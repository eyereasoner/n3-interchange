// eyemind conclusions written back as N3.
//
// The conclusions of a compiled program are rdf/3 terms, or result/3 terms
// when it has log:query rules. Terms map back as n3-to-eyemind wrote them; a
// Skolem term skolem(Rule, Variable, Arguments) is a blank node, the same one
// for the same rule firing.
import { readTerms, write, Struct, Var } from 'eyemind';
import { LOG, RDF, XSD } from './n3-parser.mjs';

export class N3WriteError extends Error {}

// The triples of an eyemind conclusions document, in order and without
// duplicates. Also reports whether a contradiction halted the run.
export function triplesFromEyemind(text) {
  const triples = [];
  const seen = new Set();
  let contradiction = false;
  for (const [term] of readTerms(String(text))) {
    if (term === 'false') { contradiction = true; continue; }
    const t = tripleTerm(term);
    if (!t) continue;
    const k = write(t);
    if (seen.has(k)) continue;
    seen.add(k);
    triples.push(t.args);
  }
  return { triples, contradiction };
}

function tripleTerm(term) {
  if (!(term instanceof Struct)) return null;
  if ((term.name === 'rdf' || term.name === 'result') && term.args.length === 3) return term;
  return null;
}

// N3 text for triples given as [S, P, O] eyemind terms. With strings
// 'auto', a result that has log:outputString triples is written as their
// strings, ordered by subject, as N3 reasoners do.
export function writeN3(triples, { prefixes = new Map(), strings = 'auto' } = {}) {
  const w = new Writer(prefixes);
  const outputs = triples.filter(([, p]) => isIri(p, `${LOG}outputString`));
  if (strings === true || (strings === 'auto' && outputs.length > 0)) {
    const keyed = outputs.map(([s, , o], i) => ({ s, o, i }));
    keyed.sort((a, b) => compareKeys(a.s, b.s) || a.i - b.i);
    return keyed.map(({ o }) => stringValue(o)).join('');
  }
  const body = triples.map(([s, p, o]) => `${w.term(s)} ${w.predicate(p)} ${w.term(o)} .`);
  const used = [...prefixes].filter(([name]) => w.used.has(name));
  const head = used.map(([name, ns]) => `@prefix ${name}: <${ns}> .`);
  if (head.length && body.length) head.push('');
  return [...head, ...body].map((line) => `${line}\n`).join('');
}

export function eyemindToN3(text, options = {}) {
  return writeN3(triplesFromEyemind(text).triples, options);
}

// A parsed N3 term as the eyemind term n3-to-eyemind writes for it.
export function termToEyemind(t) {
  const st = (name, ...args) => new Struct(name, args);
  switch (t.t) {
    case 'iri': return new Struct('iri', [t.v]);
    case 'var': return new Var(t.v);
    case 'bnode': return st('bnode', 'n3', t.scope === 0 ? t.v : `${t.v}.${t.scope}`);
    case 'int': return t.v;
    case 'float': return t.v;
    case 'literal': return st('literal', t.v, t.lang ? (t.dir ? st('lang', t.lang, t.dir) : st('lang', t.lang)) : st('datatype', t.dt));
    case 'list': return t.items.reduceRight((tail, x) => st('.', termToEyemind(x), tail), '[]');
    case 'graph': return st('graph', t.triples.reduceRight((tail, x) => st('.', st('rdf', ...tripleToEyemind(x)), tail), '[]'));
    case 'triple': return st('triple', ...tripleToEyemind(t));
    default: throw new N3WriteError(`unknown term ${t.t}`);
  }
}
export const tripleToEyemind = (x) => [termToEyemind(x.s), termToEyemind(x.p), termToEyemind(x.o)];

const isIri = (t, v) => t instanceof Struct && t.name === 'iri' && t.args[0] === v;

function stringValue(o) {
  if (o instanceof Struct && o.name === 'literal') return o.args[0];
  if (typeof o === 'bigint' || typeof o === 'number') return String(o);
  if (o instanceof Struct && o.name === 'iri') return o.args[0];
  throw new N3WriteError('a log:outputString object must be a literal');
}

