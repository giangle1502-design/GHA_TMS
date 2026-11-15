-- =============================================================================
-- GHA 9008: Trả rỗng và cược cont do tài xế nhập; chuỗi vỏ container (LE, 15/11/2026)
--   * Tài xế chỉ nhập 4 ô: số tiền trả rỗng, số HĐ trả rỗng, số tiền cược cont, số HĐ cược cont.
--     Lưu thành dòng phí chi hộ của chuyến: loại "Phí hạ" và "Phí cược cont", số HĐ ở cột Số hóa đơn.
--   * Xe chạy xong chưa trả rỗng mà dùng vỏ cho chuyến sau (chuyển kho):
--       - tài xế chọn "Giữ vỏ cho chuyến sau" (empty_return_state = 'kept') hoặc "Đã trả rỗng" ('returned');
--       - điều phối nối chuyến sau vào chuyến trước (container_prev_id), các chuyến thành một chuỗi vỏ;
--       - phí trả rỗng và cược cont của cả chuỗi GỘP VỀ CHUYẾN ĐẦU của chuỗi (chuyến lấy cont),
--         nhập ở chuyến nào cũng ghi vào chuyến đầu, mỗi chuỗi chỉ một dòng trả rỗng, một dòng cược.
--   * Tài xế xe 3PL cũng nhập được (LE 15/11): phí vẫn là chi hộ thu khách; văn phòng chép sang cước 3PL
--     bằng nút chép chi hộ ở Chi phí trả 3PL khi cần trả lại nhà xe.
--   * Danh sách "Vỏ chưa trả rỗng": chuyến giữ vỏ mà chưa có chuyến sau.
-- Không xóa dữ liệu. Chạy lại nhiều lần không lỗi.
-- =============================================================================

alter table public.shipments
  add column if not exists container_prev_id uuid references public.shipments (id) on delete set null,
  add column if not exists empty_return_state text check (empty_return_state is null or empty_return_state in ('returned', 'kept')),
  add column if not exists empty_return_state_at timestamptz;
comment on column public.shipments.container_prev_id is 'Chuyến trước dùng cùng vỏ container (chuỗi vỏ). Phí trả rỗng, cược cont gộp về chuyến đầu chuỗi';
comment on column public.shipments.empty_return_state is 'returned = đã trả rỗng, kept = giữ vỏ cho chuyến sau';
create unique index if not exists shipments_container_prev_uidx on public.shipments (container_prev_id) where container_prev_id is not null;
create index if not exists shipments_empty_kept_idx on public.shipments (empty_return_state) where empty_return_state = 'kept';

