# barfriender

Pick an ingredient, see what pairs well with it. Pick several, see what pairs with all of them.
Signed-in users save their own combinations and recipes and add their own pairings.

Stack: Supabase (Postgres, auth, RLS) + Railway (API, later).

## Data

Seed pairings come from *The Flavor Bible* (Page and Dornenburg). Only "X pairs well with Y"
is stored: ingredient names and pairs. The loader merges variants (lime juice -> lime,
shellfish, clams -> clams) and drops non-ingredients (cuisines, techniques, tasting terms, quote scraps). The book's text is not stored, and the
extracted data and generated seed are gitignored.

```
py scripts/extract.py <path-to-The-Flavor-Bible.pdf>   # -> data/flavor_bible.json
py scripts/load.py                                      # -> supabase/seed.sql (+ self-checks)
py scripts/push_seed.py                                 # reload book rows into the DB in .env
```

## Schema

`supabase/migrations/` holds the schema: `ingredients`, undirected `pairings` (a_id < b_id),
`combos` + `combo_items` (user-saved combos and recipes). Suggestions (ingredients + pairings) are ours only; `push_seed.py` reloads them by key so ids and saved combos survive. `created_by` / `user_id`
null means book data. RLS: everyone reads ingredients, pairings and public combos; only we write suggestions; users write only their own combos.

`select * from mutual_pairings(array[<id>, <id>])` returns what pairs with all of them.
