// N3 built-ins as eyemind backward rules.
//
// Each built-in predicate of a rule body becomes a goal n3_<ns>_<name>(S, O)
// whose definition is written here in eyemind itself, so the compiled program
// is self-contained and every built-in step is an ordinary, checkable
// derivation. A definition lists the helpers it needs; the compiler copies
// the definitions a program uses, and their helpers, into the program.

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const LOG = 'http://www.w3.org/2000/10/swap/log#';
const MATH = 'http://www.w3.org/2000/10/swap/math#';
const STRING = 'http://www.w3.org/2000/10/swap/string#';
const LIST = 'http://www.w3.org/2000/10/swap/list#';

const NUMERIC_TYPES = ['integer', 'decimal', 'double', 'float', 'int', 'long', 'short', 'byte',
  'nonNegativeInteger', 'positiveInteger', 'nonPositiveInteger', 'negativeInteger',
  'unsignedLong', 'unsignedInt', 'unsignedShort', 'unsignedByte'];

// Helpers shared by the built-ins.
export const HELPERS = {
  n3_num: {
    text: `
// n3_num(T, N): N is the numeric value of the term T.
implied_by(n3_num(T, N), [is_number(T), unify(N, T)])
implied_by(n3_num(T, N), [is_compound(T), unify(T, literal(L, datatype(D))), n3_numeric_type(D), atom_chars(L, Cs), number_chars(N, Cs)])
${NUMERIC_TYPES.map((t) => `fact(n3_numeric_type('${XSD}${t}'))`).join('\n')}`,
  },
  n3_nums: {
    needs: ['n3_num'],
    text: `
// n3_nums(L, Ns): the numeric values of a list of terms.
implied_by(n3_nums(L, Ns), [is_nonvar(L), n3_nums_(L, Ns)])
fact(n3_nums_([], []))
implied_by(n3_nums_([T, ...R], [N, ...Ns]), [n3_num(T, N), n3_nums_(R, Ns)])`,
  },
  n3_result: {
    needs: ['n3_num'],
    text: `
// n3_result(V, O): an unbound object becomes V, a bound one must equal it
// in value, so 2 and 2.0 agree.
implied_by(n3_result(V, O), [is_var(O), unify(O, V)])
implied_by(n3_result(V, O), [is_nonvar(O), n3_num(O, N), eq(V, N)])`,
  },
  n3_str: {
    text: `
// n3_str(T, A): A is the text of the term T: a literal's lexical form, an
// IRI, or a number's canonical spelling.
implied_by(n3_str(T, A), [is_compound(T), unify(T, literal(A, _))])
implied_by(n3_str(T, A), [is_compound(T), unify(T, iri(A))])
implied_by(n3_str(T, A), [is_int(T), number_chars(T, Cs), atom_chars(A, Cs)])
// A float with an integral value below 10^15 is written as an integer, 29
// rather than 29.0, as N3 reasoners write decimals in strings.
implied_by(n3_str(T, A), [is_float(T), n3_integral(T, F), n3_float_text(F, T, A)])
implied_by(n3_integral(T, 'yes'), [eq(T, floor(T)), lt(abs(T), float(1e15))])
implied_by(n3_integral(T, 'no'), or(ne(T, floor(T)), ge(abs(T), float(1e15))))
implied_by(n3_float_text('yes', T, A), [is(I, int(T)), number_chars(I, Cs), atom_chars(A, Cs)])
implied_by(n3_float_text('no', T, A), [number_chars(T, Cs), atom_chars(A, Cs)])`,
  },
  n3_strs: {
    needs: ['n3_str'],
    text: `
implied_by(n3_strs(L, As), [is_nonvar(L), n3_strs_(L, As)])
fact(n3_strs_([], []))
implied_by(n3_strs_([T, ...R], [A, ...As]), [n3_str(T, A), n3_strs_(R, As)])`,
  },
  n3_str_result: {
    needs: ['n3_str'],
    text: `
// n3_str_result(A, O): an unbound object becomes the string A, a bound one
// must have the text A.
implied_by(n3_str_result(A, O), [is_var(O), unify(O, literal(A, datatype('${XSD}string')))])
implied_by(n3_str_result(A, O), [is_nonvar(O), n3_str(O, A)])`,
  },
  n3_lower: {
    text: `
// n3_lower(A, L), n3_upper(A, U): Unicode case conversion; comparing lower
// cases ignores case, as 'É' and 'é' are the same letter.
implied_by(n3_lower(A, L), atom_lower(A, L))
implied_by(n3_upper(A, U), atom_upper(A, U))`,
  },
  n3_contains: {
    text: `
// n3_contains(A, B): the text B occurs in the text A.
implied_by(n3_contains(A, B), once(atom_concat(_, R, A), atom_concat(B, _, R)))`,
  },
  n3_append: {
    text: `
fact(n3_append([], L, L))
implied_by(n3_append([H, ...T], L, [H, ...R]), n3_append(T, L, R))`,
  },
  n3_member: {
    text: `
implied_by(n3_member(X, [X, ..._]), 'true')
implied_by(n3_member(X, [_, ...T]), n3_member(X, T))`,
  },
  n3_length: {
    text: `
fact(n3_length([], 0))
implied_by(n3_length([_, ...T], N), [n3_length(T, M), is(N, add(M, 1))])`,
  },
  n3_formulas: {
    needs: ['n3_sort', 'n3_includes'],
    text: `
// n3_formulas(A, B, F): F is yes when A and B are both formulas, else no; call
// it with F unbound, as a bound F would let the second branch answer for it.
// n3_same_formula(A, B): each triple of either is a triple of the other,
// variables and blank nodes matched by unification.
implied_by(n3_formulas(A, B, F), once(or(and(is_nonvar(A), is_nonvar(B), unify(A, graph(_)), unify(B, graph(_)), unify(F, 'yes')), unify(F, 'no'))))
implied_by(n3_triple_set(graph(Ts), S), n3_sort(Ts, S))
implied_by(n3_same_formula(graph(As), graph(Bs)), [n3_all_members(As, Bs), n3_all_members(Bs, As)])`,
  },
  n3_conclusion_result: {
    needs: ['n3_sort', 'n3_formulas'],
    text: `
// n3_conclusion_result(G, O): an unbound object becomes the formula G, a
// bound one must hold the same triples.
implied_by(n3_conclusion_result(C, O), [is_var(O), unify(O, C)])
implied_by(n3_conclusion_result(graph(Ts), O), [is_nonvar(O), n3_sort(Ts, S), n3_triple_set(O, S)])`,
  },
  n3_member_at: {
    needs: ['n3_result'],
    text: `
// n3_member_at(L, K, I, X): X is at index I of L, counting from K.
implied_by(n3_member_at([X, ..._], K, I, X), n3_result(K, I))
implied_by(n3_member_at([_, ...R], K, I, X), [is(K1, add(K, 1)), n3_member_at(R, K1, I, X)])`,
  },
  n3_as_list: {
    needs: ['n3_member'],
    text: `
// n3_as_list(T, L): a collection written as rdf:first and rdf:rest triples
// from a blank node is read as the list L; any other T is L itself.
implied_by(n3_as_list(T, L), [once(n3_list_view(T, K)), n3_as_list_(K, T, L)])
implied_by(n3_list_view(T, 'as_is'), is_var(T))
implied_by(n3_list_view(iri('${RDF}nil'), 'described'), 'true')
implied_by(n3_list_view(bnode(_, _), 'described'), 'true')
implied_by(n3_list_view(skolem(_, _, _), 'described'), 'true')
implied_by(n3_list_view(_, 'as_is'), 'true')
implied_by(n3_as_list_('as_is', T, T), 'true')
implied_by(n3_as_list_('described', T, L), once(or(n3_described(T, [], L), unify(L, T))))
// Seen holds the nodes already read, so a cycle is no list.
implied_by(n3_described(iri('${RDF}nil'), _, []), 'true')
implied_by(n3_described(T, Seen, [X, ...R]), [not(n3_member(T, Seen)), rdf(T, iri('${RDF}first'), Y), n3_as_list(Y, X), rdf(T, iri('${RDF}rest'), N), n3_described(N, [T, ...Seen], R)])`,
  },
  n3_includes: {
    needs: ['n3_member'],
    text: `
// n3_includes(G, F): every triple of the formula F is a triple of the formula G.
implied_by(n3_includes(G, F), [is_nonvar(G), is_nonvar(F), n3_includes_(G, F)])
// No triple of F matches G, with F's unbound variables standing for any
// value: an empty collection, which unlike a negation allows them.
implied_by(n3_not_includes(G, F), [is_nonvar(G), is_nonvar(F), findall('found', n3_includes_(G, F), [])])
implied_by(n3_includes_(graph(Ts), graph(Ps)), n3_all_members(Ps, Ts))
fact(n3_all_members([], _))
implied_by(n3_all_members([P, ...Ps], Ts), [n3_member(P, Ts), n3_all_members(Ps, Ts)])`,
  },
  n3_round: {
    text: `
// n3_round(E, R): the value of E rounded to an integer, halves upward, so
// -1.5 is -1; an integer is itself, however large.
implied_by(n3_round(E, R), [is(X, E), n3_round_(X, R)])
implied_by(n3_round_(X, X), is_int(X))
implied_by(n3_round_(X, R), [is_float(X), is(R, floor(add(X, float(0.5))))])`,
  },
  n3_tquot: {
    text: `
// n3_tquot(X, Y, Q): integer quotient truncated toward zero.
implied_by(n3_tquot(X, Y, Q), [ge(mul(X, Y), 0), is(Q, floordiv(abs(X), abs(Y)))])
implied_by(n3_tquot(X, Y, Q), [lt(mul(X, Y), 0), is(Q, neg(floordiv(abs(X), abs(Y))))])`,
  },
  n3_sort: {
    text: `
// n3_sort(L, S): L in the standard order, without duplicates.
fact(n3_sort([], []))
implied_by(n3_sort([X], [X]), 'true')
implied_by(n3_sort([X, Y, ...R], S), [n3_halve([X, Y, ...R], A, B), n3_sort(A, SA), n3_sort(B, SB), n3_merge(SA, SB, S)])
fact(n3_halve([], [], []))
implied_by(n3_halve([X], [X], []), 'true')
implied_by(n3_halve([X, Y, ...R], [X, ...A], [Y, ...B]), n3_halve(R, A, B))
fact(n3_merge([], L, L))
implied_by(n3_merge([X, ...R], [], [X, ...R]), 'true')
implied_by(n3_merge([X, ...R], [Y, ...T], S), [n3_cmp(O, X, Y), n3_merge_(O, X, R, Y, T, S)])
implied_by(n3_merge_('<', X, R, Y, T, [X, ...S]), n3_merge(R, [Y, ...T], S))
implied_by(n3_merge_('=', X, R, _, T, [X, ...S]), n3_merge(R, T, S))
implied_by(n3_merge_('>', X, R, Y, T, [Y, ...S]), n3_merge([X, ...R], T, S))
// Numbers compare by value, other terms by the standard order.
implied_by(n3_cmp(O, X, Y), [n3_numbers(X, Y, F), n3_cmp_(F, O, X, Y)])
implied_by(n3_numbers(X, Y, F), once(or(and(is_number(X), is_number(Y), unify(F, 'yes')), unify(F, 'no'))))
implied_by(n3_cmp_('yes', O, X, Y), [lt(X, Y), unify(O, '<')])
implied_by(n3_cmp_('yes', O, X, Y), [gt(X, Y), unify(O, '>')])
implied_by(n3_cmp_('yes', O, X, Y), [eq(X, Y), compare(O, X, Y)])
implied_by(n3_cmp_('no', O, X, Y), compare(O, X, Y))`,
  },
  n3_digits: {
    text: `
// n3_fixed(X, D, A): A spells X with D digits after the point.
implied_by(n3_fixed(X, 0, A), [n3_round(X, I), number_chars(I, Cs), atom_chars(A, Cs)])
implied_by(n3_fixed(X, D, A), [gt(D, 0), n3_round(mul(abs(X), pow(10, D)), J), number_chars(J, Cs), n3_pad(Cs, D, Ps), n3_split_at_end(Ps, D, Int, Frac), n3_sign(X, J, Sign), n3_concat_chars([Sign, Int, ['.'], Frac], Out), atom_chars(A, Out)])
implied_by(n3_sign(X, J, ['-']), [lt(X, 0), gt(J, 0)])
implied_by(n3_sign(X, J, []), or(ge(X, 0), eq(J, 0)))
// n3_pad(Cs, D, Ps): Cs with leading zeros to at least D + 1 digits.
implied_by(n3_pad(Cs, D, Ps), [n3_length(Cs, N), le(N, D), n3_pad(['0', ...Cs], D, Ps)])
implied_by(n3_pad(Cs, D, Cs), [n3_length(Cs, N), gt(N, D)])
implied_by(n3_split_at_end(L, D, A, B), [n3_length(L, N), is(K, sub(N, D)), n3_take(K, L, A, B)])
implied_by(n3_take(0, L, [], L), 'true')
implied_by(n3_take(K, [X, ...R], [X, ...A], B), [gt(K, 0), is(K1, sub(K, 1)), n3_take(K1, R, A, B)])
fact(n3_concat_chars([], []))
implied_by(n3_concat_chars([L, ...Ls], R), [n3_concat_chars(Ls, R0), n3_append(L, R0, R)])`,
    needs: ['n3_round', 'n3_length', 'n3_append'],
  },
  n3_format: {
    needs: ['n3_str', 'n3_num', 'n3_digits', 'n3_length', 'n3_append'],
    text: `
// n3_format(Cs, Args, Out): printf-style formatting of %s, %d, %f, %.Nf,
// %e and %%, with an optional width and - flag for %s and %d.
fact(n3_format([], [], []))
implied_by(n3_format(['%', '%', ...R], As, ['%', ...O]), n3_format(R, As, O))
implied_by(n3_format(['%', ...R], [A, ...As], O), [n3_spec(R, Flags, Width, Prec, Conv, Rest), n3_conv(Conv, Prec, A, Cs), n3_width(Flags, Width, Cs, Ws), n3_format(Rest, As, O0), n3_append(Ws, O0, O)])
implied_by(n3_format([C, ...R], As, [C, ...O]), [not_identical(C, '%'), n3_format(R, As, O)])
// A conversion specification: flags, width, precision and the conversion.
implied_by(n3_spec(Cs, Flag, W, P, Conv, Rest), [n3_flag(Cs, Flag, Cs1), n3_int_prefix(Cs1, W, Cs2), n3_prec(Cs2, P, [Conv, ...Rest])])
implied_by(n3_flag(['-', ...R], '-', R), 'true')
implied_by(n3_flag(['0', ...R], '0', R), 'true')
implied_by(n3_flag([C, ...R], 'none', [C, ...R]), [not_identical(C, '-'), not_identical(C, '0')])
implied_by(n3_prec(['.', ...R], P, Rest), n3_int_prefix(R, P, Rest))
implied_by(n3_prec([C, ...R], 'none', [C, ...R]), not_identical(C, '.'))
implied_by(n3_int_prefix(Cs, N, Rest), [n3_digit_prefix(Cs, Ds, Rest), n3_digits_value(Ds, N)])
implied_by(n3_digit_prefix([D, ...R], [D, ...Ds], Rest), [n3_digit(D), n3_digit_prefix(R, Ds, Rest)])
implied_by(n3_digit_prefix([C, ...R], [], [C, ...R]), not(n3_digit(C)))
fact(n3_digit_prefix([], [], []))
fact(n3_digits_value([], 'none'))
implied_by(n3_digits_value([D, ...Ds], N), number_chars(N, [D, ...Ds]))
${'0123456789'.split('').map((d) => `fact(n3_digit('${d}'))`).join('\n')}
implied_by(n3_conv('s', 'none', A, Cs), [n3_str(A, T), atom_chars(T, Cs)])
implied_by(n3_conv('s', P, A, Cs), [is_int(P), n3_str(A, T), atom_chars(T, All), n3_prefix_n(All, P, Cs)])
implied_by(n3_conv('d', _, A, Cs), [n3_num(A, N), n3_round(N, I), number_chars(I, Cs)])
implied_by(n3_conv('f', 'none', A, Cs), [n3_num(A, N), n3_fixed(N, 6, T), atom_chars(T, Cs)])
implied_by(n3_conv('f', P, A, Cs), [is_int(P), n3_num(A, N), n3_fixed(N, P, T), atom_chars(T, Cs)])
implied_by(n3_conv('e', _, A, Cs), [n3_num(A, N), is(F, float(N)), number_chars(F, Cs)])
implied_by(n3_conv('g', _, A, Cs), [n3_num(A, N), number_chars(N, Cs)])
implied_by(n3_conv('G', _, A, Cs), [n3_num(A, N), number_chars(N, Cs)])
implied_by(n3_prefix_n(L, N, L), [n3_length(L, M), le(M, N)])
implied_by(n3_prefix_n(L, N, P), [n3_length(L, M), gt(M, N), n3_take(N, L, P, _)])
implied_by(n3_width(_, 'none', Cs, Cs), 'true')
implied_by(n3_width(_, W, Cs, Cs), [is_int(W), n3_length(Cs, N), ge(N, W)])
implied_by(n3_width(F, W, Cs, Ws), [is_int(W), n3_length(Cs, N), lt(N, W), is(K, sub(W, N)), n3_fill(F, K, Cs, Ws)])
implied_by(n3_fill('-', K, Cs, Ws), [n3_spaces(K, ' ', Sp), n3_append(Cs, Sp, Ws)])
implied_by(n3_fill('0', K, ['-', ...Cs], ['-', ...Ws]), [n3_spaces(K, '0', Sp), n3_append(Sp, Cs, Ws)])
implied_by(n3_fill('0', K, [C, ...Cs], Ws), [not_identical(C, '-'), n3_spaces(K, '0', Sp), n3_append(Sp, [C, ...Cs], Ws)])
implied_by(n3_fill('none', K, Cs, Ws), [n3_spaces(K, ' ', Sp), n3_append(Sp, Cs, Ws)])
fact(n3_spaces(0, _, []))
implied_by(n3_spaces(K, C, [C, ...S]), [gt(K, 0), is(K1, sub(K, 1)), n3_spaces(K1, C, S)])`,
  },
};