-- Chuyến đầu của chuỗi vỏ
create or replace function private.container_root(p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_prev uuid;
  n int := 0;
begin
  loop
    select container_prev_id into v_prev from public.shipments where id = v_id;
    exit when v_prev is null or n >= 100;
    v_id := v_prev;
    n := n + 1;
  end loop;
  return v_id;
end;
$$;
revoke all on function private.container_root(uuid) from public, anon, authenticated;

-- Các chuyến của chuỗi vỏ, theo thứ tự từ chuyến đầu
create or replace function private.container_chain(p_id uuid)
returns table (shipment_id uuid, pos int)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive c as (
    select s.id, 1 as pos from public.shipments s where s.id = private.container_root(p_id)
    union all
    select s.id, c.pos + 1 from public.shipments s join c on s.container_prev_id = c.id where c.pos < 100
  )
  select id, pos from c;
$$;
revoke all on function private.container_chain(uuid) from public, anon, authenticated;

-- Loại phí: 'empty' = Phí hạ (trả rỗng), 'deposit' = Phí cược cont. Chưa có thì tạo (chi hộ).
create or replace function private.container_fee_type(p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := case p_kind when 'empty' then 'Phí hạ' else 'Phí cược cont' end;
  v_id uuid;
begin
  select id into v_id from public.fee_types where lower(name) = lower(v_name) order by (fee_kind = 'pass_through') desc, is_active desc, sort_order, created_at limit 1;
  if v_id is null then
    insert into public.fee_types (name, fee_kind, description, sort_order, fee_group_id)
    values (v_name, 'pass_through',
            case p_kind when 'empty' then 'Phí hạ container, chi hộ khách' else 'Tiền cược container, chi hộ khách' end,
            case p_kind when 'empty' then 21 else 23 end,
            (select id from public.fee_groups where legacy_code = 'CHIHO' or code = 'CHIHO' or lower(name) = 'phí chi hộ' order by (legacy_code = 'CHIHO') desc nulls last limit 1))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function private.container_fee_type(text) from public, anon, authenticated;

-- Tính lại tổng phụ phí / chi hộ của chuyến từ các dòng phí (như set_shipment_fees)
create or replace function private.recalc_shipment_fee_totals(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_extra numeric;
  v_pass numeric;
begin
  select coalesce(sum(amount) filter (where fee_kind <> 'pass_through'), 0), coalesce(sum(amount) filter (where fee_kind = 'pass_through'), 0)
    into v_extra, v_pass from public.shipment_fees where shipment_id = p_id;
  update public.shipments set extra_fee_amount = v_extra, pass_through_amount = v_pass
  where id = p_id and (extra_fee_amount, pass_through_amount) is distinct from (v_extra, v_pass);
end;
$$;
revoke all on function private.recalc_shipment_fee_totals(uuid) from public, anon, authenticated;

-- Ghi một dòng phí (trả rỗng hoặc cược) của chuỗi vào chuyến đầu. Trống cả số tiền và số HĐ = bỏ dòng.
create or replace function private.put_container_fee(p_root uuid, p_kind text, p_amount numeric, p_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type uuid := private.container_fee_type(p_kind);
  v_kind text;
  v_line uuid;
  v_no int;
begin
  select id into v_line from public.shipment_fees where shipment_id = p_root and fee_type_id = v_type order by line_no limit 1;
  if p_amount is null and p_ref is null then
    if v_line is not null then
      delete from public.shipment_fees where id = v_line;
    end if;
    return;
  end if;
  if v_line is not null then
    update public.shipment_fees set amount = round(coalesce(p_amount, 0), 0), ref_no = p_ref
    where id = v_line and (amount, ref_no) is distinct from (round(coalesce(p_amount, 0), 0), p_ref);
  else
    select fee_kind into v_kind from public.fee_types where id = v_type;
    select coalesce(max(line_no), 0) + 1 into v_no from public.shipment_fees where shipment_id = p_root;
    if v_no > 100 then
      raise exception 'Chuyến đã đủ 100 dòng phí, không thêm được' using errcode = '22023';
    end if;
    insert into public.shipment_fees (shipment_id, line_no, fee_type_id, fee_kind, amount, ref_no)
    values (p_root, v_no, v_type, v_kind, round(coalesce(p_amount, 0), 0), p_ref);
  end if;
end;
$$;
revoke all on function private.put_container_fee(uuid, text, numeric, text) from public, anon, authenticated;

-- Phí trả rỗng / cược đang ghi ở chuyến đầu của chuỗi
create or replace function private.container_fees(p_root uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'empty_amount', (select f.amount from public.shipment_fees f where f.shipment_id = p_root and f.fee_type_id = private.container_fee_type('empty') order by f.line_no limit 1),
    'empty_ref', (select f.ref_no from public.shipment_fees f where f.shipment_id = p_root and f.fee_type_id = private.container_fee_type('empty') order by f.line_no limit 1),
    'deposit_amount', (select f.amount from public.shipment_fees f where f.shipment_id = p_root and f.fee_type_id = private.container_fee_type('deposit') order by f.line_no limit 1),
    'deposit_ref', (select f.ref_no from public.shipment_fees f where f.shipment_id = p_root and f.fee_type_id = private.container_fee_type('deposit') order by f.line_no limit 1));
$$;
revoke all on function private.container_fees(uuid) from public, anon, authenticated;

-- Chuyến có dùng container (đầu kéo, có số cont, rơ moóc, điểm hạ rỗng hoặc đã nằm trong chuỗi vỏ)
create or replace function private.shipment_uses_container(s public.shipments)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select s.container_no is not null or s.trailer_id is not null or s.empty_return_location_id is not null
      or s.container_prev_id is not null or s.empty_return_state is not null
      or exists (select 1 from public.shipments n where n.container_prev_id = s.id)
      or coalesce((select v.vehicle_kind = 'tractor' from public.vehicles v where v.id = s.vehicle_id), false);
$$;
revoke all on function private.shipment_uses_container(public.shipments) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- App tài xế
-- -----------------------------------------------------------------------------
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
  p_state text default null
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
  if v_r.receivable_id is not null then
    return jsonb_build_object('ok', false, 'error', 'Chuyến ' || v_r.shipment_code || ' đã lập công nợ, không sửa được phí. Vui lòng gọi kế toán.');
  end if;
  if v_r.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'Chuyến đầu ' || v_r.shipment_code || ' của vỏ cont đã hủy. Vui lòng gọi điều phối.');
  end if;

  perform private.put_container_fee(v_r.id, 'empty', p_empty_amount, v_er);
  perform private.put_container_fee(v_r.id, 'deposit', p_deposit_amount, v_dr);
  perform private.recalc_shipment_fee_totals(v_r.id);
  if p_state is not null and v_s.empty_return_state is distinct from p_state then
    update public.shipments set empty_return_state = p_state, empty_return_state_at = now() where id = v_s.id;
  end if;
  return jsonb_build_object('ok', true, 'root_code', v_r.shipment_code);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.driver_link_set_container(text, uuid, numeric, text, numeric, text, text) from public;
grant execute on function public.driver_link_set_container(text, uuid, numeric, text, numeric, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Điều phối: xem chuỗi vỏ, nối chuyến vào vỏ của chuyến trước, danh sách vỏ chưa trả rỗng
-- -----------------------------------------------------------------------------
create or replace function public.container_kept_list()
returns table (
  shipment_id uuid, shipment_code text, container_no text, plate_number text, driver_name text, customer_name text,
  pickup_at timestamptz, kept_at timestamptz, days_kept int, root_id uuid, root_code text, deposit_amount numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.has_perm('shipments.view') or private.has_perm('dispatch.view')) then
    raise exception 'Bạn không có quyền xem chuyến' using errcode = '42501';
  end if;
  return query
  select s.id, s.shipment_code, coalesce(s.container_no, r.container_no), v.plate_number, d.full_name, c.name,
         s.pickup_at, coalesce(s.empty_return_state_at, s.completed_at),
         greatest(0, (now()::date - coalesce(s.empty_return_state_at, s.completed_at, s.pickup_at)::date))::int,
         r.id, r.shipment_code, (private.container_fees(r.id) ->> 'deposit_amount')::numeric
  from public.shipments s
  join public.shipments r on r.id = private.container_root(s.id)
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.drivers d on d.id = s.driver_id
  left join public.transport_orders o on o.id = s.order_id
  left join public.customers c on c.id = o.customer_id
  where s.empty_return_state = 'kept' and s.status <> 'cancelled'
    and not exists (select 1 from public.shipments n where n.container_prev_id = s.id and n.status <> 'cancelled')
  order by coalesce(s.empty_return_state_at, s.completed_at, s.pickup_at);
end;
$$;
revoke all on function public.container_kept_list() from public, anon;
grant execute on function public.container_kept_list() to authenticated;

create or replace function public.shipment_container_chain(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.shipments;
  v_root uuid;
begin
  if not (private.has_perm('shipments.view') or private.has_perm('dispatch.view')) then
    raise exception 'Bạn không có quyền xem chuyến' using errcode = '42501';
  end if;
  select * into v_s from public.shipments where id = p_shipment_id;
  if v_s.id is null then
    return null;
  end if;
  v_root := private.container_root(v_s.id);
  return jsonb_build_object(
    'uses_container', private.shipment_uses_container(v_s),
    'state', v_s.empty_return_state,
    'prev_id', v_s.container_prev_id,
    'root_id', v_root,
    'fees', private.container_fees(v_root),
    'chain', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'code', s.shipment_code, 'status', s.status, 'container_no', s.container_no,
        'plate', v.plate_number, 'state', s.empty_return_state, 'pickup_at', s.pickup_at) order by c.pos), '[]'::jsonb)
      from private.container_chain(v_s.id) c
      join public.shipments s on s.id = c.shipment_id
      left join public.vehicles v on v.id = s.vehicle_id),
    'candidates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', k.shipment_id, 'code', k.shipment_code, 'container_no', k.container_no, 'plate', k.plate_number,
        'days_kept', k.days_kept) order by (k.plate_number is not distinct from (select plate_number from public.vehicles where id = v_s.vehicle_id)) desc, k.kept_at desc), '[]'::jsonb)
      from public.container_kept_list() k
      where k.shipment_id <> v_s.id
        and k.shipment_id not in (select shipment_id from private.container_chain(v_s.id))));
