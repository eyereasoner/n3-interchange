// The three commands: n3-to-eyemind, eyemind-to-n3 and eyemind-n3.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseN3 } from './n3-parser.mjs';
import { eyemindToN3 } from './eyemind-to-n3.mjs';
import { createRequire } from 'node:module';
import { VERSION, checkProof, checkReport, loadText, publicReport, run, unusedClauses } from 'eyemind';
import { DEFAULT_LIMITS, answersToN3, compileSources, fetchSourceDocuments } from './run.mjs';

const PACKAGE = createRequire(import.meta.url)('../package.json');

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

async function main(fn) {
  try {
    process.exitCode = (await fn(process.argv.slice(2))) ?? 0;
  } catch (error) {
    if (!(error instanceof Error) || error instanceof TypeError || error instanceof ReferenceError) throw error;
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
  main(async (argv) => {
    const opts = parseArgs(argv, ['--base', '-o'], [], TO_EYEMIND);
    if (opts.files.length !== 1) throw new Error(TO_EYEMIND.trimEnd());
    const [file] = opts.files;
    const sources = [[read(file), file]];
    const base = opts['--base'] ?? '';
    const { program } = compileSources(sources, { base, documents: await fetchSourceDocuments(sources, { base }) });
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

const RUN = `Usage: eyemind-n3 [OPTION ...] input.n3 ...
Reason over N3 with eyemind and write the derived triples as N3. The inputs
form one document, compiled to an eyemind program; the eyemind options act on
that program.
N3 options:
      --all               Write every triple, not only derived ones
      --strings           Write log:outputString values as text
      --triples           Write triples even when there are log:outputString values
      --program           Write the compiled eyemind program instead
      --base IRI          Base IRI for relative references
  -o FILE                 Write the output to FILE
eyemind options:
  -p, --proof             Print eyemind's proof of the conclusions
  -c, --prove-and-check   Generate a proof and check it against the compiled program
      --check-proof FILE  Check a proof of the compiled program (- for stdin)
      --json              Print the check report as JSON instead
      --goal GOAL         Ask an eyemind goal after forward reasoning, such as
                          "rdf(S, iri('http://example.org/p'), O)"; with
                          --check-proof, the goal the proof answers
      --strict-proof      Reject proofs with unresolved obligations
      --unused            List the compiled clauses that make no difference
      --stats             Print reasoning statistics to stderr
      --max-depth N       Bound backward recursion (default 1000000)
      --max-iterations N  Bound forward rounds per stratum (default 100000)
      --max-inferences N  Bound reasoning work (default 1000000000)
  -v, --version           Print the versions of n3-interchange and eyemind
  -h, --help              Print this help
Exit codes: 0 success, 1 error, 2 an inference fuse ({ ... } => false) fired
or a checked proof is invalid; with a proof, a fuse that fired is 65, as in eyemind.
`;

const VALUED = new Set(['--base', '-o', '--check-proof', '--goal', '--max-depth', '--max-iterations', '--max-inferences']);
const FLAGS = new Map([['-p', '--proof'], ['-c', '--prove-and-check'], ['-v', '--version'], ['-h', '--help']]);
const LIMITS = { '--max-depth': 'maxDepth', '--max-iterations': 'maxIterations', '--max-inferences': 'maxInferences' };

export function eyemindN3Main() {
  main(async (argv) => {
    const opts = { files: [], goals: [] };
    for (let i = 0; i < argv.length; i++) {
      const arg = FLAGS.get(argv[i]) ?? argv[i];
      if (VALUED.has(arg)) {
        if (i + 1 >= argv.length || /^--./.test(argv[i + 1])) throw new Error(`${arg} needs a value`);
        if (arg === '--goal') opts.goals.push(argv[++i]);
        else opts[arg] = argv[++i];
      } else if (['--all', '--strings', '--triples', '--program', '--proof', '--prove-and-check', '--json',
        '--strict-proof', '--unused', '--stats', '--version', '--help'].includes(arg)) opts[arg] = true;
      else if (arg.startsWith('-') && arg !== '-') throw new Error(`unknown option ${arg}; see eyemind-n3 --help`);
      else opts.files.push(arg);
    }
    if (opts['--help']) {
      process.stdout.write(RUN);
      return 0;
    }
    if (opts['--version']) {
      process.stdout.write(`n3-interchange v${PACKAGE.version}, eyemind v${VERSION}\n`);
      return 0;
    }
    const checking = opts['--check-proof'] !== undefined || opts['--prove-and-check'];
    if (opts['--json'] && !checking) throw new Error('--json requires --check-proof or --prove-and-check');
    if (opts['--strict-proof'] && !checking) throw new Error('--strict-proof requires --check-proof or --prove-and-check');
    if (opts['--prove-and-check'] && (opts['--proof'] || opts['--check-proof'] !== undefined)) {
      throw new Error('--prove-and-check cannot be combined with --proof or --check-proof');
    }
    if (opts['--check-proof'] !== undefined && opts['--proof']) throw new Error('--check-proof cannot be combined with --proof');
    if (opts['--unused'] && (opts['--proof'] || checking)) {
      throw new Error('--unused cannot be combined with --proof, --check-proof or --prove-and-check');
    }
    if (opts.files.length === 0) throw new Error(RUN.trimEnd());
    if (opts['--check-proof'] === '-' && opts.files.includes('-')) throw new Error('stdin holds the proof; name the N3 inputs as files');
    const limits = { ...DEFAULT_LIMITS };
    for (const [flag, name] of Object.entries(LIMITS)) {
      if (opts[flag] === undefined) continue;
      const value = Number(opts[flag]);
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${flag} needs a positive integer`);
      limits[name] = value;
    }

    const sources = opts.files.map((file) => [read(file), file]);
    const base = opts['--base'] ?? '';
    const { doc, program: text } = compileSources(sources, { base, documents: await fetchSourceDocuments(sources, { base }) });
    if (opts['--program']) {
      output(opts, text);
      return 0;
    }
    const program = loadText(text, 'compiled.js');
    const goals = opts.goals;
    const report = (r) => (opts['--json'] ? `${JSON.stringify(publicReport(r), null, 2)}\n` : checkReport(r));
    const allowTrusted = !opts['--strict-proof'];
    if (opts['--check-proof'] !== undefined) {
      const r = checkProof(program, read(opts['--check-proof']), { goals, allowTrusted });
      output(opts, report(r));
      return r.valid ? 0 : 2;
    }
    if (opts['--unused']) {
      output(opts, unusedClauses(program, { goals, ...limits }));
      return 0;
    }
    const result = run(program, { goals, ...limits, proof: Boolean(opts['--proof'] || opts['--prove-and-check']) });
    if (opts['--stats']) process.stderr.write(`${JSON.stringify(result.stats)}\n`);
    if (opts['--prove-and-check']) {
      const r = checkProof(program, result.proof, { goals, allowTrusted });
      output(opts, report(r));
      return r.valid ? result.haltCode || 0 : 2;
    }
    if (opts['--proof']) {
      output(opts, result.stdout);
      return result.haltCode || 0;
    }
    const strings = opts['--strings'] ? true : opts['--triples'] ? false : 'auto';
    const answers = result.answers;
    // Answers to a goal that are not triples are written as eyemind writes them.
    if (goals.length && !answers.every((a) => /^(rdf|result)\(/.test(a))) {
      output(opts, result.stdout);
      return result.haltCode || 0;
    }
    const r = answersToN3(doc, answers, { mode: opts['--all'] ? 'all' : 'new', strings });
    output(opts, r.n3);
    if (r.contradiction) {
      process.stderr.write('inference fuse: a { ... } => false rule fired\n');
      return 2;
    }
    return 0;
  });
}