// Built-in predicates: IRI -> { goal, needs, text }.
export const BUILTINS = new Map();

function def(iri, goal, text, needs = []) {
  BUILTINS.set(iri, { goal, text, needs });
}

// math: two-operand functions over a list (A B).
for (const [name, expr] of [['difference', 'sub(X, Y)'], ['exponentiation', 'pow(X, Y)'], ['atan2', 'atan2(X, Y)'],
  ['logarithm', 'log(X, Y)']]) {
  const goal = `n3_math_${name}`;
  def(`${MATH}${name}`, goal, `
implied_by(${goal}([A, B], O), [n3_num(A, X), n3_num(B, Y), is(V, ${expr}), n3_result(V, O)])`, ['n3_num', 'n3_result']);
}
// (A B) math:exponentiation C with B unknown solves for it.
BUILTINS.get(`${MATH}exponentiation`).text += `
implied_by(n3_math_exponentiation([A, B], O), [is_var(B), n3_num(A, X), n3_num(O, Z), is(B, log(Z, X))])`;
BUILTINS.get(`${MATH}exponentiation`).text = BUILTINS.get(`${MATH}exponentiation`).text.replace(
  '[n3_num(A, X), n3_num(B, Y)', '[is_nonvar(B), n3_num(A, X), n3_num(B, Y)');

