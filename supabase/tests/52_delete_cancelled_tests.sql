-- =============================================================================
-- Kiểm thử 0070: xóa vĩnh viễn chuyến đã hủy
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
\i supabase/migrations/20261111000070_delete_cancelled_shipments.sql
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
create temp table t_dc (k text primary key, v text);
grant all on t_dc to anon, authenticated;
create or replace function pg_temp.v(key text) returns uuid language sql as $$ select v::uuid from t_dc where k = key $$;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, delivery_date, notes)
values ('10000000-0000-0000-0000-000000000001', 3, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-12-20', 'xoa-chuyen-huy');
insert into t_dc select 'P', id::text from public.transport_plans where notes = 'xoa-chuyen-huy' order by created_at desc limit 1;
select public.plan_create_orders(pg_temp.v('P'));
insert into t_dc select 's' || row_number() over (order by shipment_code), id::text from public.shipments where plan_id = pg_temp.v('P');
insert into t_dc select 'o1', order_id::text from public.shipments where id = pg_temp.v('s1');
insert into t_dc select 'o3', order_id::text from public.shipments where id = pg_temp.v('s3');
select public.cancel_shipment(pg_temp.v('s1'), 'Khách hủy');
select public.cancel_shipment(pg_temp.v('s2'), 'Khách hủy');

select tests.assert_fails($$select public.delete_cancelled_shipments(array[pg_temp.v('s1')], 'xoa nham')$$, 'Sai chữ xác nhận thì không xóa');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert_fails($$select public.delete_cancelled_shipments(array[pg_temp.v('s1')], 'XOA')$$, 'Tài xế không có quyền xóa');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into t_dc select 'r', public.delete_cancelled_shipments(array[pg_temp.v('s1'), pg_temp.v('s2'), pg_temp.v('s3')], 'xoa')::text;
reset role;
select tests.assert((select (v::jsonb ->> 'deleted')::int from t_dc where k = 'r') = 2, 'Xóa 2 chuyến đã hủy');
select tests.assert((select v::jsonb -> 'skipped' -> 0 ->> 'reason' from t_dc where k = 'r') = 'chưa ở trạng thái Đã hủy', 'Chuyến chưa hủy được giữ lại kèm lý do');
select tests.assert(not exists (select 1 from public.shipments where id in (pg_temp.v('s1'), pg_temp.v('s2'))), 'Chuyến hủy đã bị xóa');
select tests.assert(exists (select 1 from public.shipments where id = pg_temp.v('s3') and status <> 'cancelled'), 'Chuyến đang chạy còn nguyên');
select tests.assert(not exists (select 1 from public.shipment_status_history where shipment_id in (pg_temp.v('s1'), pg_temp.v('s2'))), 'Lịch sử trạng thái xóa kèm');
select tests.assert(pg_temp.v('o1') = pg_temp.v('o3') or not exists (select 1 from public.transport_orders where id = pg_temp.v('o1')), 'Đơn không còn chuyến bị xóa');
select tests.assert(exists (select 1 from public.audit_logs where action = 'shipments.delete_cancelled'), 'Ghi nhật ký tổng hợp');
select tests.assert(exists (select 1 from public.audit_logs where action ilike '%delete%' and entity_type = 'shipments' and entity_id = pg_temp.v('s1')::text), 'Nhật ký ghi từng chuyến bị xóa');
-- Xóa trực tiếp (không qua hàm) chuyến đã hủy vẫn bị chặn
select public.cancel_shipment(pg_temp.v('s3'), 'Hủy nốt');
select tests.assert_fails($$delete from public.shipments where id = pg_temp.v('s3')$$, 'Không xóa thẳng chuyến hủy ngoài hàm');

\o
\echo '0070 xóa chuyến hủy: OK'
