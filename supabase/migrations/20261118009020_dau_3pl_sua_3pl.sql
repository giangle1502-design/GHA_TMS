-- =============================================================================
-- GHA 9020: % HỖ TRỢ DẦU CỦA 3PL + SỬA 3PL CHO CHUYẾN ĐÃ HOÀN THÀNH (18/11/2026)
--   1. Nhà cung cấp (nhà xe 3PL) có ô "% hỗ trợ dầu" (suppliers.fuel_support_pct).
--      Nhập chi phí 3PL: dòng Cước 3PL tự lấy % dầu của nhà xe,
--      Số tiền = SL × Đơn giá × (1 + % dầu / 100) (giống công thức cước GHA). Sửa được từng dòng.
--      % dầu từng dòng lưu ở shipment_carrier_costs.fuel_pct để đối chiếu sau.
--   2. "Sửa xe, TX" (chuyến đang chạy / đã giao / đã đóng) sửa được cả Nhà xe 3PL của chuyến.
--      Đầu kéo, tài xế chạy cho nhiều 3PL nên KHÔNG đổi nhà xe mặc định của xe.
--      Công nợ phải trả 3PL của chuyến tự chuyển sang nhà xe đúng (đã trả tiền nhà xe cũ thì chặn).
--   Chạy lại nhiều lần không sao. Tài khoản khách hàng vẫn không đọc được nhà xe, chi phí 3PL.
-- =============================================================================

-- 1. % hỗ trợ dầu ------------------------------------------------------------
alter table public.suppliers add column if not exists fuel_support_pct numeric(6, 2)
  check (fuel_support_pct is null or (fuel_support_pct >= 0 and fuel_support_pct <= 100));
comment on column public.suppliers.fuel_support_pct is
  '% hỗ trợ dầu của nhà xe 3PL: tự áp vào dòng Cước 3PL (Số tiền = SL × Đơn giá × (1 + %/100)). Trống = không có';

alter table public.shipment_carrier_costs add column if not exists fuel_pct numeric(6, 2)
  check (fuel_pct is null or (fuel_pct >= 0 and fuel_pct <= 100));
comment on column public.shipment_carrier_costs.fuel_pct is
  '% hỗ trợ dầu áp vào dòng cước 3PL này (amount đã gồm hỗ trợ dầu)';