def(`${MATH}sum`, 'n3_math_sum', `
implied_by(n3_math_sum(L, O), [n3_nums(L, Ns), n3_sum(Ns, 0, V), n3_result(V, O)])
// From the left, so floats round as they do written out: ((a + b) + c).
fact(n3_sum([], V, V))
implied_by(n3_sum([N], 0, N), 'true')
implied_by(n3_sum([N, M, ...R], 0, V), [is(A, add(N, M)), n3_sum(R, A, V)])
implied_by(n3_sum([N, ...R], A, V), [not_identical(A, 0), is(B, add(A, N)), n3_sum(R, B, V)])`, ['n3_nums', 'n3_result']);
def(`${MATH}product`, 'n3_math_product', `
implied_by(n3_math_product(L, O), [n3_nums(L, [N, ...Ns]), n3_product(Ns, N, V), n3_result(V, O)])
implied_by(n3_math_product([], O), n3_result(1, O))
fact(n3_product([], V, V))
implied_by(n3_product([N, ...R], A, V), [is(B, mul(A, N)), n3_product(R, B, V)])`, ['n3_nums', 'n3_result']);
def(`${MATH}quotient`, 'n3_math_quotient', `
// Integers that divide exactly give an integer, as in EYE.
implied_by(n3_math_quotient([A, B], O), [n3_num(A, X), n3_num(B, Y), ne(Y, 0), n3_quotient(X, Y, V), n3_result(V, O)])
implied_by(n3_quotient(X, Y, V), [is_int(X), is_int(Y), eq(mod(X, Y), 0), is(V, floordiv(X, Y))])
implied_by(n3_quotient(X, Y, V), [not(and(is_int(X), is_int(Y), eq(mod(X, Y), 0))), is(V, div(X, Y))])`, ['n3_num', 'n3_result']);
def(`${MATH}integerQuotient`, 'n3_math_integerQuotient', `
implied_by(n3_math_integerQuotient([A, B], O), [n3_num(A, X0), n3_num(B, Y0), ne(Y0, 0), is(X, int(X0)), is(Y, int(Y0)), n3_tquot(X, Y, V), n3_result(V, O)])`, ['n3_num', 'n3_result', 'n3_tquot']);
def(`${MATH}remainder`, 'n3_math_remainder', `
implied_by(n3_math_remainder([A, B], O), [n3_num(A, X), n3_num(B, Y), ne(Y, 0), is_int(X), is_int(Y), n3_tquot(X, Y, Q), is(V, sub(X, mul(Y, Q))), n3_result(V, O)])
implied_by(n3_math_remainder([A, B], O), [n3_num(A, X), n3_num(B, Y), ne(Y, 0), not(and(is_int(X), is_int(Y))), is(V, fmod(X, Y)), n3_result(V, O)])`, ['n3_num', 'n3_result', 'n3_tquot']);

