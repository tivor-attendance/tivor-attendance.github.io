-- Shared online store for the static (GitHub Pages) site — see lib/cloud.ts.
-- Run once in Supabase → SQL Editor.

create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.kv enable row level security;

-- Only the signed-in admin account may read or write the data.
drop policy if exists "admin full access" on public.kv;
create policy "admin full access" on public.kv
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'pranay@altiq.one')
  with check ((auth.jwt() ->> 'email') = 'pranay@altiq.one');