-- Nhập chi phí 3PL: nhận thêm lines[].fuel_pct (chỉ dòng cước)
create or replace function public.set_shipment_carrier_costs(
  p_shipment_id uuid, p_supplier_id uuid, p_lines jsonb, p_invoice_no text default null, p_due_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  it jsonb;
  n int := 0;
  v_kind text;
  v_amount numeric;
  v_qty numeric;
  v_price numeric;
  v_fuel numeric;
  v_desc text;
  v_type uuid;
  v_type_name text;
  v_line_supplier uuid;
  v_payable uuid;
  v_total numeric := 0;
  v_carrier_total numeric := 0;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('shipments.update') or private.has_perm('receivables.create')) then
    raise exception 'Bạn không có quyền nhập chi phí 3PL' using errcode = '42501';
  end if;
  if not private.can_view_3pl() then
    raise exception 'Bạn không có quyền xem/nhập chi phí 3PL' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = '22023';
  end if;
  if s.status = 'cancelled' then
    raise exception 'Chuyến đã hủy, không nhập chi phí 3PL' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Không tìm thấy nhà xe' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách khoản không hợp lệ' using errcode = '22023';
  end if;

  update public.shipments set carrier_supplier_id = p_supplier_id where id = s.id and carrier_supplier_id is distinct from p_supplier_id;
  delete from public.shipment_carrier_costs where shipment_id = s.id;
  for it in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_kind := coalesce(nullif(it->>'kind', ''), 'freight');
    if v_kind not in ('freight', 'pass_through', 'other') then
      raise exception 'Loại khoản không hợp lệ: %', v_kind using errcode = '22023';
    end if;
    v_qty := nullif(it->>'quantity', '')::numeric;
    v_price := nullif(it->>'unit_price', '')::numeric;
    v_fuel := case when v_kind = 'freight' then nullif(nullif(it->>'fuel_pct', '')::numeric, 0) end;
    if v_fuel is not null and (v_fuel < 0 or v_fuel > 100) then
      raise exception '%% hỗ trợ dầu phải từ 0 đến 100' using errcode = '22023';
    end if;
    v_amount := coalesce(nullif(it->>'amount', '')::numeric,
                         case when v_qty is not null and v_price is not null
                              then round(v_qty * v_price * (1 + coalesce(v_fuel, 0) / 100), 0) end);
    continue when coalesce(v_amount, 0) = 0;
    if v_amount < 0 then
      raise exception 'Số tiền không được âm' using errcode = '22023';
    end if;
    v_type := nullif(it->>'fee_type_id', '')::uuid;
    v_type_name := null;
    if v_type is not null then
      select name into v_type_name from public.fee_types where id = v_type;
      if v_type_name is null then
        raise exception 'Không tìm thấy loại phí' using errcode = '22023';
      end if;
    end if;
    v_line_supplier := nullif(it->>'supplier_id', '')::uuid;
    if v_line_supplier is not null and not exists (select 1 from public.suppliers where id = v_line_supplier) then
      raise exception 'Không tìm thấy đơn vị 3PL của khoản "%"', coalesce(v_type_name, it->>'description') using errcode = '22023';
    end if;
    if v_line_supplier = p_supplier_id then
      v_line_supplier := null;
    end if;
    v_desc := coalesce(nullif(trim(coalesce(it->>'description', '')), ''), v_type_name,
                       case v_kind when 'freight' then 'Cước 3PL' when 'pass_through' then 'Chi hộ 3PL' else 'Chi phí khác 3PL' end);
    n := n + 1;
    if n > 100 then
      raise exception 'Tối đa 100 khoản cho một chuyến' using errcode = '22023';
    end if;
    insert into public.shipment_carrier_costs (shipment_id, line_no, cost_kind, fee_type_id, description, quantity, unit_price, fuel_pct, amount, ref_no, note, supplier_id)
    values (s.id, n, v_kind, v_type, left(v_desc, 200), v_qty, v_price, v_fuel, v_amount,
            nullif(left(trim(coalesce(it->>'ref_no', '')), 100), ''), nullif(left(trim(coalesce(it->>'note', '')), 500), ''), v_line_supplier);
    v_total := v_total + v_amount;
    if v_line_supplier is null then
      v_carrier_total := v_carrier_total + v_amount;
    end if;
  end loop;

  if v_carrier_total > 0 and p_supplier_id is null then
    raise exception 'Chọn nhà xe 3PL nhận tiền (hoặc chọn đơn vị 3PL cho từng khoản)' using errcode = '22023';
  end if;
  v_payable := private.sync_carrier_payable(s.id, p_invoice_no, p_due_date);
  return jsonb_build_object('lines', n, 'total', v_total, 'payable_id', v_payable,
                            'payable_code', (select code from public.payables where id = v_payable));
end;
$$;
revoke all on function public.set_shipment_carrier_costs(uuid, uuid, jsonb, text, date) from public, anon;
grant execute on function public.set_shipment_carrier_costs(uuid, uuid, jsonb, text, date) to authenticated;

