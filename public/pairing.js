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

// One ranked list: suggestions that pair with the most mix ingredients first ("goes with 5 of 6"),
// then the stronger pairing, then A to Z. One pass over the candidates, so it stays fast for any mix size.
// candidates: iterable of [id, { name, is_bar }]. checked: ids every suggestion must pair with.
// Each item: { id, name, strength (the weakest link), with: [mix ids it pairs with, in mix order] }.
function rankSuggestions(list, pm, candidates, { barOnly = false, checked = new Set() } = {}) {
  const out = [];
  for (const [cand, row] of candidates) {
    if (list.includes(cand) || (barOnly && !row.is_bar)) continue;
    const w = list.filter((id) => pm.get(id).has(cand));
    if (!w.length || ![...checked].every((c) => w.includes(c))) continue;
    out.push({ id: cand, name: row.name, with: w, strength: Math.min(...w.map((id) => pm.get(id).get(cand).strength)) });
  }
  return out.sort((a, b) => b.with.length - a.with.length || b.strength - a.strength || a.name.localeCompare(b.name));
}

// Several ingredients' pairings as one (duplicates like cola / coca-cola): partner ids go through
// canon, and the stronger pairing wins.
function mergePairs(maps, canon = (id) => id) {
  const out = new Map();
  for (const m of maps) for (const [id, p] of m) {
    const c = canon(id), cur = out.get(c);
    if (!cur || p.strength > cur.strength) out.set(c, p);
  }
  return out;
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

// Typo help ("bourbin" -> bourbon): names within a small edit distance of the text, closest first.
// Compares against the whole name and each of its words, so "angostra" finds "angostura bitters".
// Allows 1 edit for short text, 2 from 6 letters; a swap of two neighbors counts as 1.
function closeNames(names, typed, n = 3, fold = (t) => t) {
  const q = fold(typed.trim().toLowerCase());
  if (q.length < 3) return [];
  const max = q.length < 6 ? 1 : 2;
  const dist = (a, b) => {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  };
  return names.map((name) => {
    const l = fold(name.toLowerCase());
    return [Math.min(dist(q, l), ...l.split(/[\s,/]+/).filter(Boolean).map((w) => dist(q, w))), name];
  }).filter(([d]) => d <= max).sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]))
    .slice(0, n).map(([, name]) => name);
}

if (typeof module !== "undefined") module.exports = { together, rankSuggestions, mergePairs, matchNames, closeNames };
