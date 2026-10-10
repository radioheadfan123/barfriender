"""Extract ingredient entries + pairings from the source PDF into data/source.json.

Usage: py scripts/extract.py <path-to-pdf>

The PDF is a calibre ebook conversion. Every text run arrives on its own line; a run
starting with a tab (or ',' ':' '(') continues the previous one. Typography carries the data:
  size 23 bold UPPERCASE = entry heading
  *BOLD CAPS = 4, BOLD CAPS = 3, bold lowercase = 2, plain = 1 (pairing strength)
Book prose (chef quotes, Tips, Dishes) is dropped, only pairing facts are kept.
"""
import json
import re
import sys
from pathlib import Path

from PyPDF2 import PdfReader

CH3_FIRST, CH3_LAST = 69, 950  # 0-based pages: first entry (ACHIOTE SEEDS) .. last entry page
META = {"Season:": "season", "Taste:": "taste", "Weight:": "weight", "Volume:": "volume"}
SKIP_META = {"Tips:", "Techniques:", "Function:", "Botanical relatives:", "Weather:"}
PROSE_LEN = 50
QUOTE_SCAN = 80                # max runs to look ahead for a quote's '— NAME' attribution
NOTE_RE = re.compile(r"^(.*?),\s*((?:esp|e\.g|i\.e|incl|including|and/or|for)\b.*)$")


def runs(pdf):
    r = PdfReader(pdf)
    out = []
    for pn in range(CH3_FIRST, CH3_LAST + 1):
        def v(text, cm, tm, fd, fs, pn=pn):
            if not text.strip():
                return
            t = " ".join(text.split()).lstrip("• ").strip()
            if not t:
                return
            out.append({
                "page": pn, "size": fs, "text": t,
                "bold": bool(fd) and "Bold" in fd.get("/BaseFont", ""),
                "cont": text[0] == "\t" or t[0] in ",:(",
                "trail": text[-1] in " \t",          # sentence runs on into the next run = prose
            })
        r.pages[pn].extract_text(visitor_text=v)
    return out


def is_heading(run):
    letters = re.sub(r"[^A-Za-z]", "", run["text"].split("(")[0])
    return run["size"] == 23 and run["bold"] and len(letters) > 1 and letters.isupper()


def is_prose(run):
    t = run["text"]
    if re.match(r"^\*?[^:()]+:\s", t) and t.count(",") >= 2:
        return False                                 # 'berries: blueberries, gooseberries, ...' list
    return (len(t) >= PROSE_LEN or (run["trail"] and not t.endswith(","))
            or (t.endswith((".", "!", "?", "”", '"')) and " " in t))


def is_attribution(run):
    return run["text"].startswith("—")


def strength(run, text):
    if text.startswith("*"):
        return 4
    if run["bold"]:
        letters = re.sub(r"[^A-Za-z]", "", text.split("(")[0].split(",")[0])
        return 3 if letters and letters.isupper() else 2
    return 1


def clean_name(t):
    return " ".join(t.lstrip("*").strip().rstrip(",;:").split()).lower()


def split_note(t):
    """'sugar (esp. brown)' / 'sugar, esp. brown' -> ('sugar', 'esp. brown')"""
    m = NOTE_RE.match(t) or re.match(r"^(.*?)\s*\((.*)\)\s*$", t)
    return (m.group(1), m.group(2).strip()) if m and m.group(1).strip() else (t, None)


def add_pairing(cur, name, s):
    name, note = split_note(name)
    name = clean_name(re.sub(r"\s*\((?:e\.g\.|esp\.)?$", "", name))   # 'chile peppers (e.g.' cut by a wrap
    if not name[:1].isalnum() or name.endswith(".") or name.count(")") > name.count("("):
        return None                                  # ')', '[', 'chocolate.' scraps of quotes
    p = {"name": name, "strength": s, "note": note}
    cur["pairings"].append(p)
    return p


def expand(cur, base, values, s):
    """'vinegar: balsamic, rice' -> 'vinegar, balsamic', 'vinegar, rice'"""
    for part in re.split(r",\s*(?![^()]*\))", values):     # commas outside '(e.g., Kahlúa)'
        part = split_note(part.strip())[0]
        if clean_name(part):
            add_pairing(cur, f"{base}, {clean_name(part)}", s)


