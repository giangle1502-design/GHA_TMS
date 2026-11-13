-- =============================================================================
-- Kiểm thử 0046: hủy chuyến/đơn từ kế hoạch → cont trở về Lập kế hoạch; khôi phục chuyến đã hủy
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
create temp table t_rr (k text primary key, v text);
grant all on t_rr to anon, authenticated;
create or replace function pg_temp.v(key text) returns uuid language sql as $$ select v::uuid from t_rr where k = key $$;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, delivery_date)
values ('10000000-0000-0000-0000-000000000001', 3, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-12-10');
insert into t_rr select 'P', id::text from public.transport_plans where delivery_date = '2026-12-10' and container_qty = 3 order by created_at desc limit 1;
select public.plan_create_orders(pg_temp.v('P'));
insert into t_rr select 's' || row_number() over (order by shipment_code), id::text from public.shipments where plan_id = pg_temp.v('P');
insert into t_rr select 'o1', order_id::text from public.shipments where id = pg_temp.v('s1');

-- Hủy cả đơn của cont 1: cont trở về kế hoạch (dòng trả về), kế hoạch gốc còn 2 cont
select public.cancel_transport_order(pg_temp.v('o1'), 'Khách đổi lịch');
insert into t_rr select 'R', id::text from public.transport_plans where source_plan_id = pg_temp.v('P');
select tests.assert((select status = 'planned' and container_qty = 1 from public.transport_plans where id = pg_temp.v('R')), 'Hủy đơn: cont trở về Lập kế hoạch (chưa tạo đơn)');
select tests.assert((select status = 'ordered' and container_qty = 2 and order_count = 2 from public.transport_plans where id = pg_temp.v('P')), 'Kế hoạch gốc còn 2 cont đang chạy');
select tests.assert((select plan_id from public.shipments where id = pg_temp.v('s1')) = pg_temp.v('R'), 'Chuyến hủy gắn với dòng trả về');

-- Hủy chuyến 2: gom vào cùng dòng trả về
select public.cancel_shipment(pg_temp.v('s2'), 'Hết hàng');
select tests.assert((select container_qty from public.transport_plans where id = pg_temp.v('R')) = 2, 'Hủy thêm chuyến: gom vào dòng trả về (2 cont)');
select tests.assert((select container_qty from public.transport_plans where id = pg_temp.v('P')) = 1, 'Kế hoạch gốc còn 1 cont');

-- Khôi phục chuyến 1: về Chưa phân công, mở lại đơn, cont lấy lại khỏi kế hoạch
select public.restore_shipment(pg_temp.v('s1'));
select tests.assert((select status = 'draft' and cancel_reason is null and driver_id is null from public.shipments where id = pg_temp.v('s1')), 'Khôi phục: chuyến về Chưa phân công');
select tests.assert((select status from public.transport_orders where id = pg_temp.v('o1')) = 'open', 'Khôi phục: đơn hàng mở lại');
select tests.assert((select plan_id from public.shipments where id = pg_temp.v('s1')) = pg_temp.v('P'), 'Chuyến khôi phục gắn lại kế hoạch gốc');
select tests.assert((select container_qty from public.transport_plans where id = pg_temp.v('P')) = 2 and (select container_qty from public.transport_plans where id = pg_temp.v('R')) = 1,
  'Số cont: gốc 2, trả về 1');
select tests.assert(exists (select 1 from public.shipment_status_history where shipment_id = pg_temp.v('s1') and note = 'Khôi phục chuyến đã hủy'), 'Lịch sử ghi khôi phục');
select tests.assert_fails($$select public.restore_shipment(pg_temp.v('s1'))$$, 'Chuyến chưa hủy thì không khôi phục');

-- Hủy hết: kế hoạch gốc trở về đủ 3 cont, dòng trả về được gộp
select public.cancel_shipment(pg_temp.v('s1'), 'Hủy lại');
select public.cancel_shipment(pg_temp.v('s3'), 'Hủy hết');
select tests.assert((select status = 'planned' and container_qty = 3 and order_codes is null from public.transport_plans where id = pg_temp.v('P')), 'Hủy hết: kế hoạch gốc trở về 3 cont');
select tests.assert(not exists (select 1 from public.transport_plans where id = pg_temp.v('R')), 'Dòng trả về được gộp vào kế hoạch gốc');

-- Khôi phục khi kế hoạch còn 3 cont chờ: trừ 1 cont
select public.restore_shipment(pg_temp.v('s2'));
select tests.assert((select container_qty from public.transport_plans where id = pg_temp.v('P')) = 2, 'Khôi phục trừ 1 cont khỏi kế hoạch chờ');
-- Tạo đơn lại rồi khôi phục chuyến cũ: chặn để không trùng
select public.plan_create_orders(pg_temp.v('P'));
select tests.assert_fails($$select public.restore_shipment(pg_temp.v('s3'))$$, 'Cont đã tạo đơn lại thì không khôi phục chuyến cũ');
select tests.assert_fails($$delete from public.transport_plans where id = pg_temp.v('P')$$, 'Kế hoạch đã tạo đơn không xóa được');

-- Xóa kế hoạch đã trở về (có chuyến đã hủy gắn): xóa được, chuyến bỏ liên kết
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, notes)
values ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'xoa-thu');
insert into t_rr select 'P2', id::text from public.transport_plans where notes = 'xoa-thu';
select public.plan_create_orders(pg_temp.v('P2'));
insert into t_rr select 'x1', id::text from public.shipments where plan_id = pg_temp.v('P2');
select public.cancel_shipment(pg_temp.v('x1'), 'Khách bỏ');
select tests.assert((select status from public.transport_plans where id = pg_temp.v('P2')) = 'planned', 'Hủy đơn duy nhất: kế hoạch trở về');
delete from public.transport_plans where id = pg_temp.v('P2');
select tests.assert((select plan_id from public.shipments where id = pg_temp.v('x1')) is null, 'Xóa kế hoạch: chuyến đã hủy bỏ liên kết');
select tests.assert_fails($$update public.shipments set status = 'draft' where id = pg_temp.v('x1')$$, 'Không tự sửa chuyến đã hủy về chưa phân công');
reset role;