// math: one-operand functions, S math:f O, solved forward and, where an
// inverse exists, backward.
for (const [name, expr, inverse] of [
  ['negation', 'neg(X)', 'neg(Y)'], ['absoluteValue', 'abs(X)'], ['floor', 'floor(X)'], ['ceiling', 'ceil(X)'],
  ['sin', 'sin(X)', 'asin(Y)'], ['cos', 'cos(X)', 'acos(Y)'], ['tan', 'tan(X)', 'atan(Y)'],
  ['asin', 'asin(X)', 'sin(Y)'], ['acos', 'acos(X)', 'cos(Y)'], ['atan', 'atan(X)', 'tan(Y)'],
  ['sinh', 'sinh(X)', 'log(add(Y, sqrt(add(mul(Y, Y), 1))))'], ['cosh', 'cosh(X)', 'log(add(Y, sqrt(sub(mul(Y, Y), 1))))'],
  ['tanh', 'tanh(X)', 'mul(float(0.5), log(div(add(1, Y), sub(1, Y))))'],
  ['degrees', 'degrees(X)', 'radians(Y)'], ['radians', 'radians(X)', 'degrees(Y)'],
  ['sqrt', 'sqrt(X)'], ['exp', 'exp(X)'], ['ln', 'log(X)'],
]) {
  const goal = `n3_math_${name}`;
  let text = `
implied_by(${goal}(S, O), [is_nonvar(S), n3_num(S, X), is(V, ${expr}), n3_result(V, O)])`;
  if (inverse) text += `
implied_by(${goal}(S, O), [is_var(S), n3_num(O, Y), is(S, ${inverse})])`;
  def(`${MATH}${name}`, goal, text, ['n3_num', 'n3_result']);
}
def(`${MATH}rounded`, 'n3_math_rounded', `
implied_by(n3_math_rounded(S, O), [n3_num(S, X), n3_round(X, V), n3_result(V, O)])`, ['n3_num', 'n3_result', 'n3_round']);
for (const [name, fn] of [['min', 'min'], ['max', 'max']]) {
  def(`${MATH}${name}`, `n3_math_${name}`, `
implied_by(n3_math_${name}(L, O), [n3_nums(L, [N, ...Ns]), n3_${name}(Ns, N, V), n3_result(V, O)])
fact(n3_${name}([], V, V))
implied_by(n3_${name}([N, ...R], A, V), [is(B, ${fn}(A, N)), n3_${name}(R, B, V)])`, ['n3_nums', 'n3_result']);
}
// Comparisons with "INF" or "-INF" as xsd:float or xsd:double, which
// eyemind numbers cannot hold, order [Rank, Value] pairs: -INF ranks 0, a
// number 1, INF 2.
HELPERS.n3_infinite = {
  needs: ['n3_num'],
  text: `
implied_by(n3_extended(T, [1, V]), n3_num(T, V))
implied_by(n3_extended(literal('INF', datatype(D)), [2, 0]), n3_float_type(D))
implied_by(n3_extended(literal('-INF', datatype(D)), [0, 0]), n3_float_type(D))
fact(n3_float_type('${XSD}float'), n3_float_type('${XSD}double'))
implied_by(n3_infinite_order(S, O, C), [is_nonvar(S), is_nonvar(O), n3_extended(S, [R1, V1]), n3_extended(O, [R2, V2]), once(or(ne(R1, 1), ne(R2, 1))), compare(C, [R1, V1], [R2, V2])])`,
};
for (const [name, op, orders] of [['greaterThan', 'gt', ['>']], ['lessThan', 'lt', ['<']], ['notGreaterThan', 'le', ['<', '=']],
  ['notLessThan', 'ge', ['>', '=']], ['equalTo', 'eq', ['=']], ['notEqualTo', 'ne', ['<', '>']]]) {
  def(`${MATH}${name}`, `n3_math_${name}`, `
implied_by(n3_math_${name}(S, O), [n3_num(S, X), n3_num(O, Y), ${op}(X, Y)])
implied_by(n3_math_${name}(S, O), [n3_infinite_order(S, O, C), ${orders.length === 1 ? `unify(C, '${orders[0]}')` : `or(unify(C, '${orders[0]}'), unify(C, '${orders[1]}'))`}])
// (A B) math:${name} true compares A and B.
implied_by(n3_math_${name}([A, B], literal('true', datatype('${XSD}boolean'))), [n3_num(A, X), n3_num(B, Y), ${op}(X, Y)])`, ['n3_num', 'n3_infinite']);
}

