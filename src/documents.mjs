// The documents log:semantics, log:semanticsOrError and log:content read.
//
// eyemind reads no files and no network while it reasons, so the documents
// a program names are fetched before compiling: every IRI written as the
// subject of one of those built-ins. The compiled program states each one's
// text, formula or error as facts, and reasoning stays a function of them.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LOG } from './n3-parser.mjs';

export const DOCUMENT_PREDICATES = new Set([`${LOG}semantics`, `${LOG}semanticsOrError`, `${LOG}content`]);

// The IRIs a document's triples name as documents to read: the subject of
// such a built-in, and, when a rule finds that subject with a pattern whose
// predicate is an IRI, as in { :doc :source ?d. ?d log:semantics ?f }, each
// IRI the document's facts state at that place.
export function documentIris(triples, found = new Set()) {
  named(triples, found);
  const places = [];
  for (const x of triples) {
    if (!(x.s.t === 'graph' && x.p.t === 'iri' && (x.p.v === `${LOG}implies` || x.p.v === `${LOG}impliedBy` || x.p.v === `${LOG}query`))) continue;
    const body = x.p.v === `${LOG}impliedBy` ? x.o : x.s;
    if (body.t !== 'graph') continue;
    for (const b of body.triples) {
      if (!(b.p.t === 'iri' && DOCUMENT_PREDICATES.has(b.p.v) && b.s.t === 'var')) continue;
      for (const pattern of body.triples) {
        if (pattern === b || pattern.p.t !== 'iri') continue;
        if (pattern.o.t === 'var' && pattern.o.v === b.s.v) places.push([pattern.p.v, 'o']);
        if (pattern.s.t === 'var' && pattern.s.v === b.s.v) places.push([pattern.p.v, 's']);
      }
    }
  }
  for (const [predicate, position] of places) {
    for (const x of triples) if (x.p.t === 'iri' && x.p.v === predicate && x[position].t === 'iri') found.add(x[position].v);
  }
  return found;
}

function named(triples, found) {
  const term = (t) => {
    if (t.t === 'graph') named(t.triples, found);
    else if (t.t === 'list') t.items.forEach(term);
  };
  for (const x of triples) {
    if (x.p.t === 'iri' && DOCUMENT_PREDICATES.has(x.p.v) && x.s.t === 'iri') found.add(x.s.v);
    term(x.s);
    term(x.o);
  }
  return found;
}

const withoutFragment = (iri) => iri.replace(/#.*$/, '');

// Fetch the documents: a Map from IRI to { text } or { error }.
export async function fetchDocuments(iris, { timeout = 10000 } = {}) {
  const documents = new Map();
  await Promise.all([...iris].map(async (iri) => {
    const location = withoutFragment(iri);
    try {
      if (location.startsWith('file:')) {
        documents.set(iri, { text: await readFile(fileURLToPath(location), 'utf8') });
      } else if (/^https?:/.test(location)) {
        const response = await fetch(location, { signal: AbortSignal.timeout(timeout), headers: { accept: 'text/n3, text/turtle, */*' } });
        if (!response.ok) documents.set(iri, { error: `${location}: HTTP ${response.status}` });
        else documents.set(iri, { text: await response.text() });
      } else {
        documents.set(iri, { error: `${location}: only file, http and https IRIs can be read` });
      }
    } catch (error) {
      documents.set(iri, { error: `${location}: ${error.message}` });
    }
  }));
  return documents;
}
