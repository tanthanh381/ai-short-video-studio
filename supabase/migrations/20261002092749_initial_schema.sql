create extension if not exists pgcrypto;

create type public.project_status as enum ('draft','generating_media','queued','rendering','completed','failed');
create type public.media_status as enum ('pending','processing','ready','failed');
create type public.job_status as enum ('queued','running','completed','failed','cancelled');
create type public.job_type as enum ('storyboard','generate_media','regenerate_scene','render_video');

create table public.allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  is_active boolean not null default true,
  daily_budget_usd numeric(12,2) not null default 3 check (daily_budget_usd >= 0 and daily_budget_usd <= 1000),
  max_concurrent_jobs integer not null default 1 check (max_concurrent_jobs between 1 and 5),
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  source_text text not null check (char_length(source_text) between 1 and 30000),
  input_mode text not null default 'idea' check (input_mode in ('idea','full-script')),
  hook text not null default '',
  suggested_title text not null default '',
  suggested_description text not null default '',
  status public.project_status not null default 'draft',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_updated_idx on public.projects(user_id,updated_at desc);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_order integer not null check (scene_order >= 0),
  narration text not null check (char_length(narration) between 1 and 2000),
  image_prompt text not null check (char_length(image_prompt) between 1 and 3000),
  estimated_duration_ms integer not null check (estimated_duration_ms between 1000 and 120000),
  actual_duration_ms integer check (actual_duration_ms between 100 and 180000),
  image_path text,
  audio_path text,
  media_status public.media_status not null default 'pending',
  error_message text,
  subtitles jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,scene_order)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_type public.job_type not null,
  status public.job_status not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  progress integer not null default 0 check (progress between 0 and 100),
  stage text not null default 'Đã xếp hàng',
  error_message text,
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  idempotency_key text not null,
  next_attempt_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,idempotency_key)
);
create index jobs_claim_idx on public.jobs(next_attempt_at,created_at) where status='queued';
create index jobs_project_idx on public.jobs(project_id,created_at desc);

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  storage_path text not null,
  thumbnail_path text not null,
  duration_ms integer not null check (duration_ms > 0),
  width integer not null,
  height integer not null,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);
create index exports_project_created_idx on public.exports(project_id,created_at desc);

create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  kind text not null,
  amount_usd numeric(12,6) not null default 0 check (amount_usd >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index usage_user_created_idx on public.usage_events(user_id,created_at desc);
create index usage_project_idx on public.usage_events(project_id) where project_id is not null;
create index usage_job_idx on public.usage_events(job_id) where job_id is not null;

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger projects_updated before update on public.projects for each row execute function public.set_updated_at();
create trigger scenes_updated before update on public.scenes for each row execute function public.set_updated_at();
create trigger jobs_updated before update on public.jobs for each row execute function public.set_updated_at();

alter table public.allowed_users enable row level security;
alter table public.projects enable row level security;
alter table public.scenes enable row level security;
alter table public.jobs enable row level security;
alter table public.exports enable row level security;
alter table public.usage_events enable row level security;

create policy "user reads own access" on public.allowed_users for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner reads projects" on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner creates projects" on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "owner updates projects" on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner deletes projects" on public.projects for delete to authenticated using ((select auth.uid()) = user_id);
create policy "owner reads scenes" on public.scenes for select to authenticated using (exists(select 1 from public.projects p where p.id=project_id and p.user_id=(select auth.uid())));
create policy "owner manages scenes" on public.scenes for all to authenticated using (exists(select 1 from public.projects p where p.id=project_id and p.user_id=(select auth.uid()))) with check (exists(select 1 from public.projects p where p.id=project_id and p.user_id=(select auth.uid())));
create policy "owner reads jobs" on public.jobs for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner reads exports" on public.exports for select to authenticated using (exists(select 1 from public.projects p where p.id=project_id and p.user_id=(select auth.uid())));
create policy "owner reads usage" on public.usage_events for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.allowed_users,public.projects,public.scenes,public.jobs,public.exports,public.usage_events from anon;
grant select on public.allowed_users,public.projects,public.scenes,public.jobs,public.exports,public.usage_events to authenticated;
grant insert,update,delete on public.projects,public.scenes to authenticated;
grant all on public.allowed_users,public.projects,public.scenes,public.jobs,public.exports,public.usage_events to service_role;
grant usage,select on sequence public.usage_events_id_seq to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('private-media','private-media',false,52428800,array['image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','audio/mp4','audio/aac','audio/x-m4a','video/mp4'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.claim_next_job(p_worker_id text)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  with exhausted as (
    update public.jobs
    set status='failed', locked_by=null, locked_at=null, stage='Tác vụ hết số lần thử', error_message='Worker bị gián đoạn và tác vụ đã hết số lần thử', finished_at=now()
    where status='running' and coalesce(heartbeat_at,locked_at) < now() - interval '15 minutes' and attempts >= max_attempts
    returning project_id
  )
  update public.projects p set status='failed'
  from exhausted e where p.id=e.project_id;

  update public.jobs
  set status='queued', locked_by=null, locked_at=null, stage='Khôi phục tác vụ bị gián đoạn', next_attempt_at=now()
  where status='running' and coalesce(heartbeat_at,locked_at) < now() - interval '15 minutes' and attempts < max_attempts;

  return query
  update public.jobs
  set status='running', attempts=attempts+1, locked_by=p_worker_id, locked_at=now(), heartbeat_at=now(), started_at=coalesce(started_at,now()), stage='Đang bắt đầu'
  where id=(select id from public.jobs where status='queued' and next_attempt_at<=now() and attempts<max_attempts order by created_at for update skip locked limit 1)
  returning *;
end;
$$;
revoke all on function public.claim_next_job(text) from public,anon,authenticated;
grant execute on function public.claim_next_job(text) to service_role;
