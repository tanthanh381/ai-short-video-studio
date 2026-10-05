-- Run only after scripts/audit/db-baseline.sql in the isolated audit database.
begin;
do $$ declare t text; p text; begin
  foreach t in array array['projects','scenes'] loop
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('authenticated','public.'||t,p) then
        raise exception 'FAIL: authenticated still has % on %',p,t;
      end if;
    end loop;
    if not has_table_privilege('service_role','public.'||t,'UPDATE') then
      raise exception 'FAIL: API write grant lost';
    end if;
  end loop;
  if has_function_privilege('authenticated','public.claim_next_job(text)','EXECUTE') then
    raise exception 'FAIL: browser can claim worker jobs';
  end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
do $$ begin
  if not exists(select 1 from public.projects where id='00000000-0000-4000-8000-000000000003') then
    raise exception 'FAIL: owner read was broken';
  end if;
  begin
    update public.projects set title='Must not change' where id='00000000-0000-4000-8000-000000000003';
    raise exception 'FAIL: direct update unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.projects(user_id,title,source_text) values(auth.uid(),'Blocked','Blocked direct mutation');
    raise exception 'FAIL: direct insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.projects where id='00000000-0000-4000-8000-000000000003';
    raise exception 'FAIL: direct delete unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
update public.projects set title='Trusted API still works' where id='00000000-0000-4000-8000-000000000003';
reset role;
do $$ begin
  if not exists(select 1 from public.projects where id='00000000-0000-4000-8000-000000000003' and title='Trusted API still works') then
    raise exception 'FAIL: trusted API mutation failed';
  end if;
  raise notice 'PASS: browser mutations blocked, owner read and trusted API preserved';
end $$;
rollback;
