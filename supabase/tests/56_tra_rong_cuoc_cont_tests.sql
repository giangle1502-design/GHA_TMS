-- =============================================================================
-- Kiểm thử 9008: tài xế nhập trả rỗng / cược cont; chuỗi vỏ container gộp phí về chuyến đầu
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
insert into public.vehicles (id, code, plate_number, vehicle_type_id) values
  ('50000000-0000-0000-0000-0000000000e9', 'XEE9', '61K99009', '30000000-0000-0000-0000-000000000001');
insert into public.drivers (id, code, full_name) values ('40000000-0000-0000-0000-0000000000e9', 'TXE9', 'Tài xế E9');
create temp table t_cc (k text primary key, v text);
grant all on t_cc to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t_cc where k = key $$;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, delivery_date)
values ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2027-01-11'),
       ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '2027-01-12'),
       ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2027-01-13');
insert into t_cc select 'P' || extract(day from delivery_date)::int, id::text from public.transport_plans where delivery_date between '2027-01-11' and '2027-01-13';
select public.plan_create_orders(pg_temp.v('P11')::uuid);
select public.plan_create_orders(pg_temp.v('P12')::uuid);
select public.plan_create_orders(pg_temp.v('P13')::uuid);
insert into t_cc select 's1', id::text from public.shipments where plan_id = pg_temp.v('P11')::uuid;
insert into t_cc select 's2', id::text from public.shipments where plan_id = pg_temp.v('P12')::uuid;
insert into t_cc select 's3', id::text from public.shipments where plan_id = pg_temp.v('P13')::uuid;
insert into t_cc select 'c1', shipment_code from public.shipments where id = pg_temp.v('s1')::uuid;
insert into t_cc select 'c2', shipment_code from public.shipments where id = pg_temp.v('s2')::uuid;
update public.shipments set container_no = 'TGHU1234567', pod_photo_required = false where id = pg_temp.v('s1')::uuid;
update public.shipments set pod_photo_required = false where id = pg_temp.v('s2')::uuid;
select public.assign_shipment(pg_temp.v('s1')::uuid, '40000000-0000-0000-0000-0000000000e9', '50000000-0000-0000-0000-0000000000e9');
reset role;

-- Chuyến 1: tài xế nhập cược cont, giữ vỏ cho chuyến sau
set role anon;
insert into t_cc select 'tok', public.driver_link_login('61K99009') ->> 'token';
select tests.assert((select count(*) = 1 from public.driver_link_containers(pg_temp.v('tok')) where shipment_id = pg_temp.v('s1')::uuid and container_no = 'TGHU1234567'),
  'Chuyến có số cont: app tài xế hiện thẻ trả rỗng & cược cont');
select tests.assert((public.driver_link_set_container(pg_temp.v('tok'), pg_temp.v('s1')::uuid, null, null, 500000, 'HD-C1', null) ->> 'error') like 'Nhận chuyến trước%',
  'Chưa nhận chuyến: chưa nhập được');
select public.driver_link_accept(pg_temp.v('tok'), pg_temp.v('s1')::uuid);
select public.driver_link_start(pg_temp.v('tok'), pg_temp.v('s1')::uuid);
select tests.assert((public.driver_link_set_container(pg_temp.v('tok'), pg_temp.v('s1')::uuid, null, null, 500000, 'HD-C1', 'returned') ->> 'error') = 'Đã trả rỗng: nhập số tiền trả rỗng.',
  'Chọn Đã trả rỗng mà chưa nhập tiền trả rỗng: báo lỗi');
select tests.assert((public.driver_link_set_container(pg_temp.v('tok'), pg_temp.v('s1')::uuid, null, 'HD-X', null, null, null) ->> 'error') like 'Nhập số tiền trả rỗng của hóa đơn%',
  'Có số HĐ mà không có số tiền: báo lỗi');
select tests.assert((public.driver_link_set_container(pg_temp.v('tok'), pg_temp.v('s1')::uuid, null, null, 500000, 'HD-C1', 'kept') ->> 'ok')::boolean,
  'Nhập cược cont 500,000, giữ vỏ cho chuyến sau');
select tests.assert((public.driver_link_complete(pg_temp.v('tok'), pg_temp.v('s1')::uuid, null, 'full', null, true) ->> 'ok')::boolean, 'Hoàn thành chuyến 1');
reset role;
select tests.assert((select f.amount = 500000 and f.ref_no = 'HD-C1' and f.fee_kind = 'pass_through' from public.shipment_fees f join public.fee_types t on t.id = f.fee_type_id
  where f.shipment_id = pg_temp.v('s1')::uuid and t.name = 'Phí cược cont'), 'Cược cont lưu thành dòng chi hộ Phí cược cont, có số HĐ');
select tests.assert((select pass_through_amount = 500000 and empty_return_state = 'kept' from public.shipments where id = pg_temp.v('s1')::uuid),
  'Tổng chi hộ chuyến 1 = 500,000; trạng thái giữ vỏ');

-- Điều phối: vỏ chưa trả rỗng, nối chuyến 2 vào vỏ của chuyến 1
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert(exists (select 1 from public.container_kept_list() where shipment_id = pg_temp.v('s1')::uuid and container_no = 'TGHU1234567' and deposit_amount = 500000),
  'Danh sách Vỏ chưa trả rỗng có chuyến 1');
