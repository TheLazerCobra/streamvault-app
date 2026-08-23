-- Fixes infinite recursion (Postgres error 42P17) between the `lists` and
-- `list_collaborators` policies added in 0001_init.sql: a policy on each
-- table queried the other directly, so evaluating either table's RLS
-- triggered evaluating the other's, forever.
--
-- `security definer` helper functions break the cycle: they run with the
-- privileges of their owner (which owns these tables and so bypasses RLS
-- on them), so calling one from a policy doesn't re-trigger RLS on the
-- table it checks.

create function public.is_list_owner(p_list_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.lists where id = p_list_id and owner_id = auth.uid()
  );
$$;

create function public.is_list_public(p_list_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.lists where id = p_list_id and is_public = true
  );
$$;

create function public.is_list_collaborator(p_list_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.list_collaborators
    where list_id = p_list_id and user_id = auth.uid()
  );
$$;

create function public.is_list_editor(p_list_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.list_collaborators
    where list_id = p_list_id and user_id = auth.uid() and role = 'editor'
  );
$$;

-- lists: swap the direct list_collaborators query for the helper.
drop policy "collaborators can read lists they're added to" on public.lists;
create policy "collaborators can read lists they're added to"
  on public.lists for select
  using (public.is_list_collaborator(id));

-- list_items: same idea, plus this was routing through `lists`' policy
-- (which now no longer recurses) so it's covered too.
drop policy "readable if the parent list is readable" on public.list_items;
create policy "readable if the parent list is readable"
  on public.list_items for select
  using (
    public.is_list_owner(list_id)
    or public.is_list_public(list_id)
    or public.is_list_collaborator(list_id)
  );

drop policy "owner or editor collaborator can add/remove items" on public.list_items;
create policy "owner or editor collaborator can add/remove items"
  on public.list_items for all
  using (public.is_list_owner(list_id) or public.is_list_editor(list_id))
  with check (added_by = auth.uid());

-- list_collaborators: swap the direct lists query for the helper.
drop policy "list owner manages collaborators" on public.list_collaborators;
create policy "list owner manages collaborators"
  on public.list_collaborators for all
  using (public.is_list_owner(list_id))
  with check (public.is_list_owner(list_id));

drop policy "collaborators can see who else is on the list" on public.list_collaborators;
create policy "collaborators can see who else is on the list"
  on public.list_collaborators for select
  using (user_id = auth.uid() or public.is_list_owner(list_id));
