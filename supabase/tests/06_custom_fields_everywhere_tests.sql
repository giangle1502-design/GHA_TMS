-- =============================================================================
-- Kiểm thử trường bổ sung cho mọi biểu mẫu (0015). Chạy sau 05.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

select tests.assert(
  (select count(*) from unnest(array['vehicle_types','routes','price_lists','fuel_rules','expense_categories','banks','payment_methods','company_entities','salary_rules','maintenance_records','catalog_items']) m
    where private.custom_field_table(m) is null) = 0,
  'Mọi danh mục đều nhận trường bổ sung');
insert into public.field_definitions (module, field_key, label, data_type) values ('vehicle_types', 'so_truc', 'Số trục', 'integer');
select tests.assert(exists (select 1 from public.field_definitions where module = 'vehicle_types' and field_key = 'so_truc'), 'Tạo được trường bổ sung cho loại xe');
update public.vehicle_types set custom_fields = '{"so_truc": 3}' where id = '30000000-0000-0000-0000-000000000001';
select tests.assert((select custom_fields ->> 'so_truc' from public.vehicle_types where id = '30000000-0000-0000-0000-000000000001') = '3', 'Lưu được giá trị trường bổ sung của loại xe');
select tests.assert_fails($$update public.vehicle_types set custom_fields = '[]'$$, 'Trường bổ sung phải là đối tượng JSON');

create temp table t_cf (k text primary key, v jsonb);
grant all on t_cf to authenticated;
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into t_cf values ('o', public.create_transport_order(
  '{"customer_id":"10000000-0000-0000-0000-000000000001","custom_fields":{"so_po":"PO-7788"}}',
  '[{"pickup_at":"2026-10-23T08:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000","custom_fields":{"so_cont":"TGHU1234567"}}]'));
select tests.assert(
  (select custom_fields ->> 'so_cont' from public.shipment_list where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_cf where k = 'o')) = 'TGHU1234567',
  'Tạo chuyến kèm trường bổ sung, danh sách chuyến trả về giá trị');
select tests.assert(
  (select order_custom_fields ->> 'so_po' from public.shipment_list where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_cf where k = 'o')) = 'PO-7788',
  'Tạo đơn hàng kèm trường bổ sung');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ TRƯỜNG BỔ SUNG ĐỀU ĐẠT'
