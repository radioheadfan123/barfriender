"""Run supabase/seed.sql against the database in .env (DATABASE_URL). Replaces all book rows.

Usage: py scripts/push_seed.py      (needs: py -m pip install "psycopg[binary]")
`supabase db push --include-seed` only seeds once, so reloads go through here.
"""
import re
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
url = re.search(r"^DATABASE_URL=(.+)$", (ROOT / ".env").read_text(), re.M).group(1).strip()
with psycopg.connect(url, autocommit=True) as c:
    c.execute((ROOT / "supabase" / "seed.sql").read_text(encoding="utf-8"))
    n_ing, n_pairs = c.execute("select (select count(*) from ingredients), (select count(*) from pairings)").fetchone()
    print(f"live: {n_ing} ingredients, {n_pairs} pairings")
