-- Run this once in your Supabase project's SQL Editor:
-- https://supabase.com/dashboard/project/<your-project>/sql/new
--
-- Creates a `workspaces` table that stores the entire planning state as JSONB.
-- Idempotent: re-runnable safely (every column add uses IF NOT EXISTS).
-- Each browser owns one row keyed by a UUID stored in localStorage.
--
-- IMPORTANT trade-off: the `anon` key is in the public bundle, so anyone with
-- the key + your project URL CAN technically scan all rows. For a personal
-- demo this is fine. For multi-user production add Supabase Auth and tighten
-- the RLS policies below to `auth.uid() = owner`.

create table if not exists public.workspaces (
  id text primary key,
  apis jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Schema additions over time. ALTER ... IF NOT EXISTS makes this idempotent.
alter table public.workspaces
  add column if not exists reactors jsonb;

alter table public.workspaces
  add column if not exists "window" jsonb;

alter table public.workspaces
  add column if not exists projects jsonb;

alter table public.workspaces
  add column if not exists active_project_id text;

create index if not exists workspaces_updated_at_idx
  on public.workspaces (updated_at desc);

alter table public.workspaces enable row level security;

drop policy if exists "anon select" on public.workspaces;
drop policy if exists "anon insert" on public.workspaces;
drop policy if exists "anon update" on public.workspaces;
drop policy if exists "anon delete" on public.workspaces;

create policy "anon select"
  on public.workspaces
  for select
  to anon
  using (true);

create policy "anon insert"
  on public.workspaces
  for insert
  to anon
  with check (true);

create policy "anon update"
  on public.workspaces
  for update
  to anon
  using (true)
  with check (true);

create policy "anon delete"
  on public.workspaces
  for delete
  to anon
  using (true);
