-- Hardening for real traffic: size limits, per-user caps, no public combos (not a feature yet),
-- a bounded pairing search, writes only where the site needs them, and faster RLS checks.

-- Saved combos are private and always belong to someone.
alter table combos alter column user_id set not null;
alter table combos add constraint combos_private check (not is_public);   -- lift when sharing ships

-- Size limits (the site's inputs use the same numbers).
alter table combos add constraint combos_name_len  check (char_length(name) between 1 and 120);
alter table combos add constraint combos_notes_len check (notes is null or char_length(notes) <= 2000);
alter table combo_items add constraint combo_items_amount_len check (amount is null or char_length(amount) <= 40);
alter table combo_items add constraint combo_items_position check (position between 0 and 49);

-- Per-user caps so one account can't fill the database.
create function combos_cap() returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from combos where user_id = new.user_id) >= 500 then
    raise exception 'You can save up to 500 combos.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger combos_cap before insert on combos for each row execute function combos_cap();

create function combo_items_cap() returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from combo_items where combo_id = new.combo_id) >= 30 then
    raise exception 'A combo can have up to 30 ingredients.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger combo_items_cap before insert on combo_items for each row execute function combo_items_cap();

-- RLS with auth.uid() evaluated once per query instead of once per row, plus the index it needs.
create index if not exists combos_user_idx on combos (user_id);

drop policy "read combos" on combos;
drop policy "own combos"  on combos;
create policy "own combos" on combos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy "read combo items" on combo_items;
drop policy "own combo items"  on combo_items;
create policy "own combo items" on combo_items for all to authenticated
  using (exists (select 1 from combos c where c.id = combo_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from combos c where c.id = combo_id and c.user_id = (select auth.uid())));

-- Table privileges match what the site does. RLS stays on as the second lock.
revoke insert, update, delete, truncate on ingredients, pairings, affinities from anon, authenticated;
revoke insert, update, delete, truncate on combos, combo_items from anon;
revoke select on combos, combo_items from anon;

-- Pairing search: at most 12 picks (the UI never sends more), so no one can request a giant query.
create or replace function mutual_pairings(ids bigint[], bar_only boolean default false)
returns table (id bigint, name text, strength smallint)
language sql stable security invoker set search_path = public as $$
  select i.id, i.name, min(p.strength)::smallint
  from pairings p
  join ingredients i on i.id = case when p.a_id = any(ids) then p.b_id else p.a_id end
  where cardinality(ids) between 1 and 12
    and (p.a_id = any(ids) or p.b_id = any(ids)) and i.id <> all(ids) and (not bar_only or i.is_bar)
  group by i.id, i.name
  having count(distinct case when p.a_id = any(ids) then p.a_id else p.b_id end) = cardinality(ids)
  order by 3 desc, i.name;
$$;

alter function ingredient_pairings(bigint) set search_path = public;
