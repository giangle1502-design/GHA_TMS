-- Kiểm thử: tài khoản khách hàng không thấy 3-PL, cước 3-PL; xe xem như xe của GHA
create schema if not exists tests;
create or replace function tests.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid::text, false);
$$;
grant usage on schema tests to authenticated;
grant execute on function tests.login(uuid) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000c001', 'kh.vap@gha.test', '{"full_name":"Admin khách VAP"}'),
  ('00000000-0000-0000-0000-00000000c002', 'dieuphoi@gha.test', '{"full_name":"Điều phối GHA"}')
on conflict do nothing;
update public.profiles set status = 'active' where id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002');
insert into public.user_roles (user_id, role_id)
select '00000000-0000-0000-0000-00000000c001', id from public.roles where code = 'customer_admin' on conflict do nothing;
insert into public.user_roles (user_id, role_id)
select '00000000-0000-0000-0000-00000000c002', id from public.roles where code = 'dispatcher' on conflict do nothing;

-- một khoản cước 3-PL mẫu
insert into public.shipment_carrier_costs (shipment_id, line_no, cost_kind, description, amount)
select id, 1, 'freight', 'Cước 3-PL mẫu', 1500000 from public.shipments where shipment_code = 'SHD-000146'
on conflict do nothing;

do $$
declare n_costs int; n_sup int; n_veh int; n_ship int; n_vb int;
begin
  perform tests.login('00000000-0000-0000-0000-00000000c001');
  set local role authenticated;
  select count(*) into n_costs from public.shipment_carrier_costs;
  select count(*) into n_sup from public.suppliers;
  select count(*) into n_veh from public.vehicles;
  select count(*) into n_vb from public.vehicles_for_customer;
  select count(*) into n_ship from public.shipments;
  reset role;
  if n_costs <> 0 then raise exception 'FAIL: khách thấy cước 3-PL (%)', n_costs; end if;
  if n_sup <> 0 then raise exception 'FAIL: khách thấy nhà xe (%)', n_sup; end if;
  if n_veh <> 0 then raise exception 'FAIL: khách đọc được bảng xe đầy đủ (%)', n_veh; end if;
  if n_vb = 0 then raise exception 'FAIL: khách không thấy danh sách xe cơ bản'; end if;
  if n_ship = 0 then raise exception 'FAIL: khách không thấy chuyến'; end if;
  raise notice 'PASS: khách thấy % chuyến, % xe (không chủ xe), 0 nhà xe, 0 cước 3-PL', n_ship, n_vb;

  perform tests.login('00000000-0000-0000-0000-00000000c002');
  set local role authenticated;
  select count(*) into n_costs from public.shipment_carrier_costs;
  reset role;
  if n_costs = 0 then raise exception 'FAIL: điều phối GHA không thấy cước 3-PL'; end if;
  raise notice 'PASS: điều phối GHA thấy cước 3-PL';
end $$;
