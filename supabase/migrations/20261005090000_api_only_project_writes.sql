-- Browser CRUD already uses the authenticated API. Direct table writes bypass
-- the API allowlist, active-job guard, media-path checks and optimistic locking.
-- Keep owner-scoped reads; mutations are performed only by the trusted API.
revoke insert, update, delete, truncate, references, trigger
  on public.projects, public.scenes from anon, authenticated;
drop policy if exists "owner creates projects" on public.projects;
drop policy if exists "owner updates projects" on public.projects;
drop policy if exists "owner deletes projects" on public.projects;
drop policy if exists "owner manages scenes" on public.scenes;
-- No data is deleted and service_role grants remain unchanged.
