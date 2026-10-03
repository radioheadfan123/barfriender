-- The owner's member row is added by an AFTER trigger, so on insert ... returning the new menu wasn't
-- visible to its own creator yet. Owners can always read their menus.
drop policy "members read menus" on menus;
create policy "members read menus" on menus for select to authenticated
  using (owner_id = (select auth.uid()) or menu_role(id) is not null);
