"""Turn data/source.json into supabase/seed.sql (book rows: created_by null).

Usage: py scripts/load.py

Only "X pairs well with Y" is kept: ingredient names and undirected pairs.
Every pairing partner becomes an ingredient row, so multi-select works on ids.
Names are matched by a normalized key: 'limes' / 'lime' / 'MINT — IN GENERAL' / 'mint'.
Seed file is gitignored: it is the book's data.
"""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BATCH = 1000


def singular(word):
    if word == "leaves":
        return "leaf"
    if len(word) > 3 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith(("oes", "ches", "shes", "xes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


CATEGORIES = {"nut", "spice", "herb", "fruit", "berry", "vegetable", "green"}   # 'nuts, hazelnuts' = hazelnuts


def norm(n):
    return " ".join(singular(w) for w in re.findall(r"[\w'&-]+|[,/]", n)).replace(" ,", ",")


def keys(name):
    """All keys a name answers to. First one is canonical.
    'cream, sour' -> 'sour cream' (+ 'cream sour'); 'lamb, chops' also -> 'lamb chop'."""
    n = name.lower().replace("’", "'")
    n = re.sub(r"\s*—\s*in general$", "", n).replace(" — ", ", ")
    if n.count(",") == 1:
        head, tail = (s.strip() for s in n.split(","))
        if norm(head) in CATEGORIES:
            return [norm(tail)]
        return [norm(f"{tail} {head}"), norm(f"{head} {tail}")]
    return [norm(n)]


def key(name):
    return keys(name)[0]


# --- cleanup: typos, parse scraps, and things that aren't ingredients --------------------

FIX = {"watercrêss": "watercress", "parlsey, flat-leaf": "parsley, flat-leaf", "pomegrantes": "pomegranates",
       "vinegar, chamapagne": "vinegar, champagne", "tapanade": "tapenade", "gingko nuts": "ginkgo nuts",
       "faro": "farro", "m0starda": "mostarda", "grand": "grand marnier", "marnier": "grand marnier",
       "parmigiano-": "cheese, parmesan", "parmigiano-reggiano": "cheese, parmesan",
       "parmesan": "cheese, parmesan", "gruyère": "cheese, gruyère", "cheddar": "cheese, cheddar",
       "gorgonzola": "cheese, gorgonzola", "pecorino": "cheese, pecorino", "salata": "ricotta salata",
       "rocket": "arugula", "balsamic": "vinegar, balsamic", "kosher": "salt, kosher",
       "kosher, sea": "salt, sea", "orange-flower water": "orange blossom water",
       "noodles/pasta": "pasta", "chiles": "chile peppers", "pasta/noodles, egg": "pasta", "beer / ale": "beer", "beer or ale": "beer"}
NOT_INGREDIENTS = {
    # tasting / technique / occasion entries and scraps of quotes
    "balance", "aroma", "menu", "bitterness", "saltiness", "sourness", "sweetness", "coldness", "umami",
    "astringency", "heat", "piquancy", "spiciness", "seasonality", "richness", "texture", "textures",
    "temperatures", "techniques", "ingredients", "appetizers", "brined dishes", "thanksgiving", "picnics",
    "before", "fleur de", "sel", "paste", "red, white", "seeds", "wild", "custardy", "drink", "baking",
    "de-venise", "turka", "mexican", "cures", "emulsions", "finishing dishes", "love it or hate it",
    "character, refreshing", "spring", "summer", "autumn", "winter", "fall", "dressings", "spirits",
    "fresh fruit", "fruits, most", "herbs, other", "herbs, most other", "liqueurs, other nut",
    "hot beverages", "cocktails", "toasts", "beverages", "desserts", "alcohol",
}
NOT_INGREDIENT_RE = re.compile(
    r"cuisines?\b|cusine|\bdishes\b|\bfoods\b|cooking|technique|\bmeals?\b|holiday"
    r"|\bchef\b|wild sweets|babbo|union square|wildwood|jardinière|vij’s|duby|dhalwala|-$|\([^)]*$"
    r"|\bwith\b| is | as in |\bmost\b|\bother\b|^and ")
GROUPS = CATEGORIES | {"shellfish", "seafood", "poultry", "cured meat", "spirit", "liqueur", "orange liqueur",
                       "botanical relative", "game bird", "innard", "fish", "wine", "meat", "cheese",
                       "cheese and cheese dish", "brandy", "brandie", "baked good", "seaweed", "lettuce", "sauce"}
VERBS = {"fry", "grill", "mash", "puree", "roast", "steam", "stuff", "braise", "sauté", "boil", "bake",
         "blanch", "stew", "poach", "simmer", "sear", "broil", "smoke", "stir-fry", "raw", "cure"}


def junk(name):
    words = re.findall(r"[\w’'-]+", name)
    return (name in NOT_INGREDIENTS or bool(NOT_INGREDIENT_RE.search(name)) or len(words) >= 6
            or (words and all(w in VERBS for w in words)))


def resolve(name, known):
    r = _resolve(name, known)
    return FIX.get(r, r) if r else r                 # 'chiles, red' -> 'chiles' -> 'chile peppers'


def _resolve(name, known):
    """Collapse variants onto a known ingredient.
    'ginger, minced' -> ginger; 'shellfish, clams' -> clams; 'cheese, goat' -> goat cheese;
    'pineapple and pineapple juice' -> pineapple; 'spirits, white, gin' -> gin."""
    name = FIX.get(name, name)
    m = re.match(r"^(.+) (?:juice|zest|peel)$", name)
    if m and key(m.group(1)) in known:               # 'orange juice' -> oranges, like 'lime, juice' -> lime
        return m.group(1)
    for sep in (" and ", " or ", " / ", "/"):
        first = name.split(sep)[0].strip()
        if sep in name and key(first) in known:
            return first
    parts = [p.strip() for p in name.split(",") if p.strip()]
    if len(parts) == 2:
        head, mod = parts
        group = norm(head) in GROUPS                 # only 'shellfish, clams' style -> clams, not 'garlic, green'
        for cand in (f"{head}, {mod}", mod if group else None, head):   # 'goat cheese' / 'clams' / 'ginger'
            if cand and key(cand) in known:
                return cand
    elif len(parts) > 2:
        for cand in (parts[-1], parts[0]):
            if key(cand) in known:
                return cand
        return None                                  # unmatched list like 'mozzarella, parmesan, swiss' = scrap
    return name


def build(entries):
    ids, rows = {}, []                    # key -> id, ingredient rows

    entries = [e for e in entries if not junk(e["name"].split(" and ")[0])]   # 'eggs and egg-based dishes' stays
    # known = book entries + plain names the book lists more than once
    plain = Counter(p["name"] for e in entries for p in e["pairings"]
                    if not re.search(r",| and | or |/", p["name"]))
    known = {k for e in entries for a in [e["name"], *e["aliases"], *e["name"].split(" and "),
                                         *re.split(r"\s*/\s*", re.sub(r"\s*—\s*in general$", "", e["name"]))]
             for k in keys(FIX.get(a, a))}
    known |= {key(n) for n, c in plain.items() if c > 1}

    def ingredient(name, entry=False):
        if not entry:
            name = resolve(name, known)
            if name is None or junk(name):
                return None
        ks = keys(name)
        i = next((ids[k] for k in ks if k in ids), None)
        if i is None:
            i = len(rows) + 1
            display = name
            if not entry and name.count(",") == 1 and norm(name.split(",")[0].strip()) not in CATEGORIES:
                head, mod = (s.strip() for s in name.split(","))
                display = f"{mod} {head}"                             # 'cream, sour' shows as 'sour cream'
            rows.append({"id": i, "name": display, "key": ks[0], "entry": False, "meta": {}})
        for k in ks:
            ids.setdefault(k, i)
        row = rows[i - 1]
        if entry and not row["entry"]:
            row["entry"] = True
            row["name"] = re.sub(r"\s*/\s*", " / ", re.sub(r"\s*—\s*in general$", "", name))
        return i

    # entries first so they own their keys and display names
    for e in entries:
        i = ingredient(e["name"], entry=True)
        for m, v in e["meta"].items():                                # taste / season / weight / volume
            rows[i - 1]["meta"].setdefault(m, v)
        base =re.sub(r"\s*—\s*in general$", "", e["name"])
        # 'melon/ muskmelons', 'chocolate / cocoa', and 'coconut' for 'coconut and coconut milk'
        for a in e["aliases"] + re.split(r"\s*/\s*", base) + base.split(" and "):
            for k in keys(a):
                ids.setdefault(k, i)                                  # alternate names match, not stored

    pairs = {}                            # (a, b) -> {strength, note}; strength = the stronger direction
    for e in entries:
        a = ids[key(e["name"])]
        for p in e["pairings"]:
            b = ingredient(p["name"])
            if b and a != b:
                cur = pairs.setdefault((min(a, b), max(a, b)), {"strength": 1, "note": None})
                # Two levels only (her call 2026-10-03): any bold in the book = 2 "recommended", plain = 1.
                cur["strength"] = max(cur["strength"], min(p["strength"], 2))
                cur["note"] = cur["note"] or p.get("note")

    # classic combos: only names that already match an ingredient, at least 2 of them
    affs = set()
    for e in entries:
        for combo in e.get("affinities", []):
            got = []
            for n in combo:
                r = resolve(n, known)
                i = r and next((ids[k] for k in keys(r) if k in ids), None)
                if i and i not in got:
                    got.append(i)
            if len(got) >= 2:
                affs.add(tuple(sorted(got)))
    return rows, pairs, affs, ids


def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return str(v).lower()
    if isinstance(v, int):
        return str(v)
    if isinstance(v, list):
        return "array[" + ", ".join(q(x) for x in v) + "]::text[]"
    return "'" + str(v).replace("'", "''") + "'"


def staples():
    """Our own bar staples as book-shaped entries, so they load through the same path."""
    data = json.loads((ROOT / "scripts" / "staples.json").read_text(encoding="utf-8"))
    return [{"name": n, "aliases": [], "meta": {}, "affinities": [],
             "pairings": [{"name": p, "strength": s, "note": None} for p, s in partners.items()]}
            for n, partners in data.items() if not n.startswith("_")]


def bar_ids(ids):
    lines = (ROOT / "scripts" / "bar.txt").read_text(encoding="utf-8").splitlines()
    names = [l.strip() for l in lines if l.strip() and not l.startswith("#")]
    missing = [n for n in names if key(n) not in ids]
    assert not missing, f"bar.txt names with no ingredient: {missing}"
    return {ids[key(n)] for n in names}


def inserts(table, cols, values):
    out = []
    for s in range(0, len(values), BATCH):
        chunk = values[s:s + BATCH]
        out.append(f"insert into {table} ({', '.join(cols)}) values\n")
        out.append(",\n".join("(" + ", ".join(q(v) for v in row) + ")" for row in chunk) + ";\n")
    return out


# Reload keeps ingredient ids stable (matched by key), so users' saved combos survive a re-import.
RELOAD = """
insert into ingredients (name, key, taste, season, weight, volume, is_bar)
  select name, key, taste, season, weight, volume, is_bar from new_ing
  on conflict (key) do update set name = excluded.name, taste = excluded.taste, season = excluded.season,
    weight = excluded.weight, volume = excluded.volume, is_bar = excluded.is_bar;
delete from ingredients i                     -- gone from the book and not in anyone's saved combo
  where not exists (select 1 from new_ing n where n.key = i.key)
    and not exists (select 1 from combo_items c where c.ingredient_id = i.id);
delete from pairings;                         -- suggestions are all ours: replace them wholesale
insert into pairings (a_id, b_id, strength, note)
  select distinct on (least(a.id, b.id), greatest(a.id, b.id)) least(a.id, b.id), greatest(a.id, b.id), p.strength, p.note
  from new_pairs p join ingredients a on a.key = p.a_key join ingredients b on b.key = p.b_key
  order by least(a.id, b.id), greatest(a.id, b.id), p.strength desc;
delete from affinities;
insert into affinities (ingredient_ids)
  select array(select i.id from unnest(n.keys) k join ingredients i on i.key = k order by i.id) from new_aff n;
"""


def main():
    entries = json.loads((ROOT / "data" / "source.json").read_text(encoding="utf-8")) + staples()
    rows, pairs, affs, ids = build(entries)
    bar = bar_ids(ids)

    used = {x for ab in pairs for x in ab}             # entries with no pairings aren't stored
    m = lambda r, f: r["meta"].get(f)
    ing = [[r["name"], r["key"], m(r, "taste"), m(r, "season"), m(r, "weight"), m(r, "volume"), r["id"] in bar]
           for r in rows if r["id"] in used]
    k = {r["id"]: r["key"] for r in rows}
    pr = [[k[a], k[b], p["strength"], p["note"]] for (a, b), p in sorted(pairs.items())]
    af = [[[k[i] for i in a]] for a in sorted(affs) if all(i in used for i in a)]

    sql = ["-- generated by scripts/load.py. Do not commit.\nbegin;\n",
           "create temp table new_ing (name text, key text, taste text, season text, weight text, volume text,"
           " is_bar boolean) on commit drop;\n",
           "create temp table new_pairs (a_key text, b_key text, strength smallint, note text) on commit drop;\n",
           "create temp table new_aff (keys text[]) on commit drop;\n"]
    sql += inserts("new_ing", ["name", "key", "taste", "season", "weight", "volume", "is_bar"], ing)
    sql += inserts("new_pairs", ["a_key", "b_key", "strength", "note"], pr)
    sql += inserts("new_aff", ["keys"], af)
    sql.append(RELOAD)
    sql.append("commit;\n")
    out = ROOT / "supabase" / "seed.sql"
    out.write_text("".join(sql), encoding="utf-8")
    print(f"{len(ing)} ingredients ({sum(r[-1] for r in ing)} bar), {len(pr)} pairings, {len(af)} combos"
          f" -> {out} ({out.stat().st_size // 1024} KB)")
    return rows, pairs, af, ing


if __name__ == "__main__":
    rows, pairs, af, ing = main()
    # self-check: plural/singular and 'in general' entries link up with their partners
    assert key("limes") == key("lime") and key("MINT — IN GENERAL".lower()) == key("mint")
    assert key("cherries") == key("cherry") and key("tomatoes") == key("tomato")
    assert key("cream, sour") == key("sour cream") and key("pepper, black") == key("black pepper")
    by_name = {r["key"]: r["id"] for r in rows}
    assert all(a < b for a, b in pairs)
    lime, mint = by_name[key("lime")], by_name[key("mint")]
    assert pairs[(min(lime, mint), max(lime, mint))]["strength"] >= 2, "lime + mint should pair strongly"
    assert sum(r[-1] for r in ing) > 50 and len(af) >= 100
    for s in staples():
        sid = by_name[key(s["name"])]
        for p in s["pairings"]:
            pid = by_name[key(p["name"])]
            assert (min(sid, pid), max(sid, pid)) in pairs, f"staple pair missing: {s['name']} + {p['name']}"
    print("checks ok; most-linked:", Counter(x for ab in pairs for x in ab).most_common(3))