// string: regular expressions, eyemind's ECMAScript patterns.
def(`${STRING}matches`, 'n3_string_matches', `
implied_by(n3_string_matches(S, O), [n3_str(S, A), n3_str(O, P), regex_match(P, A)])`, ['n3_str']);
def(`${STRING}notMatches`, 'n3_string_notMatches', `
implied_by(n3_string_notMatches(S, O), [n3_str(S, A), n3_str(O, P), not(regex_match(P, A))])`, ['n3_str']);
def(`${STRING}replace`, 'n3_string_replace', `
// (Text Pattern Replacement) string:replace Result, every match replaced.
implied_by(n3_string_replace([S, P0, R0], O), [n3_str(S, A), n3_str(P0, P), n3_str(R0, R), regex_replace(P, A, R, B), n3_str_result(B, O)])`, ['n3_str', 'n3_str_result']);
def(`${STRING}scrape`, 'n3_string_scrape', `
// (Text Pattern) string:scrape Group: the first group of the first match.
implied_by(n3_string_scrape([S, P0], O), [n3_str(S, A), n3_str(P0, P), once(regex_find(P, A, [_, G, ..._])), n3_str_result(G, O)])`, ['n3_str', 'n3_str_result']);

// string:
def(`${STRING}concatenation`, 'n3_string_concatenation', `
implied_by(n3_string_concatenation(L, O), [n3_strs(L, As), n3_concat(As, A), n3_str_result(A, O)])
fact(n3_concat([], ''))
implied_by(n3_concat([A, ...R], C), [n3_concat(R, B), atom_concat(A, B, C)])`, ['n3_strs', 'n3_str_result']);
def(`${STRING}length`, 'n3_string_length', `
implied_by(n3_string_length(S, O), [n3_str(S, A), atom_length(A, N), n3_result(N, O)])`, ['n3_str', 'n3_result']);
def(`${STRING}contains`, 'n3_string_contains', `
implied_by(n3_string_contains(S, O), [n3_str(S, A), n3_str(O, B), n3_contains(A, B)])`, ['n3_str', 'n3_contains']);
def(`${STRING}containsIgnoringCase`, 'n3_string_containsIgnoringCase', `
implied_by(n3_string_containsIgnoringCase(S, O), [n3_str(S, A0), n3_str(O, B0), n3_lower(A0, A), n3_lower(B0, B), n3_contains(A, B)])`, ['n3_str', 'n3_contains', 'n3_lower']);
def(`${STRING}startsWith`, 'n3_string_startsWith', `
implied_by(n3_string_startsWith(S, O), [n3_str(S, A), n3_str(O, B), once(atom_concat(B, _, A))])`, ['n3_str']);
def(`${STRING}endsWith`, 'n3_string_endsWith', `
implied_by(n3_string_endsWith(S, O), [n3_str(S, A), n3_str(O, B), once(atom_concat(_, B, A))])`, ['n3_str']);
def(`${STRING}equalIgnoringCase`, 'n3_string_equalIgnoringCase', `
implied_by(n3_string_equalIgnoringCase(S, O), [n3_str(S, A0), n3_str(O, B0), n3_lower(A0, A), n3_lower(B0, A)])`, ['n3_str', 'n3_lower']);
def(`${STRING}notEqualIgnoringCase`, 'n3_string_notEqualIgnoringCase', `
implied_by(n3_string_notEqualIgnoringCase(S, O), [n3_str(S, A0), n3_str(O, B0), n3_lower(A0, A), n3_lower(B0, B), not_identical(A, B)])`, ['n3_str', 'n3_lower']);
def(`${STRING}upperCase`, 'n3_string_upperCase', `
implied_by(n3_string_upperCase(S, O), [n3_str(S, A), n3_upper(A, U), n3_str_result(U, O)])`, ['n3_str', 'n3_lower', 'n3_str_result']);
def(`${STRING}lowerCase`, 'n3_string_lowerCase', `
implied_by(n3_string_lowerCase(S, O), [n3_str(S, A), n3_lower(A, L), n3_str_result(L, O)])`, ['n3_str', 'n3_lower', 'n3_str_result']);
for (const [name, test] of [['lessThan', "unify(C, '<')"], ['greaterThan', "unify(C, '>')"], ['notLessThan', "not_identical(C, '<')"],
  ['notGreaterThan', "not_identical(C, '>')"], ['equalTo', "unify(C, '=')"], ['notEqualTo', "not_identical(C, '=')"]]) {
  def(`${STRING}${name}`, `n3_string_${name}`, `
implied_by(n3_string_${name}(S, O), [n3_str(S, A), n3_str(O, B), compare(C, A, B), ${test}])`, ['n3_str']);
}
def(`${STRING}substring`, 'n3_string_substring', `
// (S Start Length) string:substring O, counting from 1.
implied_by(n3_string_substring([S, I], O), [n3_str(S, A), atom_length(A, N), n3_num(I, I0), is(L, sub(add(N, 1), I0)), n3_string_substring([S, I, L], O)])
implied_by(n3_string_substring([S, I, L], O), [n3_str(S, A), n3_num(I, I0), n3_num(L, L0), atom_chars(A, Cs), is(K, max(0, sub(I0, 1))), n3_take(K, Cs, _, Rest), n3_prefix_n(Rest, L0, Sub), atom_chars(T, Sub), n3_str_result(T, O)])`, ['n3_str', 'n3_num', 'n3_str_result', 'n3_digits', 'n3_format']);
def(`${STRING}format`, 'n3_string_format', `
implied_by(n3_string_format([F, ...Args], O), [n3_str(F, A), atom_chars(A, Cs), n3_format(Cs, Args, Out), atom_chars(T, Out), n3_str_result(T, O)])`, ['n3_str', 'n3_str_result', 'n3_format']);