select tests.assert(public.shipment_container_chain(pg_temp.v('s2')::uuid) -> 'candidates' @> jsonb_build_array(jsonb_build_object('id', pg_temp.v('s1'))),
  'Chuyến 2 được gợi ý dùng vỏ chuyến 1');
select public.set_container_prev(pg_temp.v('s2')::uuid, pg_temp.v('s1')::uuid);
select tests.assert((select container_no = 'TGHU1234567' and container_prev_id = pg_temp.v('s1')::uuid from public.shipments where id = pg_temp.v('s2')::uuid),
  'Nối vỏ: chuyến 2 nhận số cont của chuyến 1');
select tests.assert(not exists (select 1 from public.container_kept_list() where shipment_id = pg_temp.v('s1')::uuid), 'Vỏ đã có chuyến sau: rời danh sách chưa trả');
select tests.assert(jsonb_array_length(public.shipment_container_chain(pg_temp.v('s2')::uuid) -> 'chain') = 2, 'Chuỗi vỏ có 2 chuyến');
select tests.assert(public.shipment_container_chain(pg_temp.v('s3')::uuid) -> 'candidates' = '[]'::jsonb, 'Vỏ đã dùng không còn gợi ý cho chuyến khác');
select public.assign_shipment(pg_temp.v('s2')::uuid, '40000000-0000-0000-0000-0000000000e9', '50000000-0000-0000-0000-0000000000e9');
reset role;

-- Chuyến 2 (chuyển kho): tài xế thấy vỏ nhận từ chuyến 1, nhập trả rỗng
set role anon;
select tests.assert((public.driver_link_set_container(pg_temp.v('tok'), pg_temp.v('s1')::uuid, 300000, 'HD-H1', 500000, 'HD-C1', 'returned') ->> 'error') like 'Vỏ cont đã chuyển sang chuyến%',
  'Chuyến 1 không chọn Đã trả rỗng được khi vỏ đã sang chuyến 2');
select public.driver_link_accept(pg_temp.v('tok'), pg_temp.v('s2')::uuid);
select public.driver_link_start(pg_temp.v('tok'), pg_temp.v('s2')::uuid);
select tests.assert((select prev_code = pg_temp.v('c1') and root_code = pg_temp.v('c1') and deposit_amount = 500000 and container_no = 'TGHU1234567'
  from public.driver_link_containers(pg_temp.v('tok')) where shipment_id = pg_temp.v('s2')::uuid), 'Chuyến 2 thấy vỏ từ chuyến 1 và cược đã nhập');
select tests.assert((public.driver_link_set_container(pg_temp.v('tok'), pg_temp.v('s2')::uuid, 300000, 'HD-H1', 500000, 'HD-C1', 'returned') ->> 'root_code') = pg_temp.v('c1'),
  'Chuyến 2 nhập trả rỗng 300,000: ghi về chuyến đầu');
select tests.assert((public.driver_link_set_container(pg_temp.v('tok'), pg_temp.v('s2')::uuid, 350000, 'HD-H1', 500000, 'HD-C1', 'returned') ->> 'ok')::boolean,
  'Sửa lại số tiền trả rỗng');
reset role;
select tests.assert((select count(*) = 1 and sum(f.amount) = 350000 from public.shipment_fees f join public.fee_types t on t.id = f.fee_type_id
  where f.shipment_id = pg_temp.v('s1')::uuid and t.name = 'Phí hạ'), 'Chuyến đầu chỉ có một dòng trả rỗng 350,000 (sửa không nhân đôi)');
select tests.assert(not exists (select 1 from public.shipment_fees where shipment_id = pg_temp.v('s2')::uuid), 'Chuyến 2 không có dòng phí trả rỗng / cược riêng');
select tests.assert((select pass_through_amount = 850000 from public.shipments where id = pg_temp.v('s1')::uuid), 'Tổng chi hộ chuyến đầu = 850,000');
select tests.assert((select empty_return_state = 'returned' from public.shipments where id = pg_temp.v('s2')::uuid), 'Chuyến 2 đã trả rỗng');

-- Không nối được vào vỏ đã trả rỗng; xóa trắng 4 ô thì bỏ dòng phí
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
do $$ begin
  perform public.set_container_prev((select v::uuid from t_cc where k = 's3'), (select v::uuid from t_cc where k = 's2'));
  raise exception 'FAIL: nối được vào vỏ đã trả rỗng';
exception when sqlstate '22023' then
  if sqlerrm not like '%đã trả rỗng%' then raise exception 'FAIL: lỗi khác: %', sqlerrm; end if;
end $$;
reset role;
set role anon;
select tests.assert((public.driver_link_set_container(pg_temp.v('tok'), pg_temp.v('s2')::uuid, null, null, 500000, 'HD-C1', null) ->> 'ok')::boolean, 'Xóa ô trả rỗng');
reset role;
select tests.assert(not exists (select 1 from public.shipment_fees f join public.fee_types t on t.id = f.fee_type_id where f.shipment_id = pg_temp.v('s1')::uuid and t.name = 'Phí hạ')
  and (select pass_through_amount = 500000 from public.shipments where id = pg_temp.v('s1')::uuid), 'Xóa trắng trả rỗng: bỏ dòng, tổng chi hộ còn 500,000');

\o
\echo '56_tra_rong_cuoc_cont_tests: OK'
