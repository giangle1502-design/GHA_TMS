-- =============================================================================
-- GHA 9031: CỔNG NHÀ XE 3PL – GỢI Ý XE, TÀI XẾ ĐÃ NHẬP (LE 19/11/2026)
--   Xe, tài xế 3PL đã được lưu vào danh mục từ lần đăng ký trước (9030); hàm dưới trả danh sách đó
--   để trang /nha-xe gợi ý khi gõ số xe / tên tài xế và tự điền tài xế, SĐT, CCCD theo xe.
-- =============================================================================

-- Xe, tài xế nhà xe đã nhập trước đây: gợi ý khi gõ ở cổng 3PL (LE 19/11: không phải nhập lại mỗi lần)
--   Số CCCD chỉ trả cho chính tài khoản 3PL (họ tự nhập) hoặc người có quyền xem thông tin nhạy cảm tài xế.
create or replace function public.carrier_portal_fleet(p_supplier_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sup uuid[] := private.portal_supplier_ids(p_supplier_id);
  v_nid boolean := private.is_supplier_scoped() or private.has_perm('drivers.view_sensitive');
begin
  if cardinality(v_sup) = 0 then
    return jsonb_build_object('vehicles', '[]'::jsonb, 'drivers', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'vehicles', coalesce((
      select jsonb_agg(jsonb_build_object('plate', v.plate_number, 'driver_id', v.assigned_driver_id) order by v.plate_number)
      from public.vehicles v
      where v.supplier_id = any(v_sup) and v.archived_at is null and v.status in ('active', 'maintenance')
    ), '[]'::jsonb),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.full_name, 'phone', d.phone,
                                          'national_id', case when v_nid then ds.national_id end,
                                          'last_plate', (select v.plate_number from public.shipments s join public.vehicles v on v.id = s.vehicle_id
                                                          where s.driver_id = d.id and s.status <> 'cancelled' order by s.pickup_at desc limit 1))
                       order by d.full_name)
      from public.drivers d
      left join public.driver_sensitive ds on ds.driver_id = d.id
      where d.is_outsourced and d.supplier_id = any(v_sup) and d.archived_at is null and d.status = 'active'
        and d.full_name not like 'Tài xế 3PL %' and d.full_name <> 'Tài xế & 3PL'
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.carrier_portal_fleet(uuid) from public, anon;
grant execute on function public.carrier_portal_fleet(uuid) to authenticated;