// list:
def(`${LIST}first`, 'n3_list_first', `
implied_by(n3_list_first(L, X), [is_nonvar(L), unify(L, [X, ..._])])`);
def(`${LIST}rest`, 'n3_list_rest', `
implied_by(n3_list_rest(L, R), [is_nonvar(L), unify(L, [_, ...R])])`);
def(`${LIST}firstRest`, 'n3_list_firstRest', `
implied_by(n3_list_firstRest([X, ...R], [X, R]), 'true')`);
def(`${LIST}last`, 'n3_list_last', `
implied_by(n3_list_last(L, X), [is_nonvar(L), n3_last(L, X)])
implied_by(n3_last([X], X), 'true')
implied_by(n3_last([_, Y, ...R], X), n3_last([Y, ...R], X))`);
def(`${LIST}length`, 'n3_list_length', `
implied_by(n3_list_length(L, O), [is_nonvar(L), n3_length(L, N), n3_result(N, O)])`, ['n3_length', 'n3_result']);
def(`${LIST}member`, 'n3_list_member', `
implied_by(n3_list_member(L, X), [is_nonvar(L), n3_member(X, L)])`, ['n3_member']);
def(`${LIST}in`, 'n3_list_in', `
implied_by(n3_list_in(X, L), [is_nonvar(L), n3_member(X, L)])`, ['n3_member']);
def(`${LIST}notMember`, 'n3_list_notMember', `
implied_by(n3_list_notMember(L, X), not(n3_member(X, L)))`, ['n3_member']);
def(`${LIST}append`, 'n3_list_append', `
// (L1 ... Ln) list:append L; with L given and two lists, every split.
implied_by(n3_list_append(Ls, L), [is_ground(Ls), n3_appends(Ls, L)])
implied_by(n3_list_append(Ls, L), [is_nonvar(Ls), unify(Ls, [A, B]), n3_ground_flag([A, B], F), unify(F, 'no'), is_nonvar(L), n3_append(A, B, L)])
// n3_ground_flag(T, F): F is yes or no as T is ground, decided without
// negation, which needs bound variables.
implied_by(n3_ground_flag(T, F), once(or(and(is_ground(T), unify(F, 'yes')), unify(F, 'no'))))
fact(n3_appends([], []))
implied_by(n3_appends([L, ...Ls], R), [n3_appends(Ls, R0), n3_append(L, R0, R)])`, ['n3_append']);
def(`${LIST}memberAt`, 'n3_list_memberAt', `
// (L I) list:memberAt X, counting from 0.
implied_by(n3_list_memberAt([L, I], X), [is_nonvar(L), n3_member_at(L, 0, I, X)])`, ['n3_member_at']);
def(`${LIST}iterate`, 'n3_list_iterate', `
// L list:iterate (I X): X is at index I, counting from 0.
implied_by(n3_list_iterate(L, [I, X]), [is_nonvar(L), n3_member_at(L, 0, I, X)])`, ['n3_member_at']);
def(`${LIST}remove`, 'n3_list_remove', `
// (L X) list:remove R: R is L without any element equal to X.
implied_by(n3_list_remove([L, X], R), [is_ground(L), n3_remove(L, X, R)])
fact(n3_remove([], _, []))
implied_by(n3_remove([Y, ...T], X, R), [unify(X, Y), n3_remove(T, X, R)])
implied_by(n3_remove([Y, ...T], X, [Y, ...R]), [not_unify(X, Y), n3_remove(T, X, R)])`);
def(`${LIST}reverse`, 'n3_list_reverse', `
implied_by(n3_list_reverse(L, R), [is_nonvar(L), n3_reverse(L, [], R)])
fact(n3_reverse([], A, A))
implied_by(n3_reverse([X, ...T], A, R), n3_reverse(T, [X, ...A], R))`);
def(`${LIST}sort`, 'n3_list_sort', `
implied_by(n3_list_sort(L, S), [is_nonvar(L), n3_sort(L, S)])`, ['n3_sort']);
def(`${LIST}unique`, 'n3_list_unique', `
implied_by(n3_list_unique(L, S), [is_nonvar(L), n3_unique(L, [], S)])
fact(n3_unique([], _, []))
implied_by(n3_unique([X, ...T], Seen, R), [n3_member(X, Seen), n3_unique(T, Seen, R)])
implied_by(n3_unique([X, ...T], Seen, [X, ...R]), [not(n3_member(X, Seen)), n3_unique(T, [X, ...Seen], R)])`, ['n3_member']);

