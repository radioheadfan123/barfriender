# barfriender

A bartending pairing site I built for a close friend who bartends. Pick the ingredients you have and it shows what pairs well with all of them.

Live at **https://barfriender.app**

## What it does
- Pick ingredients and see what pairs with them, ranked by how many they go with ("Goes with all 3", "Goes with 2 of 3").
- Tap any ingredient to explore what goes with it.
- Make an account to save combos and drinks, with amounts and notes.
- Shared menus: invite friends by link as editors or viewers, and changes show up live.

## How it's built
- Plain HTML, CSS and JavaScript on the front end.
- A small Node server on Railway that serves the pages and sends feedback emails.
- Supabase (Postgres) for data and logins, with row-level security so each user can only touch their own rows.
- About 1,000 ingredients and 17,000 pairings, extracted and cleaned up with Python scripts.