def parse(rs):
    entries, cur = [], None
    mode = "skip"          # skip | list | affinities
    last = None            # what a continuation attaches to: ("meta", key) | ("pair", p) | ("drop",)
    prev_heading = False
    i = 0
    while i < len(rs):
        run, t = rs[i], rs[i]["text"]
        i += 1

        if run["size"] == 23:
            if cur and prev_heading and t.startswith("("):
                continue                             # wrapped '(See also ...)' line
            if cur and prev_heading and cur["name"].endswith("—"):
                cur["name"] = clean_name(f"{cur['name']} {t}")   # 'BEEF —' + 'KOBE'
                continue
            if cur and prev_heading and is_heading(run) and "(" not in t + cur["raw"]:
                cur["aliases"].append(clean_name(t))   # stacked names: PORCINI / CEPES / KING BOLETE
                continue
            if not is_heading(run):
                # 'Dishes' can sit mid-list (page-break sidebar); the list resumes after it.
                # Other size-23 text is a chef sidebar: skip to the next heading.
                prev_heading = False
                if t == "Dishes" and mode in ("list", "dishes"):
                    mode = "dishes"
                elif t != "Dishes":
                    mode = "skip"
                continue
            while (t.count("(") > t.count(")") and i < len(rs) and rs[i]["size"] == 23
                   and not (is_heading(rs[i]) and ")" not in rs[i]["text"])):
                t += " " + rs[i]["text"]             # heading wrapped mid-parenthesis
                i += 1
            m = re.search(r"\(see (?!also)[^)]*\)\s*(\S.*)$", t, re.I)
            if m:
                t = m.group(1)                       # 'TANGERINES (see Oranges) TARRAGON' on one run
            elif re.search(r"\(see (?!also)", t, re.I):
                cur, mode, prev_heading = None, "skip", False   # pure cross-reference
                continue
            name, note = split_note(re.sub(r"\s*\(See[^)]*\)?", "", t).strip())
            cur = {"name": clean_name(name), "raw": t, "note": note, "page": run["page"] + 1,
                   "aliases": [], "meta": {}, "pairings": [], "affinities": []}
            entries.append(cur)
            mode, last, prev_heading = "list", None, True
            continue
        prev_heading = False
        if cur is None or (run["size"] != 20 and not is_attribution(run)):
            continue

        if t == "Flavor Affinities":
            mode, last = "affinities", None
            continue
        if t.rstrip(":") == "AVOID":
            mode = "skip"
            continue
        if mode == "skip":
            continue
        if mode == "dishes":
            if run["bold"] or run["cont"] or is_prose(run) or not t[0].islower():
                continue                             # dish titles and 'Chef, Restaurant' lines
            mode = "list"

        if run["bold"] and t in META:
            cur["meta"][META[t]] = ""
            last = ("meta", META[t])
            continue
        if run["bold"] and t in SKIP_META:
            last = ("drop",)
            continue
        if last and last[0] == "drop" and (run["cont"] or is_prose(run) or last[1:] == (",",)):
            last = ("drop", ",") if t.endswith(",") else ("drop",)
            continue                                 # Tips / Techniques text and its wrapped lines

        if run["cont"] and last and last[0] == "pair" and is_prose(run):
            cur["pairings"].remove(last[1])          # 'mint,' + '\tapplemint is mild, while...' = quote
            run = dict(run, cont=False)
        if run["cont"]:
            if last and last[0] == "meta":
                cur["meta"][last[1]] = (cur["meta"][last[1]] + " " + t).strip()
            elif last and last[0] == "pair" and not is_prose(run):
                p = last[1]
                if t.startswith(":"):                # 'OIL' + ': canola, peanut'
                    cur["pairings"].remove(p)
                    expand(cur, p["name"], t[1:], p["strength"])
                    last = ("drop",)
                else:
                    note = split_note("x" + t)[1] or t.lstrip(",( ").rstrip(")")
                    p["note"] = f"{p['note']}; {note}" if p["note"] else note
            continue

        if is_prose(run) or is_attribution(run):
            # chef quote: skip to its '— NAME' attribution if one comes soon, before the next heading
            j = i - 1
            while (j < len(rs) and j < i + QUOTE_SCAN and not is_attribution(rs[j])
                   and rs[j]["size"] != 23 and rs[j]["text"] != "Flavor Affinities"):
                j += 1
            if j < len(rs) and is_attribution(rs[j]):
                i = j + 1
                while i < len(rs) and rs[i]["cont"]:     # venue line
                    i += 1
            last = ("drop",)
            continue

        if mode == "affinities":
            if "+" in t:
                cur["affinities"].append([clean_name(x) for x in t.split("+") if clean_name(x)])
            continue

        s = strength(run, t)
        m = re.match(r"^\*?([^:()]+):\s*(.*)$", t)
        if m:                                        # 'vinegar: balsamic, rice, sherry'
            rest = m.group(2)
            while i < len(rs) and rs[i]["size"] == 20 and not is_prose(rs[i]) and (
                    rs[i]["cont"] or rest.rstrip().endswith(",")):   # values wrap onto the next run
                rest += " " + rs[i]["text"]
                i += 1
            expand(cur, clean_name(m.group(1)), rest, s)
            last = ("drop",)
            continue
        p = add_pairing(cur, t, s)
        last = ("pair", p) if p else ("drop",)
    return entries


if __name__ == "__main__":
    entries = [e for e in parse(runs(sys.argv[1])) if e["pairings"] or e["meta"]]  # empty = cross-ref
    for e in entries:
        del e["raw"]
        # bold keywords inside quotes ('mint' under MINT, notes that are half a sentence)
        e["pairings"] = [p for p in e["pairings"] if p["name"] != e["name"] and p["name"] not in e["name"]
                         and len((p["note"] or "").split()) <= 7]
    out = Path(__file__).resolve().parent.parent / "data" / "source.json"
    out.write_text(json.dumps(entries, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(entries)} entries, {sum(len(e['pairings']) for e in entries)} pairings -> {out}")