end;
$$;
revoke all on function public.shipment_container_chain(uuid) from public, anon;
grant execute on function public.shipment_container_chain(uuid) to authenticated;

-- Nối chuyến vào vỏ cont của chuyến trước (p_prev_id null = gỡ nối)
create or replace function public.set_container_prev(p_shipment_id uuid, p_prev_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.shipments;
  v_p public.shipments;
  v_root uuid;
  v_kind text;
  v_line public.shipment_fees;
  v_no int;
  v_moved boolean := false;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('shipments.update')) then
    raise exception 'Bạn không có quyền sửa chuyến' using errcode = '42501';
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = '22023';
  end if;
  if v_s.status = 'cancelled' then
    raise exception 'Chuyến đã hủy' using errcode = '22023';
  end if;

  if p_prev_id is null then
    if v_s.container_prev_id is not null then
      update public.shipments set container_prev_id = null where id = v_s.id;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  select * into v_p from public.shipments where id = p_prev_id for update;
  if v_p.id is null or v_p.id = v_s.id then
    raise exception 'Chọn chuyến trước hợp lệ' using errcode = '22023';
  end if;
  if v_p.status = 'cancelled' then
    raise exception 'Chuyến % đã hủy', v_p.shipment_code using errcode = '22023';
  end if;
  if v_p.empty_return_state = 'returned' then
    raise exception 'Chuyến % đã trả rỗng, không dùng lại vỏ được', v_p.shipment_code using errcode = '22023';
  end if;
  if exists (select 1 from public.shipments n where n.container_prev_id = v_p.id and n.id <> v_s.id and n.status <> 'cancelled') then
    raise exception 'Vỏ của chuyến % đã nối sang chuyến khác', v_p.shipment_code using errcode = '22023';
  end if;
  if exists (select 1 from private.container_chain(v_s.id) c where c.shipment_id = v_p.id) then
    raise exception 'Chuyến % đã nằm trong chuỗi vỏ này', v_p.shipment_code using errcode = '22023';
  end if;
  -- Chuyến nối vào còn là chuyến đầu của chuỗi riêng: chuyển dòng trả rỗng / cược sang chuyến đầu mới
  v_root := private.container_root(v_p.id);
  if exists (select 1 from public.shipments where id = v_root and receivable_id is not null)
     and exists (select 1 from public.shipment_fees f where f.shipment_id = v_s.id
                 and f.fee_type_id in (private.container_fee_type('empty'), private.container_fee_type('deposit'))) then
    raise exception 'Chuyến đầu của vỏ đã lập công nợ, không chuyển được phí trả rỗng / cược sang' using errcode = '22023';
  end if;
  foreach v_kind in array array['empty', 'deposit'] loop
    select * into v_line from public.shipment_fees where shipment_id = v_s.id and fee_type_id = private.container_fee_type(v_kind) order by line_no limit 1;
    continue when v_line.id is null;
    if exists (select 1 from public.shipment_fees where shipment_id = v_root and fee_type_id = v_line.fee_type_id) then
      raise exception 'Chuyến % và chuyến đầu của vỏ đều đã có phí %. Bỏ một dòng rồi nối lại.',
        v_s.shipment_code, case v_kind when 'empty' then 'trả rỗng' else 'cược cont' end using errcode = '22023';
    end if;
    if v_s.receivable_id is not null then
      raise exception 'Chuyến % đã lập công nợ, không chuyển được phí trả rỗng / cược', v_s.shipment_code using errcode = '22023';
    end if;
    select coalesce(max(line_no), 0) + 1 into v_no from public.shipment_fees where shipment_id = v_root;
    delete from public.shipment_fees where id = v_line.id;
    insert into public.shipment_fees (shipment_id, line_no, fee_type_id, fee_kind, amount, note, ref_no)
    values (v_root, v_no, v_line.fee_type_id, v_line.fee_kind, v_line.amount, v_line.note, v_line.ref_no);
    v_moved := true;
  end loop;
  if v_moved then
    perform private.recalc_shipment_fee_totals(v_s.id);
    perform private.recalc_shipment_fee_totals(v_root);
  end if;

  update public.shipments
     set container_prev_id = v_p.id,
         container_no = coalesce(container_no, v_p.container_no, (select container_no from public.shipments where id = v_root))
   where id = v_s.id;
  if v_p.empty_return_state is distinct from 'kept' then
    update public.shipments set empty_return_state = 'kept', empty_return_state_at = coalesce(empty_return_state_at, now()) where id = v_p.id;
  end if;
  return jsonb_build_object('ok', true, 'moved_fees', v_moved);
end;
$$;
revoke all on function public.set_container_prev(uuid, uuid) from public, anon;
grant execute on function public.set_container_prev(uuid, uuid) to authenticated;
