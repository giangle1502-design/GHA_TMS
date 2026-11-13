-- =============================================================================
-- KHÁNH HÀ TMS - 0024: Khách thanh toán mặc định của khách hàng (khách hàng yêu cầu 30/10/2026)
--   Thiết lập một lần trong hồ sơ khách hàng; form Tạo đơn hàng tự điền "Khách thanh toán", vẫn đổi được.
-- =============================================================================

alter table public.customers
  add column default_payer_customer_id uuid references public.customers (id) on delete set null;

comment on column public.customers.default_payer_customer_id is 'Đơn vị thanh toán mặc định khi tạo đơn cho khách hàng này (trống = chính khách hàng)';

create index customers_default_payer_idx on public.customers (default_payer_customer_id) where default_payer_customer_id is not null;