// Subject order for strings: numbers by value before other terms, which
// compare by their text.
function compareKeys(a, b) {
  const na = typeof a === 'bigint' || typeof a === 'number';
  const nb = typeof b === 'bigint' || typeof b === 'number';
  if (na && nb) return a < b ? -1 : a > b ? 1 : 0;
  if (na !== nb) return na ? -1 : 1;
  const ta = write(a);
  const tb = write(b);
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

const PN_LOCAL = /^(?:[A-Za-z_0-9À-�]|:)(?:[A-Za-z_0-9·À-�.:-]*[A-Za-z_0-9·À-�:-])?$/u;

class Writer {
  constructor(prefixes) {
    this.prefixes = [...prefixes].sort((a, b) => b[1].length - a[1].length);
    this.used = new Set();
    this.bnodes = new Map();
  }

  iri(v) {
    for (const [name, ns] of this.prefixes) {
      if (v.startsWith(ns)) {
        const local = v.slice(ns.length);
        if (local === '' || PN_LOCAL.test(local)) {
          this.used.add(name);
          return `${name}:${local}`;
        }
      }
    }
    return `<${v.replace(/[\u0000- <>"{}|^`\\]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}>`;
  }

  predicate(p) {
    if (isIri(p, `${RDF}type`)) return 'a';
    if (isIri(p, `${LOG}implies`)) return '=>';
    if (isIri(p, `${LOG}impliedBy`)) return '<=';
    return this.term(p);
  }

  bnode(key) {
    if (!this.bnodes.has(key)) this.bnodes.set(key, `_:b${this.bnodes.size}`);
    return this.bnodes.get(key);
  }

  term(t) {
    if (typeof t === 'bigint') return String(t);
    if (typeof t === 'number') return floatText(t);
    if (t instanceof Var) return `?${t.name.replace(/[^A-Za-z0-9_]/g, '_')}`;
    if (t === '[]') return '()';
    if (typeof t === 'string') throw new N3WriteError(`the atom ${JSON.stringify(t)} is not an N3 term`);
    if (!(t instanceof Struct)) throw new N3WriteError('not an N3 term');
    const [a, b, c] = t.args;
    if (t.name === 'iri' && t.args.length === 1) return this.iri(a);
    if (t.name === 'qvar' && t.args.length === 1 && typeof a === 'string') return `?${a.replace(/[^A-Za-z0-9_]/g, '_')}`;
    if (t.name === 'qbnode' && t.args.length === 1 && typeof a === 'string') return `_:${a.replace(/[^A-Za-z0-9_]/g, '_')}`;
    if (t.name === 'bnode' && t.args.length === 2) return this.bnode(`bnode ${write(t)}`);
    if (t.name === 'skolem' && t.args.length === 3) return this.bnode(`skolem ${write(t)}`);
    if (t.name === 'literal' && t.args.length === 2) return this.literal(a, b);
    if (t.name === 'triple' && t.args.length === 3) return `<<( ${this.term(a)} ${this.predicate(b)} ${this.term(c)} )>>`;
    if (t.name === 'graph' && t.args.length === 1) {
      const items = listItems(a).map((x) => {
        if (!(x instanceof Struct && x.name === 'rdf' && x.args.length === 3)) throw new N3WriteError('a formula holds rdf/3 triples');
        return `${this.term(x.args[0])} ${this.predicate(x.args[1])} ${this.term(x.args[2])}`;
      });
      return items.length ? `{ ${items.join('. ')} }` : '{}';
    }
    if (t.name === '.' && t.args.length === 2) return `(${listItems(t).map((x) => this.term(x)).join(' ')})`;
    throw new N3WriteError(`${write(t)} is not an N3 term`);
  }

  literal(text, annotation) {
    const lex = quoteString(text);
    if (annotation instanceof Struct && annotation.name === 'lang') {
      const [lang, dir] = annotation.args;
      return `${lex}@${lang}${dir ? `--${dir}` : ''}`;
    }
    if (annotation instanceof Struct && annotation.name === 'datatype') {
      const dt = annotation.args[0];
      if (dt === `${XSD}string`) return lex;
      if (dt === `${XSD}boolean` && (text === 'true' || text === 'false')) return text;
      return `${lex}^^${this.iri(dt)}`;
    }
    throw new N3WriteError('a literal needs datatype(IRI) or lang(Tag)');
  }
}

function listItems(t) {
  const items = [];
  while (t instanceof Struct && t.name === '.' && t.args.length === 2) {
    items.push(t.args[0]);
    t = t.args[1];
  }
  if (t !== '[]') throw new N3WriteError('an open list is not an N3 term');
  return items;
}

// A float as an N3 decimal, or a double when it needs an exponent.
function floatText(v) {
  if (Object.is(v, -0)) return '-0.0';
  const s = String(v);
  if (/e/.test(s)) return s.replace('e+', 'e');
  return s.includes('.') ? s : `${s}.0`;
}

function quoteString(text) {
  if (text.includes('\n') && !text.includes('"""') && !text.endsWith('"')) {
    return `"""${text.replace(/\\/g, '\\\\')}"""`;
  }
  return `"${text.replace(/[\\"\n\r\t]/g, (c) => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c])}"`;
}
