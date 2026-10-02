# pourpair

Pick an ingredient, see what pairs well with it. Pick several, see what pairs with all of them.
Signed-in users save their own combinations and recipes and add their own pairings.

Stack: Supabase (Postgres, auth, RLS) + Railway (API, later).

## Data

Seed pairings come from *The Flavor Bible* (Page and Dornenburg). Only pairing facts are stored
(ingredient, partner, strength 1-4, short qualifier). The book's text is not stored, and the
extracted data and generated seed are gitignored.

```
py scripts/extract.py <path-to-The-Flavor-Bible.pdf>   # -> data/flavor_bible.json
py scripts/load.py                                      # -> supabase/seed.sql (+ self-checks)
```

Strength follows the book's typography: 4 = holy grail (*CAPS), 3 = BOLD CAPS, 2 = bold, 1 = listed.

## Schema

`supabase/migrations/` holds the schema: `ingredients`, undirected `pairings` (a_id < b_id),
`combos` + `combo_items` (book Flavor Affinities and user recipes). `created_by` / `user_id`
null means book data. RLS: public read of book rows and public combos, users write their own.

`select * from mutual_pairings(array[<id>, <id>])` returns what pairs with all of them, best first.
