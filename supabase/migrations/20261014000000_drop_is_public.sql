-- Saves are never public: sharing happens through menus, so the unused flag and its guard go.
alter table public.combos drop constraint if exists combos_private;
alter table public.combos drop column if exists is_public;
