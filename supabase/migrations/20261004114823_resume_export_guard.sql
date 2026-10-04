-- A saved export belongs to the prior timeline. A terminally failed job may
-- already have an export if its final status/checkpoint write failed. After a
-- scene edit, continuing must render under a new job_id instead of reusing it.
create or replace function public.continue_video(p_user_id uuid,p_project_id uuid,p_max_concurrent integer)
returns setof public.jobs
language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.jobs;
  v_project public.projects;
  v_limit integer;
  v_input_hash text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 73421));
  select * into v_project from public.projects where id=p_project_id and user_id=p_user_id;
  if not found then raise exception 'VIDEO_PROJECT_NOT_FOUND'; end if;
  select * into v_job from public.jobs
    where project_id=p_project_id and user_id=p_user_id and job_type='create_video'
    order by created_at desc limit 1;
  if not found then raise exception 'VIDEO_NO_PIPELINE'; end if;
  if v_job.status in ('queued','running') then return next v_job; return; end if;
  select least(max_concurrent_jobs,p_max_concurrent) into v_limit
    from public.allowed_users where user_id=p_user_id and is_active;
  if v_limit is null then raise exception 'VIDEO_PROJECT_NOT_FOUND'; end if;
  if exists(select 1 from public.jobs where project_id=p_project_id and status in ('queued','running'))
    then raise exception 'VIDEO_ACTIVE_PROJECT_JOB'; end if;
  if (select count(*) from public.jobs where user_id=p_user_id and status in ('queued','running')) >= v_limit
    then raise exception 'VIDEO_CONCURRENCY_LIMIT'; end if;
  v_input_hash := pg_catalog.md5(v_project.source_text || v_project.settings::text);
  if v_job.status='failed' and v_job.payload->>'input_hash'=v_input_hash
    and not exists(select 1 from public.exports where job_id=v_job.id) then
    update public.jobs set status='queued',attempts=0,error_message=null,
      locked_by=null,locked_at=null,heartbeat_at=null,finished_at=null,next_attempt_at=now(),
      stage='Tiếp tục từ bước đang lỗi'
      where id=v_job.id returning * into v_job;
  else
    insert into public.jobs(project_id,user_id,job_type,payload,idempotency_key,stage,max_attempts)
      values(p_project_id,p_user_id,'create_video',
        pg_catalog.jsonb_build_object('pipeline',pg_catalog.jsonb_build_object('version',1,
          'step',case when exists(select 1 from public.scenes where project_id=p_project_id) then 'media' else 'storyboard' end),
          'input_hash',v_input_hash),
        'continue-video:' || p_project_id::text || ':' || pg_catalog.gen_random_uuid()::text,
        'Đang chờ máy tạo video',3) returning * into v_job;
  end if;
  update public.projects set status='queued' where id=p_project_id;
  return next v_job;
end;
$$;
revoke all on function public.continue_video(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.continue_video(uuid,uuid,integer) to service_role;
