// Notation3 documents read into plain terms and triples.
//
// The parser accepts the N3 syntax used by rule programs: prefixes and base,
// IRIs and prefixed names, literals with language or datatype, numbers and
// booleans, blank nodes, collections, quoted formulas, universal variables,
// the verbs a, =, =>, <=, has and is ... of, inverse <-, and the paths ! and ^.
// It never evaluates anything; rules are triples whose predicate is
// log:implies, log:impliedBy or log:query.
//
// Terms:
//   { t: 'iri', v }                       an IRI
//   { t: 'bnode', v, scope }              a blank node, labelled within a formula scope
//   { t: 'literal', v, dt, lang, dir }    a literal; dt is an IRI text
//   { t: 'int', v } / { t: 'float', v }   numbers: a BigInt, a finite binary64
//   { t: 'var', v }                       a universal variable, ?name
//   { t: 'list', items }                  a collection
//   { t: 'graph', triples, scope }        a quoted formula
//   { t: 'triple', s, p, o }              an RDF 1.2 triple term
// A triple is { s, p, o }.

export const XSD = 'http://www.w3.org/2001/XMLSchema#';
export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const LOG = 'http://www.w3.org/2000/10/swap/log#';
export const OWL = 'http://www.w3.org/2002/07/owl#';

export class N3SyntaxError extends SyntaxError {
  constructor(message, line) {
    super(`N3 syntax, line ${line}: ${message}`);
    this.line = line;
  }
}

const NUMBER = /[+-]?(?:[0-9]+\.[0-9]*[eE][+-]?[0-9]+|\.[0-9]+[eE][+-]?[0-9]+|[0-9]+[eE][+-]?[0-9]+|[0-9]*\.[0-9]+|[0-9]+)/y;
const PUNCT = ['^^', '=>', '<=', '<-', '.', ';', ',', '[', ']', '(', ')', '{', '}', '=', '!', '^'];

function isPnCharsBase(c) {
  return /[A-Za-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/u.test(c) ||
    (c.codePointAt(0) >= 0x10000 && c.codePointAt(0) <= 0xEFFFF);
}
const isPnCharsU = (c) => isPnCharsBase(c) || c === '_';
const isPnChars = (c) => isPnCharsU(c) || c === '-' || /[0-9·̀-ͯ‿-⁀]/u.test(c);

function decodeEscapes(text, line) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '\\') { out += c; continue; }
    const e = text[++i];
    const simple = { t: '\t', b: '\b', n: '\n', r: '\r', f: '\f', '"': '"', "'": "'", '\\': '\\' };
    if (simple[e] !== undefined) out += simple[e];
    else if (e === 'u' || e === 'U') {
      const n = e === 'u' ? 4 : 8;
      const hex = text.slice(i + 1, i + 1 + n);
      if (!new RegExp(`^[0-9A-Fa-f]{${n}}$`).test(hex)) throw new N3SyntaxError(`bad \\${e} escape`, line);
      const code = parseInt(hex, 16);
      // Escapes name characters: not U+0000, a surrogate or a noncharacter.
      if (code === 0 || (code >= 0xd800 && code <= 0xdfff) || (code & 0xfffe) === 0xfffe || code > 0x10ffff) {
        throw new N3SyntaxError(`\\${e}${hex} does not name a character a document may hold`, line);
      }
      out += String.fromCodePoint(code);
      i += n;
    } else throw new N3SyntaxError(`unknown string escape \\${e}`, line);
  }
  return out;
}

