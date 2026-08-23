-- Two changes to support the lists/watched UI without extra TMDB round-trips
-- and to simplify client-side inserts.

-- ── Denormalized display fields ──────────────────────────────────────────
-- The profile page (lists overview, watched grid, sort/filter by genre or
-- year) renders directly from these cached fields instead of re-fetching
-- every title from TMDB. tmdb_id/media_type remain the source of truth for
-- identity (badges, "is this watched" lookups); these are a display cache,
-- refreshed whenever an item is re-added.
alter table public.list_items
  add column title      text,
  add column poster_path text,
  add column year        text,
  add column seasons      integer,
  add column genre_ids    integer[],
  add column tmdb_score   integer;

alter table public.watched
  add column title      text,
  add column poster_path text,
  add column year        text,
  add column seasons      integer,
  add column genre_ids    integer[],
  add column tmdb_score   integer,
  add column note         text;

-- ── Default ownership to the calling user ────────────────────────────────
-- Lets the client omit these columns entirely on insert; RLS `with check`
-- clauses already require them to equal auth.uid(), so defaulting to it
-- removes a whole class of "sent the wrong user id" bugs.
alter table public.lists           alter column owner_id    set default auth.uid();
alter table public.list_items      alter column added_by    set default auth.uid();
alter table public.watched         alter column user_id     set default auth.uid();
alter table public.follows         alter column follower_id set default auth.uid();
alter table public.recommendations alter column from_user_id set default auth.uid();
