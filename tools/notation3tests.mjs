// Score eyemind-n3 on the Notation3 test suite
// (https://codeberg.org/phochste/notation3tests), given its tests directory.
//
//   node tools/notation3tests.mjs [--timeout SECONDS] [-v] DIR
//
// A test file states :test :contains :NAME and, when it passes,
// :result :has :NAME or :test :is true. A success-* test passes when its
// result appears, a fail-* test when none does, and a crash-* test when the
// run stops with an error or no output.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseN3 } from '../src/n3-parser.mjs';

const args = process.argv.slice(2);
let timeout = 10;
let verbose = false;
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--timeout') timeout = Number(args[++i]);
  else if (args[i] === '-v') verbose = true;
  else rest.push(args[i]);
}
const [dir] = rest;
if (!dir) {
  process.stderr.write('usage: node tools/notation3tests.mjs [--timeout SECONDS] [-v] DIR\n');
  process.exit(2);
}
const bin = fileURLToPath(new URL('../bin/eyemind-n3.js', import.meta.url));
const EX = 'http://example.org/';

const collect = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = join(d, e.name);
    if (e.isDirectory()) collect(full, out);
    else if (e.name.endsWith('.n3')) out.push(full);
  }
  return out;
};

function runOne(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--max-old-space-size=512', bin, relative(dir, file)], { cwd: dir });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ out, err, code, signal });
    });
  });
}

function score(file, { out, err, code, signal }) {
  const crash = file.split('/').pop().startsWith('crash');
  if (signal) return [crash ? 'ok' : 'timeout', 'timeout'];
  let triples;
  try {
    if (code !== 0 && code !== 2) throw new Error(err.trim());
    if (!out.trim()) throw new Error('empty output');
    triples = parseN3(out).triples;
  } catch (error) {
    return [crash ? 'ok' : /is not supported/.test(error.message) ? 'unsupported' : 'crashed', error.message.split('\n')[0]];
  }
  const isEx = (t, name) => t.t === 'iri' && t.v === EX + name;
  const tests = [...new Set(triples.filter((x) => isEx(x.s, 'test') && isEx(x.p, 'contains')).map((x) => x.o.v))];
  if (crash) return [tests.length ? 'nonconform' : 'ok', 'no crash'];
  if (!tests.length) return ['incomplete', 'no :test :contains'];
  const has = (test) => triples.some((x) => isEx(x.s, 'result') && isEx(x.p, 'has') && x.o.v === test);
  const is = (value) => triples.some((x) => isEx(x.s, 'test') && isEx(x.p, 'is') && x.o.t === 'literal' && x.o.v === value);
  const verdicts = tests.map((test) => {
    const name = test.replace(/.*[/#]/, '');
    if (name.startsWith('fail')) return has(test) || is('true') || is('false') ? 'nonconform' : 'ok';
    if (name.startsWith('success')) return has(test) || is('true') ? 'ok' : is('false') ? 'nonconform' : 'incomplete';
    return 'incomplete';
  });
  return [verdicts.every((v) => v === 'ok') ? 'ok' : verdicts.find((v) => v !== 'ok'), ''];
}

const files = collect(dir).sort();
const tally = {};
const lines = new Array(files.length);
let next = 0;
async function worker() {
  while (next < files.length) {
    const k = next++;
    const [verdict, detail] = score(files[k], await runOne(files[k]));
    tally[verdict] = (tally[verdict] ?? 0) + 1;
    lines[k] = `${verdict.padEnd(11)} ${relative(dir, files[k])}${verdict !== 'ok' && detail ? `  ${detail.slice(0, 140)}` : ''}`;
  }
}
await Promise.all(Array.from({ length: Math.min(3, cpus().length) }, worker));
for (const line of lines) if (verbose || !line.startsWith('ok')) console.log(line);
console.log(`${tally.ok ?? 0}/${files.length} ok; ${Object.entries(tally).filter(([k]) => k !== 'ok').map(([k, v]) => `${k} ${v}`).join(', ')}`);