-- 2. Sửa xe, tài xế, nhà xe 3PL của chuyến đang chạy / đã giao / đã đóng ---------
-- p_set_supplier = true: ghi Nhà xe 3PL của chuyến = p_supplier_id (null = chuyến chạy xe nội bộ, bỏ nhà xe).
-- p_set_supplier = false: giữ nhà xe như cũ (gọi kiểu cũ 4 tham số).
drop function if exists public.correct_shipment_crew(uuid, uuid, uuid, text);
create or replace function public.correct_shipment_crew(
  p_shipment_id uuid, p_vehicle_id uuid, p_driver_id uuid, p_reason text,
  p_supplier_id uuid default null, p_set_supplier boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_month date;
  v_name text;
  v_moved integer := 0;
  v_crew_changed boolean;
  v_sup_changed boolean;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('shipments.update')) then
    raise exception 'Bạn không có quyền sửa chuyến' using errcode = '42501';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Nhập lý do sửa (ít nhất 3 ký tự), ví dụ: Nhập nhầm tài xế' using errcode = '22023';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if s.status not in ('in_transit', 'driver_completed', 'closed') then
    raise exception 'Chuyến chưa chạy thì dùng nút Phân công / Đổi để đổi xe, tài xế' using errcode = '22023';
  end if;
  perform private.check_crew(p_vehicle_id, p_driver_id, false);

  v_crew_changed := p_vehicle_id is distinct from s.vehicle_id or p_driver_id is distinct from s.driver_id;
  v_sup_changed := p_set_supplier and p_supplier_id is distinct from s.carrier_supplier_id;
  if v_sup_changed and not private.can_view_3pl() then
    raise exception 'Bạn không có quyền sửa nhà xe 3PL' using errcode = '42501';
  end if;
  if v_sup_changed and p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Không tìm thấy nhà xe 3PL' using errcode = '22023';
  end if;
  if v_sup_changed and p_supplier_id is null and exists (
    select 1 from public.shipment_carrier_costs where shipment_id = s.id and supplier_id is null
  ) then
    raise exception 'Chuyến đã nhập chi phí trả 3PL. Muốn chuyển sang xe nội bộ thì xóa chi phí 3PL của chuyến trước (hoặc chọn nhà xe 3PL đúng).' using errcode = '22023';
  end if;
  if not v_crew_changed and not v_sup_changed then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  if p_driver_id is distinct from s.driver_id and s.completed_at is not null then
    v_month := date_trunc('month', s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date;
    select d.full_name into v_name
    from public.driver_payrolls p join public.drivers d on d.id = p.driver_id
    where p.driver_id in (s.driver_id, p_driver_id) and p.period_month = v_month
      and p.status not in ('cancelled', 'rejected')
    limit 1;
    if v_name is not null then
      raise exception 'Bảng lương tháng % của tài xế % đã lập (tính theo số chuyến). Hủy bảng lương đó trước rồi mới sửa tài xế.',
        to_char(v_month, 'MM/YYYY'), v_name using errcode = '22023';
    end if;
  end if;

  perform set_config('gha.audit_reason', 'Sửa xe, tài xế: ' || v_reason, true);
  if v_crew_changed then
    update public.shipments
       set vehicle_id = p_vehicle_id, driver_id = p_driver_id,
           vehicle_day_order = case when p_vehicle_id is distinct from s.vehicle_id then null else vehicle_day_order end
     where id = s.id;
    update public.shipment_assignments set driver_id = p_driver_id, vehicle_id = p_vehicle_id
     where shipment_id = s.id and response = 'accepted';
    if p_driver_id is distinct from s.driver_id then
      update public.shipment_expenses e set driver_id = p_driver_id
       where e.shipment_id = s.id and e.driver_id = s.driver_id and e.paid_by = 'driver'
         and e.payroll_id is null and e.status not in ('cancelled', 'rejected');
      get diagnostics v_moved = row_count;
    end if;
  end if;
  if v_sup_changed then
    -- Chỉ đổi nhà xe của CHUYẾN; nhà xe mặc định của xe giữ nguyên (xe chạy cho nhiều 3PL)
    update public.shipments set carrier_supplier_id = p_supplier_id where id = s.id;
    -- Công nợ trả 3PL của chuyến đi theo nhà xe đúng (đã trả nhà xe cũ thì báo lỗi, không đổi)
    perform private.sync_carrier_payable(s.id);
  end if;
  perform set_config('gha.audit_reason', '', true);
  return jsonb_build_object('ok', true, 'changed', true, 'expenses_moved', v_moved, 'supplier_changed', v_sup_changed);
end;
$$;
revoke all on function public.correct_shipment_crew(uuid, uuid, uuid, text, uuid, boolean) from public, anon;
grant execute on function public.correct_shipment_crew(uuid, uuid, uuid, text, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
