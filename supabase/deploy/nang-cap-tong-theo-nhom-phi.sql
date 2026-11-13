-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Phí vận chuyển, chi hộ, tờ khai, bốc xếp trên Quản lý chuyến; công thức tính tiền
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.shipment_fee_role_totals') is not null then
    raise exception 'CSDL đã được nâng cấp Phí vận chuyển, chi hộ, tờ khai, bốc xếp trên Quản lý chuyến; công thức tính tiền trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261101000037_shipment_fee_role_totals.sql
-- =============================================================================
-- 0037: Thẻ tổng ở Quản lý chuyến xe theo nhóm phí (yêu cầu người dùng 01/11/2026):
--   Phí vận chuyển = cước (đơn giá × số lượng) + phụ phí + hỗ trợ dầu + phí thuộc nhóm vai trò freight
--                    (phụ thu vé, hạ rỗng xa + BOT, neo xe)
--   Phí chi hộ, Phí tờ khai, Phí bốc xếp, Phí khác = tổng các dòng phí thuộc nhóm tương ứng.
-- - shipment_list thêm các cột trên (bảng Quản lý chuyến xe, tìm kiếm nâng cao).
-- - Doanh thu = Phí vận chuyển + phí "Tính doanh thu" ngoài nhóm vận chuyển (tờ khai...). Chi hộ, bốc xếp chỉ vào
--   Khách phải trả: loại phí nhóm Bốc xếp chuyển sang cách tính Chi hộ (dòng phí đã nhập giữ nguyên cách tính cũ).
-- Công thức do người dùng tự thiết lập qua Danh mục: Nhóm phí (vai trò) và Loại phí thu khách (nhóm, cách tính).
-- =============================================================================

update public.fee_types ft set fee_kind = 'pass_through'
from public.fee_groups g
where g.id = ft.fee_group_id and g.report_role in ('loading', 'pass_through') and ft.fee_kind <> 'pass_through';

-- Tổng phí từng chuyến theo vai trò nhóm (theo quyền xem chuyến của người gọi)
create or replace view public.shipment_fee_role_totals with (security_invoker = true) as
select s.id as shipment_id,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount
         + coalesce(sum(sf.amount) filter (where g.report_role = 'freight'), 0) as transport_fee,
       coalesce(sum(sf.amount) filter (where g.report_role = 'pass_through'), 0) as pass_through_fee,
       coalesce(sum(sf.amount) filter (where g.report_role = 'declaration'), 0) as declaration_fee,
       coalesce(sum(sf.amount) filter (where g.report_role = 'loading'), 0) as loading_fee,
       coalesce(sum(sf.amount) filter (where sf.id is not null and coalesce(g.report_role, 'other') = 'other'), 0) as other_fee
from public.shipments s
left join public.shipment_fees sf on sf.shipment_id = s.id
left join public.fee_types ft on ft.id = sf.fee_type_id
left join public.fee_groups g on g.id = ft.fee_group_id
group by s.id;
revoke all on public.shipment_fee_role_totals from anon;
grant select on public.shipment_fee_role_totals to authenticated;

-- Bảng chuyến: thêm tổng theo nhóm phí (cột mới ở cuối view)
create or replace view public.shipment_list with (security_invoker = true) as
select
  s.id, s.shipment_code, s.order_id, o.order_code, s.sequence_in_order,
  o.customer_id, c.name as customer_name, c.code as customer_code,
  s.pickup_at, s.expected_delivery_at,
  s.pickup_location_id, pl.name as pickup_name,
  s.delivery_location_id, dl.name as delivery_name,
  s.vehicle_type_id, vt.name as vehicle_type_name,
  s.vehicle_id, v.plate_number,
  s.driver_id, d.full_name as driver_name, d.code as driver_code,
  s.price_list_id, s.unit_price, s.pricing_unit, s.quantity, s.freight_amount, s.surcharge_amount,
  s.fuel_support_rate, s.fuel_support_base, s.fuel_support_amount,
  s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as total_revenue,
  s.status, s.document_status, s.settlement_status,
  s.notes, s.version, s.created_at, s.updated_at,
  s.custom_fields, o.custom_fields as order_custom_fields,
  s.vehicle_day_order,
  s.extra_fee_amount, s.pass_through_amount,
  s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due,
  s.dispatch_approval, s.dispatch_approval_request_id,
  s.dispatch_reject_reason,
  (s.dispatch_approval = 'pending' and s.dispatch_approval_request_id is not null
     and private.can_approve(s.dispatch_approval_request_id)) as can_approve_dispatch,
  coalesce(ft.transport_fee, s.freight_amount + s.surcharge_amount + s.fuel_support_amount) as transport_fee,
  coalesce(ft.pass_through_fee, 0) as pass_through_fee,
  coalesce(ft.declaration_fee, 0) as declaration_fee,
  coalesce(ft.loading_fee, 0) as loading_fee,
  coalesce(ft.other_fee, 0) as other_fee
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join lateral (select * from public.shipment_fee_role_totals t where t.shipment_id = s.id) ft on true;

create or replace function public.shipment_list_summary(p_from timestamptz, p_to timestamptz, p_customer_id uuid default null, p_q text default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select l.* from public.shipment_list l
    where l.pickup_at >= p_from and l.pickup_at < p_to
      and (p_customer_id is null or l.customer_id = p_customer_id)
      and (coalesce(p_q, '') = '' or concat_ws(' ', l.shipment_code, l.order_code, l.customer_name, l.plate_number, l.driver_name, l.pickup_name, l.delivery_name) ilike '%' || p_q || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'by_status', (select coalesce(jsonb_object_agg(status, jsonb_build_object(
        'count', n, 'freight', freight, 'surcharge', surcharge, 'fuel', fuel, 'revenue', revenue,
        'transport', transport, 'pass_through', pass_through, 'declaration', declaration, 'loading', loading, 'other', other)), '{}'::jsonb)
      from (select status, count(*) as n, sum(freight_amount) as freight, sum(surcharge_amount) as surcharge,
                   sum(fuel_support_amount) as fuel, sum(total_revenue) as revenue,
                   coalesce(sum(transport_fee), 0) as transport, coalesce(sum(pass_through_fee), 0) as pass_through,
                   coalesce(sum(declaration_fee), 0) as declaration, coalesce(sum(loading_fee), 0) as loading,
                   coalesce(sum(other_fee), 0) as other
            from f group by status) x)
  );
$$;
revoke all on function public.shipment_list_summary(timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.shipment_list_summary(timestamptz, timestamptz, uuid, text) to authenticated;

commit;
