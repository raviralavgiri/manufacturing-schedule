-- Run this once in your Supabase project's SQL Editor:
-- https://supabase.com/dashboard/project/<your-project>/sql/new
--
-- Schema for the planner. Each project (e.g. "Default", "TEST") is one row
-- in `public.projects`. Browsers do NOT have their own rows — every browser
-- reads/writes the same shared set of project rows. Switching the
-- "active project" is a per-browser preference (localStorage only) and is
-- not stored in the database.
--
-- Idempotent: re-runnable safely (every column / index / policy uses
-- IF NOT EXISTS or DROP-then-CREATE).
--
-- IMPORTANT trade-off: the `anon` key is in the public bundle, so anyone
-- with the key + your project URL CAN read/write all rows. For a personal
-- demo this is fine. For multi-user production add Supabase Auth and tighten
-- the RLS policies below to filter by `auth.uid() = owner`.

create table if not exists public.projects (
  id text primary key,
  name text not null,
  created_at bigint not null default 0,
  apis jsonb not null default '[]'::jsonb,
  reactors jsonb not null default '[]'::jsonb,
  "window" jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists projects_updated_at_idx
  on public.projects (updated_at desc);

alter table public.projects enable row level security;

drop policy if exists "anon select" on public.projects;
drop policy if exists "anon insert" on public.projects;
drop policy if exists "anon update" on public.projects;
drop policy if exists "anon delete" on public.projects;

create policy "anon select"
  on public.projects
  for select
  to anon
  using (true);

create policy "anon insert"
  on public.projects
  for insert
  to anon
  with check (true);

create policy "anon update"
  on public.projects
  for update
  to anon
  using (true)
  with check (true);

create policy "anon delete"
  on public.projects
  for delete
  to anon
  using (true);

-- ─── ONE-TIME MIGRATION FROM THE LEGACY `workspaces` TABLE ─────────────────
--
-- The previous schema stored every browser's full state as one row in
-- `public.workspaces`. To carry that data forward into the new per-project
-- shape, run this block ONCE. It walks every legacy workspace row, extracts
-- each project from its `projects` JSONB array, and upserts that project
-- into `public.projects`. Safe to run multiple times — uses ON CONFLICT.
--
-- Wrapped in a `do $$ ... end $$;` block so we can branch on whether the
-- legacy table exists.
do $$
declare
  legacy_exists boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'workspaces'
  ) into legacy_exists;

  if legacy_exists then
    insert into public.projects (id, name, created_at, apis, reactors, "window", updated_at)
    select
      coalesce(p->>'id', gen_random_uuid()::text)                          as id,
      coalesce(p->>'name', 'Untitled Project')                              as name,
      coalesce((p->>'createdAt')::bigint, 0)                                as created_at,
      coalesce(p->'apis', '[]'::jsonb)                                      as apis,
      coalesce(p->'reactors', '[]'::jsonb)                                  as reactors,
      coalesce(p->'window', '{}'::jsonb)                                    as window,
      coalesce(w.updated_at, now())                                         as updated_at
    from public.workspaces w
    cross join lateral jsonb_array_elements(coalesce(w.projects, '[]'::jsonb)) as p
    on conflict (id) do update set
      name       = excluded.name,
      apis       = excluded.apis,
      reactors   = excluded.reactors,
      "window"   = excluded."window",
      updated_at = excluded.updated_at;

    raise notice 'Migrated legacy workspaces.projects[] -> public.projects';
  else
    raise notice 'No legacy public.workspaces table found; skipping migration.';
  end if;
end $$;
