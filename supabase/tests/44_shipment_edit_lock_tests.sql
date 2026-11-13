-- =============================================================================
-- Kiểm thử 0061: một chuyến chỉ một người sửa; người sau chỉ xem, không lưu được
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
\i supabase/migrations/20261104000061_shipment_edit_lock.sql
create temp table t_el (k text primary key, v text);
grant all on t_el to authenticated;
insert into t_el
select 's', id::text from public.shipments where status <> 'cancelled' and receivable_id is null order by created_at limit 1;
insert into t_el select 'ft', id::text from public.fee_types where is_active order by sort_order, code limit 1;
select tests.assert((select count(*) from t_el) = 2, 'Có chuyến và loại phí để thử');
delete from public.shipment_edit_locks;

-- Điều phối (d1) vào sửa chuyến
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((public.shipment_edit_lock((select v::uuid from t_el where k = 's'), 0) ->> 'mine')::boolean, 'Người đầu tiên nhận quyền sửa');
select public.set_shipment_fees((select v::uuid from t_el where k = 's'),
  jsonb_build_array(jsonb_build_object('fee_type_id', (select v from t_el where k = 'ft'), 'amount', '100000')));
select tests.assert((public.shipment_edit_status((select v::uuid from t_el where k = 's')) ->> 'rev')::int = 1, 'Lưu phí: số lần lưu = 1 (một giao dịch đếm 1 lần)');
select tests.assert(not (public.shipment_edit_lock((select v::uuid from t_el where k = 's'), 1) ->> 'stale')::boolean, 'Tự mình lưu: dữ liệu không cũ');
update public.shipments set notes = coalesce(notes, '') where id = (select v::uuid from t_el where k = 's');
select tests.assert((public.shipment_edit_status((select v::uuid from t_el where k = 's')) ->> 'rev')::int = 2, 'Người giữ quyền sửa lưu tiếp được');

-- Kế toán (c1) vào cùng chuyến: chỉ xem
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert(not (public.shipment_edit_lock((select v::uuid from t_el where k = 's'), 2) ->> 'mine')::boolean, 'Người thứ hai không nhận được quyền sửa');
select tests.assert(public.shipment_edit_status((select v::uuid from t_el where k = 's')) ->> 'holder_name' is not null, 'Người thứ hai thấy tên người đang sửa');
select tests.assert_fails($$select public.set_shipment_fees((select v::uuid from t_el where k = 's'), '[]'::jsonb || jsonb_build_array(jsonb_build_object('fee_type_id', (select v from t_el where k = 'ft'), 'amount', '5')))$$,
  'Người thứ hai lưu phí thu khách bị chặn');
select tests.assert((select count(*) from public.shipment_fees where shipment_id = (select v::uuid from t_el where k = 's') and amount = 100000) = 1, 'Phí của người đầu tiên còn nguyên');
select tests.assert((public.shipment_edit_ask((select v::uuid from t_el where k = 's')) ->> 'sent')::boolean, 'Người thứ hai báo người đang sửa thoát ra');
reset role;
select tests.assert(exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000d1' and type = 'shipment.edit_ask'), 'Người đang sửa nhận thông báo');

-- Tài xế (b1) không tham gia khóa (app tài xế vẫn cập nhật chuyến bình thường)
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.assert(not private.shipment_lock_participant(), 'Tài xế không bị khóa sửa chặn');

-- d1 thoát ra → c1 nhận quyền sửa nhưng trang c1 tải từ trước (rev 0) nên dữ liệu cũ
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert(public.shipment_edit_status((select v::uuid from t_el where k = 's')) ->> 'ask_name' is not null, 'Người đang sửa thấy có người chờ');
select public.shipment_edit_unlock((select v::uuid from t_el where k = 's'));
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((public.shipment_edit_lock((select v::uuid from t_el where k = 's'), 0) ->> 'stale')::boolean, 'Người sau vào với trang cũ: báo dữ liệu đã cũ');
select tests.assert_fails($$update public.shipments set notes = coalesce(notes, '') where id = (select v::uuid from t_el where k = 's')$$,
  'Trang cũ: không được lưu ghi đè');
select tests.assert(not (public.shipment_edit_lock((select v::uuid from t_el where k = 's'), 2) ->> 'stale')::boolean, 'Tải lại trang (rev 2): hết cũ');
select public.set_shipment_fees((select v::uuid from t_el where k = 's'), '[]'::jsonb);
select tests.assert(not exists (select 1 from public.shipment_fees where shipment_id = (select v::uuid from t_el where k = 's')), 'Sau khi tải lại, người sau lưu được');
reset role;

-- Quyền sửa tự hết sau 2 phút không báo (mất mạng, tắt tab)
update public.shipment_edit_locks set lock_seen = now() - interval '3 minutes' where shipment_id = (select v::uuid from t_el where k = 's');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert(public.shipment_edit_status((select v::uuid from t_el where k = 's')) ->> 'holder_name' is null, 'Quá 2 phút: không còn ai đang sửa');
select tests.assert((public.shipment_edit_lock((select v::uuid from t_el where k = 's'), 3) ->> 'mine')::boolean, 'Quá 2 phút: người khác nhận được quyền sửa');
select public.shipment_edit_unlock((select v::uuid from t_el where k = 's'));
reset role;
set role anon;
select tests.assert_fails($$select public.shipment_edit_status(gen_random_uuid())$$, 'Khách không đăng nhập không gọi được');
reset role;
delete from public.shipment_edit_locks;

\o
\echo 'TẤT CẢ KIỂM THỬ KHÓA SỬA CHUYẾN ĐỀU ĐẠT'