set role anon;
select tests.assert_fails($$select public.restore_shipment(pg_temp.v('x1'))$$, 'Người ngoài không khôi phục được');
reset role;
\o
\echo 'TẤT CẢ KIỂM THỬ TRẢ VỀ KẾ HOẠCH, KHÔI PHỤC CHUYẾN ĐỀU ĐẠT'

-- 0047: chuyến hủy kiểu cũ (kế hoạch vẫn "đã tạo đơn") khôi phục được
\o /dev/null
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, notes)
values ('10000000-0000-0000-0000-000000000001', 2, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'kieu-cu');
insert into t_rr select 'L', id::text from public.transport_plans where notes = 'kieu-cu';
select public.plan_create_orders(pg_temp.v('L'));
insert into t_rr select 'l' || row_number() over (order by shipment_code), id::text from public.shipments where plan_id = pg_temp.v('L');
reset role;
-- Giả lập hủy trước bản 0046: tắt trigger trả về
alter table public.shipments disable trigger trg_shipments_plan_on_cancel;
update public.shipments set status = 'cancelled', cancel_reason = 'Đổi kế hoạch' where plan_id = pg_temp.v('L');
alter table public.shipments enable trigger trg_shipments_plan_on_cancel;
set role authenticated;
select public.restore_shipment(pg_temp.v('l1'));
select tests.assert((select status from public.shipments where id = pg_temp.v('l1')) = 'draft', 'Chuyến hủy kiểu cũ khôi phục được');
select tests.assert((select status = 'ordered' and order_count = 1 from public.transport_plans where id = pg_temp.v('L')), 'Kế hoạch cũ cập nhật còn 1 đơn đang chạy');
reset role;
\o
\echo 'KHÔI PHỤC CHUYẾN HỦY KIỂU CŨ ĐẠT'
