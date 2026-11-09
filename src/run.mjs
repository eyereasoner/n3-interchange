// Reasoning over N3 in one step: compile, run eyemind, write N3.
import { loadText, run, Struct } from 'eyemind';
import { parseN3 } from './n3-parser.mjs';
import { compileN3Document } from './n3-to-eyemind.mjs';
import { triplesFromEyemind, tripleToEyemind, writeN3 } from './eyemind-to-n3.mjs';
import { LOG } from './n3-parser.mjs';

// Generous bounds: N3 programs often run longer than eyemind's defaults.
export const DEFAULT_LIMITS = { maxDepth: 1000000, maxIterations: 100000, maxInferences: 1000000000 };

// Reason over N3 sources, given as [text, name] pairs and read as one
// document. Returns { n3, triples, contradiction, program, result }.
export function reasonN3(sources, { base = '', mode = 'new', strings = 'auto', limits = {}, proof = false } = {}) {
  if (typeof sources === 'string') sources = [[sources, 'input']];
  const docs = sources.map(([text, name]) => parseN3(text, { base: base || fileBase(name) }));
  // Blank-node labels are local to each source.
  const doc = { triples: [], prefixes: new Map() };
  docs.forEach((d, k) => {
    doc.triples.push(...(docs.length > 1 ? relabel(d.triples, `s${k}.`) : d.triples));
    for (const [name, ns] of d.prefixes) if (!doc.prefixes.has(name)) doc.prefixes.set(name, ns);
  });
  const { program } = compileN3Document(doc, { source: sources.map(([, name]) => name).join(', ') });
  const result = run(loadText(program, 'compiled.js'), { ...DEFAULT_LIMITS, ...limits, proof });
  let { triples, contradiction } = triplesFromEyemind(result.answers.join('\n'));
  const given = doc.triples.filter((x) => !isRule(x)).map(tripleToEyemind);
  if (mode === 'all') triples = [...given, ...triples];
  // Strings the document states are part of the report too.
  else if (strings !== false && triples.some(isOutputString)) triples = [...given.filter(isOutputString), ...triples];
  return { n3: writeN3(triples, { prefixes: doc.prefixes, strings }), triples, contradiction, program, result };
}

const RULES = new Set([`${LOG}implies`, `${LOG}impliedBy`, `${LOG}query`]);
const isRule = (x) => x.p.t === 'iri' && RULES.has(x.p.v) && (x.s.t === 'graph' || x.s.t === 'literal') && (x.o.t === 'graph' || x.o.t === 'literal');

const isOutputString = ([, p]) => p instanceof Struct && p.name === 'iri' && p.args[0] === `${LOG}outputString`;

const fileBase = (name) => (name && name !== 'input' && name !== '-' ? `file://${name.startsWith('/') ? '' : '/'}${name}` : '');

function relabel(triples, prefix) {
  const term = (t) => {
    if (t.t === 'bnode') return { ...t, v: prefix + t.v };
    if (t.t === 'list') return { ...t, items: t.items.map(term) };
    if (t.t === 'graph') return { ...t, triples: t.triples.map(triple) };
    if (t.t === 'triple') return triple(t);
    return t;
  };
  const triple = (x) => ({ ...x, s: term(x.s), p: term(x.p), o: term(x.o) });
  return triples.map(triple);
}
