-- =============================================================================
-- GHA 9017: Chống nhập nhầm cont khi trả rỗng / cược cont (LE, 17/11/2026)
--   * Hai cont cùng điểm nhận, điểm giao: app tài xế hiện SỐ CONT to trên thẻ và trong ô nhập để tài xế
--     đối chiếu với hóa đơn.
--   * Chuyến chưa có số cont: tài xế phải nhập số cont (đúng chuẩn ISO 6346: 4 chữ + 7 số, số cuối là số
--     kiểm tra) khi nhập trả rỗng / cược; số cont được ghi vào chuyến.
--   * Chuyến đã có số cont: tài xế gõ số cont khác → báo lỗi, gọi điều phối sửa.
--   * Một số hóa đơn trả rỗng / cược chỉ nhập cho một chuỗi vỏ: trùng số HĐ ở chuyến khác → báo lỗi.
--   * Xe 3PL nhập được (nhắc lại 9008b cho CSDL chưa chạy bản sửa).
-- Không xóa dữ liệu. Chạy lại nhiều lần không lỗi.
-- =============================================================================

-- Kiểm tra số cont theo ISO 6346 (số kiểm tra cuối)
create or replace function private.container_no_valid(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
  vals int[] := array[10,12,13,14,15,16,17,18,19,20,21,23,24,25,26,27,28,29,30,31,32,34,35,36,37,38];
  ch text;
  n int;
  total int := 0;
  i int;
begin
  if v !~ '^[A-Z]{4}[0-9]{7}$' then
    return false;
  end if;
  for i in 1..10 loop
    ch := substr(v, i, 1);
    if i <= 4 then
      n := vals[ascii(ch) - 64];
    else
      n := ch::int;
    end if;
    total := total + n * (2 ^ (i - 1))::int;
  end loop;
  return (total % 11) % 10 = substr(v, 11, 1)::int;
end;
$$;
revoke all on function private.container_no_valid(text) from public, anon;
grant execute on function private.container_no_valid(text) to authenticated;

drop function if exists public.driver_link_set_container(text, uuid, numeric, text, numeric, text, text);

create or replace function public.driver_link_containers(p_token text)
returns table (
  shipment_id uuid, container_no text, empty_return_state text, prev_code text, next_code text,
  root_id uuid, root_code text, empty_amount numeric, empty_ref text, deposit_amount numeric, deposit_ref text, locked boolean
)
language sql
security definer
set search_path = ''
as $$
  select s.id, coalesce(s.container_no, r.container_no), s.empty_return_state,
         p.shipment_code, n.shipment_code, r.id, r.shipment_code,
         (fx ->> 'empty_amount')::numeric, fx ->> 'empty_ref', (fx ->> 'deposit_amount')::numeric, fx ->> 'deposit_ref',
         r.receivable_id is not null or r.status = 'cancelled' or s.status not in ('accepted', 'in_transit', 'driver_completed')
  from private.driver_link_session(p_token) me
  join public.shipments s on private.driver_link_visible(me.vehicle_id, s)
  join public.shipments r on r.id = private.container_root(s.id)
  left join public.shipments p on p.id = s.container_prev_id
  left join public.shipments n on n.container_prev_id = s.id
  cross join lateral private.container_fees(r.id) fx
  where (s.status in ('assigned', 'accepted', 'in_transit')
         or (s.status in ('driver_completed', 'closed') and s.pickup_at > now() - interval '3 days'))
    and private.shipment_uses_container(s);
$$;
revoke all on function public.driver_link_containers(text) from public;
grant execute on function public.driver_link_containers(text) to anon, authenticated;

create or replace function public.driver_link_set_container(
  p_token text, p_shipment_id uuid,
  p_empty_amount numeric, p_empty_ref text, p_deposit_amount numeric, p_deposit_ref text,
  p_state text default null,
  p_container_no text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  v_r public.shipments;
  v_next text;
  v_er text := nullif(trim(coalesce(p_empty_ref, '')), '');
  v_dr text := nullif(trim(coalesce(p_deposit_ref, '')), '');
  v_cn text := nullif(upper(regexp_replace(coalesce(p_container_no, ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_known text;
  v_dup text;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chọn chuyến của xe bạn.');
  end if;
  if v_s.status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'Chuyến đã được văn phòng đóng, không sửa được. Vui lòng gọi điều phối.');
  end if;
  if v_s.status not in ('accepted', 'in_transit', 'driver_completed') then
    return jsonb_build_object('ok', false, 'error', 'Nhận chuyến trước rồi mới nhập trả rỗng, cược cont.');
  end if;
  if p_state is not null and p_state not in ('returned', 'kept') then
    return jsonb_build_object('ok', false, 'error', 'Chọn "Đã trả rỗng" hoặc "Giữ vỏ cho chuyến sau".');
  end if;
  if (p_empty_amount is not null and (p_empty_amount < 0 or p_empty_amount > 1000000000))
     or (p_deposit_amount is not null and (p_deposit_amount < 0 or p_deposit_amount > 1000000000)) then
    return jsonb_build_object('ok', false, 'error', 'Số tiền không hợp lệ.');
  end if;
  if length(v_er) > 100 or length(v_dr) > 100 then
    return jsonb_build_object('ok', false, 'error', 'Số hóa đơn tối đa 100 ký tự.');
  end if;
  if v_er is not null and p_empty_amount is null then
    return jsonb_build_object('ok', false, 'error', 'Nhập số tiền trả rỗng của hóa đơn ' || v_er || '.');
  end if;
  if v_dr is not null and p_deposit_amount is null then
    return jsonb_build_object('ok', false, 'error', 'Nhập số tiền cược cont của hóa đơn ' || v_dr || '.');
  end if;
  select shipment_code into v_next from public.shipments where container_prev_id = v_s.id and status <> 'cancelled';
  if p_state = 'returned' and v_next is not null then
    return jsonb_build_object('ok', false, 'error', 'Vỏ cont đã chuyển sang chuyến ' || v_next || ', trả rỗng nhập ở chuyến đó.');
  end if;
  if p_state = 'returned' and p_empty_amount is null then
    return jsonb_build_object('ok', false, 'error', 'Đã trả rỗng: nhập số tiền trả rỗng.');
  end if;

  select * into v_r from public.shipments where id = private.container_root(v_s.id) for update;
  -- Số cont: hiện cho tài xế đối chiếu với hóa đơn; chuyến chưa có số cont thì tài xế nhập (đúng chuẩn ISO 6346)
  v_known := coalesce(v_s.container_no, v_r.container_no);
  if v_cn is not null and not private.container_no_valid(v_cn) then
    return jsonb_build_object('ok', false, 'error', 'Số cont ' || v_cn || ' không đúng: 4 chữ cái + 7 số, số cuối là số kiểm tra. Xem lại số cont in trên hóa đơn / vỏ cont.');
  end if;
  if v_known is not null and v_cn is not null and upper(regexp_replace(v_known, '[^A-Za-z0-9]', '', 'g')) <> v_cn then
    return jsonb_build_object('ok', false, 'error', 'Số cont ' || v_cn || ' khác số cont của chuyến (' || v_known || '). Kiểm tra lại hóa đơn; nếu chuyến ghi sai số cont, gọi điều phối sửa.');
  end if;
  if v_known is null and v_cn is null and (p_empty_amount is not null or p_deposit_amount is not null or v_er is not null or v_dr is not null) then
    return jsonb_build_object('ok', false, 'error', 'Nhập số cont (in trên hóa đơn trả rỗng / cược cont) để không nhập nhầm cont.');
  end if;
  -- Một hóa đơn chỉ thuộc một cont: số HĐ đã nhập ở chuyến (chuỗi vỏ) khác thì báo
  select s2.shipment_code || coalesce(' (cont ' || s2.container_no || ')', '') into v_dup
  from public.shipment_fees f join public.shipments s2 on s2.id = f.shipment_id
  where f.shipment_id <> v_r.id and s2.status <> 'cancelled' and v_er is not null
    and f.fee_type_id = private.container_fee_type('empty') and lower(trim(f.ref_no)) = lower(v_er) limit 1;
  if v_dup is not null then
    return jsonb_build_object('ok', false, 'error', 'Hóa đơn trả rỗng ' || v_er || ' đã nhập ở chuyến ' || v_dup || '. Kiểm tra lại có nhầm cont không.');
  end if;
  select s2.shipment_code || coalesce(' (cont ' || s2.container_no || ')', '') into v_dup
  from public.shipment_fees f join public.shipments s2 on s2.id = f.shipment_id
  where f.shipment_id <> v_r.id and s2.status <> 'cancelled' and v_dr is not null
    and f.fee_type_id = private.container_fee_type('deposit') and lower(trim(f.ref_no)) = lower(v_dr) limit 1;
  if v_dup is not null then
    return jsonb_build_object('ok', false, 'error', 'Hóa đơn cược cont ' || v_dr || ' đã nhập ở chuyến ' || v_dup || '. Kiểm tra lại có nhầm cont không.');
  end if;
  if v_r.receivable_id is not null then
    return jsonb_build_object('ok', false, 'error', 'Chuyến ' || v_r.shipment_code || ' đã lập công nợ, không sửa được phí. Vui lòng gọi kế toán.');
  end if;
  if v_r.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'Chuyến đầu ' || v_r.shipment_code || ' của vỏ cont đã hủy. Vui lòng gọi điều phối.');
  end if;

  if v_known is null and v_cn is not null then
    update public.shipments set container_no = v_cn where id = v_s.id;
  end if;
  perform private.put_container_fee(v_r.id, 'empty', p_empty_amount, v_er);
  perform private.put_container_fee(v_r.id, 'deposit', p_deposit_amount, v_dr);
  perform private.recalc_shipment_fee_totals(v_r.id);
  if p_state is not null and v_s.empty_return_state is distinct from p_state then
    update public.shipments set empty_return_state = p_state, empty_return_state_at = now() where id = v_s.id;
  end if;
  return jsonb_build_object('ok', true, 'root_code', v_r.shipment_code, 'container_no', coalesce(v_known, v_cn));
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.driver_link_set_container(text, uuid, numeric, text, numeric, text, text, text) from public;
grant execute on function public.driver_link_set_container(text, uuid, numeric, text, numeric, text, text, text) to anon, authenticated;

