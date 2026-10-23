// The Mix page's grouping logic, on a tiny made-up pairing graph.
const { test } = require("node:test");
const assert = require("node:assert");
const { together, rankSuggestions, mergePairs, matchNames, closeNames } = require("../public/pairing.js");

// rum 1, lime 2, mint 3, cola 4 (pairs with nothing in the mix); candidates 10-13.
const edges = { 1: { 2: 2, 3: 1, 10: 2, 11: 1, 12: 1 }, 2: { 1: 2, 3: 2, 10: 1, 11: 2 }, 3: { 1: 1, 2: 2, 10: 1, 13: 1 }, 4: {} };
const pm = new Map(Object.entries(edges).map(([id, p]) => [Number(id), new Map(Object.entries(p).map(([o, s]) => [Number(o), { strength: s }]))]));
const cands = new Map([[10, { name: "sugar", is_bar: true }], [11, { name: "soda", is_bar: true }], [12, { name: "pineapple", is_bar: false }], [13, { name: "cucumber", is_bar: true }]]);

test("together finds the largest groups that all pair, and leaves out loners", () => {
  assert.deepEqual(together([1, 2, 3, 4], pm), [[1, 2, 3]]);
  assert.deepEqual(together([1, 4], pm), []);
  assert.deepEqual(together([1, 2], pm), [[1, 2]]);
});

test("together reports separate groups when not everything pairs", () => {
  // drop rum-mint and lime-mint: lime pairs with rum only, mint pairs with nothing
  const thin = new Map([[1, new Map([[2, {}]])], [2, new Map([[1, {}]])], [3, new Map()]]);
  assert.deepEqual(together([1, 2, 3], thin), [[1, 2]]);
});

test("suggestions are one list ranked by how many mix items they go with, then strength", () => {
  const r = rankSuggestions([1, 2, 3], pm, cands);
  assert.deepEqual(r.map((x) => x.name), ["sugar", "soda", "cucumber", "pineapple"]);
  assert.deepEqual(r.map((x) => x.with.length), [3, 2, 1, 1]);
  assert.deepEqual(r[1].with, [1, 2], "with keeps mix order");
  assert.equal(r[0].strength, 1, "strength is the weakest link");
});

test("same count: the stronger pairing ranks first, then A to Z", () => {
  assert.deepEqual(rankSuggestions([1], pm, cands).map((x) => x.name), ["sugar", "pineapple", "soda"]);
});

test("bar-only and the 'only show what pairs with' filter", () => {
  assert.ok(!rankSuggestions([1, 2, 3], pm, cands, { barOnly: true }).some((x) => x.name === "pineapple"));
  assert.deepEqual(rankSuggestions([1, 2, 3], pm, cands, { checked: new Set([3]) }).map((x) => x.name), ["sugar", "cucumber"]);
});

test("ranking a full 30-ingredient mix over 1,000 candidates is fast", () => {
  const ids = Array.from({ length: 30 }, (_, i) => i + 1);
  const many = new Map(Array.from({ length: 1000 }, (_, i) => [100 + i, { name: "c" + i, is_bar: true }]));
  const g = new Map(ids.map((a) => [a, new Map([...many.keys()].filter((c) => c % a === 0).map((c) => [c, { strength: 1 + (c % 2) }]))]));
  const t0 = Date.now(), r = rankSuggestions(ids, g, many);
  assert.ok(Date.now() - t0 < 200, "should be linear in candidates");
  assert.ok(r.every((x, i) => !i || r[i - 1].with.length >= x.with.length), "never fewer before more");
});

test("merged duplicates: partners map onto one id and the stronger pairing wins", () => {
  // 951 coca-cola is a duplicate of 838 cola
  const canon = (id) => (id === 951 ? 838 : id);
  const m = mergePairs([new Map([[1, { strength: 1 }], [951, { strength: 2 }]]), new Map([[1, { strength: 2 }], [5, { strength: 1 }]])], canon);
  assert.deepEqual([...m.keys()].sort(), [1, 5, 838]);
  assert.equal(m.get(1).strength, 2);
  assert.equal(m.get(838).strength, 2);
});

test("did you mean: typos within a small edit distance, closest first", () => {
  const names = ["bourbon", "bourbon whiskey", "angostura bitters", "tequila", "rum", "curaçao", "gin"];
  const fold = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  assert.deepEqual(closeNames(names, "bourbin"), ["bourbon", "bourbon whiskey"]);
  assert.deepEqual(closeNames(names, "tequlia"), ["tequila"], "a swap counts as one edit");
  assert.deepEqual(closeNames(names, "angostra"), ["angostura bitters"], "matches a word inside the name");
  assert.deepEqual(closeNames(names, "curacoa", 3, fold), ["curaçao"]);
  assert.deepEqual(closeNames(names, "rim"), ["rum"]);
  assert.deepEqual(closeNames(names, "gn"), [], "too short to guess");
  assert.deepEqual(closeNames(names, "vodka"), [], "nothing close");
});

test("search matches: starts-with first, then word start, then anywhere, capped", () => {
  const names = ["lime", "lime juice", "key lime", "sublime syrup", "mint", "LIME LEAF"];
  assert.deepEqual(matchNames(names, "lim"), ["lime", "LIME LEAF", "lime juice", "key lime", "sublime syrup"]);
  assert.deepEqual(matchNames(names, "  "), []);
  assert.deepEqual(matchNames(names, "zz"), []);
  assert.equal(matchNames(names, "i", 2).length, 2);
});

test("together stays fast and correct on a full 30-ingredient mix", () => {
  const ids = Array.from({ length: 30 }, (_, i) => i + 1);
  // two cliques: odds all pair, evens all pair, plus one bridge 1-2
  const g = new Map(ids.map((a) => [a, new Map(ids.filter((b) => b !== a && (a % 2 === b % 2 || a + b === 3)).map((b) => [b, {}]))]));
  const t0 = Date.now(), out = together(ids, g);
  assert.ok(Date.now() - t0 < 200, "should not be exponential");
  assert.deepEqual(out.map((c) => c.length), [15, 15, 2]);
  assert.deepEqual(out[2], [1, 2]);
});

test("search with a singular-form normalizer finds -ies plurals", () => {
  const norm = (t) => t.split(" ").map((w) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w)).join(" ");
  const names = ["strawberries", "cherry pie", "cranberries"];
  assert.deepEqual(matchNames(names, "strawberry", 8, norm), ["strawberries"]);
  assert.deepEqual(matchNames(names, "Cherry", 8, norm), ["cherry pie"]);
  assert.deepEqual(matchNames(names, "strawberry"), [], "without norm, plain substring only");
});

test("search puts preferred (bar) names first within the same match quality", () => {
  const names = ["salt pork", "salt", "salted caramel", "sea salt"];
  const bar = (n) => n === "salted caramel" || n === "sea salt";
  assert.deepEqual(matchNames(names, "salt", 8, undefined, bar), ["salted caramel", "salt", "salt pork", "sea salt"]);
});
