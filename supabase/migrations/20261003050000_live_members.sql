-- Joins, role changes and removals show live: they bump the menu, and menus are published to Realtime
-- (menu_members itself isn't, because Realtime can't hide DELETE events from non-members).
alter table menus add column updated_at timestamptz not null default now();
create function menu_members_touch() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update menus set updated_at = now() where id = coalesce(new.menu_id, old.menu_id);
  return null;
end $$;
create trigger menu_members_touch after insert or update or delete on menu_members
  for each row execute function menu_members_touch();
