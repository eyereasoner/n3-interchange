// N3 documents compiled to eyemind programs.
//
// Every N3 statement becomes rdf(Subject, Predicate, Object): the document's
// own triples are facts, and a run concludes the triples its forward rules
// derive that were not already facts. Rules become eyemind rules:
//
//   { B } => { H }.        implies(B, H)           forward
//   { H } <= { B }.        implied_by(H, B)        backward, one per head triple
//   { B } log:query { H }. implies(B, result(H))   selects the output
//   { B } => false.        contradiction(B)        an inference fuse
//
// A rule's ?variables and blank nodes are eyemind variables; a blank node
// only the conclusion mentions is the Skolem term of that firing. Built-in
// predicates of a body become goals defined in eyemind itself (builtins.mjs).
import { Struct, loadText, run, write } from 'eyemind';
import { N3SyntaxError, parseN3, LOG, XSD } from './n3-parser.mjs';
import { triplesFromEyemind } from './eyemind-to-n3.mjs';

const MATH = 'http://www.w3.org/2000/10/swap/math#';
const STRING = 'http://www.w3.org/2000/10/swap/string#';
const LIST = 'http://www.w3.org/2000/10/swap/list#';
import { BUILTINS, HELPERS, UNSUPPORTED } from './builtins.mjs';

export class N3CompileError extends Error {}

// A term or atom text as a JavaScript string literal.
const q = (text) => JSON.stringify(text);

