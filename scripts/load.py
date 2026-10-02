"""Turn data/flavor_bible.json into supabase/seed.sql (book rows: created_by null).

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
            rows.append({"id": i, "name": display, "key": ks[0], "entry": False})
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
        base = re.sub(r"\s*—\s*in general$", "", e["name"])
        # 'melon/ muskmelons', 'chocolate / cocoa', and 'coconut' for 'coconut and coconut milk'
        for a in e["aliases"] + re.split(r"\s*/\s*", base) + base.split(" and "):
            for k in keys(a):
                ids.setdefault(k, i)                                  # alternate names match, not stored

    pairs = set()
    for e in entries:
        a = ids[key(e["name"])]
        for p in e["pairings"]:
            b = ingredient(p["name"])
            if b and a != b:
                pairs.add((min(a, b), max(a, b)))
    return rows, pairs


def q(v):
    return str(v) if isinstance(v, int) else "'" + str(v).replace("'", "''") + "'"


def inserts(table, cols, values):
    out = []
    for s in range(0, len(values), BATCH):
        chunk = values[s:s + BATCH]
        out.append(f"insert into {table} ({', '.join(cols)}) overriding system value values\n"
                   if "id" in cols else f"insert into {table} ({', '.join(cols)}) values\n")
        out.append(",\n".join("(" + ", ".join(q(v) for v in row) + ")" for row in chunk) + ";\n")
    return out


def main():
    entries = json.loads((ROOT / "data" / "flavor_bible.json").read_text(encoding="utf-8"))
    rows, pairs = build(entries)

    used = {x for ab in pairs for x in ab}             # entries with no pairings aren't stored
    ing = [[r["id"], r["name"], r["key"]] for r in rows if r["id"] in used]
    pr = sorted(pairs)

    # ponytail: reload wipes book rows; once users have pairings on book ingredients, reload by key instead
    sql = ["-- generated by scripts/load.py from The Flavor Bible. Do not commit.\nbegin;\n",
           "delete from pairings where created_by is null;\n",
           "delete from ingredients where created_by is null;\n"]
    sql += inserts("ingredients", ["id", "name", "key"], ing)
    sql += inserts("pairings", ["a_id", "b_id"], pr)
    sql.append("select setval(pg_get_serial_sequence('ingredients', 'id'), (select max(id) from ingredients));\n")
    sql.append("commit;\n")
    out = ROOT / "supabase" / "seed.sql"
    out.write_text("".join(sql), encoding="utf-8")
    print(f"{len(ing)} ingredients, {len(pr)} pairings -> {out} ({out.stat().st_size // 1024} KB)")
    return rows, pairs


if __name__ == "__main__":
    rows, pairs = main()
    # self-check: plural/singular and 'in general' entries link up with their partners
    assert key("limes") == key("lime") and key("MINT — IN GENERAL".lower()) == key("mint")
    assert key("cherries") == key("cherry") and key("tomatoes") == key("tomato")
    assert key("cream, sour") == key("sour cream") and key("pepper, black") == key("black pepper")
    by_name = {r["key"]: r["id"] for r in rows}
    assert all(a < b for a, b in pairs)
    lime, mint = by_name[key("lime")], by_name[key("mint")]
    assert (min(lime, mint), max(lime, mint)) in pairs, "lime + mint should pair"
    print("checks ok; most-linked:", Counter(x for ab in pairs for x in ab).most_common(3))
