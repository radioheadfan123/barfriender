-- Keep only "X pairs well with Y": no strengths, notes, book metadata or starter combos.

delete from combos where user_id is null;        -- book Flavor Affinities (combo_items cascade)

drop function mutual_pairings(bigint[]);

alter table pairings drop column strength, drop column note;
alter table ingredients
  drop column aliases, drop column season, drop column taste, drop column weight,
  drop column volume, drop column is_entry, drop column is_bar;

-- ingredients that were only in starter combos
delete from ingredients i
where i.created_by is null
  and not exists (select 1 from pairings p where i.id in (p.a_id, p.b_id));

-- What pairs with ALL of the selected ingredients (book pairings plus the caller's own).
create function mutual_pairings(ids bigint[])
returns table (id bigint, name text)
language sql stable security invoker as $$
  select i.id, i.name
  from pairings p
  join ingredients i on i.id = case when p.a_id = any(ids) then p.b_id else p.a_id end
  where (p.a_id = any(ids) or p.b_id = any(ids)) and i.id <> all(ids)
  group by i.id, i.name
  having count(distinct case when p.a_id = any(ids) then p.a_id else p.b_id end) = cardinality(ids)
  order by i.name;
$$;
