"""Add or update just our staples (scripts/staples.json + their bar.txt tag) in the database in .env.

Usage: py scripts/push_staples.py            (prints the SQL, touches nothing)
       py scripts/push_staples.py --apply    (runs it; needs: py -m pip install "psycopg[binary]")

For when the full reload (load.py + push_seed.py) isn't possible, e.g. the book data isn't on this PC.
Same result for the staples: new rows keyed like load.py, existing rows keep their name and id, pairings
upserted with the stronger strength. One transaction; any partner name the database doesn't know aborts it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load import ROOT, key, q, staples  # noqa: E402

bar = {key(l.strip()) for l in (ROOT / "scripts" / "bar.txt").read_text(encoding="utf-8").splitlines()
       if l.strip() and not l.startswith("#")}
rows = staples()
ing = ",\n".join(f"({q(s['name'])}, {q(key(s['name']))}, {q(key(s['name']) in bar)})" for s in rows)
pairs = ",\n".join(f"({q(key(s['name']))}, {q(key(p['name']))}, {p['strength']})" for s in rows for p in s["pairings"])

SQL = f"""begin;
insert into ingredients (name, key, is_bar) values
{ing}
on conflict (key) do update set is_bar = ingredients.is_bar or excluded.is_bar;
create temp table new_pairs (a_key text, b_key text, strength smallint) on commit drop;
insert into new_pairs values
{pairs};
do $$ declare missing text; begin
  select string_agg(distinct k, ', ') into missing from (select a_key k from new_pairs union select b_key from new_pairs) x
    where not exists (select 1 from ingredients i where i.key = x.k);
  if missing is not null then raise exception 'unknown ingredient keys: %', missing; end if;
end $$;
insert into pairings (a_id, b_id, strength)
  select distinct on (least(a.id, b.id), greatest(a.id, b.id)) least(a.id, b.id), greatest(a.id, b.id), p.strength
  from new_pairs p join ingredients a on a.key = p.a_key join ingredients b on b.key = p.b_key
  where a.id <> b.id
  order by least(a.id, b.id), greatest(a.id, b.id), p.strength desc
  on conflict (a_id, b_id) do update set strength = greatest(pairings.strength, excluded.strength);
commit;
"""

if "--apply" not in sys.argv:
    print(SQL)
    sys.exit(0)

import re  # noqa: E402

import psycopg  # noqa: E402

url = re.search(r"^DATABASE_URL=(.+)$", (ROOT / ".env").read_text(), re.M).group(1).strip()
with psycopg.connect(url, autocommit=True) as c:
    c.execute(SQL)
    n = c.execute("select count(*) from ingredients where key = any(%s)", ([key(s["name"]) for s in rows],)).fetchone()[0]
    print(f"live: {n} of {len(rows)} staples present")
