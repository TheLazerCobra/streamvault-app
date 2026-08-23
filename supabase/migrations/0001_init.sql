-- StreamVault: accounts, lists, watch history, and the social layer.
-- Matches the schema in the architecture roadmap. Every table a user's data
-- lives in gets row-level security so the browser can talk to Postgres
-- directly (via the Supabase client) without a custom API server.

-- ── profiles ──────────────────────────────────────────────────────────────
-- One row per account, created automatically when someone signs up.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up. Username
-- defaults to the local part of their email, deduplicated if needed.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base_username text;
  final_username text;
  suffix int := 0;
begin
  base_username := coalesce(split_part(new.email, '@', 1), 'user');
  final_username := base_username;
  while exists (select 1 from public.profiles where username = final_username) loop
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, final_username, base_username);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── lists ─────────────────────────────────────────────────────────────────
create table public.lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  color       text not null default '#e8b84b',
  is_public   boolean not null default false,
  share_slug  text unique,
  created_at  timestamptz not null default now()
);

alter table public.lists enable row level security;

create policy "owner has full access to their lists"
  on public.lists for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "public lists are readable by anyone"
  on public.lists for select
  using (is_public = true);

create policy "collaborators can read lists they're added to"
  on public.lists for select
  using (
    exists (
      select 1 from public.list_collaborators c
      where c.list_id = lists.id and c.user_id = auth.uid()
    )
  );

-- ── list_items ────────────────────────────────────────────────────────────
create table public.list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.lists(id) on delete cascade,
  tmdb_id     integer not null,
  media_type  text not null check (media_type in ('movie', 'tv')),
  added_by    uuid not null references public.profiles(id),
  added_at    timestamptz not null default now(),
  unique (list_id, tmdb_id, media_type)
);

alter table public.list_items enable row level security;

create policy "readable if the parent list is readable"
  on public.list_items for select
  using (
    exists (
      select 1 from public.lists l
      where l.id = list_items.list_id
        and (
          l.owner_id = auth.uid()
          or l.is_public = true
          or exists (
            select 1 from public.list_collaborators c
            where c.list_id = l.id and c.user_id = auth.uid()
          )
        )
    )
  );

create policy "owner or editor collaborator can add/remove items"
  on public.list_items for all
  using (
    exists (
      select 1 from public.lists l
      where l.id = list_items.list_id
        and (
          l.owner_id = auth.uid()
          or exists (
            select 1 from public.list_collaborators c
            where c.list_id = l.id and c.user_id = auth.uid() and c.role = 'editor'
          )
        )
    )
  )
  with check (added_by = auth.uid());

-- ── list_collaborators ────────────────────────────────────────────────────
create table public.list_collaborators (
  list_id  uuid not null references public.lists(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  role     text not null check (role in ('viewer', 'editor')),
  added_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

alter table public.list_collaborators enable row level security;

create policy "list owner manages collaborators"
  on public.list_collaborators for all
  using (
    exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid())
  );

create policy "collaborators can see who else is on the list"
  on public.list_collaborators for select
  using (user_id = auth.uid() or exists (
    select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()
  ));

-- ── watched ───────────────────────────────────────────────────────────────
create table public.watched (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  tmdb_id     integer not null,
  media_type  text not null check (media_type in ('movie', 'tv')),
  rating      numeric(3,1) check (rating between 0 and 10),
  watched_at  timestamptz not null default now(),
  unique (user_id, tmdb_id, media_type)
);

alter table public.watched enable row level security;

create policy "users manage their own watch history"
  on public.watched for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── follows ───────────────────────────────────────────────────────────────
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

alter table public.follows enable row level security;

create policy "follow graph is publicly readable"
  on public.follows for select
  using (true);

create policy "users manage who they follow"
  on public.follows for insert
  with check (auth.uid() = follower_id);

create policy "users can unfollow"
  on public.follows for delete
  using (auth.uid() = follower_id);

-- ── recommendations ───────────────────────────────────────────────────────
create table public.recommendations (
  id            uuid primary key default gen_random_uuid(),
  from_user_id  uuid not null references public.profiles(id) on delete cascade,
  to_user_id    uuid not null references public.profiles(id) on delete cascade,
  tmdb_id       integer not null,
  media_type    text not null check (media_type in ('movie', 'tv')),
  note          text,
  created_at    timestamptz not null default now(),
  seen_at       timestamptz,
  check (from_user_id <> to_user_id)
);

alter table public.recommendations enable row level security;

create policy "sender and recipient can read a recommendation"
  on public.recommendations for select
  using (auth.uid() = from_user_id or auth.uid() = to_user_id);

create policy "users send recommendations as themselves"
  on public.recommendations for insert
  with check (auth.uid() = from_user_id);

create policy "recipient can mark a recommendation as seen"
  on public.recommendations for update
  using (auth.uid() = to_user_id)
  with check (auth.uid() = to_user_id);
