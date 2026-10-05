-- Isolated CI only: reproduce own-project API-guard bypass before the fix.
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into public.allowed_users(user_id,email) values ('00000000-0000-4000-8000-000000000001','audit-allowed@example.invalid');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
insert into public.projects(id,user_id,title,source_text)
values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','Direct write baseline','Synthetic fixture; no real account');
reset role;
do $$ begin
  if not exists(select 1 from public.projects where id='00000000-0000-4000-8000-000000000003') then
    raise exception 'Expected baseline direct write to reproduce';
  end if;
  raise notice 'REPRODUCED: non-allowlisted authenticated role could create its own project directly';
end $$;
