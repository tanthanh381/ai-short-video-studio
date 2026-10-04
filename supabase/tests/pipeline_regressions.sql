-- Run in SQL Editor/execute_sql after all one-click pipeline migrations.
-- Every test project, scene, job, and export is rolled back at the end.
begin;
do $$
declare
  v_user uuid;
  v_project uuid;
  v_scene uuid;
  v_timestamp timestamptz;
  v_caught boolean := false;
  v_settings jsonb := '{"textProvider":"ollama","mediaProvider":"local"}'::jsonb;
  v_old_job public.jobs;
  v_new_job public.jobs;
  v_active integer;
  v_limit integer;
  v_project_json jsonb;
  v_scenes_json jsonb;
  v_idempotency_key text;
  v_idempotency_title text;
  v_first_job public.jobs;
  v_same_job public.jobs;
begin
  select user_id,max_concurrent_jobs into v_user,v_limit
    from public.allowed_users where is_active order by created_at limit 1;
  if v_user is null then raise exception 'QC requires an allowed account'; end if;
  insert into public.projects(user_id,title,source_text,input_mode,settings)
    values(v_user,'Atomic rollback QC','Kịch bản nguyên văn.','full-script',v_settings)
    returning id,updated_at into v_project,v_timestamp;
  insert into public.scenes(project_id,scene_order,narration,image_prompt,estimated_duration_ms)
    values(v_project,0,'Kịch bản nguyên văn.','Original prompt',3000) returning id into v_scene;

  begin
    perform public.replace_storyboard(v_project,v_user,
      jsonb_build_array(jsonb_build_object('scene_order',0,'narration',repeat('x',2001),
        'image_prompt','Invalid prompt','estimated_duration_ms',3000)),
      'Changed hook','Changed title','Changed description','draft');
  exception when check_violation then v_caught := true;
  end;
  if not v_caught or not exists(select 1 from public.scenes where id=v_scene and narration='Kịch bản nguyên văn.')
    then raise exception 'FAIL: storyboard insertion error removed original scenes'; end if;

  v_caught := false;
  begin
    perform public.save_project(v_project,v_user,date_trunc('milliseconds',v_timestamp),
      jsonb_build_object('title','Changed title','sourceText','Changed script','inputMode','full-script',
        'hook','','suggestedTitle','','suggestedDescription','','settings',v_settings),
      jsonb_build_array(jsonb_build_object('id',v_scene,'scene_order',0,'narration',repeat('x',2001),
        'image_prompt','Invalid prompt','estimated_duration_ms',3000,'media_status','pending','subtitles','[]'::jsonb)));
  exception when check_violation then v_caught := true;
  end;
  if not v_caught or not exists(select 1 from public.projects where id=v_project and title='Atomic rollback QC')
    or not exists(select 1 from public.scenes where id=v_scene and narration='Kịch bản nguyên văn.')
    then raise exception 'FAIL: project insertion error changed metadata or original scenes'; end if;

  update public.projects set status='completed' where id=v_project returning updated_at into v_timestamp;
  v_project_json := jsonb_build_object('title','Atomic rollback QC','sourceText','Kịch bản nguyên văn.',
    'inputMode','full-script','hook','','suggestedTitle','','suggestedDescription','','settings',v_settings);
  select jsonb_agg(to_jsonb(s) order by s.scene_order,s.id) into v_scenes_json from (
    select id,scene_order,narration,image_prompt,estimated_duration_ms,actual_duration_ms,
      image_path,audio_path,media_status,error_message,subtitles from public.scenes where project_id=v_project
  ) s;
  perform public.save_project(v_project,v_user,date_trunc('milliseconds',v_timestamp),v_project_json,v_scenes_json);
  if not exists(select 1 from public.projects where id=v_project and status='completed')
    then raise exception 'FAIL: unchanged save invalidated completed video'; end if;
  select updated_at into v_timestamp from public.projects where id=v_project;
  v_project_json := jsonb_set(v_project_json,'{title}','"Renamed only"');
  perform public.save_project(v_project,v_user,date_trunc('milliseconds',v_timestamp),v_project_json,v_scenes_json);
  if not exists(select 1 from public.projects where id=v_project and status='completed' and title='Renamed only')
    then raise exception 'FAIL: title-only edit invalidated completed video'; end if;
  select updated_at into v_timestamp from public.projects where id=v_project;
  v_scenes_json := jsonb_set(v_scenes_json,'{0,narration}','"Lời đọc mới."');
  perform public.save_project(v_project,v_user,date_trunc('milliseconds',v_timestamp),v_project_json,v_scenes_json);
  if not exists(select 1 from public.projects where id=v_project and status='draft')
    then raise exception 'FAIL: narration edit did not mark video as draft'; end if;

  select count(*) into v_active from public.jobs where user_id=v_user and status in ('queued','running');
  if v_active>=v_limit then
    raise notice 'Queue regressions skipped: account currently at concurrency limit';
  else
    -- The second submission must return the same job before checking the
    -- account limit, which the first submission may have just reached.
    v_idempotency_key := 'rollback-idempotency:' || gen_random_uuid()::text;
    v_idempotency_title := 'Idempotency rollback QC ' || v_idempotency_key;
    select * into v_first_job from public.enqueue_video(v_user,v_idempotency_key,
      E'  Kịch bản kiểm thử nguyên văn.\nGiữ đúng dấu tiếng Việt.  ',v_idempotency_title,v_settings,v_limit);
    select * into v_same_job from public.enqueue_video(v_user,v_idempotency_key,
      E'  Kịch bản kiểm thử nguyên văn.\nGiữ đúng dấu tiếng Việt.  ',v_idempotency_title,v_settings,v_limit);
    if v_first_job.id is distinct from v_same_job.id
      or v_first_job.project_id is distinct from v_same_job.project_id
      or (select count(*) from public.jobs where user_id=v_user and idempotency_key=v_idempotency_key)<>1
      or (select count(*) from public.projects where user_id=v_user and title=v_idempotency_title)<>1
      or not exists(select 1 from public.projects where id=v_first_job.project_id
        and source_text=E'  Kịch bản kiểm thử nguyên văn.\nGiữ đúng dấu tiếng Việt.  ')
      then raise exception 'FAIL: repeated submission created duplicate project/job or altered script'; end if;
    -- Only this transaction's fixture job is completed; actual user jobs stay
    -- untouched and the following queue regressions can use the account slot.
    update public.jobs set status='completed' where id=v_first_job.id;

    -- No pipeline existed yet: a legacy project starts from existing scenes.
    select * into v_new_job from public.continue_video(v_user,v_project,v_limit);
    if v_new_job.job_type<>'create_video' or v_new_job.payload->'pipeline'->>'step'<>'media'
      or not exists(select 1 from public.scenes where id=v_scene and narration='Lời đọc mới.')
      then raise exception 'FAIL: legacy project continuation did not retain scenes'; end if;
    update public.jobs set status='cancelled' where id=v_new_job.id;
    insert into public.jobs(project_id,user_id,job_type,status,payload,idempotency_key,created_at)
      values(v_project,v_user,'create_video','failed',
        jsonb_build_object('pipeline',jsonb_build_object('version',1,'step','render'),
          'input_hash',md5('Kịch bản nguyên văn.' || v_settings::text)),
        'rollback-qc:' || v_project::text,now()+interval '1 millisecond') returning * into v_old_job;
    insert into public.exports(project_id,job_id,storage_path,thumbnail_path,duration_ms,width,height)
      values(v_project,v_old_job.id,'rollback-test.mp4','rollback-test.jpg',3000,1080,1920);
    select * into v_new_job from public.continue_video(v_user,v_project,v_limit);
    if v_new_job.id=v_old_job.id or v_new_job.payload->'pipeline'->>'step'<>'media'
      then raise exception 'FAIL: continuing after existing export reused old job/video'; end if;
    if not exists(select 1 from public.scenes where id=v_scene)
      then raise exception 'FAIL: resume removed successful scenes'; end if;
  end if;
end;
$$;
rollback;
