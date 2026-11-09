// The three commands: n3-to-eyemind, eyemind-to-n3 and eyemind-n3.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseN3 } from './n3-parser.mjs';
import { compileN3 } from './n3-to-eyemind.mjs';
import { eyemindToN3 } from './eyemind-to-n3.mjs';
import { reasonN3 } from './run.mjs';

const read = (file) => readFileSync(file === '-' ? 0 : file, 'utf8');

function parseArgs(argv, valued, flags, usage) {
  const opts = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { process.stdout.write(usage); process.exit(0); }
    if (valued.includes(arg)) {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      opts[arg] = argv[++i];
    } else if (flags.includes(arg)) opts[arg] = true;
    else if (arg.startsWith('-') && arg !== '-') throw new Error(`unknown option ${arg}`);
    else opts.files.push(arg);
  }
  return opts;
}

function output(opts, text) {
  if (opts['-o']) writeFileSync(opts['-o'], text);
  else process.stdout.write(text);
}

function main(fn) {
  try {
    process.exitCode = fn(process.argv.slice(2)) ?? 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

const TO_EYEMIND = `Usage: n3-to-eyemind [options] input.n3
Compile N3 facts and rules into an eyemind program.
      --base IRI   base IRI for relative references
  -o FILE          output file
`;

export function n3ToEyemindMain() {
  main((argv) => {
    const opts = parseArgs(argv, ['--base', '-o'], [], TO_EYEMIND);
    if (opts.files.length !== 1) throw new Error(TO_EYEMIND.trimEnd());
    const [file] = opts.files;
    const { program } = compileN3(read(file), { base: opts['--base'] ?? '', source: file });
    output(opts, program);
  });
}

const TO_N3 = `Usage: eyemind-to-n3 [options] conclusions.js
Write the triples of eyemind conclusions as N3.
      --prefixes FILE  take prefixes from an N3 document
      --strings        write log:outputString values as text
      --triples        write triples even when there are log:outputString values
  -o FILE              output file
`;

export function eyemindToN3Main() {
  main((argv) => {
    const opts = parseArgs(argv, ['--prefixes', '-o'], ['--strings', '--triples'], TO_N3);
    if (opts.files.length !== 1) throw new Error(TO_N3.trimEnd());
    const prefixes = opts['--prefixes'] ? parseN3(read(opts['--prefixes'])).prefixes : new Map();
    const strings = opts['--strings'] ? true : opts['--triples'] ? false : 'auto';
    output(opts, eyemindToN3(read(opts.files[0]), { prefixes, strings }));
  });
}

const RUN = `Usage: eyemind-n3 [options] input.n3 ...
Reason over N3 with eyemind and write the derived triples as N3.
      --all             write every triple, not only derived ones
      --strings         write log:outputString values as text
      --triples         write triples even when there are log:outputString values
      --program         write the compiled eyemind program instead
      --base IRI        base IRI for relative references
      --max-inferences N, --max-depth N, --max-iterations N   reasoning bounds
  -o FILE               output file
Exit status 2 means an inference fuse, { ... } => false, fired.
`;

export function eyemindN3Main() {
  main((argv) => {
    const opts = parseArgs(argv, ['--base', '-o', '--max-inferences', '--max-depth', '--max-iterations'],
      ['--all', '--strings', '--triples', '--program'], RUN);
    if (opts.files.length === 0) throw new Error(RUN.trimEnd());
    const limits = {};
    for (const [flag, name] of [['--max-inferences', 'maxInferences'], ['--max-depth', 'maxDepth'], ['--max-iterations', 'maxIterations']]) {
      if (opts[flag] !== undefined) limits[name] = Number(opts[flag]);
    }
    const sources = opts.files.map((file) => [read(file), file]);
    if (opts['--program']) {
      if (sources.length !== 1) throw new Error('--program takes one input');
      output(opts, compileN3(sources[0][0], { base: opts['--base'] ?? '', source: sources[0][1] }).program);
      return 0;
    }
    const strings = opts['--strings'] ? true : opts['--triples'] ? false : 'auto';
    const r = reasonN3(sources, { base: opts['--base'] ?? '', mode: opts['--all'] ? 'all' : 'new', strings, limits });
    output(opts, r.n3);
    if (r.contradiction) {
      process.stderr.write('inference fuse: a { ... } => false rule fired\n');
      return 2;
    }
    return 0;
  });
}