// rdf:first and rdf:rest also take a collection apart.
def(`${RDF}first`, 'n3_rdf_first', `
implied_by(n3_rdf_first(S, O), rdf(S, iri('${RDF}first'), O))
implied_by(n3_rdf_first(S, O), [is_compound(S), unify(S, [O, ..._])])`);
def(`${RDF}rest`, 'n3_rdf_rest', `
implied_by(n3_rdf_rest(S, O), rdf(S, iri('${RDF}rest'), O))
implied_by(n3_rdf_rest(S, O), [is_compound(S), unify(S, [_, ...O])])`);

// time: the parts of an xsd:dateTime or xsd:date, YYYY-MM-DDThh:mm:ss.
const TIME = 'http://www.w3.org/2000/10/swap/time#';
for (const [name, from, length] of [['year', 0, 4], ['month', 5, 2], ['day', 8, 2], ['hour', 11, 2], ['minute', 14, 2], ['second', 17, 2]]) {
  def(`${TIME}${name}`, `n3_time_${name}`, `
implied_by(n3_time_${name}(S, O), [n3_str(S, A), atom_chars(A, Cs), n3_take(${from}, Cs, _, R), n3_take(${length}, R, Ds, _), number_chars(N, Ds), n3_result(N, O)])`,
  ['n3_str', 'n3_result', 'n3_digits']);
}
def(`${TIME}timeZone`, 'n3_time_timeZone', `
implied_by(n3_time_timeZone(S, O), [n3_str(S, A), atom_chars(A, Cs), n3_take(19, Cs, _, R), n3_zone(R, Z), atom_chars(T, Z), n3_str_result(T, O)])
implied_by(n3_zone(['.', ...R], Z), [n3_digit_prefix(R, _, Rest), n3_zone(Rest, Z)])
implied_by(n3_zone([C, ...R], [C, ...R]), not_identical(C, '.'))`, ['n3_str', 'n3_str_result', 'n3_digits', 'n3_format']);

// crypto: digests of a string's UTF-8 bytes, in lowercase hexadecimal.
const CRYPTO = 'http://www.w3.org/2000/10/swap/crypto#';
for (const [name, algorithm] of [['md5', 'md5'], ['sha', 'sha1'], ['sha1', 'sha1'], ['sha256', 'sha256'], ['sha512', 'sha512']]) {
  def(`${CRYPTO}${name}`, `n3_crypto_${name}`, `
implied_by(n3_crypto_${name}(S, O), [n3_str(S, A), digest('${algorithm}', A, H), n3_str_result(H, O)])`, ['n3_str', 'n3_str_result']);
}

// log:skolem names a ground term by the SHA-256 of its canonical text, so the
// same term always gets the same IRI and different terms different ones.
def(`${LOG}skolem`, 'n3_log_skolem', `
implied_by(n3_log_skolem(S, O), [is_ground(S), term_text(S, T), digest('sha256', T, H),
  atom_concat('https://eyereasoner.github.io/.well-known/genid/', H, I), unify(O, iri(I))])`);

// F log:conclusion C: C is the deductive closure of F, worked out while
// compiling for every formula the document states (n3_conclusion_of facts);
// a formula only built while reasoning has none.
def(`${LOG}conclusion`, 'n3_log_conclusion', `
implied_by(n3_log_conclusion(F, O), [is_nonvar(F), n3_conclusion_of(F, C), n3_conclusion_result(C, O)])`, ['n3_conclusion_result']);

// The documents a program names, read before compiling: their formula,
// text, or the error that kept them from being read.
def(`${LOG}semantics`, 'n3_log_semantics', `
implied_by(n3_log_semantics(S, O), [is_nonvar(S), n3_semantics(S, G), n3_conclusion_result(G, O)])`, ['n3_conclusion_result']);
def(`${LOG}semanticsOrError`, 'n3_log_semanticsOrError', `
implied_by(n3_log_semanticsOrError(S, O), [is_nonvar(S), n3_semantics(S, G), n3_conclusion_result(G, O)])
implied_by(n3_log_semanticsOrError(S, O), [is_nonvar(S), n3_document_error(S, E), unify(O, literal(E, datatype('${XSD}string')))])`, ['n3_conclusion_result']);
def(`${LOG}parsedAsN3`, 'n3_log_parsedAsN3', `
implied_by(n3_log_parsedAsN3(S, O), [is_nonvar(S), n3_parsed(S, G), n3_conclusion_result(G, O)])`, ['n3_conclusion_result']);
def(`${LOG}content`, 'n3_log_content', `
implied_by(n3_log_content(S, O), [is_nonvar(S), n3_content(S, T), n3_str_result(T, O)])`, ['n3_str_result']);

