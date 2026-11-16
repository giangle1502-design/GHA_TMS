-- =============================================================================
-- GHA 9013: Sổ hóa đơn có trường bổ sung tự thêm (LE yêu cầu 16/11/2026)
--   * tax_invoices.custom_fields: lưu giá trị các trường LE tự thêm (Cài đặt trường / nút "Thêm trường" trên biểu mẫu).
--   * custom_field_table: cho phép module 'tax_invoices'.
-- Không xóa, không sửa dữ liệu có sẵn.
-- =============================================================================
alter table public.tax_invoices
  add column if not exists custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object');

CREATE OR REPLACE FUNCTION private.custom_field_table(p_module text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_module
    when 'vehicles' then 'vehicles'
    when 'drivers' then 'drivers'
    when 'customers' then 'customers'
    when 'suppliers' then 'suppliers'
    when 'locations' then 'locations'
    when 'shipments' then 'shipments'
    when 'transport_orders' then 'transport_orders'
    when 'vehicle_types' then 'vehicle_types'
    when 'routes' then 'routes'
    when 'price_lists' then 'transport_price_lists'
    when 'fuel_rules' then 'fuel_support_rules'
    when 'expense_categories' then 'expense_categories'
    when 'expense_groups' then 'expense_groups'
    when 'banks' then 'banks'
    when 'payment_methods' then 'payment_methods'
    when 'company_entities' then 'company_entities'
    when 'salary_rules' then 'salary_rules'
    when 'maintenance_records' then 'maintenance_records'
    when 'catalog_items' then 'catalog_items'
    when 'advances' then 'advance_requests'
    when 'expenses' then 'shipment_expenses'
    when 'payrolls' then 'driver_payrolls'
    when 'receivables' then 'receivables'
    when 'payables' then 'payables'
    when 'shipment_items' then 'shipment_items'
    when 'fee_types' then 'fee_types'
    when 'fee_groups' then 'fee_groups'
    when 'declaration_types' then 'declaration_types'
    when 'leaves' then 'leave_requests'
    when 'purchase_requests' then 'purchase_requests'
    when 'purchase_request_types' then 'purchase_request_types'
    when 'tasks' then 'tasks'
    when 'transport_plans' then 'transport_plans'
    when 'pay_zones' then 'pay_zones'
    when 'trip_pay_rates' then 'trip_pay_rates'
    when 'pay_components' then 'pay_components'
    when 'driver_pay_components' then 'driver_pay_components'
    when 'pay_holidays' then 'pay_holidays'
    when 'products' then 'products'
    when 'order_items' then 'transport_order_items'
    when 'overhead_expenses' then 'overhead_expenses'
    when 'overhead_categories' then 'overhead_categories'
    when 'tax_invoices' then 'tax_invoices'
  end;
$function$;
