-- All storyboard scene changes commit together. A failed insert rolls back the
-- deletion, and media cleanup runs in the worker only after this succeeds.
create or replace function public.replace_storyboard(
  p_project_id uuid,p_user_id uuid,p_scenes jsonb,p_hook text,
  p_suggested_title text,p_suggested_description text,p_status public.project_status
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.projects where id=p_project_id and user_id=p_user_id for update;
  if not found then raise exception 'VIDEO_PROJECT_NOT_FOUND'; end if;
  if pg_catalog.jsonb_typeof(p_scenes)<>'array' or pg_catalog.jsonb_array_length(p_scenes)=0
    then raise exception 'VIDEO_EMPTY_STORYBOARD'; end if;
  delete from public.scenes where project_id=p_project_id;
  insert into public.scenes(project_id,scene_order,narration,image_prompt,estimated_duration_ms,media_status,subtitles)
    select p_project_id,s.scene_order,s.narration,s.image_prompt,s.estimated_duration_ms,'pending','[]'::jsonb
    from pg_catalog.jsonb_to_recordset(p_scenes) as s(scene_order integer,narration text,image_prompt text,estimated_duration_ms integer);
  update public.projects set hook=p_hook,suggested_title=p_suggested_title,
    suggested_description=p_suggested_description,status=p_status where id=p_project_id;
end;
$$;
revoke all on function public.replace_storyboard(uuid,uuid,jsonb,text,text,text,public.project_status) from public,anon,authenticated;
grant execute on function public.replace_storyboard(uuid,uuid,jsonb,text,text,text,public.project_status) to service_role;

-- Same transaction lock as enqueue_video: autosave cannot race a new job.
create or replace function public.save_project(
  p_project_id uuid,p_user_id uuid,p_updated_at timestamptz,p_project jsonb,p_scenes jsonb
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_project public.projects;
  v_prefix text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,73421));
  select * into v_project from public.projects where id=p_project_id and user_id=p_user_id for update;
  if not found then raise exception 'VIDEO_PROJECT_NOT_FOUND'; end if;
  if exists(select 1 from public.jobs where project_id=p_project_id and status in ('queued','running'))
    then raise exception 'VIDEO_ACTIVE_PROJECT_JOB'; end if;
  -- JavaScript serializes timestamps at millisecond precision.
  if pg_catalog.date_trunc('milliseconds',v_project.updated_at)<>p_updated_at
    then raise exception 'VIDEO_STALE_PROJECT'; end if;
  if pg_catalog.jsonb_typeof(p_scenes)<>'array' then raise exception 'VIDEO_INVALID_SCENES'; end if;
  if exists(select 1 from public.scenes s join pg_catalog.jsonb_to_recordset(p_scenes) as x(id uuid) on x.id=s.id
    where s.project_id<>p_project_id) then raise exception 'VIDEO_FOREIGN_SCENE'; end if;
  v_prefix := p_user_id::text || '/' || p_project_id::text || '/';
  if exists(
    select 1 from (
      select s.image_path as path from pg_catalog.jsonb_to_recordset(p_scenes) as s(image_path text)
      union all select s.audio_path from pg_catalog.jsonb_to_recordset(p_scenes) as s(audio_path text)
      union all select p_project->'settings'->>'backgroundMusicPath'
    ) paths where path is not null and (pg_catalog.left(path,pg_catalog.length(v_prefix))<>v_prefix or pg_catalog.strpos(path,'..')>0)
  ) then raise exception 'VIDEO_FOREIGN_MEDIA'; end if;
  update public.projects set title=p_project->>'title',source_text=p_project->>'sourceText',
    input_mode=p_project->>'inputMode',hook=p_project->>'hook',suggested_title=p_project->>'suggestedTitle',
    suggested_description=p_project->>'suggestedDescription',settings=p_project->'settings'
    where id=p_project_id;
  delete from public.scenes where project_id=p_project_id;
  insert into public.scenes(id,project_id,scene_order,narration,image_prompt,estimated_duration_ms,
    actual_duration_ms,image_path,audio_path,media_status,error_message,subtitles)
    select s.id,p_project_id,s.scene_order,s.narration,s.image_prompt,s.estimated_duration_ms,
      s.actual_duration_ms,s.image_path,s.audio_path,s.media_status,s.error_message,s.subtitles
    from pg_catalog.jsonb_to_recordset(p_scenes) as s(
      id uuid,scene_order integer,narration text,image_prompt text,estimated_duration_ms integer,
      actual_duration_ms integer,image_path text,audio_path text,media_status public.media_status,error_message text,subtitles jsonb
    );
end;
$$;
revoke all on function public.save_project(uuid,uuid,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_project(uuid,uuid,timestamptz,jsonb,jsonb) to service_role;
