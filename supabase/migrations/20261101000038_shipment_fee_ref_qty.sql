-- =============================================================================
-- 0038: Dòng phí của chuyến có thêm Số hóa đơn / Số chứng từ, Số lượng × Đơn giá.
-- - shipment_fees.ref_no: số hóa đơn (phí chi hộ: hạ, nâng, cược) hoặc số chứng từ (tờ khai).
-- - shipment_fees.quantity, unit_price: tùy chọn (bốc xếp). Có đủ cả hai mà để trống số tiền
--   thì số tiền = số lượng × đơn giá. Nhập thẳng số tiền vẫn được như cũ.
-- =============================================================================

alter table public.shipment_fees add column if not exists ref_no text check (ref_no is null or length(ref_no) <= 100);
alter table public.shipment_fees add column if not exists quantity numeric(18, 3) check (quantity is null or quantity >= 0);
alter table public.shipment_fees add column if not exists unit_price numeric(18, 2) check (unit_price is null or unit_price >= 0);

create or replace function public.set_shipment_fees(p_shipment_id uuid, p_fees jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  it jsonb;
  ft public.fee_types;
  n int := 0;
  v_amount numeric;
  v_note text;
  v_type uuid;
  v_decl uuid;
  v_ref text;
  v_qty numeric;
  v_price numeric;
  v_extra numeric := 0;
  v_pass numeric := 0;
begin
  if not (private.has_perm('dispatch.create') or private.has_perm('dispatch.update') or private.has_perm('shipments.update')) then
    raise exception 'Bạn không có quyền nhập phí của chuyến' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = '22023';
  end if;
  if s.status = 'cancelled' then
    raise exception 'Chuyến đã hủy, không sửa phí' using errcode = '22023';
  end if;
  if s.receivable_id is not null then
    raise exception 'Chuyến đã lập công nợ, không được sửa phí. Hủy phiếu công nợ trước.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_fees, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách phí không hợp lệ' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_fees, '[]'::jsonb)) > 100 then
    raise exception 'Mỗi chuyến tối đa 100 dòng phí' using errcode = '22023';
  end if;
  delete from public.shipment_fees where shipment_id = s.id;
  for it in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) loop
    v_amount := nullif(trim(coalesce(it ->> 'amount', '')), '')::numeric;
    v_note := nullif(trim(coalesce(it ->> 'note', '')), '');
    v_type := nullif(trim(coalesce(it ->> 'fee_type_id', '')), '')::uuid;
    v_decl := nullif(trim(coalesce(it ->> 'declaration_type_id', '')), '')::uuid;
    v_ref := nullif(trim(coalesce(it ->> 'ref_no', '')), '');
    v_qty := nullif(trim(coalesce(it ->> 'quantity', '')), '')::numeric;
    v_price := nullif(trim(coalesce(it ->> 'unit_price', '')), '')::numeric;
    continue when v_amount is null and v_type is null and v_note is null and v_decl is null
      and v_ref is null and v_qty is null and v_price is null;
    if (v_qty is not null and v_qty < 0) or (v_price is not null and v_price < 0) then
      raise exception 'Dòng phí % có số lượng hoặc đơn giá âm', n + 1 using errcode = '22023';
    end if;
    if length(v_ref) > 100 then
      raise exception 'Dòng phí % có số hóa đơn / chứng từ quá 100 ký tự', n + 1 using errcode = '22023';
    end if;
    -- Có số lượng và đơn giá mà chưa nhập số tiền: số tiền = số lượng × đơn giá
    if v_amount is null and v_qty is not null and v_price is not null then
      v_amount := v_qty * v_price;
    end if;
    if v_type is null then
      raise exception 'Dòng phí % chưa chọn loại phí', n + 1 using errcode = '22023';
    end if;
    -- Chỉ chọn loại tờ khai, chưa có phí: ghi 0 đ để vẫn lưu loại tờ khai
    if v_amount is null and (v_decl is not null or v_ref is not null) then
      v_amount := 0;
    end if;
    if v_amount is null or v_amount < 0 then
      raise exception 'Dòng phí % chưa nhập số tiền hợp lệ', n + 1 using errcode = '22023';
    end if;
    select * into ft from public.fee_types where id = v_type;
    if ft.id is null then
      raise exception 'Loại phí không tồn tại' using errcode = '22023';
    end if;
    if v_decl is not null and not exists (select 1 from public.declaration_types where id = v_decl) then
      raise exception 'Loại tờ khai không tồn tại' using errcode = '22023';
    end if;
    n := n + 1;
    insert into public.shipment_fees (shipment_id, line_no, fee_type_id, fee_kind, amount, note, declaration_type_id, ref_no, quantity, unit_price)
    values (s.id, n, ft.id, ft.fee_kind, round(v_amount, 0), v_note, v_decl, v_ref, v_qty, v_price);
    if ft.fee_kind = 'pass_through' then v_pass := v_pass + round(v_amount, 0); else v_extra := v_extra + round(v_amount, 0); end if;
  end loop;
  update public.shipments set extra_fee_amount = v_extra, pass_through_amount = v_pass
  where id = s.id and (extra_fee_amount, pass_through_amount) is distinct from (v_extra, v_pass);
  return n;
exception
  when invalid_text_representation then
    raise exception 'Số tiền, số lượng, đơn giá, loại phí hoặc loại tờ khai không hợp lệ' using errcode = '22023';
end;
$$;

revoke all on function public.set_shipment_fees(uuid, jsonb) from public, anon;
grant execute on function public.set_shipment_fees(uuid, jsonb) to authenticated;
