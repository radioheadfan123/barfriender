-- Suggestions ("X pairs well with Z") come only from us. Users don't add pairings or ingredients;
-- they save their own combos (combos / combo_items, unchanged).

drop policy "own pairings" on pairings;
drop policy "read pairings" on pairings;
alter table pairings drop column created_by;       -- also drops the old (a_id, b_id, created_by) unique
alter table pairings add unique (a_id, b_id);
create policy "read pairings" on pairings for select using (true);

drop policy "own ingredients" on ingredients;
alter table ingredients drop column created_by;
