-- Kiểm thử bốc xếp 3PL: một chuyến xe nhà xe A, bốc xếp do đơn vị B, C và chính A
create schema if not exists tests;
create or replace function tests.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid::text, false);
$$;
grant usage on schema tests to authenticated;
grant execute on function tests.login(uuid) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000c003', 'ketoan@gha.test', '{"full_name":"Kế toán GHA"}')
on conflict do nothing;
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000c003';
insert into public.user_roles (user_id, role_id)
select '00000000-0000-0000-0000-00000000c003', id from public.roles where code = 'super_admin' on conflict do nothing;

insert into public.suppliers (code, name, custom_fields) values
  ('TBX-A', 'Nhà xe thử A', '{"supplier_kind":"3pl"}'),
  ('TBX-B', 'Bốc xếp thử B', '{"supplier_kind":"3pl"}'),
  ('TBX-C', 'Bốc xếp thử C', '{"supplier_kind":"3pl"}')
on conflict do nothing;

do $$
declare
  v_s uuid; a uuid; b uuid; c uuid; ft uuid; r jsonb;
  n int; v_amt numeric; v_tot numeric; v_cost numeric; v_paid boolean; v_pb uuid;
begin
  select s.id into v_s from public.shipments s where s.status not in ('cancelled', 'closed') and not exists (select 1 from public.shipment_carrier_costs x where x.shipment_id = s.id) and not exists (select 1 from public.payables p where p.shipment_id = s.id) order by s.shipment_code limit 1;
  if v_s is null then raise exception 'FAIL: không có chuyến mẫu'; end if;
  select id into a from public.suppliers where code = 'TBX-A';
  select id into b from public.suppliers where code = 'TBX-B';
  select id into c from public.suppliers where code = 'TBX-C';
  select id into ft from public.fee_types where is_loading order by sort_order limit 1;

  perform tests.login('00000000-0000-0000-0000-00000000c003');
  set local role authenticated;
  r := public.set_shipment_carrier_costs(v_s, a, jsonb_build_array(
    jsonb_build_object('kind', 'freight', 'amount', 2000000),
    jsonb_build_object('kind', 'other', 'fee_type_id', ft, 'supplier_id', b, 'quantity', 10, 'unit_price', 40000),
    jsonb_build_object('kind', 'other', 'fee_type_id', ft, 'supplier_id', c, 'amount', 300000),
    jsonb_build_object('kind', 'other', 'fee_type_id', ft, 'supplier_id', a, 'amount', 100000)));
  select amount into v_amt from public.payables where shipment_id = v_s and kind = 'carrier' and status <> 'cancelled';
  if v_amt <> 2100000 then raise exception 'FAIL: công nợ nhà xe A = % (cần 2,100,000)', v_amt; end if;
  select amount, id into v_amt, v_pb from public.payables where shipment_id = v_s and kind = 'loading' and supplier_id = b and status <> 'cancelled';
  if v_amt <> 400000 then raise exception 'FAIL: công nợ bốc xếp B = % (cần 400,000)', v_amt; end if;
  select amount into v_amt from public.payables where shipment_id = v_s and kind = 'loading' and supplier_id = c and status <> 'cancelled';
  if v_amt <> 300000 then raise exception 'FAIL: công nợ bốc xếp C = %', v_amt; end if;
  select total, cost into v_tot, v_cost from public.shipment_carrier_totals where shipment_id = v_s;
  if v_tot <> 2100000 or v_cost <> 2800000 then raise exception 'FAIL: tổng nhà xe % / chi phí %', v_tot, v_cost; end if;
  select count(*) into n from public.report_loading_3pl where shipment_id = v_s;
  if n <> 3 then raise exception 'FAIL: báo cáo bốc xếp có % khoản (cần 3)', n; end if;
  raise notice 'PASS: nhà xe A 2,100,000; bốc xếp B 400,000, C 300,000 tách công nợ riêng; lời/lỗ trừ đủ 2,800,000';

  -- Trả B → báo cáo hiện đã thanh toán
  perform public.pay_carrier_payables(array[v_pb]);
  select paid into v_paid from public.report_loading_3pl where shipment_id = v_s and supplier_id = b;
  if not v_paid then raise exception 'FAIL: đã trả B mà báo cáo chưa ghi đã thanh toán'; end if;
  raise notice 'PASS: trả đơn vị B → khoản bốc xếp B đã thanh toán';

  -- Bỏ đơn vị C → công nợ C bị hủy; giảm B dưới số đã trả → báo lỗi
  r := public.set_shipment_carrier_costs(v_s, a, jsonb_build_array(
    jsonb_build_object('kind', 'freight', 'amount', 2000000),
    jsonb_build_object('kind', 'other', 'fee_type_id', ft, 'supplier_id', b, 'quantity', 10, 'unit_price', 40000)));
  select count(*) into n from public.payables where shipment_id = v_s and kind = 'loading' and supplier_id = c and status <> 'cancelled';
  if n <> 0 then raise exception 'FAIL: bỏ đơn vị C mà công nợ C chưa hủy'; end if;
  begin
    r := public.set_shipment_carrier_costs(v_s, a, jsonb_build_array(jsonb_build_object('kind', 'freight', 'amount', 2000000)));
    raise exception 'FAIL: xóa khoản B đã trả mà không báo lỗi';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'PASS: bỏ đơn vị C hủy công nợ C; không xóa được khoản đã trả';
  reset role;

  -- Khách hàng không thấy báo cáo bốc xếp 3PL
  perform tests.login('00000000-0000-0000-0000-00000000c001');
  set local role authenticated;
  select count(*) into n from public.report_loading_3pl;
  reset role;
  if n <> 0 then raise exception 'FAIL: khách thấy % khoản bốc xếp 3PL', n; end if;
  raise notice 'PASS: tài khoản khách không thấy bốc xếp 3PL';
end $$;
