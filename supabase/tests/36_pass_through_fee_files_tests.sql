-- =============================================================================
-- Kiểm thử 0053: đính kèm PDF / ảnh hóa đơn cho phí chi hộ (documents.entity_type = shipment_fee)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_ff (k text primary key, v text);
grant all on t_ff to authenticated;
insert into t_ff select 's', id::text from public.shipments where status not in ('cancelled') order by created_at limit 1;
insert into t_ff select 'ft', t.id::text from public.fee_types t where t.fee_kind = 'pass_through' order by t.sort_order limit 1;
select tests.assert((select count(*) from t_ff) = 2, 'Có chuyến và loại phí chi hộ để kiểm thử');

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối (có documents.create, documents.view)
set role authenticated;
insert into public.documents (storage_path, file_name, mime_type, size_bytes, entity_type, entity_id, doc_type, uploaded_by, fee_type_id)
select 'shipment_fee/' || (select v from t_ff where k = 's') || '/' || gen_random_uuid() || '.pdf', 'hoa-don-nang.pdf', 'application/pdf', 1000,
  'shipment_fee', (select v::uuid from t_ff where k = 's'), 'invoice', auth.uid(), (select v::uuid from t_ff where k = 'ft');
select tests.assert((select count(*) from public.documents where entity_type = 'shipment_fee'
  and entity_id = (select v::uuid from t_ff where k = 's') and fee_type_id = (select v::uuid from t_ff where k = 'ft')) = 1,
  'Điều phối đính kèm và xem được hóa đơn PDF của phí chi hộ');
select tests.assert_fails($$insert into public.documents (storage_path, file_name, mime_type, size_bytes, entity_type, entity_id, doc_type, uploaded_by)
  select 'shipment_fee/x/y.pdf', 'a.pdf', 'application/pdf', 10, 'shipment_fee', (select v::uuid from t_ff where k = 's'), 'invoice', auth.uid()$$,
  'Tệp phí chi hộ phải có loại phí');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000f1'); -- chỉ xem báo cáo
set role authenticated;
select tests.assert((select count(*) from public.documents where entity_type = 'shipment_fee') = 0, 'Người không có quyền chứng từ không thấy tệp');
select tests.assert_fails($$insert into public.documents (storage_path, file_name, mime_type, size_bytes, entity_type, entity_id, doc_type, uploaded_by, fee_type_id)
  select 'shipment_fee/a/b.pdf', 'a.pdf', 'application/pdf', 10, 'shipment_fee', (select v::uuid from t_ff where k = 's'), 'invoice', auth.uid(),
  (select v::uuid from t_ff where k = 'ft')$$, 'Người không có quyền chứng từ không đính kèm được');
reset role;

-- Lưu lại phí (xóa và ghi lại dòng phí) không làm mất tệp đã đính kèm
select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select public.set_shipment_fees((select v::uuid from t_ff where k = 's'),
  jsonb_build_array(jsonb_build_object('fee_type_id', (select v from t_ff where k = 'ft'), 'amount', '250000', 'ref_no', 'HD-01')));
select public.set_shipment_fees((select v::uuid from t_ff where k = 's'),
  jsonb_build_array(jsonb_build_object('fee_type_id', (select v from t_ff where k = 'ft'), 'amount', '300000', 'ref_no', 'HD-01')));
reset role;
select tests.assert((select count(*) from public.documents where entity_type = 'shipment_fee' and entity_id = (select v::uuid from t_ff where k = 's')) = 1,
  'Sửa phí chi hộ nhiều lần vẫn giữ tệp hóa đơn');

-- dọn dẹp
delete from public.documents where entity_type = 'shipment_fee';
\o
\echo 'TẤT CẢ KIỂM THỬ ĐÍNH KÈM HÓA ĐƠN PHÍ CHI HỘ ĐỀU ĐẠT'
