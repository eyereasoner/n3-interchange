// Unit tests, the examples against their saved outputs, and the commands.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkProof, loadText } from 'eyemind';
import { compileN3, eyemindToN3, fetchSourceDocuments, parseN3, reasonN3 } from '../src/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const reason = (text, options) => reasonN3(text, options).n3;
const P = '@prefix : <http://example.org/#>.\n';

// Parsing.
test('parser: prefixes, a, literals, numbers and lists', () => {
  const { triples } = parseN3(`${P}:s a :C; :p "x"@en, "1"^^<http://www.w3.org/2001/XMLSchema#integer>, 2.5, (1 :o), true.`);
  assert.equal(triples.length, 6);
  assert.equal(triples[0].p.v, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
  assert.deepEqual(triples[1].o, { t: 'literal', v: 'x', lang: 'en', dir: null, dt: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString' });
  assert.deepEqual(triples[2].o, { t: 'int', v: 1n });
  assert.deepEqual(triples[3].o, { t: 'float', v: 2.5 });
  assert.equal(triples[4].o.t, 'list');
  assert.equal(triples[5].o.dt, 'http://www.w3.org/2001/XMLSchema#boolean');
});
test('parser: integers beyond 2^53 stay exact', () => {
  const { triples } = parseN3(`${P}:s :p 123456789012345678901234567890.`);
  assert.equal(triples[0].o.v, 123456789012345678901234567890n);
});
test('parser: paths, inverse verbs and blank-node property lists', () => {
  const { triples } = parseN3(`${P}:a!:p :q :b. :c is :r of :d. [ :x 1 ] :y 2.`);
  assert.equal(triples.length, 5);
  assert.equal(triples[2].s.v, 'http://example.org/#d');
});
test('parser: syntax errors name their line', () => {
  assert.throws(() => parseN3(`${P}\n:s :p .`), /line 3/);
  assert.throws(() => parseN3('nope:s :p :o.'), /undeclared prefix 'nope:'/);
});

// Compiling.
test('compiler: IRIs are iri(Text) and rules are eyemind rules', () => {
  const { program } = compileN3(`${P}:a :p :b. { ?x :p ?y } => { ?y :q ?x }.`);
  assert.match(program, /^fact\(rdf\(iri\("http:\/\/example.org\/#a"\), iri\("http:\/\/example.org\/#p"\), iri\("http:\/\/example.org\/#b"\)\)\)$/m);
  assert.match(program, /^implies\(rdf\(X, iri\("http:\/\/example.org\/#p"\), Y\), rdf\(Y, iri\("http:\/\/example.org\/#q"\), X\)\)$/m);
});
test('compiler: an unsupported built-in is an error that says why', () => {
  assert.throws(() => compileN3(`${P}{ "" time:localTime ?t } => { :t :is ?t }.`), /time:localTime is not supported: eyemind has no clock/);
});
test('compiler: a constant pattern drops escapes Unicode mode forbids', () => {
  const { program } = compileN3(`${P}{ ?s :p ?t. ?t string:matches "a\\\\:b\\\\.c" } => { ?s :ok true }.`);
  assert.match(program, /n3_string_matches\([^,]+, literal\("a:b\\\\.c"/);
  const braces = compileN3(`${P}{ ?s :p ?t. ?t string:matches "{{x}}\\\\p{L}{2}" } => { ?s :ok true }.`).program;
  assert.match(braces, /literal\("\\\\{\\\\{x\\\\}\\\\}\\\\p\{L\}\{2\}"/);
});
test('compiler: only the built-ins a program uses are defined', () => {
  const { program } = compileN3(`${P}{ (1 2) math:sum ?s } => { :t :is ?s }.`);
  assert.match(program, /n3_math_sum/);
  assert.doesNotMatch(program, /n3_string_format/);
});

// Reasoning.
test('forward rules report only what they derive', () => {
  assert.equal(reason(`${P}:a :p :b. { ?x :p ?y } => { ?x :q ?y. ?x :p ?y }.`), '@prefix : <http://example.org/#> .\n\n:a :q :b .\n');
});
test('--all mode reports the given triples too', () => {
  assert.match(reason(`${P}:a :p :b. { ?x :p ?y } => { ?x :q ?y }.`, { mode: 'all' }), /:a :p :b \.\n:a :q :b \./);
});
test('backward rules answer forward premises', () => {
  const out = reason(`${P}:a :n 3. { ?x :double ?y } <= { ?x :n ?n. (?n 2) math:product ?y }. { :a :double ?d } => { :a :twice ?d }.`);
  assert.match(out, /:a :twice 6 \./);
});
test('log:query selects the output', () => {
  const out = reason(`${P}:a :p :b. { ?x :p ?y } => { ?x :q ?y }. { ?x :q ?y } log:query { ?y :back ?x }.`);
  assert.equal(out, '@prefix : <http://example.org/#> .\n\n:b :back :a .\n');
});
test('a conclusion blank node is one node per firing', () => {
  const out = reason(`${P}:a a :P. :b a :P. { ?x a :P } => { ?x :m _:m }.`);
  assert.match(out, /:a :m _:b0 \.\n:b :m _:b1 \./);
});
test('scoped negation and collection', () => {
  const out = reason(`${P}:a :v 1. :b :v 2. :b :bad true.
    { ?x :v ?n. ?S log:notIncludes { ?x :bad true } } => { ?x :ok true }.
    { (?n { ?x :v ?n } ?all) log:collectAllIn ?S } => { :all :are ?all }.`);
  assert.match(out, /:a :ok true \./);
  assert.doesNotMatch(out, /:b :ok/);
  assert.match(out, /:all :are \(1 2\) \./);
});
test('log:forAllIn', () => {
  const out = reason(`${P}:a :p 1. :b :p 2. :a :q 1. :b :q 2.
    { ({ ?x :p ?n } { ?x :q ?n }) log:forAllIn ?S } => { :check :is :done }.`);
  assert.match(out, /:check :is :done \./);
});
test('negating a pattern a rule may conclude is unstratified', () => {
  assert.throws(() => reasonN3(`${P}:a :p 1. { ?x :p 1. ?S log:notIncludes { ?x :q 1 } } => { ?x :q 1 }.`), /unstratified/);
});
test('built-ins wait for the triples that bind their inputs', () => {
  const out = reason(`${P}:a :n 1. :b :n 2. { ?x log:notEqualTo ?y. ?x :n ?i. ?y :n ?j } => { ?x :differs ?y }.`);
  assert.match(out, /:a :differs :b \./);
});
test('math, string and list built-ins', () => {
  const out = reason(`${P}{ (7 2) math:quotient ?q. (6 3) math:quotient ?r. (7 2) math:remainder ?m. (-7 2) math:integerQuotient ?i.
      ("ab" "cd") string:concatenation ?c. ("%s=%.2f" "x" 3.14159) string:format ?f. "Hello" string:length ?l.
      (3 1 2 1) list:sort ?s. (1 2 3) list:last ?z. ((1) (2 3)) list:append ?ap }
    => { :r :is (?q ?r ?m ?i ?c ?f ?l ?s ?z ?ap) }.`);
  assert.match(out, /:r :is \(3\.5 2 1 -3 "abcd" "x=3\.14" 5 \(1 2 3\) 3 \(1 2 3\)\) \./);
});
test('regular-expression built-ins', () => {
  const out = reason(`${P}{ "a:b" string:matches "a\\\\:b". "abc" string:notMatches "^b".
      ("2026-11" "([0-9]+)-([0-9]+)" "$2/$1") string:replace ?r. ("id=42;" "id=([0-9]+)") string:scrape ?g }
    => { :r :is (?r ?g) }.`);
  assert.match(out, /:r :is \("11\/2026" "42"\) \./);
});
test('digests, skolem IRIs, Unicode case and formula conjunction', () => {
  const out = reason(`${P}{ "abc" crypto:sha256 ?h. "abc" crypto:md5 ?m.
      (:a 1) log:skolem ?k1. (:a 1) log:skolem ?k2. (:a 2) log:skolem ?k3.
      "Élan" string:equalIgnoringCase "éLAN". "straße" string:upperCase ?u.
      ({ :a :b :c } { :d :e :f. :a :b :c }) log:conjunction ?f.
      ?f log:equalTo { :d :e :f. :a :b :c }.
      "<http://e/s> <http://e/p> 1." log:parsedAsN3 { <http://e/s> <http://e/p> 1 } }
    => { :r :is (?h ?m ?u); :same ?k1, ?k2; :other ?k3 }.`);
  assert.match(out, /"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" "900150983cd24fb0d6963f7d28e17f72" "STRASSE"/);
  const same = [...out.matchAll(/:same (<[^>]+>)/g)].map((m) => m[1]);
  const other = /:other (<[^>]+>)/.exec(out)[1];
  assert.equal(same.length, 1);
  assert.match(same[0], /^<https:\/\/eyereasoner.github.io\/.well-known\/genid\/[0-9a-f]{64}>$/);
  assert.notEqual(same[0], other);
});
test('documents a program names are read before compiling', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'n3-interchange-'));
  writeFileSync(join(dir, 'hello.n3'), '@prefix : <http://example.org/#>.\n:Hello a :World.\n');
  writeFileSync(join(dir, 'broken.n3'), ':Hello a\n');
  const url = (name) => pathToFileURL(join(dir, name)).href;
  const text = `${P}{ <${url('hello.n3')}> log:semantics ?f. ?f log:includes { :Hello a ?c }.
      <${url('hello.n3')}> log:content ?t. <${url('broken.n3')}> log:semanticsOrError ?e.
      <${url('missing.n3')}> log:semanticsOrError ?m }
    => { :r :is (?c ?t ?e ?m) }.`;
  const documents = await fetchSourceDocuments(text);
  const out = reasonN3(text, { documents }).n3;
  assert.match(out, /:r :is \(:World """@prefix : <http:\/\/example.org\/#>.\n:Hello a :World.\n""" /);
  assert.match(out, /"error\(parse_error,N3 syntax, line \d+: [^"]*\)" "error\(dereference_failed,file:[^"]*missing.n3\)"\) \./);
  // Without the documents fetched, the built-ins have nothing to read.
  assert.equal(reasonN3(text).n3, '');
});
test('comparisons with infinity, formula equality up to renaming, and rdf:nil as a list', () => {
  const out = reason(`${P}:t :v rdf:nil.
    { "INF"^^xsd:float math:greaterThan 42. 42 math:greaterThan "-INF"^^xsd:double.
      { _:x :b :c. :d :e :f } log:equalTo { :d :e :f. _:y :b :c }.
      :t :v ?l. ?l list:length 0 } => { :r :is :ok }.
    { { :a :b :c. :d :e :f } log:notEqualTo { :d :e :f. :a :b :c } } => { :r :is :wrong }.
    { ?x math:greaterThan "INF"^^xsd:float } => { :r :is :unbound }.`);
  assert.match(out, /:r :is :ok \./);
  assert.doesNotMatch(out, /:wrong|:unbound/);
});
test('a built-in waits for a later built-in that binds its input', () => {
  const out = reason(`${P}{ (?x 1) math:sum ?y. ?x math:greaterThan 3. ?x math:cos ?c. (2 4) list:iterate (?i ?x) } => { :r :is (?x ?y) }.
    { ?z math:greaterThan -0.5. ?z math:cos ?w. ?z math:lessThan 0.5. (1) list:iterate (?j ?w) } => { :s :is ?z }.`);
  assert.match(out, /:r :is \(4 5\) \./);
  assert.match(out, /:s :is 0\.0 \./);
});
test('a built-in with nothing to compute holds, and its variables stay universal', () => {
  const out = reason(`${P}{ ?x math:sin ?y } => { { ?x math:sin 0.0 } => { :r :is ?x } }.`);
  assert.match(out, /\{ \?x <http:\/\/www.w3.org\/2000\/10\/swap\/math#sin> 0\.0 \} => \{ :r :is \?x \} \./);
  assert.match(out, /:r :is 0\.0 \./);
});
test('numbers keep their kind: integers stay exact', () => {
  const out = reason(`${P}{ (9007199254740993 1) math:sum ?s. (2 0.5) math:product ?p } => { :r :is (?s ?p) }.`);
  assert.match(out, /:r :is \(9007199254740994 1\.0\) \./);
});
test('a derived rule is applied and reported', () => {
  const out = reason(`${P}:on :is true. :a a :M. { :on :is true } => { { ?x a :M } => { ?x :ok true } }.`);
  assert.match(out, /\{ \?x a :M \} => \{ \?x :ok true \} \./);
  assert.match(out, /:a :ok true \./);
});
test('log:outputString writes strings in subject order', () => {
  assert.equal(reason(`${P}:b log:outputString "2\\n". { } => { :a log:outputString "1\\n" }.`), '1\n2\n');
});
test('an inference fuse reports a contradiction', () => {
  assert.equal(reasonN3(`${P}:a :p :b. { :a :p :b } => false.`).contradiction, true);
});
test('every compiled run has a checking proof', () => {
  const r = reasonN3(`${P}:a :p 2. { ?x :p ?n. (?n 3) math:sum ?m. ?m math:negation ?k. ?j math:negation ?k.
    ("%s" ?m) string:format ?s. ?S log:notIncludes { ?x :q ?m } } => { ?x :r (?m ?s ?j) }.`, { proof: true });
  assert.match(r.n3, /:a :r \(5 "5" 5\) \./);
  const report = checkProof(loadText(r.program, 'compiled.js'), r.result.proof);
  assert.equal(report.valid, true);
});

// The examples against their saved outputs.
const examples = readdirSync(join(root, 'examples')).filter((f) => f.endsWith('.n3')).sort();
for (const file of examples) {
  const name = basename(file, '.n3');
  test(`example ${name}`, () => {
    const outputs = readdirSync(join(root, 'examples/output')).filter((f) => f.startsWith(`${name}.`));
    assert.equal(outputs.length, 1, `examples/output needs one saved output for ${name}`);
    const r = spawnSync(process.execPath, [join(root, 'bin/eyemind-n3.js'), join(root, 'examples', file)], { encoding: 'utf8' });
    assert.equal(r.stdout, readFileSync(join(root, 'examples/output', outputs[0]), 'utf8'));
    assert.equal(r.status, name === 'fuse' ? 2 : 0, r.stderr);
  });
}

// The three commands chained give what eyemind-n3 gives in one step.
test('n3-to-eyemind | eyemind | eyemind-to-n3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'n3-interchange-'));
  const input = join(root, 'examples/invoice.n3');
  const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });
  const program = join(dir, 'invoice.js');
  assert.equal(node([join(root, 'bin/n3-to-eyemind.js'), input, '-o', program]).status, 0);
  const eyemind = fileURLToPath(new URL('../node_modules/eyemind/bin/eyemind.js', import.meta.url));
  const run = node([eyemind, program]);
  assert.equal(run.status, 0, run.stderr);
  writeFileSync(join(dir, 'conclusions.js'), run.stdout);
  const back = node([join(root, 'bin/eyemind-to-n3.js'), '--prefixes', input, join(dir, 'conclusions.js')]);
  assert.equal(back.stdout, readFileSync(join(root, 'examples/output/invoice.n3'), 'utf8'));
});
test('eyemind-n3 takes the eyemind options', () => {
  const dir = mkdtempSync(join(tmpdir(), 'n3-interchange-'));
  const bin = join(root, 'bin/eyemind-n3.js');
  const cli = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  const socrates = join(root, 'examples/socrates.n3');
  // A proof of the compiled program, checked on its own and again from a file.
  const proof = cli('--proof', socrates);
  assert.equal(proof.status, 0, proof.stderr);
  assert.match(proof.stdout, /^step\(rdf\(iri\('http:\/\/example.org\/socrates#Socrates'\)/m);
  writeFileSync(join(dir, 'proof.js'), proof.stdout);
  const checked = cli('--check-proof', join(dir, 'proof.js'), socrates);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /^verdict\('checked'\)$/m);
  writeFileSync(join(dir, 'forged.js'), proof.stdout.replace(/clause\(1\), \{/, 'clause(2), {'));
  assert.equal(cli('--check-proof', join(dir, 'forged.js'), socrates).status, 2);
  const json = JSON.parse(cli('-c', '--json', socrates).stdout);
  assert.equal(json.valid, true);
  // A goal over the compiled program; triples come back as N3.
  const goal = cli('--goal', "rdf(S, iri('http://example.org/family#ancestor'), O)", join(root, 'examples/family.n3'));
  assert.match(goal.stdout, /:bob :ancestor :dan \./);
  assert.match(cli('--stats', socrates).stderr, /"inferences":/);
  assert.equal(cli('-p', join(root, 'examples/fuse.n3')).status, 65);
  assert.match(cli('-v').stdout, /^n3-interchange v\d+\.\d+\.\d+, eyemind v\d+\.\d+\.\d+$/m);
  assert.match(cli('--json', socrates).stderr, /--json requires --check-proof or --prove-and-check/);
  assert.match(cli('--max-depth', '0', socrates).stderr, /--max-depth needs a positive integer/);
});
test('eyemind-to-n3 reads conclusions without running them', () => {
  assert.equal(eyemindToN3("rdf(iri('http://e/a'), iri('http://e/p'), literal('x', lang('en')))\n"), '<http://e/a> <http://e/p> "x"@en .\n');
  assert.throws(() => eyemindToN3('rdf(1 + 2, a, b)'), /expected/);
});

for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
  } catch (error) {
    failed++;
    console.log(`not ok - ${name}\n  ${String(error.stack ?? error).split('\n').slice(0, 6).join('\n  ')}`);
  }
}
console.log(`${failed ? 'FAIL' : 'ok'} ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
