-- =============================================================================
-- GHA-TMS 9004: BẬT LẠI các kiểm tra nghiệp vụ trên chuyến/đơn hàng.
-- Lần nhập dữ liệu cũ (9002) đã tắt chúng và không bật lại, nên trên CSDL thật:
--   * Hỗ trợ dầu không tự tính (Đơn giá × SL × % dầu) khi nhập/sửa giá → hiện 0 đ
--   * Khóa sửa chuyến đã chốt/đã lên công nợ, duyệt điều phối, lịch sử trạng thái không chạy.
-- File này bật lại tất cả rồi tính lại tiền hỗ trợ dầu của các chuyến bị sai. Chạy lại không sao.
-- =============================================================================
alter table public.transport_orders enable trigger trg_transport_orders_guard;
alter table public.shipments enable trigger trg_shipments_guard;
alter table public.shipments enable trigger trg_shipments_edit_lock;
alter table public.shipments enable trigger trg_shipments_billed_guard;
alter table public.shipments enable trigger trg_shipments_dispatch_approval;
alter table public.shipments enable trigger trg_shipments_submit_dispatch_approval;
alter table public.shipments enable trigger trg_shipments_end_on_behalf;
alter table public.shipments enable trigger trg_shipments_pricing;
alter table public.shipments enable trigger trg_shipments_history;
alter table public.shipment_items enable trigger trg_shipment_items_edit_lock;
alter table public.shipment_fees enable trigger trg_shipment_fees_edit_lock;

-- Tính lại hỗ trợ dầu cho chuyến có % dầu nhưng số tiền lệch công thức.
-- Chỉ chạy riêng trigger tính giá (các kiểm tra khác giữ nguyên, không đụng chuyến đúng).
do $$
declare
  n int;
begin
  perform set_config('gha.system_op', 'on', true);
  alter table public.shipments disable trigger trg_shipments_edit_lock;
  alter table public.shipments disable trigger trg_shipments_billed_guard;
  alter table public.shipments disable trigger trg_shipments_guard;
  alter table public.shipments disable trigger trg_shipments_history;

  -- Chuyến chuyển từ app cũ chưa có cơ sở tính: tính trên doanh thu cước (đơn giá × SL), như app cũ
  update public.shipments s
     set fuel_support_base = 'freight_revenue'
   where s.fuel_support_rate is not null and s.fuel_support_base is null;

  update public.shipments s
     set fuel_support_rate = s.fuel_support_rate
   where s.fuel_support_rate is not null
     and s.fuel_support_base in ('freight_revenue', 'unit_price', 'total_revenue')
     and s.fuel_support_amount is distinct from round(
           case s.fuel_support_base
             when 'freight_revenue' then round(s.unit_price * s.quantity, 0)
             when 'unit_price' then s.unit_price
             else round(s.unit_price * s.quantity, 0) + s.surcharge_amount
           end * s.fuel_support_rate / 100, 0);
  get diagnostics n = row_count;
  raise notice 'Đã tính lại hỗ trợ dầu cho % chuyến', n;

  alter table public.shipments enable trigger trg_shipments_edit_lock;
  alter table public.shipments enable trigger trg_shipments_billed_guard;
  alter table public.shipments enable trigger trg_shipments_guard;
  alter table public.shipments enable trigger trg_shipments_history;
end;
$$;
