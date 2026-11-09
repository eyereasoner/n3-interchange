# n3-interchange

[![npm](https://img.shields.io/npm/v/n3-interchange.svg)](https://www.npmjs.com/package/n3-interchange)

Notation3 (N3) for [eyemind](https://github.com/eyereasoner/eyemind). It
compiles N3 facts and rules into an eyemind program and writes eyemind's
conclusions back as N3. Run together, eyemind becomes an N3 reasoner: it reads
the same `.n3` files and writes the same derived triples as EYE, eye-js,
eyeling and eyeron. Coverage is not complete; [Coverage](#coverage) lists the
measured results and the built-ins it leaves out.

```text
N3 document
   | n3-to-eyemind
   v
eyemind program        facts, rules and the N3 built-ins it uses, in eyemind
   | eyemind
   v
eyemind conclusions    the derived rdf/3 triples
   | eyemind-to-n3
   v
N3 derived triples
```

`eyemind-n3` does all three in one step. Every step is readable on its own:
the program is ordinary eyemind, so `eyemind --proof` proves its conclusions
and `eyemind --check-proof` checks them, built-in steps included. The
[mapping guide](MAPPING.md) gives the translation in detail.

## Install

```sh
npm install
```

Node.js 18 or newer. The package depends on `eyemind` and nothing else.

## Run

```sh
eyemind-n3 examples/socrates.n3
```

```turtle
@prefix : <http://example.org/socrates#> .

:Socrates a :Mortal .
```

Like the other N3 reasoners, `eyemind-n3` writes the triples the rules derive.
With `log:query` rules it writes only their conclusions, and when the result
holds `log:outputString` triples it writes their strings, ordered by subject.
An inference fuse, `{ ... } => false`, stops the run with exit status 2.

```text
eyemind-n3 [OPTION ...] input.n3 ...
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
      --goal GOAL         Ask an eyemind goal after forward reasoning
      --strict-proof      Reject proofs with unresolved obligations
      --unused            List the compiled clauses that make no difference
      --stats             Print reasoning statistics to stderr
      --max-depth N       Bound backward recursion (default 1000000)
      --max-iterations N  Bound forward rounds per stratum (default 100000)
      --max-inferences N  Bound reasoning work (default 1000000000)
  -v, --version           Print the versions of n3-interchange and eyemind
  -h, --help              Print this help
```

Several inputs are read as one document; blank-node labels stay local to each.

The eyemind options mean what they mean for `eyemind`, applied to the
compiled program. Compiling is deterministic, so a proof saved with
`--proof` checks later against the same N3 input:

```sh
eyemind-n3 --proof examples/invoice.n3 > invoice-proof.js
eyemind-n3 --check-proof invoice-proof.js examples/invoice.n3
eyemind-n3 --goal "rdf(S, iri('http://example.org/family#ancestor'), O)" examples/family.n3
```

A goal's answers are written as N3 when they are triples, and as eyemind
terms otherwise. With `--proof` or `--prove-and-check` the exit codes are
eyemind's: 2 for an invalid proof and 65 for a fuse that fired.

## The three steps

```sh
n3-to-eyemind examples/invoice.n3 -o invoice.js
eyemind invoice.js > conclusions.js
eyemind-to-n3 --prefixes examples/invoice.n3 conclusions.js
```

`n3-to-eyemind` takes `--base IRI` and `-o FILE`. `eyemind-to-n3` reads the
conclusions as data, without running them, and takes `--prefixes FILE` (the N3
document whose prefixes to use), `--strings`, `--triples` and `-o FILE`.

## Examples

`examples/` holds small programs, each with its expected output in
`examples/output/`:

| Example | Shows |
| --- | --- |
| `socrates` | a forward rule |
| `family` | recursive backward rules (`<=`) and `log:query` |
| `closed-world` | scoped negation with `log:notIncludes` |
| `invoice` | `log:collectAllIn`, `math:sum` and `math:greaterThan` |
| `existential` | blank nodes in a conclusion, one per firing |
| `report` | `string:format` and `log:outputString` |
| `derived-rule` | a rule that concludes a rule |
| `fuse` | an inference fuse, `=> false` |

## Coverage

Measured on 2026-11-09 against the eyeling examples (commit `830e0b0`) and
the notation3tests suite as eyeling mirrors it:

| Corpus | Result |
| --- | --- |
| eyeling examples with an expected output | 159 of 205 match; 22 more need TriG inputs or JavaScript built-ins and were not run |
| notation3tests | 1031 of 1163 |

```sh
node tools/corpus.mjs ../eyeling/examples
node tools/notation3tests.mjs ../eyeling/test/notation3tests/tests
```

The parser reads all 227 eyeling examples. Most of the remaining differences
come from built-ins that need what eyemind leaves out by design, and
`n3-to-eyemind` stops with an error naming the built-in and the reason:

| Built-ins | eyemind has no |
| --- | --- |
| `log:semantics`, `semanticsOrError`, `content` | file or network access |
| `log:conclusion`, `log:conjunction`, `log:parsedAsN3` | reasoning over or merging formulas at run time |
| `log:skolem`, `log:nameOf` | naming terms by their text |
| `log:implies`, `log:impliedBy` in a premise | matching rules as data |
| `crypto:*`, `time:localTime` and `gmTime` | hashing, clock |

Other limits:

- eyemind stratifies negation and collection. A rule that negates or
  collects a pattern that some rule may conclude, the same one or another,
  is rejected as unstratified, where EYE would still answer.
- eyemind has no tabling, so `log:memoize` is an ordinary fact and a
  backward rule recomputes every call; doubly recursive definitions such as
  a naive Fibonacci exhaust memory.
- A rule whose conclusion is a variable, `{ ... } => ?F`, is read as a
  triple, not as a rule.
- Quoted formulas match as ordered lists of triples, not as sets;
  `log:equalTo` and `log:notEqualTo` compare them as sets, but not up to
  renaming blank nodes.
- `log:collectAllIn` and `log:forAllIn` need their formulas written in the
  rule; one only known when the rule runs makes the goal fail.
- Decimals and doubles are both binary64 floats, and `xsd:float` is one too.
- Built-ins called with every argument unbound fail, case-insensitive string
  built-ins fold only ASCII letters, and `INF` and `NaN` are not numbers.

## JavaScript API

```js
import { compileN3, eyemindToN3, reasonN3 } from 'n3-interchange';

const { program } = compileN3(n3Text);              // eyemind program text
const { n3, contradiction } = reasonN3(n3Text);     // derived triples as N3
const text = eyemindToN3(conclusions, { prefixes }); // conclusions as N3
```

`reasonN3(sources, options)` takes the text, or `[text, name]` pairs, and the
options `mode` (`'new'` or `'all'`), `strings` (`'auto'`, `true`, `false`),
`base`, `limits` (`maxInferences`, `maxDepth`, `maxIterations`) and `proof`.
It returns `n3`, the `triples`, `contradiction`, the compiled `program` and
eyemind's `result`, whose `proof` `checkProof` from eyemind checks.

## Tests

```sh
npm test
```

Unit tests, every example against its saved output, and the three commands
chained against `eyemind-n3`.

## Releases

`package.json` holds the version. A release runs the tests, bumps the
version, commits, tags and pushes; the tag makes GitHub create the release
and publish the package to npm through npm trusted publishing, with
provenance and no stored token:

```sh
./release patch "Release v0.1.1: describe what changed"
./release minor "Release v0.2.0: describe what changed"
```

The message is used as given for the commit, the tag and the release, and
must say what changed. The publish workflow can also be run by hand for an
existing tag, optionally as a dry run, and leaves a version npm already has
as it is.