const RESERVED = new Set(['Math', 'JSON', 'BigInt', 'Infinity', 'NaN', 'undefined', 'console', 'globalThis',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite']);

// Compile an N3 document. Options: base (IRI), source (a name for the
// header). Returns { program, prefixes, queries } where queries counts the
// log:query rules; with any, the program concludes their result/3 triples.
export function compileN3(text, { base = '', source = 'input', documents } = {}) {
  const doc = parseN3(text, { base });
  return compileN3Document(doc, { source, documents });
}

export function compileN3Document(doc, { source = 'input', documents = new Map() } = {}) {
  const facts = [];
  const rules = [];
  const needed = new Set();
  let queries = 0;
  // Only a document that mentions rdf:first, rdf:rest or rdf:nil can write a
  // list out as triples, so only its built-ins read lists that way.
  const views = ['first', 'rest', 'nil'].some((name) => mentions(doc.triples, `${RDF_NS}${name}`));
  const rulesAsTriples = doc.triples.some((x) => {
    if (x.p.t !== 'iri' || (!RULE_PREDICATES.has(x.p.v) && x.p.v !== `${LOG}query`) || !isFormulaLike(x.s) || !isFormulaLike(x.o)) return false;
    const body = triplesOf(x.p.v === `${LOG}impliedBy` ? x.o : x.s);
    return (x.p.v !== `${LOG}query` && variablePredicate(body)) || [...RULE_PREDICATES].some((p) => usesPredicate(body, p));
  });
  for (const triple of doc.triples) {
    const p = triple.p.t === 'iri' ? triple.p.v : null;
    // A rule is also a triple of the document, its variables quoted, which
    // a rule predicate or a variable predicate can find.
    if (rulesAsTriples && RULE_PREDICATES.has(p) && isFormulaLike(triple.s) && isFormulaLike(triple.o)) facts.push(`fact(${new Context(false).rdf(triple)})`);
    if (p === `${LOG}implies` && isFormulaLike(triple.s) && isFormulaLike(triple.o)) {
      rules.push(compileRule(triple.s, triple.o, 'forward', needed, views));
    } else if (p === `${LOG}impliedBy` && isFormulaLike(triple.s) && isFormulaLike(triple.o)) {
      rules.push(compileRule(triple.o, triple.s, 'backward', needed, views));
    } else if (p === `${LOG}query` && isFormulaLike(triple.s) && isFormulaLike(triple.o)) {
      queries++;
      rules.push(compileRule(triple.s, triple.o, 'query', needed, views));
    } else {
      const ctx = new Context(false);
      facts.push(`fact(${ctx.rdf(triple)})`);
    }
  }
  // The documents log:semantics and log:content read, fetched beforehand.
  let documentNumber = 0;
  const fetchedFormulas = [];
  for (const [iri, document] of documents) {
    const ctx = new Context(false);
    const subject = `iri(${q(iri)})`;
    // Errors are written as N3 reasoners write them:
    // error(dereference_failed,IRI) and error(parse_error,Message).
    if (document.error !== undefined) {
      facts.push(`fact(n3_document_error(${subject}, ${q(`error(dereference_failed,${iri.replace(/#.*$/, '')})`)}))`);
      continue;
    }
    facts.push(`fact(n3_content(${subject}, ${q(document.text)}))`);
    try {
      const parsed = parseN3(document.text, { base: iri.replace(/#.*$/, '') });
      // Its blank nodes are its own, apart from any other document's.
      const label = `d${++documentNumber}`;
      const own = (t) => (t.t === 'bnode' ? { ...t, scope: `${label}.${t.scope}` } : t.t === 'list' ? { ...t, items: t.items.map(own) }
        : t.t === 'graph' ? { ...t, triples: t.triples.map(ownTriple) } : t.t === 'triple' ? ownTriple(t) : t);
      const ownTriple = (x) => ({ ...x, s: own(x.s), p: own(x.p), o: own(x.o) });
      const formula = { t: 'graph', triples: parsed.triples.map(ownTriple), scope: 0 };
      facts.push(`fact(n3_semantics(${subject}, ${ctx.term(formula)}))`);
      fetchedFormulas.push(formula);
    } catch (error) {
      if (!(error instanceof N3SyntaxError)) throw error;
      facts.push(`fact(n3_document_error(${subject}, ${q(`error(parse_error,${error.message})`)}))`);
    }
  }
  // log:conclusion reads the closure of a formula the document states, worked
  // out now by running the formula as a program of its own.
  // A fetched document's formula counts as stated, but a closure eyemind
  // cannot work out, as for an unstratified document, is left out.
  if (usesPredicate(doc.triples, `${LOG}conclusion`)) {
    for (const formula of statedFormulas(doc.triples)) {
      const ctx = new Context(false);
      facts.push(`fact(n3_conclusion_of(${ctx.term(formula)}, ${ctx.term(closure(formula))}))`);
    }
    for (const formula of fetchedFormulas) {
      let closed;
      try {
        closed = closure(formula);
      } catch (error) {
        if (error instanceof N3CompileError || error?.name === 'EyemindError') continue;
        throw error;
      }
      const ctx = new Context(false);
      facts.push(`fact(n3_conclusion_of(${ctx.term(formula)}, ${ctx.term(closed)}))`);
    }
  }
  // log:parsedAsN3 reads the strings the document states that are N3, parsed
  // now.
  if (usesPredicate(doc.triples, `${LOG}parsedAsN3`)) {
    for (const literal of statedStrings(doc.triples)) {
      let parsed;
      try {
        parsed = parseN3(literal.v);
      } catch (error) {
        if (error instanceof N3SyntaxError) continue;
        throw error;
      }
      const ctx = new Context(false);
      facts.push(`fact(n3_parsed(${ctx.term(literal)}, ${ctx.term({ t: 'graph', triples: parsed.triples, scope: 0 })}))`);
    }
  }
  const lines = [
    `// Generated by n3-interchange from ${source.replace(/[\r\n]/g, ' ')}.`,
    '// Each N3 triple is rdf(Subject, Predicate, Object). Without a log:query',
    '// the conclusions are the triples the forward rules derive.',
    ...facts,
    ...rules.flat(),
  ];
  if (queries > 0) lines.push('query(result(S, P, O))');
  const library = libraryText(needed);
  if (library) lines.push('', '// N3 built-ins.', library);
  return { program: `${lines.join('\n')}\n`, prefixes: doc.prefixes, queries };
}

// The deductive closure of a formula: its own triples, rules included, and
// those its rules derive, run as a program of its own.
const CLOSURE_LIMITS = { maxDepth: 1000000, maxIterations: 100000, maxInferences: 100000000 };

export function closure(formula) {
  const { program } = compileN3Document({ triples: formula.triples, prefixes: new Map() }, { source: 'a formula' });
  const result = run(loadText(program, 'formula.js'), CLOSURE_LIMITS);
  const derived = triplesFromEyemind(result.answers.join('\n')).triples;
  return { t: 'graph', triples: [...formula.triples, ...derived.map(([s, p, o]) => ({ s: fromEyemind(s), p: fromEyemind(p), o: fromEyemind(o) }))], scope: formula.scope };
}

// An eyemind conclusion as the parsed term n3-to-eyemind wrote it from. A
// blank node keeps its label, and a Skolem term becomes one labelled by its
// text, the same for the same firing.
function fromEyemind(t) {
  if (typeof t === 'bigint') return { t: 'int', v: t };
  if (typeof t === 'number') return { t: 'float', v: t };
  if (t === '[]') return { t: 'list', items: [] };
  if (!(t instanceof Struct)) throw new N3CompileError(`a closure holds a term N3 cannot state: ${write(t)}`);
  const [a, b, c] = t.args;
  switch (`${t.name}/${t.args.length}`) {
    case 'iri/1': return { t: 'iri', v: a };
    case 'bnode/2': return { t: 'bnode', v: b, scope: 0 };
    case 'skolem/3': return { t: 'bnode', v: write(t), scope: 0 };
    case 'qvar/1': return { t: 'var', v: a };
    case 'qbnode/1': return { t: 'bnode', v: a, scope: 0 };
    case 'triple/3': return { t: 'triple', s: fromEyemind(a), p: fromEyemind(b), o: fromEyemind(c) };
    case 'literal/2':
      if (b instanceof Struct && b.name === 'lang') return { t: 'literal', v: a, lang: b.args[0], dir: b.args[1] ?? null, dt: '' };
      return { t: 'literal', v: a, dt: b.args[0] };
    case 'graph/1': return { t: 'graph', triples: listOf(a).map((x) => ({ s: fromEyemind(x.args[0]), p: fromEyemind(x.args[1]), o: fromEyemind(x.args[2]) })), scope: 0 };
    case './2': return { t: 'list', items: listOf(t).map(fromEyemind) };
    default: throw new N3CompileError(`a closure holds a term N3 cannot state: ${write(t)}`);
  }
}

function listOf(t) {
  const items = [];
  for (; t instanceof Struct && t.name === '.'; t = t.args[1]) items.push(t.args[0]);
  return items;
}

// Whether any term of the triples, at any depth, is the IRI.
function mentions(triples, iri) {
  const term = (t) => (t.t === 'iri' ? t.v === iri : t.t === 'graph' ? mentions(t.triples, iri)
    : t.t === 'list' ? t.items.some(term) : t.t === 'triple' ? [t.s, t.p, t.o].some(term) : false);
  return triples.some((x) => [x.s, x.p, x.o].some(term));
}

function usesPredicate(triples, iri) {
  return triples.some((x) => (x.p.t === 'iri' && x.p.v === iri) || [x.s, x.o].some((t) => termUses(t, iri)));
}
function termUses(t, iri) {
  if (t.t === 'graph') return usesPredicate(t.triples, iri);
  if (t.t === 'list') return t.items.some((x) => termUses(x, iri));
  return false;
}

// The plain strings the document's own facts state, each once.
function statedStrings(triples) {
  const found = new Map();
  const visit = (t) => {
    if (t.t === 'literal' && t.dt === `${XSD}string`) found.set(t.v, t);
    else if (t.t === 'list') t.items.forEach(visit);
  };
  for (const x of triples) [x.s, x.o].forEach(visit);
  return [...found.values()];
}

// The formulas the document's own facts state, each once, outermost first.
function statedFormulas(triples) {
  const found = [];
  const visit = (t) => {
    if (t.t === 'graph') found.push(t);
    else if (t.t === 'list') t.items.forEach(visit);
  };
  for (const x of triples) {
    const rule = x.p.t === 'iri' && [`${LOG}implies`, `${LOG}impliedBy`, `${LOG}query`].includes(x.p.v) && isFormulaLike(x.s) && isFormulaLike(x.o);
    if (!rule) [x.s, x.o].forEach(visit);
  }
  return found;
}

const RULE_PREDICATES = new Set([`${LOG}implies`, `${LOG}impliedBy`]);

// Whether a pattern, at any depth of quoted formulas, has a variable predicate.
function variablePredicate(triples) {
  const term = (t) => (t.t === 'graph' ? variablePredicate(t.triples) : t.t === 'list' ? t.items.some(term) : false);
  return triples.some((x) => x.p.t === 'var' || x.p.t === 'bnode' || term(x.s) || term(x.o));
}

const isFormulaLike = (t) => t.t === 'graph' || (t.t === 'literal' && t.dt === `${XSD}boolean`);
const isTrue = (t) => t.t === 'literal' && t.dt === `${XSD}boolean` && t.v === 'true';
const isFalse = (t) => t.t === 'literal' && t.dt === `${XSD}boolean` && t.v === 'false';
const triplesOf = (t) => (t.t === 'graph' ? t.triples : []);

// The definitions a program's built-ins need, each once, helpers first.
function libraryText(needed) {
  const done = new Set();
  const out = [];
  const visit = (name, entry) => {
    if (done.has(name)) return;
    done.add(name);
    for (const dep of entry.needs ?? []) visit(dep, HELPERS[dep]);
    if (entry.text) out.push(entry.text.trim());
  };
  for (const name of [...needed].sort()) visit(name, BUILTINS.get(name) ?? HELPERS[name]);
  return out.join('\n');
}

// Naming for one clause: variables for ?names and, in rules, blank nodes.
class Context {
  constructor(inRule) {
    this.inRule = inRule;
    this.names = new Map();
    this.used = new Set();
    this.anonymous = new Set();
    this.anonCount = 0;
    this.quoted = null;
  }

  name(key, hint) {
    if (this.names.has(key)) return this.names.get(key);
    let base;
    if (this.anonymous.has(key)) {
      // A variable only a negation mentions: _N names are anonymous to it.
      do base = `_${++this.anonCount}`; while (this.used.has(base));
    } else {
      base = hint.replace(/[^A-Za-z0-9_]/g, '_');
      if (/^[a-z]/.test(base)) base = base[0].toUpperCase() + base.slice(1);
      if (!/^[A-Z]/.test(base) || RESERVED.has(base) || base.startsWith('VAR_')) base = `V${base}`;
      let name = base;
      for (let k = 2; this.used.has(name); k++) name = `${base}_${k}`;
      base = name;
    }
    this.used.add(base);
    this.names.set(key, base);
    return base;
  }

  term(t) {
    if (this.quoted && (t.t === 'var' || (t.t === 'bnode' && this.inRule))) {
      const key = t.t === 'var' ? `v:${t.v}` : bnodeKey(t);
      if (this.quoted.has(key)) return t.t === 'var' ? `qvar(${q(t.v)})` : `qbnode(${q(t.v.replace(/^#/, 'b'))})`;
    }
    switch (t.t) {
      case 'iri': return `iri(${q(t.v)})`;
      // Outside rules a variable belongs to a quoted formula: a constant.
      case 'var': return this.inRule ? this.name(`v:${t.v}`, t.v) : `qvar(${q(t.v)})`;
      case 'bnode':
        if (this.inRule) return this.name(bnodeKey(t), `B${t.v.replace(/^#/, '')}`);
        return `bnode('n3', ${q(bnodeLabel(t))})`;
      case 'int': return t.v >= -(2n ** 53n) && t.v <= 2n ** 53n ? String(t.v) : `${t.v}n`;
      case 'float': return `float(${Object.is(t.v, -0) ? '-0' : String(t.v)})`;
      case 'literal':
        if (t.lang) return `literal(${q(t.v)}, ${t.dir ? `lang(${q(t.lang)}, ${q(t.dir)})` : `lang(${q(t.lang)})`})`;
        return `literal(${q(t.v)}, datatype(${q(t.dt)}))`;
      case 'list': return `[${t.items.map((x) => this.term(x)).join(', ')}]`;
      case 'graph': return `graph([${t.triples.map((x) => this.rdf(x)).join(', ')}])`;
      case 'triple': return `triple(${this.term(t.s)}, ${this.term(t.p)}, ${this.term(t.o)})`;
      default: throw new N3CompileError(`unknown term ${t.t}`);
    }
  }

  rdf(x, name = 'rdf') {
    return `${name}(${this.term(x.s)}, ${this.term(x.p)}, ${this.term(x.o)})`;
  }
}

const bnodeKey = (t) => `b:${t.scope}:${t.v}`;
const bnodeLabel = (t) => (t.scope === 0 ? t.v : `${t.v}.${t.scope}`);

// Variable keys a term mentions, rule blank nodes included.
function keysOf(t, out = new Set()) {
  if (t.t === 'var') out.add(`v:${t.v}`);
  else if (t.t === 'bnode') out.add(bnodeKey(t));
  else if (t.t === 'list') t.items.forEach((x) => keysOf(x, out));
  else if (t.t === 'graph') t.triples.forEach((x) => keysOfTriple(x, out));
  else if (t.t === 'triple') keysOfTriple(t, out);
  return out;
}
function keysOfTriple(x, out = new Set()) {
  keysOf(x.s, out);
  keysOf(x.p, out);
  keysOf(x.o, out);
  return out;
}

// Where a regular-expression built-in takes its pattern: the object, or an
// item of the subject list.
const REGEX_PATTERN = new Map([
  [`${STRING}matches`, 'o'], [`${STRING}notMatches`, 'o'], [`${STRING}replace`, 1], [`${STRING}scrape`, 1],
]);

// N3 patterns are often written for regular expressions that let any
// character be escaped, as in "\\:", and a brace stand for itself; eyemind
// reads ECMAScript patterns in Unicode mode, where neither is allowed. A
// constant pattern loses the backslash before other punctuation and has a
// brace that is no quantifier escaped, which means the same.
function unicodePattern(pattern) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) {
      const next = pattern[++i];
      // \p{L}, \P{L} and \u{1F600} keep their braces.
      const braced = /^[pPu]\{[^}]*\}/.exec(pattern.slice(i));
      if (braced) {
        out += `\\${braced[0]}`;
        i += braced[0].length - 1;
      } else out += /[A-Za-z0-9^$.*+?()[\]{}|/\\-]/.test(next) ? `\\${next}` : next;
    } else if (inClass) {
      if (c === ']') inClass = false;
      out += c;
    } else if (c === '[') {
      inClass = true;
      out += c;
    } else if (c === '{') {
      const quantifier = /^\{[0-9]+(,[0-9]*)?\}/.exec(pattern.slice(i));
      if (quantifier) {
        out += quantifier[0];
        i += quantifier[0].length - 1;
      } else out += '\\{';
    } else out += c === '}' ? '\\}' : c;
  }
  return out;
}

function withPattern(x, where) {
  const fix = (t) => (t.t === 'literal' ? { ...t, v: unicodePattern(t.v) } : t);
  if (where === 'o') return { ...x, o: fix(x.o) };
  if (x.s.t !== 'list' || x.s.items.length <= where) return x;
  const items = [...x.s.items];
  items[where] = fix(items[where]);
  return { ...x, s: { ...x.s, items } };
}

const SCOPED_SUBJECT = new Set([`${LOG}includes`, `${LOG}notIncludes`]);
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
// The argument positions where a built-in takes a list, which may be written
// out as rdf:first and rdf:rest triples.
const LIST_SUBJECT = new Set([
  ...['sum', 'product', 'difference', 'quotient', 'integerQuotient', 'remainder', 'exponentiation', 'atan2', 'logarithm',
    'min', 'max'].map((n) => `${MATH}${n}`),
  ...['concatenation', 'format', 'replace', 'scrape', 'substring'].map((n) => `${STRING}${n}`),
  ...['dtlit', 'langlit', 'conjunction', 'skolem', 'equalTo', 'notEqualTo'].map((n) => `${LOG}${n}`),
]);
const LIST_OBJECT = new Set([`${LOG}equalTo`, `${LOG}notEqualTo`]);
function takesList(p, position) {
  // list: built-ins take lists on both sides, but for the element of
  // list:in and list:member.
  if (p.startsWith(LIST)) return !(position === 's' && p === `${LIST}in`) && !(position === 'o' && p === `${LIST}member`);
  return position === 's' ? LIST_SUBJECT.has(p) : LIST_OBJECT.has(p);
}
const SCOPED_OBJECT = new Set([`${LOG}collectAllIn`, `${LOG}forAllIn`]);

function compileRule(body, head, kind, needed, views = true) {
  const ctx = new Context(true);
  if (!isFormulaLike(body)) throw new N3CompileError('a rule premise must be a formula');
  const bodyTriples = triplesOf(body);
  const headKeys = keysOf(head);
  // A ?variable or blank node that stands only as the scope of a scoped
  // built-in means the whole store, as in ?SCOPE log:notIncludes { ... }.
  const scopes = scopeTerms(bodyTriples, headKeys);
  const outside = (skip) => {
    const keys = new Set(headKeys);
    for (const x of bodyTriples) if (x !== skip) keysOfTriple(x, keys);
    return keys;
  };
  const goals = (triples, negated) => triples.flatMap((x) => goal(x, negated));
  // A body triple with variables, none of which another body triple, or an
  // enclosing rule, can bind.
  const unconstrained = (x) => {
    const keys = keysOfTriple(x);
    if (!keys.size || bodyTriples.indexOf(x) < 0 || ![x.s, x.o].every((t) => t.t === 'var' || t.t === 'bnode')) return false;
    // A backward rule's caller binds its conclusion's variables.
    if (kind === 'backward' && [...keys].some((key) => headKeys.has(key))) return false;
    for (const y of bodyTriples) if (y !== x) for (const key of keysOfTriple(y)) if (keys.has(key)) return false;
    return true;
  };
  // How many negations or collections the goal being compiled is inside.
  let closed = 0;
  let listViews = 0;
  const conj = (gs) => (gs.length === 0 ? "'true'" : gs.length === 1 ? gs[0] : `[${gs.join(', ')}]`);

  // Name a negated formula's own variables anonymously, so negation lets
  // them stand for any value.
  const markAnonymous = (formulaTerms, skip) => {
    const out = outside(skip);
    for (const t of formulaTerms) for (const key of keysOf(t)) if (!out.has(key) && !ctx.names.has(key)) ctx.anonymous.add(key);
  };

  function goal(x, negated) {
    const p = x.p.t === 'iri' ? x.p.v : null;
    if (p === null) return [ctx.rdf(x)];
    if (UNSUPPORTED.has(p)) throw new N3CompileError(`${shortName(p)} is not supported: eyemind has no ${UNSUPPORTED.get(p)}`);
    if (SCOPED_SUBJECT.has(p)) {
      const neg = p === `${LOG}notIncludes`;
      if (x.o.t !== 'graph') {
        // A formula only known when the rule runs; anything else, or the
        // store against a formula not written out, includes nothing.
        if (x.o.t !== 'var' || isScope(x.s, scopes)) return ["'fail'"];
        needed.add('n3_includes');
        return [`${neg ? 'n3_not_includes' : 'n3_includes'}(${ctx.term(x.s)}, ${ctx.term(x.o)})`];
      }
      if (neg && !negated) markAnonymous([x.o], x);
      if (isScope(x.s, scopes)) {
        if (neg) closed++;
        const inner = goals(x.o.triples, negated || neg);
        if (neg) closed--;
        return neg ? [`not(${conj(inner)})`] : inner;
      }
      needed.add('n3_includes');
      return [`${neg ? 'n3_not_includes' : 'n3_includes'}(${ctx.term(x.s)}, graph([${x.o.triples.map((y) => ctx.rdf(y)).join(', ')}]))`];
    }
    if (SCOPED_OBJECT.has(p)) {
      // The formulas must be written in the rule: eyemind cannot call a
      // formula only known when the rule runs, so such a goal fails.
      const count = p === `${LOG}forAllIn` ? 2 : 3;
      if (x.s.t !== 'list' || x.s.items.length !== count || x.s.items[count === 2 ? 0 : 1].t !== 'graph' ||
          x.s.items[1].t !== 'graph') return ["'fail'"];
      closed++;
      try {
        if (p === `${LOG}collectAllIn`) {
          const [template, where, list] = x.s.items;
          return [`findall(${ctx.term(template)}, ${conj(goals(where.triples, negated))}, ${ctx.term(list)})`];
        }
        const [where, then] = x.s.items;
        if (!negated) markAnonymous([where, then], x);
        return [`not(${conj([...goals(where.triples, true), `not(${conj(goals(then.triples, true))})`])})`];
      } finally {
        closed--;
      }
    }
    if (p === `${LIST}map`) {
      // ((L) P) list:map R: the objects of P for each member of L, in order,
      // with the predicate inlined so its dependencies stay precise.
      if (x.s.t !== 'list' || x.s.items.length !== 2) throw new N3CompileError('list:map needs a subject (List Predicate)');
      needed.add('n3_member');
      const [list, pred] = x.s.items.map((t) => ctx.term(t));
      const [e, y] = [ctx.name(`map:e:${++ctx.anonCount}`, 'E_map'), ctx.name(`map:y:${ctx.anonCount}`, 'Y_map')];
      return [`findall(${y}, [n3_member(${e}, ${list}), rdf(${e}, ${pred}, ${y})], ${ctx.term(x.o)})`];
    }
    if (p === `${LOG}parsedAsN3`) {
      // A string written in the rule is parsed now, and compared with the
      // object as a formula; one known when the rule runs is looked up among
      // the strings the document states, parsed now too; text that is not
      // N3 gives no formula.
      if (x.s.t !== 'literal') {
        needed.add(p);
        return [`n3_log_parsedAsN3(${ctx.term(x.s)}, ${ctx.term(x.o)})`];
      }
      let parsed;
      try {
        parsed = parseN3(x.s.v);
      } catch (error) {
        if (error instanceof N3SyntaxError) return ["'fail'"];
        throw error;
      }
      needed.add(`${LOG}equalTo`);
      return [`n3_log_equalTo(${new Context(false).term({ t: 'graph', triples: parsed.triples, scope: 1 })}, ${ctx.term(x.o)})`];
    }
    if ((p === `${LOG}equalTo` || p === `${LOG}notEqualTo`) && [x.s, x.o].some((t) => !['var', 'bnode', 'graph', 'list'].includes(t.t))) {
      // A constant that is no formula: equality is unification.
      return [`${p === `${LOG}equalTo` ? 'unify' : 'not_unify'}(${ctx.term(x.s)}, ${ctx.term(x.o)})`];
    }
    if (p === `${LOG}conclusion` && x.s.t === 'graph') {
      // A formula written in the rule, sharing no variable with it, has its
      // closure worked out now.
      const out = outside(x);
      if (![...keysOf(x.s)].some((key) => out.has(key))) {
        needed.add(p);
        return [`n3_conclusion_result(${new Context(false).term(closure(x.s))}, ${ctx.term(x.o)})`];
      }
    }
    if (REGEX_PATTERN.has(p)) x = withPattern(x, REGEX_PATTERN.get(p));
    const builtin = BUILTINS.get(p);
    if (builtin && !negated && !closed && unconstrained(x)) {
      // Every variable of the built-in is unbound and no other goal of the
      // premise mentions it: nothing can be computed, and the goal holds
      // without binding anything, as in N3 reasoners.
      return [];
    }
    if (builtin) {
      if (builtin.text) needed.add(p);
      // A list a built-in receives may be written out as rdf:first and
      // rdf:rest triples; n3_as_list reads it as a list, and passes anything
      // else on as it is. Inside a negation or collection it would make the
      // rule depend on every rule that concludes such triples, so there it
      // is left out.
      const viewGoals = [];
      const arg = (t, item = false) => {
        // The items of a written list may be written-out lists too.
        if (t.t === 'list' && views && !item && !closed && takesList(p, position)) return `[${t.items.map((i) => arg(i, true)).join(', ')}]`;
        if (!views || closed || !takesList(p, position) || (t.t !== 'var' && t.t !== 'bnode')) return ctx.term(t);
        needed.add('n3_as_list');
        const key = `list:${++listViews}`;
        ctx.anonymous.add(key);
        const view = ctx.name(key, 'L');
        viewGoals.push(`n3_as_list(${ctx.term(t)}, ${view})`);
        return view;
      };
      let position = 's';
      const s = arg(x.s);
      position = 'o';
      const o = arg(x.o);
      return [...viewGoals, `${builtin.goal}(${s}, ${o})`];
    }
    return [ctx.rdf(x)];
  }

  // A backward rule's conclusion arrives bound from the goal that calls it.
  const premise = conj(goals(reorder(bodyTriples, outside, kind === 'backward' ? headKeys : new Set()), false));

  if (isFalse(head)) return [`contradiction(${premise})`];
  const headTriples = triplesOf(head);
  if (headTriples.length === 0) return [];
  if (kind === 'backward') {
    return headTriples.map((h) => `implied_by(${ctx.rdf(h)}, ${premise})`);
  }
  const heads = headTriples.flatMap((h) => headTerm(h, kind));
  return [`implies(${premise}, ${heads.length === 1 ? heads[0] : `[${heads.join(', ')}]`})`];

  // A conclusion: a triple, or a rule the firing states. captured holds the
  // variables the enclosing premises bind; a derived rule's conclusion may
  // state rules in turn.
  function headTerm(h, k, captured = null) {
    const p = h.p.t === 'iri' ? h.p.v : null;
    if (k === 'forward' && (p === `${LOG}implies` || p === `${LOG}impliedBy`) && isFormulaLike(h.s) && isFormulaLike(h.o)) {
      const [b, c] = p === `${LOG}implies` ? [h.s, h.o] : [h.o, h.s];
      const inner = conj(goals(triplesOf(b), false));
      const cs = triplesOf(c);
      if (cs.length === 0) throw new N3CompileError('a derived rule needs a conclusion');
      if (captured === null) {
        captured = new Set();
        for (const x of bodyTriples) if (!(BUILTINS.has(x.p.v) && unconstrained(x))) keysOfTriple(x, captured);
      }
      // The firing also concludes the rule as a triple, its own variables
      // quoted as qvar(Name) and qbnode(Label), as N3 reasoners report derived rules.
      ctx.quoted = new Set([...keysOfTriple(h)].filter((key) => !captured.has(key)));
      const asTriple = ctx.rdf(h);
      ctx.quoted = null;
      if (p === `${LOG}impliedBy`) return [...cs.map((y) => `implied_by(${ctx.rdf(y)}, ${inner})`), asTriple];
      const within = new Set(captured);
      keysOf(b, within);
      const conclusions = cs.flatMap((y) => headTerm(y, k, within));
      return [`implies(${inner}, ${conclusions.length === 1 ? conclusions[0] : `[${conclusions.join(', ')}]`})`, asTriple];
    }
    return [ctx.rdf(h, k === 'query' ? 'result' : 'rdf')];
  }
}

// Built-ins that only test their arguments; the others compute their object
// from their subject.
const TESTS = new Set([
  ...['greaterThan', 'lessThan', 'notGreaterThan', 'notLessThan', 'equalTo', 'notEqualTo'].map((n) => `${MATH}${n}`),
  ...['greaterThan', 'lessThan', 'notGreaterThan', 'notLessThan', 'equalTo', 'notEqualTo', 'contains', 'containsIgnoringCase',
    'startsWith', 'endsWith', 'equalIgnoringCase', 'notEqualIgnoringCase'].map((n) => `${STRING}${n}`),
  `${LOG}notEqualTo`, `${LOG}notIncludes`, `${LOG}forAllIn`, `${LIST}notMember`,
]);
const INLINE = new Set([`${LIST}map`]);
// Built-ins that also run from a bound object to their subject.
const REVERSIBLE = new Set([`${LIST}firstRest`, `${LIST}append`, `${LOG}uri`, `${LOG}dtlit`, `${LOG}langlit`,
  ...['negation', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'degrees', 'radians'].map((n) => `${MATH}${n}`)]);

// Body triples in evaluation order. A built-in waits for the goals after it
// that bind its inputs (a test's every variable, another built-in's
// subject): ordinary triples, and built-ins that compute their object, so
// { ?a log:notEqualTo ?b. ?x :p ?a. ?y :p ?b } compares bound values and
// { (?x 1) math:sum ?y. (1 2 3) list:iterate (?i ?x) } adds to a bound ?x.
// Otherwise the written order stays.
function reorder(triples, outside, given) {
  const isPlain = (x) => x.p.t !== 'iri' || (!BUILTINS.has(x.p.v) && !INLINE.has(x.p.v) && !TESTS.has(x.p.v) && !SCOPED_SUBJECT.has(x.p.v) && !SCOPED_OBJECT.has(x.p.v));
  const inputs = (x) => {
    if (isPlain(x)) return new Set();
    const p = x.p.v;
    if (p === `${LOG}includes` || p === `${LOG}equalTo`) return new Set();
    // Only variables shared with the rest of the rule are inputs; a
    // collection's are those of its template and formula.
    const out = outside(x);
    const keys = TESTS.has(p) ? keysOfTriple(x) : p === `${LOG}collectAllIn` ? keysOf({ t: 'list', items: x.s.items?.slice(0, 2) ?? [] }) : keysOf(x.s);
    return new Set([...keys].filter((k) => out.has(k)));
  };
  const order = [];
  const bound = new Set(given);
  // What the premise itself binds: a backward rule's conclusion is usually,
  // but not always, bound by its caller, too weak a ground to run a
  // built-in backward on.
  const placed = new Set();
  const pending = [];
  // What a goal binds: an ordinary triple its variables, a test nothing, a
  // collection its list, and another built-in its object.
  const binds = (x, keys) => {
    if (isPlain(x)) return keysOfTriple(x, keys);
    const p = x.p.v;
    if (TESTS.has(p) || SCOPED_SUBJECT.has(p)) return keys;
    if (p === `${LOG}collectAllIn`) return x.s.t === 'list' && x.s.items[2] ? keysOf(x.s.items[2], keys) : keys;
    // One that also runs backward binds in the direction the premise
    // supports: its object once its subject is bound, its subject once
    // other goals of the premise bind its object, and otherwise nothing.
    if (REVERSIBLE.has(p)) {
      const others = later(0, x);
      const known = (key) => bound.has(key) || others.has(key);
      if ([...keysOf(x.s)].every(known)) return keysOf(x.o, keys);
      if ([...keysOf(x.o)].every((key) => placed.has(key) || others.has(key))) return keysOf(x.s, keys);
      return keys;
    }
    return keysOf(x.o, keys);
  };
  // What the goals from position i bind, leaving one out and leaving out
  // those that also run backward, which keeps this from looping.
  const later = (i, skip = null) => {
    const keys = new Set();
    for (let k = i; k < triples.length; k++) {
      const y = triples[k];
      if (y !== skip && !(REVERSIBLE.has(y.p.v ?? '') && !isPlain(y))) binds(y, keys);
    }
    return keys;
  };
  const place = (x) => {
    order.push(x);
    keysOfTriple(x, bound);
    keysOfTriple(x, placed);
  };
  triples.forEach((x, i) => {
    if (isPlain(x)) place(x);
    else pending.push(x);
    const rest = new Set();
    for (let k = i + 1; k < triples.length; k++) binds(triples[k], rest);
    for (let k = 0; k < pending.length;) {
      const x = pending[k];
      // It waits for later goals, and for pending ones, that bind its inputs.
      const binders = new Set(rest);
      for (const y of pending) if (y !== x) binds(y, binders);
      const coming = (keys) => [...keys].some((key) => !bound.has(key) && binders.has(key));
      // One that also runs backward is ready once either side is bound,
      // and otherwise waits for whatever binds either side.
      const reversible = REVERSIBLE.has(x.p.v);
      const ready = reversible && ([...keysOf(x.s)].every((key) => bound.has(key)) || [...keysOf(x.o)].every((key) => placed.has(key)));
      const waiting = !ready && (coming(inputs(x)) || (reversible && coming(keysOf(x.o))));
      if (waiting) { k++; continue; }
      place(pending.splice(k, 1)[0]);
      k = 0;
    }
  });
  return [...order, ...pending];
}

function scopeTerms(triples, headKeys) {
  const candidates = new Map();
  const elsewhere = new Set(headKeys);
  for (const x of triples) {
    const p = x.p.t === 'iri' ? x.p.v : null;
    let scope = null;
    if (SCOPED_SUBJECT.has(p) && (x.s.t === 'var' || x.s.t === 'bnode')) scope = x.s;
    if (SCOPED_OBJECT.has(p) && (x.o.t === 'var' || x.o.t === 'bnode')) scope = x.o;
    for (const t of [x.s, x.p, x.o]) {
      if (t === scope) candidates.set([...keysOf(t)][0], true);
      else keysOf(t, elsewhere);
    }
  }
  return new Set([...candidates.keys()].filter((k) => !elsewhere.has(k)));
}

// A number or other constant scope, as in 1 log:notIncludes { ... }, also
// means the store.
const isScope = (t, scopes) => ((t.t === 'var' || t.t === 'bnode') ? scopes.has([...keysOf(t)][0]) : !['graph', 'list'].includes(t.t));

const SHORT = [['http://www.w3.org/2000/10/swap/', ''], [XSD, 'xsd:']];
function shortName(iri) {
  for (const [ns, pre] of SHORT) {
    if (iri.startsWith(ns)) {
      const rest = iri.slice(ns.length);
      return pre ? pre + rest : rest.replace('#', ':');
    }
  }
  return `<${iri}>`;
}
