// Pure pairing logic shared by the Mix page and the tests (no DOM, no network).
// pm: Map(mix ingredient id -> Map(partner id -> { strength, note })).

// Largest groups in the mix where every member pairs with every other: the maximal cliques
// (Bron-Kerbosch with a pivot, fast even for a full 30-ingredient mix). Members keep mix order.
function together(list, pm) {
  const ok = (a, b) => pm.get(a).has(b) || pm.get(b).has(a);
  const nb = new Map(list.map((a) => [a, new Set(list.filter((b) => b !== a && ok(a, b)))]));
  const out = [];
  (function bk(r, p, x) {
    if (!p.length && !x.length) { if (r.length > 1) out.push(list.filter((id) => r.includes(id))); return; }
    const pivot = [...p, ...x].reduce((best, u) => (nb.get(u).size > nb.get(best).size ? u : best));
    for (const v of p.filter((v) => !nb.get(pivot).has(v))) {
      bk([...r, v], p.filter((u) => nb.get(v).has(u)), x.filter((u) => nb.get(v).has(u)));
      p = p.filter((u) => u !== v); x = [...x, v];
    }
  })([], [...list], []);
  return out.sort((a, b) => b.length - a.length || list.indexOf(a[0]) - list.indexOf(b[0]));
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
// norm (optional) also compares singular forms, so "strawberry" finds "strawberries".
// first (optional) puts preferred names ahead within the same match quality (bar items before food).
function matchNames(names, typed, n = 8, norm = (t) => t, first = () => false) {
  const q = typed.trim().toLowerCase(), nq = norm(q);
  if (!q) return [];
  const at = (l, t) => (l.startsWith(t) ? 0 : (" " + l).includes(" " + t) ? 1 : l.includes(t) ? 2 : 3);
  const rank = (name) => { const l = name.toLowerCase(); return Math.min(at(l, q), nq ? at(norm(l), nq) : 3); };
  return names.map((name) => [rank(name), name]).filter(([r]) => r < 3)
    .sort((a, b) => a[0] - b[0] || first(b[1]) - first(a[1]) || a[1].length - b[1].length || a[1].localeCompare(b[1])).slice(0, n).map(([, name]) => name);
}

if (typeof module !== "undefined") module.exports = { together, suggestionGroups, matchNames };
