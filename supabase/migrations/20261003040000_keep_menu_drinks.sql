-- Deleting an account keeps what that person added to shared menus (her call 2026-10-03).
--  * Drinks in menus stay; their creator just becomes null.
--  * Private saves are still deleted (no one else can see them).
--  * Menus they owned pass to the longest-standing editor, else viewer; a menu with no one else goes.

alter table combos alter column user_id drop not null;
alter table combos drop constraint combos_user_id_fkey;
alter table combos add constraint combos_user_id_fkey foreign key (user_id) references auth.users on delete set null;
alter table combos add constraint combos_owned check (user_id is not null or menu_id is not null);

create function public.on_user_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record; heir uuid;
begin
  delete from combos where user_id = old.id and menu_id is null;        -- private saves go with the account
  for m in select id from menus where owner_id = old.id loop
    select user_id into heir from menu_members
      where menu_id = m.id and user_id <> old.id
      order by (role = 'editor') desc, joined_at limit 1;
    if heir is not null then
      update menus set owner_id = heir where id = m.id;
      update menu_members set role = 'owner' where menu_id = m.id and user_id = heir;
    end if;                                                              -- else the menu cascades away
  end loop;
  return old;
end $$;
revoke execute on function public.on_user_deleted() from public, anon, authenticated;

create trigger on_user_deleted before delete on auth.users
  for each row execute function public.on_user_deleted();
