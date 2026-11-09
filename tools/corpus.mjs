// Run a directory of N3 examples through eyemind-n3 and compare each result
// with the expected output next to it, as the eyeling and EYE example
// collections lay them out: DIR/NAME.n3 with DIR/output/NAME.n3 (triples,
// compared as graphs with blank nodes renamed) or DIR/output/NAME.md (text).
//
//   node tools/corpus.mjs [--timeout SECONDS] [-v] DIR [NAME ...]
//
// Each example runs in its own process. Prints one line per example and a
// summary; -v also prints the first lines of each difference or error.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseN3 } from '../src/n3-parser.mjs';

const args = process.argv.slice(2);
let timeout = 60;
let verbose = false;
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--timeout') timeout = Number(args[++i]);
  else if (args[i] === '-v') verbose = true;
  else rest.push(args[i]);
}
const [dir, ...names] = rest;
if (!dir) {
  process.stderr.write('usage: node tools/corpus.mjs [--timeout SECONDS] [-v] DIR [NAME ...]\n');
  process.exit(2);
}
const bin = fileURLToPath(new URL('../bin/eyemind-n3.js', import.meta.url));

// A graph as sorted lines with blank nodes renamed in order of appearance.
function canonical(text) {
  const { triples } = parseN3(text);
  const lines = triples.map((x) => [x.s, x.p, x.o].map(show).join(' '));
  return lines.map((l) => l.replace(/_:\S+/g, '_:b')).sort();
}
function show(t) {
  switch (t.t) {
    case 'iri': return `<${t.v}>`;
    case 'bnode': return `_:${t.v}`;
    case 'var': return `?${t.v}`;
    // Numbers compare by value: 2 and 2.0 are the same.
    case 'int': return String(t.v);
    case 'float': return Number.isInteger(t.v) && Math.abs(t.v) < 1e21 ? String(BigInt(t.v)) : String(t.v);
    case 'literal': return `${JSON.stringify(t.v)}${t.lang ? `@${t.lang}` : `^^${t.dt}`}`;
    case 'list': return `(${t.items.map(show).join(' ')})`;
    case 'graph': return `{${t.triples.map((x) => [x.s, x.p, x.o].map(show).join(' ')).sort().join('. ')}}`;
    case 'triple': return `<<(${show(t.s)} ${show(t.p)} ${show(t.o)})>>`;
    default: return '?';
  }
}

const files = (names.length ? names.map((n) => `${n.replace(/\.n3$/, '')}.n3`) : readdirSync(dir).filter((f) => f.endsWith('.n3'))).sort();
const tally = { pass: 0, differ: 0, error: 0, unsupported: 0, timeout: 0, skipped: 0 };
for (const file of files) {
  const name = basename(file, '.n3');
  const n3 = join(dir, 'output', `${name}.n3`);
  const md = join(dir, 'output', `${name}.md`);
  const expected = existsSync(n3) ? ['n3', n3] : existsSync(md) ? ['md', md] : null;
  if (!expected || existsSync(join(dir, 'input', `${name}.trig`)) || existsSync(join(dir, 'builtin', `${name}.js`))) {
    tally.skipped++;
    console.log(`skip     ${name}`);
    continue;
  }
  const started = Date.now();
  const r = spawnSync(process.execPath, [bin, join(dir, file)], { encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 1 << 28 });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  let status;
  let detail = '';
  if (r.error && r.error.code === 'ETIMEDOUT') status = 'timeout';
  else if (r.status !== 0 && r.status !== 2) {
    detail = r.stderr.trim();
    status = /is not supported/.test(detail) ? 'unsupported' : 'error';
  } else {
    const want = readFileSync(expected[1], 'utf8');
    let same;
    if (expected[0] === 'md') same = r.stdout.replace(/[ \t]+$/gm, '').trimEnd() === want.replace(/[ \t]+$/gm, '').trimEnd();
    else {
      try {
        same = JSON.stringify(canonical(r.stdout)) === JSON.stringify(canonical(want));
      } catch (error) {
        same = false;
        detail = error.message;
      }
    }
    status = same ? 'pass' : 'differ';
    if (!same && !detail) detail = diff(expected[0] === 'md' ? r.stdout : canonical(r.stdout).join('\n'), expected[0] === 'md' ? want : canonical(want).join('\n'));
  }
  tally[status]++;
  console.log(`${status.padEnd(8)} ${name} (${secs}s)${status !== 'pass' && detail ? `  ${detail.split('\n')[0].slice(0, 140)}` : ''}`);
  if (verbose && status !== 'pass' && detail) console.log(detail.split('\n').slice(0, 12).map((l) => `    ${l}`).join('\n'));
}
console.log(Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', '));

function diff(got, want) {
  const a = got.split('\n');
  const b = want.split('\n');
  const sa = new Set(a);
  const sb = new Set(b);
  const missing = b.filter((l) => !sa.has(l));
  const extra = a.filter((l) => !sb.has(l));
  return [...missing.slice(0, 6).map((l) => `- ${l}`), ...extra.slice(0, 6).map((l) => `+ ${l}`)].join('\n') || 'differs in order or duplicates';
}
