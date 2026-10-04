// The Mix page's grouping logic, on a tiny made-up pairing graph.
const { test } = require("node:test");
const assert = require("node:assert");
const { together, suggestionGroups, matchNames } = require("../public/pairing.js");

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

test("suggestions are grouped by exactly what they pair with, biggest groups first", () => {
  const g = suggestionGroups([1, 2, 3], pm, cands);
  assert.deepEqual(g.map((x) => x.with), [[1, 2, 3], [1, 2], [1], [3]]);
  assert.deepEqual(g[0].items.map((i) => i.name), ["sugar"]);
  assert.equal(g[0].items[0].strength, 1, "strength is the weakest link");
  assert.deepEqual(g[2].items.map((i) => i.name), ["pineapple"]);
});

test("bar-only and the 'only show what pairs with' filter", () => {
  assert.ok(!suggestionGroups([1, 2, 3], pm, cands, { barOnly: true }).some((x) => x.items.some((i) => i.name === "pineapple")));
  const onlyMint = suggestionGroups([1, 2, 3], pm, cands, { checked: new Set([3]) });
  assert.deepEqual(onlyMint.map((x) => x.with), [[1, 2, 3], [3]]);
});

test("within a group, stronger pairings come first, then A to Z", () => {
  const g = suggestionGroups([1], pm, cands);
  assert.deepEqual(g[0].items.map((i) => i.name), ["sugar", "pineapple", "soda"]);
});

test("search matches: starts-with first, then word start, then anywhere, capped", () => {
  const names = ["lime", "lime juice", "key lime", "sublime syrup", "mint", "LIME LEAF"];
  assert.deepEqual(matchNames(names, "lim"), ["lime", "LIME LEAF", "lime juice", "key lime", "sublime syrup"]);
  assert.deepEqual(matchNames(names, "  "), []);
  assert.deepEqual(matchNames(names, "zz"), []);
  assert.equal(matchNames(names, "i", 2).length, 2);
});