// Tokens: { k: kind, v: text, line }. Kinds: iri, pname, bnode, var, string,
// lang, number, word, punct, eof.
export function tokenize(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const push = (k, v) => toks.push({ k, v, line });
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') { i++; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    if (src.startsWith('<<', i) || src.startsWith('>>', i) || src.startsWith(')>>', i)) {
      const v = src.startsWith('<<(', i) ? '<<(' : src.startsWith(')>>', i) ? ')>>' : src.slice(i, i + 2);
      push('punct', v);
      i += v.length;
      continue;
    }
    if (c === '<' && src[i + 1] !== '=' && src[i + 1] !== '-') {
      const end = src.indexOf('>', i + 1);
      if (end < 0) throw new N3SyntaxError('unterminated IRI', line);
      const raw = src.slice(i + 1, end);
      if (/[\s<"{}|^`]/.test(raw)) throw new N3SyntaxError(`invalid character in IRI <${raw}>`, line);
      const decoded = decodeEscapes(raw, line);
      // An escape may not bring in what the IRI could not hold as written.
      if (/[\u0000-\u0020<>"{}|^`\\]/.test(decoded)) throw new N3SyntaxError(`invalid character in IRI <${raw}>`, line);
      push('iri', decoded);
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const long = src.startsWith(c.repeat(3), i);
      const q = long ? c.repeat(3) : c;
      let j = i + q.length;
      let raw = '';
      const start = line;
      for (;;) {
        if (j >= n) throw new N3SyntaxError('unterminated string', start);
        if (src[j] === '\\') { raw += src[j] + src[j + 1]; j += 2; continue; }
        if (src.startsWith(q, j)) {
          // A long string may end in quotes: """a"""" is the text a".
          if (long) while (src[j + 3] === c) { raw += c; j++; }
          break;
        }
        if (src[j] === '\n') { if (!long) throw new N3SyntaxError('line break in a short string', line); line++; }
        raw += src[j++];
      }
      push('string', decodeEscapes(raw, start));
      i = j + q.length;
      continue;
    }
    if (c === '@') {
      const m = /^@([A-Za-z]+(?:-[A-Za-z0-9]+)*(?:--(?:ltr|rtl))?)/.exec(src.slice(i, i + 100));
      if (!m) throw new N3SyntaxError('expected a language tag or keyword after @', line);
      const word = m[1];
      const prev = toks[toks.length - 1];
      if (['prefix', 'base', 'version', 'keywords', 'forAll', 'forSome'].includes(word) && !(prev && prev.k === 'string')) push('word', `@${word}`);
      else if (['a', 'is', 'of', 'has'].includes(word) && !(prev && prev.k === 'string')) push('word', word);
      else push('lang', word);
      i += m[0].length;
      continue;
    }
    if (c === '?' && i + 1 < n && isPnChars(String.fromCodePoint(src.codePointAt(i + 1)))) {
      let j = i + 1;
      while (j < n) {
        const ch = String.fromCodePoint(src.codePointAt(j));
        if (!isPnChars(ch)) break;
        j += ch.length;
      }
      push('var', src.slice(i + 1, j));
      i = j;
      continue;
    }
    if (c === '_' && src[i + 1] === ':') {
      let j = i + 2;
      while (j < n) {
        const ch = String.fromCodePoint(src.codePointAt(j));
        if (!(isPnChars(ch) || ch === '.')) break;
        j += ch.length;
      }
      while (src[j - 1] === '.') j--;
      push('bnode', src.slice(i + 2, j));
      i = j;
      continue;
    }
    NUMBER.lastIndex = i;
    const num = NUMBER.exec(src);
    if (num && (/[0-9]/.test(c) || ((c === '+' || c === '-' || c === '.') && /[0-9.]/.test(src[i + 1] ?? '')))) {
      push('number', num[0]);
      i += num[0].length;
      continue;
    }
    const punct = PUNCT.find((p) => src.startsWith(p, i));
    if (punct && !(punct === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      push('punct', punct);
      i += punct.length;
      continue;
    }
    // A prefixed name or a bare word.
    const startCh = String.fromCodePoint(src.codePointAt(i));
    if (isPnCharsBase(startCh) || c === ':' || c === '_') {
      let j = i;
      let prefix = null;
      while (j < n) {
        const ch = String.fromCodePoint(src.codePointAt(j));
        if (ch === ':' && prefix === null) { prefix = src.slice(i, j); j++; continue; }
        if (prefix !== null && ch === '\\' && j + 1 < n) { j += 2; continue; }
        if (prefix !== null && ch === '%' && /^[0-9A-Fa-f]{2}$/.test(src.slice(j + 1, j + 3))) { j += 3; continue; }
        if (isPnChars(ch) || ch === '.' || (prefix !== null && ch === ':')) { j += ch.length; continue; }
        break;
      }
      while (src[j - 1] === '.' && j > i) j--;
      const text = src.slice(i, j);
      if (prefix === null) push('word', text);
      else push('pname', text);
      i = j;
      continue;
    }
    throw new N3SyntaxError(`unexpected character ${JSON.stringify(c)}`, line);
  }
  push('eof', '');
  return toks;
}

// Resolve a relative IRI reference against a base (RFC 3986, Section 5.2).
export function resolveIri(ref, base) {
  if (!base || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)) return ref;
  const m = /^([A-Za-z][A-Za-z0-9+.-]*:)(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/.exec(base);
  if (!m) return ref;
  const [, scheme, authority = '', path, query = ''] = m;
  if (ref === '') return scheme + authority + path + query;
  if (ref.startsWith('#')) return scheme + authority + path + query + ref;
  if (ref.startsWith('//')) return scheme + ref;
  if (ref.startsWith('?')) return scheme + authority + path + ref;
  const [refPath, rest = ''] = ref.split(/(?=[?#])/, 2).length === 2 ? [ref.slice(0, ref.search(/[?#]/)), ref.slice(ref.search(/[?#]/))] : [ref, ''];
  let merged;
  if (refPath.startsWith('/')) merged = refPath;
  else if (authority && path === '') merged = `/${refPath}`;
  else merged = path.slice(0, path.lastIndexOf('/') + 1) + refPath;
  return scheme + authority + removeDots(merged) + rest;
}

function removeDots(path) {
  const out = [];
  const segs = path.split('/');
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (s === '.') { if (k === segs.length - 1) out.push(''); continue; }
    if (s === '..') { if (out.length > 1) out.pop(); if (k === segs.length - 1) out.push(''); continue; }
    out.push(s);
  }
  return out.join('/');
}

const iri = (v) => ({ t: 'iri', v });

// Prefixes a document may use without declaring them.
export const DEFAULT_PREFIXES = {
  rdf: RDF,
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: XSD,
  owl: OWL,
  log: LOG,
  math: 'http://www.w3.org/2000/10/swap/math#',
  string: 'http://www.w3.org/2000/10/swap/string#',
  list: 'http://www.w3.org/2000/10/swap/list#',
  time: 'http://www.w3.org/2000/10/swap/time#',
  crypto: 'http://www.w3.org/2000/10/swap/crypto#',
};

// Parse a document: { triples, prefixes, base }. Prefixes map names to IRIs
// in declaration order.
export function parseN3(src, { base = '' } = {}) {
  const toks = tokenize(String(src));
  let pos = 0;
  const prefixes = new Map();
  let bnodeCount = 0;
  let scopeCount = 0;
  const top = { id: 0, triples: [] };
  let scope = top;
  const peek = (k = 0) => toks[pos + k];
  const next = () => toks[pos++];
  const fail = (message, tok = peek()) => new N3SyntaxError(message, tok.line);
  const isP = (v, tok = peek()) => tok.k === 'punct' && tok.v === v;
  const expectP = (v) => {
    const tok = next();
    if (!(tok.k === 'punct' && tok.v === v)) throw fail(`expected '${v}', found ${describe(tok)}`, tok);
  };
  const describe = (tok) => (tok.k === 'eof' ? 'the end' : `'${tok.v}'`);
  const freshBnode = () => ({ t: 'bnode', v: `#${++bnodeCount}`, scope: scope.id });
  const emit = (s, p, o) => scope.triples.push({ s, p, o });

  function pname(text, tok) {
    const k = text.indexOf(':');
    const pre = text.slice(0, k);
    const ns = prefixes.has(pre) ? prefixes.get(pre) : DEFAULT_PREFIXES[pre];
    if (ns === undefined) throw fail(`undeclared prefix '${pre}:'`, tok);
    const local = text.slice(k + 1).replace(/\\(.)/g, '$1');
    return iri(ns + local);
  }

  function directive() {
    const tok = next();
    const word = tok.v.replace(/^@/, '').toLowerCase();
    if (word === 'prefix') {
      const p = next();
      if (p.k !== 'pname' || !p.v.endsWith(':') || p.v.indexOf(':') !== p.v.length - 1 || p.v.endsWith('.:')) throw fail('expected a prefix name such as ex:, not ending in a dot', p);
      const i = next();
      if (i.k !== 'iri') throw fail('expected an IRI for the prefix', i);
      prefixes.set(p.v.slice(0, -1), resolveIri(i.v, base));
    } else if (word === 'base') {
      const i = next();
      if (i.k !== 'iri') throw fail('expected an IRI for the base', i);
      base = resolveIri(i.v, base);
    } else if (word === 'version') {
      const v = next();
      if (v.k !== 'string') throw fail('expected a version string', v);
    } else {
      throw fail(`${tok.v} is not supported`, tok);
    }
    if (tok.v.startsWith('@')) expectP('.');
    else if (isP('.')) next();
  }

  function literalTail(text) {
    const tok = peek();
    if (tok.k === 'lang') {
      next();
      const [lang, dir] = tok.v.split('--');
      return { t: 'literal', v: text, lang: lang.toLowerCase(), dir: dir ?? null, dt: dir ? `${RDF}dirLangString` : `${RDF}langString` };
    }
    if (isP('^^')) {
      next();
      const dt = iriTerm();
      return typedLiteral(text, dt.v);
    }
    return { t: 'literal', v: text, dt: `${XSD}string` };
  }

  function iriTerm() {
    const tok = next();
    if (tok.k === 'iri') return iri(resolveIri(tok.v, base));
    if (tok.k === 'pname') return pname(tok.v, tok);
    throw fail(`expected an IRI, found ${describe(tok)}`, tok);
  }

  function term() {
    const tok = peek();
    if (tok.k === 'iri' || tok.k === 'pname') return iriTerm();
    next();
    if (tok.k === 'var') return { t: 'var', v: tok.v };
    if (tok.k === 'bnode') return { t: 'bnode', v: tok.v, scope: scope.id };
    if (tok.k === 'string') return literalTail(tok.v);
    if (tok.k === 'number') return numberTerm(tok.v);
    if (tok.k === 'word') {
      if (tok.v === 'true' || tok.v === 'false') return { t: 'literal', v: tok.v, dt: `${XSD}boolean` };
      throw fail(`unexpected word '${tok.v}'; prefixed names need a colon, as in :${tok.v}`, tok);
    }
    if (isP('<<(', tok) || isP('<<', tok)) {
      const s = pathTerm();
      const p = verb();
      const o = pathTerm();
      if (p.inverse) throw fail('a triple term cannot use an inverse verb', tok);
      const close = next();
      if (!(close.k === 'punct' && close.v === (tok.v === '<<(' ? ')>>' : '>>'))) throw fail(`expected '${tok.v === '<<(' ? ')>>' : '>>'}'`, close);
      return { t: 'triple', s, p: p.p, o };
    }
    if (isP('[', tok)) {
      // [ id :x :p :o ] describes :x itself.
      let b;
      if (peek().k === 'word' && peek().v === 'id') {
        next();
        b = pathTerm();
      } else b = freshBnode();
      if (!isP(']')) predicateObjectList(b);
      expectP(']');
      return b;
    }
    if (isP('(', tok)) {
      const items = [];
      while (!isP(')')) {
        if (peek().k === 'eof') throw fail("unterminated collection; expected ')'");
        items.push(pathTerm());
      }
      next();
      return { t: 'list', items };
    }
    if (isP('{', tok)) {
      const outer = scope;
      scope = { id: ++scopeCount, triples: [] };
      while (!isP('}')) {
        if (peek().k === 'eof') throw fail("unterminated formula; expected '}'");
        if (statement(true) === 'directive') continue;
        if (isP('.')) next();
        else if (!isP('}')) throw fail(`expected '.' or '}', found ${describe(peek())}`);
      }
      next();
      const g = { t: 'graph', triples: scope.triples, scope: scope.id };
      scope = outer;
      return g;
    }
    throw fail(`expected a term, found ${describe(tok)}`, tok);
  }

  // A term followed by any number of paths: x!p is the object of x p,
  // x^p the subject of something p x.
  function pathTerm() {
    let t = term();
    while (isP('!') || isP('^')) {
      const forward = next().v === '!';
      const p = term();
      const b = freshBnode();
      if (forward) emit(t, p, b);
      else emit(b, p, t);
      t = b;
    }
    return t;
  }

  // A verb: { p, inverse }.
  function verb() {
    const tok = peek();
    if (tok.k === 'word' && tok.v === 'a') { next(); return { p: iri(`${RDF}type`), inverse: false }; }
    if (tok.k === 'word' && tok.v === 'has') { next(); return { p: pathTerm(), inverse: false }; }
    if (tok.k === 'word' && tok.v === 'is') {
      next();
      const p = pathTerm();
      const of = next();
      if (!(of.k === 'word' && of.v === 'of')) throw fail("expected 'of' after 'is ...'", of);
      return { p, inverse: true };
    }
    if (isP('=')) { next(); return { p: iri(`${OWL}sameAs`), inverse: false }; }
    if (isP('=>')) { next(); return { p: iri(`${LOG}implies`), inverse: false }; }
    if (isP('<=')) { next(); return { p: iri(`${LOG}impliedBy`), inverse: false }; }
    if (isP('<-')) { next(); return { p: pathTerm(), inverse: true }; }
    return { p: pathTerm(), inverse: false };
  }

  function predicateObjectList(s) {
    for (;;) {
      const { p, inverse } = verb();
      for (;;) {
        const o = pathTerm();
        if (inverse) emit(o, p, s);
        else emit(s, p, o);
        if (!isP(',')) break;
        next();
      }
      if (!isP(';')) return;
      while (isP(';')) next();
      if (isP('.') || isP(']') || isP('}') || peek().k === 'eof') return;
    }
  }

  function statement(inFormula) {
    const tok = peek();
    if (tok.k === 'word' && /^(@prefix|@base|prefix|base|version)$/i.test(tok.v)) {
      directive();
      return 'directive';
    }
    if (tok.k === 'word' && (tok.v === '@forAll' || tok.v === '@forSome')) throw fail(`${tok.v} is not supported; use ?variables and blank nodes`, tok);
    // { true } is the empty formula.
    if (inFormula && tok.k === 'word' && tok.v === 'true' && (isP('.', peek(1)) || isP('}', peek(1)))) { next(); return 'triples'; }
    const s = pathTerm();
    // A bracketed blank node may stand alone: [ :p :o ].
    if (s.t === 'bnode' && (isP('.') || isP('}') || peek().k === 'eof')) return 'triples';
    predicateObjectList(s);
    return 'triples';
  }

  while (peek().k !== 'eof') {
    const kind = statement(false);
    if (kind === 'directive') continue;
    expectP('.');
  }
  return { triples: top.triples, prefixes, base };
}

function numberTerm(text) {
  if (/^[+-]?[0-9]+$/.test(text)) return { t: 'int', v: BigInt(text) };
  return { t: 'float', v: Number(text) };
}

const INTEGER_TYPES = new Set(['integer']);
const FLOAT_TYPES = new Set(['decimal', 'double', 'float']);

// A typed literal; xsd:integer, xsd:decimal and xsd:double with a valid
// lexical form become numbers, as the N3 shorthands 1, 1.5 and 1.5e0 do.
export function typedLiteral(text, dt) {
  if (dt.startsWith(XSD)) {
    const local = dt.slice(XSD.length);
    if (INTEGER_TYPES.has(local) && /^[+-]?[0-9]+$/.test(text)) return { t: 'int', v: BigInt(text) };
    if (FLOAT_TYPES.has(local) && /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(text)) return { t: 'float', v: Number(text) };
  }
  return { t: 'literal', v: text, dt };
}
