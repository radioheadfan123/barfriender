-- "Delete my account" from the site. Deletes only the caller; on_user_deleted() then removes their private
-- saves, keeps what they added to shared menus, and hands their menus to the next member.
create function delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.'; end if;
  delete from auth.users where id = (select auth.uid());
end $$;
revoke execute on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
