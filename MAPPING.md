# N3 as eyemind

This guide describes how `n3-to-eyemind` translates an N3 document and how
`eyemind-to-n3` reads the conclusions back.

## Triples and terms

Each N3 triple becomes `rdf(Subject, Predicate, Object)`. The document's own
triples are facts:

```turtle
:Socrates a :Human.
```

```js
fact(rdf(iri("http://example.org/socrates#Socrates"), iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), iri("http://example.org/socrates#Human")))
```

| N3 | eyemind term |
| --- | --- |
| IRI | `iri("http://example.org/a")` |
| Blank node | `bnode('n3', Label)` |
| Integer, `xsd:integer` | an integer, exact at any size |
| Decimal, double, `xsd:decimal`, `xsd:double` | a float |
| String, `xsd:string` | `literal(Text, datatype("http://www.w3.org/2001/XMLSchema#string"))` |
| Other typed literal, boolean | `literal(Text, datatype(IRI))` |
| Language string | `literal(Text, lang(Tag))`, or `lang(Tag, Direction)` |
| Collection | a list, `[A, B, C]` |
| Quoted formula | `graph([rdf(S, P, O), ...])` |
| RDF 1.2 triple term | `triple(S, P, O)` |
| Variable in a quoted formula outside rules | `qvar(Name)` |

IRIs, blank nodes, literals and triple terms are written as rdf-interchange
writes them, so its `rdf-to-eyemind` data and the rules of either package
mix. eyemind indexes small ground compounds such as `iri(...)` like atoms, so
a pattern with a constant IRI finds its matches directly.

## Rules

| N3 | eyemind |
| --- | --- |
| `{ B } => { H }.` | `implies(B, H)`, a forward rule |
| `{ H } <= { B }.` | `implied_by(H, B)` per triple of `H`, a backward rule |
| `{ B } log:query { H }.` | `implies(B, result(H))`, and `query(result(S, P, O))` |
| `{ B } => false.` | `contradiction(B)`, which halts the run |
| `{ A } => { { B } => { C } }.` | `implies(A, [implies(B, C), rdf(graph(B), log:implies, graph(C))])` |

A rule's `?variables` and blank nodes are eyemind variables. A blank node
only the conclusion mentions is, in eyemind, the Skolem term of the firing,
`skolem(Rule, Variable, Arguments)`; `eyemind-to-n3` writes it as a blank
node, the same one for the same firing. A rule that concludes a rule also
concludes it as a triple, its own variables quoted as `qvar(Name)` and
`qbnode(Label)`, because N3 reasoners report derived rules.

Without `log:query` the program states no query, so eyemind's conclusions are
the triples its forward rules derive that were not already facts.

## Built-ins

A body triple whose predicate is a built-in becomes a goal
`n3_<namespace>_<name>(Subject, Object)`, defined by backward rules written in
eyemind and copied into the program with the helpers it needs. Built-in steps
are ordinary derivations, so a proof cites them like any other.

| N3 | eyemind |
| --- | --- |
| `?S log:notIncludes { F }` | `not(F)`, the formula's own variables anonymous |
| `?S log:includes { F }` | the goals of `F` |
| `(T { F } L) log:collectAllIn ?S` | `findall(T, F, L)` |
| `({ A } { B }) log:forAllIn ?S` | `not([A, not(B)])` |
| `F1 log:includes F2`, formulas | `n3_includes(F1, F2)`, each triple of `F2` in `F1` |
| `((L) P) list:map R` | `findall(Y, [n3_member(X, L), rdf(X, P, Y)], R)` |
| `log:equalTo`, `log:notEqualTo` | `unify`, `not_unify` for a constant that is no formula; formulas as sets |
| `crypto:md5`, `sha`, `sha256`, `sha512` | eyemind's `digest` of the string's UTF-8 bytes, in hexadecimal |
| `string:lowerCase`, `upperCase`, `…IgnoringCase` | eyemind's `atom_lower`, `atom_upper`: Unicode case conversion |
| `L log:skolem I` | `https://eyereasoner.github.io/.well-known/genid/` and the SHA-256 of `term_text(L)` |
| `(F1 … Fn) log:conjunction F` | the triples of all `Fi`, sorted, each once |
| `F log:conclusion C` | `n3_conclusion_of(F, C)`, a fact per formula the document states, its closure computed while compiling |
| `"…" log:parsedAsN3 F` | the string parsed while compiling, compared with `F` as a set |
| `S string:matches P`, `notMatches` | `regex_match(P, S)`, `not(regex_match(P, S))` |
| `(S P R) string:replace U` | `regex_replace(P, S, R, U)`, every match replaced |
| `(S P) string:scrape G` | the first group of the first match, `once(regex_find(P, S, [_, G, ..._]))` |

A built-in whose formula is neither written in the rule nor bound when it
runs, such as `log:includes` with a literal object, compiles to `'fail'`.
`log:equalTo` and `log:notEqualTo` compare two formulas as sets of triples,
sorting each, and other terms by unification.

### Lists written as triples

A list can be written out as `rdf:first` and `rdf:rest` triples from a blank
node, ending in `rdf:nil`. Such a description is a different term from the
collection `( ... )`, so a triple pattern does not match one with the other.
A built-in reads both as a list: before it, each `?variable` or blank node
argument, and each such item of a written list, passes through
`n3_as_list(T, L)`, which follows the description, nested descriptions too,
and passes anything else on unchanged. Only a document that mentions
`rdf:first` or `rdf:rest` gets these steps, since only it can write a list
out, and they are left out inside a negation or collection, where reading
`rdf:first` triples would make the rule depend on every rule that concludes
them.

A scope is the subject of `log:includes` or `log:notIncludes`, or the object
of `log:collectAllIn` or `log:forAllIn`. A variable that appears nowhere else
in the rule, or a constant such as `1`, means the whole store.

Patterns are eyemind's: ECMAScript regular expressions in Unicode mode. A
constant pattern written for a dialect that lets any character be escaped or
a brace stand for itself, as in `"a\\:b"` or `"{{name}}"`, is rewritten to
mean the same there: the backslash before other punctuation is dropped, and
a brace that is no quantifier is escaped.

Numeric built-ins compare and return values, so `2` and `2.0` agree as
objects. Integer division that is exact gives an integer, `math:rounded`
rounds halves upward, and sums and products run from the left, as written.
Strings of an integral float, below 10^15, are written without a fraction,
`29` rather than `29.0`.

### Evaluation order

eyemind solves a body from left to right. N3 does not fix an order, so the
compiler moves a built-in after the ordinary triples that bind its inputs:
all the variables of a test such as `math:lessThan` or `log:notEqualTo`, or
the subject of a function such as `math:sum`. A built-in that also runs
backward, such as `list:firstRest`, stays where it is when its object is
bound. In a backward rule the conclusion's variables count as bound, since
the calling goal supplies them.

## Proofs

`eyemind-n3` runs the compiled program through eyemind's library, and
`reasonN3(text, { proof: true })` returns eyemind's proof, which eyemind
checks before returning it. The built-ins choose between modes with
`is_var`, which a proof records as it was called.