// (F1 ... Fn) log:conjunction F: F holds the triples of every Fi, once each.
def(`${LOG}conjunction`, 'n3_log_conjunction', `
implied_by(n3_log_conjunction(L, O), [is_ground(L), n3_conj(L, Ts), n3_sort(Ts, S), n3_conj_result(S, O)])
fact(n3_conj([], []))
implied_by(n3_conj([graph(Ts), ...R], All), [n3_conj(R, Rest), n3_append(Ts, Rest, All)])
implied_by(n3_conj([literal('true', datatype('${XSD}boolean')), ...R], All), n3_conj(R, All))
implied_by(n3_conj_result(S, O), [is_var(O), unify(O, graph(S))])
implied_by(n3_conj_result(S, O), [is_nonvar(O), n3_triple_set(O, S)])`, ['n3_sort', 'n3_append', 'n3_formulas']);

// log:
// Formulas are equal when they hold the same triples, in any order.
def(`${LOG}equalTo`, 'n3_log_equalTo', `
implied_by(n3_log_equalTo(A, B), [n3_formulas(A, B, F), n3_equal(F, A, B)])
implied_by(n3_equal('yes', A, B), n3_same_formula(A, B))
implied_by(n3_equal('no', A, B), unify(A, B))`, ['n3_formulas']);
def(`${LOG}notEqualTo`, 'n3_log_notEqualTo', `
implied_by(n3_log_notEqualTo(A, B), [n3_formulas(A, B, F), n3_not_equal(F, A, B)])
// An empty collection rather than a negation, so a formula's own variables
// need not be bound.
implied_by(n3_not_equal('yes', A, B), findall('same', n3_same_formula(A, B), []))
implied_by(n3_not_equal('no', A, B), not_unify(A, B))`, ['n3_formulas']);
def(`${LOG}uri`, 'n3_log_uri', `
implied_by(n3_log_uri(S, O), [is_nonvar(S), unify(S, iri(U)), n3_str_result(U, O)])
implied_by(n3_log_uri(S, O), [is_var(S), n3_str(O, U), unify(S, iri(U))])`, ['n3_str', 'n3_str_result']);
def(`${LOG}rawType`, 'n3_log_rawType', `
implied_by(n3_log_rawType(S, O), [is_nonvar(S), once(n3_raw_type(S, T)), unify(O, iri(T))])
implied_by(n3_raw_type(graph(_), '${LOG}Formula'), 'true')
implied_by(n3_raw_type(literal(_, _), '${LOG}Literal'), 'true')
implied_by(n3_raw_type(S, '${LOG}Literal'), is_number(S))
implied_by(n3_raw_type([], '${RDF}List'), 'true')
implied_by(n3_raw_type([_, ..._], '${RDF}List'), 'true')
implied_by(n3_raw_type(iri(_), '${LOG}Other'), 'true')
implied_by(n3_raw_type(bnode(_, _), '${LOG}LabeledBlankNode'), 'true')
implied_by(n3_raw_type(skolem(_, _, _), '${LOG}UnlabeledBlankNode'), 'true')`);
def(`${LOG}dtlit`, 'n3_log_dtlit', `
// (Lexical Datatype) log:dtlit Literal.
implied_by(n3_log_dtlit([S, iri(D)], O), [is_nonvar(S), n3_str(S, A), n3_typed(A, D, O)])
implied_by(n3_log_dtlit([L, D], O), [is_nonvar(O), n3_lit_parts(O, A, U), unify(L, literal(A, datatype('${XSD}string'))), unify(D, iri(U))])
// xsd:integer, xsd:decimal and xsd:double with a valid lexical form are
// numbers, as when they are read.
implied_by(n3_typed(A, D, N), [n3_number_type(D, K), atom_chars(A, Cs), number_chars(N, Cs), n3_number_kind(N, K)])
implied_by(n3_typed(A, D, literal(A, datatype(D))), not(and(n3_number_type(D, _1), atom_chars(A, _2), number_chars(_3, _2), n3_number_kind(_3, _1))))
fact(n3_number_type('${XSD}integer', 'int'), n3_number_type('${XSD}decimal', 'float'), n3_number_type('${XSD}double', 'float'))
implied_by(n3_number_kind(N, 'int'), is_int(N))
implied_by(n3_number_kind(N, 'float'), is_number(N))
implied_by(n3_lit_parts(literal(A, datatype(U)), A, U), 'true')
implied_by(n3_lit_parts(N, A, '${XSD}integer'), [is_int(N), number_chars(N, Cs), atom_chars(A, Cs)])
implied_by(n3_lit_parts(N, A, '${XSD}decimal'), [is_float(N), number_chars(N, Cs), atom_chars(A, Cs)])`, ['n3_str']);
def(`${LOG}langlit`, 'n3_log_langlit', `
// (Lexical Language) log:langlit Literal.
implied_by(n3_log_langlit([S, T], O), [is_nonvar(S), n3_str(S, A), n3_str(T, L), unify(O, literal(A, lang(L)))])
implied_by(n3_log_langlit([S, T], O), [is_var(S), unify(O, literal(A, lang(L))), unify(S, literal(A, datatype('${XSD}string'))), unify(T, literal(L, datatype('${XSD}string')))])`, ['n3_str']);

// Built-ins that need what eyemind deliberately leaves out: clocks,
// printing, and rules as data.
export const UNSUPPORTED = new Map([
  [`${LOG}trace`, 'printing while reasoning'],
  [`${LOG}implies`, 'matching rules as data'],
  [`${LOG}impliedBy`, 'matching rules as data'],
]);
for (const name of ['localTime', 'gmTime', 'currentTime']) UNSUPPORTED.set(`http://www.w3.org/2000/10/swap/time#${name}`, 'clock');
