// Pure pairing logic shared by the Mix page and the tests (no DOM, no network).
// pm: Map(mix ingredient id -> Map(partner id -> { strength, note })).

// Largest groups in the mix where every member pairs with every other (mixes are small, so brute force).
// ponytail: 2^n subsets, fine to ~15 ingredients; Bron-Kerbosch if mixes ever get bigger.
function together(list, pm) {
  const ok = (a, b) => pm.get(a).has(b) || pm.get(b).has(a);
  const out = [];
  for (let mask = (1 << list.length) - 1; mask > 0; mask--) {
    const set = list.filter((_, i) => mask & (1 << i));
    if (set.length < 2 || !set.every((a, i) => set.slice(i + 1).every((b) => ok(a, b)))) continue;
    if (!out.some((c) => set.every((x) => c.includes(x)))) out.push(set);
  }
  return out.sort((a, b) => b.length - a.length);
}

// Suggestions grouped by EXACTLY which mix ingredients they pair with, biggest groups first.
// candidates: iterable of [id, { name, is_bar }]. checked: ids every suggestion must pair with.
function suggestionGroups(list, pm, candidates, { barOnly = false, checked = new Set() } = {}) {
  const groups = new Map();                                     // "id,id" -> { with, items }
  for (const [cand, row] of candidates) {
    if (list.includes(cand) || (barOnly && !row.is_bar)) continue;
    const w = list.filter((id) => pm.get(id).has(cand));
    if (!w.length || ![...checked].every((c) => w.includes(c))) continue;
    const k = w.join(",");
    if (!groups.has(k)) groups.set(k, { with: w, items: [] });
    groups.get(k).items.push({ id: cand, name: row.name, strength: Math.min(...w.map((id) => pm.get(id).get(cand).strength)) });
  }
  const order = (g) => g.with.map((id) => list.indexOf(id)).join();
  const sorted = [...groups.values()].sort((a, b) => b.with.length - a.with.length || order(a).localeCompare(order(b)));
  for (const g of sorted) g.items.sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
  return sorted;
}

// Search-box matches: names starting with the text first, then a word starting with it, then anywhere.
function matchNames(names, typed, n = 8) {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  const rank = (name) => { const l = name.toLowerCase(); return l.startsWith(q) ? 0 : (" " + l).includes(" " + q) ? 1 : l.includes(q) ? 2 : 3; };
  return names.map((name) => [rank(name), name]).filter(([r]) => r < 3)
    .sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1])).slice(0, n).map(([, name]) => name);
}

if (typeof module !== "undefined") module.exports = { together, suggestionGroups, matchNames };
