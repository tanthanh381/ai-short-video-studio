-- Preserve the user's choice between an idea and a locked full script in the
-- one-click pipeline. The six-argument function remains for old clients.
create or replace function public.enqueue_video(
  p_user_id uuid, p_idempotency_key text, p_source_text text,
  p_input_mode text, p_title text, p_settings jsonb, p_max_concurrent integer
)
returns setof public.jobs
language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.jobs;
  v_project_id uuid;
  v_limit integer;
begin
  if p_input_mode not in ('idea', 'full-script') then raise exception 'VIDEO_INVALID_INPUT_MODE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 73421));
  select * into v_job from public.jobs where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then return next v_job; return; end if;
  select least(max_concurrent_jobs, p_max_concurrent) into v_limit
    from public.allowed_users where user_id = p_user_id and is_active;
  if v_limit is null then raise exception 'VIDEO_PROJECT_NOT_FOUND'; end if;
  if (select count(*) from public.jobs where user_id = p_user_id and status in ('queued','running')) >= v_limit
    then raise exception 'VIDEO_CONCURRENCY_LIMIT'; end if;
  insert into public.projects(user_id,title,source_text,input_mode,settings,status)
    values(p_user_id,p_title,p_source_text,p_input_mode,p_settings,'queued') returning id into v_project_id;
  insert into public.jobs(project_id,user_id,job_type,payload,idempotency_key,stage,max_attempts)
    values(v_project_id,p_user_id,'create_video',
      pg_catalog.jsonb_build_object('pipeline',pg_catalog.jsonb_build_object('version',1,'step','storyboard'),
        'input_hash',pg_catalog.md5(p_source_text || p_settings::text || p_input_mode)),
      p_idempotency_key,'Đang chờ máy tạo video',3) returning * into v_job;
  return next v_job;
end;
$$;
revoke all on function public.enqueue_video(uuid,text,text,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.enqueue_video(uuid,text,text,text,text,jsonb,integer) to service_role;
