-- =============================================================================
-- KHÁNH HÀ TMS - 0019: Ứng tiền, chi phí, bảng lương của tài xế theo NGƯỜI (đăng nhập Google), không theo xe
--   (khách hàng chốt 22/10/2026: tài xế chạy xe nào do vận tải sắp xếp; ứng tiền lúc nào cũng được).
--   * Link biển số chỉ còn dùng cho chuyến (nhận, chạy, hoàn thành, nhập/bổ sung chi phí của chuyến).
--   * Trang tiền (ứng tiền, sửa/hủy chi phí, bảng lương) bắt buộc đăng nhập Google; hệ thống nhận ra tài xế
--     qua email ghi trong hồ sơ tài xế (hoặc lời mời có gắn tài xế như trước).
--   * Bỏ các hàm tiền dùng link biển số: ai biết biển số cũng xem được lương của tài xế mặc định.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Gắn tài khoản Google với hồ sơ tài xế theo email
-- -----------------------------------------------------------------------------
create index if not exists drivers_email_lower_idx on public.drivers (lower(email)) where archived_at is null;

-- Gắn khi email Google trùng email của đúng 1 hồ sơ tài xế đang dùng, chưa gắn tài khoản khác.
-- Chỉ cấp vai trò Tài xế; tài khoản đã bị khóa thì không mở lại.
create or replace function private.link_driver_by_email(p_uid uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := lower(trim(coalesce(p_email, '')));
  v_driver uuid;
  v_status text;
begin
  if em = '' or p_uid is null then
    return null;
  end if;
  select d.id into v_driver from public.drivers d where d.profile_id = p_uid and d.archived_at is null limit 1;
  if v_driver is not null then
    return v_driver;
  end if;
  select status into v_status from public.profiles where id = p_uid;
  if v_status is null or v_status = 'disabled' then
    return null;
  end if;
  if (select count(*) from public.drivers d where lower(trim(d.email)) = em and d.archived_at is null) <> 1 then
    return null;
  end if;
  select d.id into v_driver from public.drivers d
   where lower(trim(d.email)) = em and d.archived_at is null and d.profile_id is null;
  if v_driver is null then
    return null;
  end if;

  perform set_config('gha.system_op', 'on', true);
  update public.drivers set profile_id = p_uid where id = v_driver and profile_id is null;
  insert into public.user_roles (user_id, role_id)
  select p_uid, r.id from public.roles r where r.code = 'driver'
  on conflict do nothing;
  update public.profiles set status = 'active' where id = p_uid and status = 'pending';
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
  values (p_uid, 'driver.link_by_email', 'drivers', v_driver::text, jsonb_build_object('email', em));
  perform set_config('gha.system_op', '', true);
  return v_driver;
end;
$$;
revoke all on function private.link_driver_by_email(uuid, text) from public, anon, authenticated;

-- Lần đăng nhập đầu: không có lời mời thì thử gắn theo email hồ sơ tài xế
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv_id uuid;
  em text := lower(coalesce(new.email, ''));
  v_driver uuid;
begin
  if em = '' then
    return new;
  end if;

  insert into public.profiles (id, email, full_name, avatar_url, status)
  values (
    new.id,
    em,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    'pending'
  )
  on conflict (id) do nothing;

  select id into inv_id from public.user_invitations where email = em and status = 'pending' limit 1;
  if inv_id is not null then
    perform private.apply_invitation(inv_id, new.id);
  else
    v_driver := private.link_driver_by_email(new.id, em);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
  values (new.id, 'auth.first_sign_in', 'profiles', new.id::text,
          jsonb_build_object('email', em, 'invited', inv_id is not null, 'driver_linked', v_driver is not null));
  return new;
end;
$$;

-- Tài xế hiện tại (đã đăng nhập). Tự gắn nếu văn phòng mới ghi email vào hồ sơ sau lần đăng nhập đầu.
create or replace function private.driver_me_driver()
returns public.drivers
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.drivers;
  v_id uuid;
begin
  if auth.uid() is null then
    return d;
  end if;
  select * into d from public.drivers where profile_id = auth.uid() and archived_at is null limit 1;
  if d.id is null then
    v_id := private.link_driver_by_email(auth.uid(), (select email from public.profiles where id = auth.uid()));
    if v_id is not null then
      select * into d from public.drivers where id = v_id;
    end if;
  end if;
  if d.id is not null and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active') then
    d := null;
  end if;
  return d;
end;
$$;
revoke all on function private.driver_me_driver() from public, anon, authenticated;

create function public.driver_me()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.drivers;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'signed_in', false);
  end if;
  d := private.driver_me_driver();
  return jsonb_build_object('ok', d.id is not null, 'signed_in', true,
    'email', (select email from public.profiles where id = auth.uid()),
    'driver_id', d.id, 'driver_name', d.full_name, 'driver_code', d.code);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Vé tải ảnh: thêm loại vé theo tài xế (sửa chi phí có chụp lại hóa đơn từ trang tiền)
-- -----------------------------------------------------------------------------
alter table private.driver_upload_tickets
  alter column vehicle_id drop not null,
  add column driver_id uuid references public.drivers (id) on delete cascade,
  add constraint driver_upload_tickets_owner check (vehicle_id is not null or driver_id is not null);

drop function private.driver_attach_uploads(uuid, uuid, text, uuid, text[]);
create function private.driver_attach_uploads(
  p_ticket uuid, p_vehicle_id uuid, p_entity_type text, p_entity_id uuid, p_allowed text[], p_driver_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t private.driver_upload_tickets;
  o record;
  v_type text;
  v_mime text;
  v_counts jsonb := '{}'::jsonb;
begin
  if p_ticket is null then
    return v_counts;
  end if;
  select * into t from private.driver_upload_tickets
   where id = p_ticket and (vehicle_id = p_vehicle_id or (p_driver_id is not null and driver_id = p_driver_id)) for update;
  if t.id is null or t.used_at is not null then
    raise exception 'Ảnh đã gửi hết hạn. Vui lòng chụp lại.' using errcode = '22023';
  end if;
  if to_regclass('storage.objects') is not null then
    for o in execute 'select name, metadata from storage.objects where bucket_id = ''documents'' and name like $1 order by created_at'
      using 'tx/' || p_ticket::text || '/%'
    loop
      if not private.driver_upload_name_ok(o.name) then continue; end if;
      v_type := split_part(split_part(o.name, '/', 3), '-', 1);
      if not v_type = any (p_allowed) then continue; end if;
      v_mime := coalesce(o.metadata ->> 'mimetype', case when o.name like '%.pdf' then 'application/pdf' else 'image/jpeg' end);
      if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf') then continue; end if;
      insert into public.documents (bucket, storage_path, file_name, mime_type, size_bytes, entity_type, entity_id, doc_type)
      values ('documents', o.name, split_part(o.name, '/', 3), v_mime,
              greatest(1, least(10485760, coalesce((o.metadata ->> 'size')::bigint, 1))), p_entity_type, p_entity_id, v_type)
      on conflict (bucket, storage_path) do nothing;
      v_counts := jsonb_set(v_counts, array[v_type], to_jsonb(coalesce((v_counts ->> v_type)::int, 0) + 1));
    end loop;
  end if;
  update private.driver_upload_tickets set used_at = now() where id = t.id;
  return v_counts;
end;
$$;
revoke all on function private.driver_attach_uploads(uuid, uuid, text, uuid, text[], uuid) from public, anon, authenticated;

create function public.driver_me_upload_ticket(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.drivers := private.driver_me_driver();
  v_id uuid;
begin
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Tài khoản chưa gắn với hồ sơ tài xế.', 'unlinked', true);
  end if;
  if not exists (select 1 from public.shipment_expenses where id = p_expense_id and driver_id = d.id) then
    return jsonb_build_object('ok', false, 'error', 'Không tìm thấy khoản chi phí của bạn.');
  end if;
  if (select count(*) from private.driver_upload_tickets where driver_id = d.id and created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('ok', false, 'error', 'Gửi ảnh quá nhiều lần. Vui lòng thử lại sau ít phút.');
  end if;
  insert into private.driver_upload_tickets (driver_id, purpose) values (d.id, 'expense') returning id into v_id;
  return jsonb_build_object('ok', true, 'ticket', v_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Trang tiền của tài xế (đăng nhập)
-- -----------------------------------------------------------------------------
create function public.driver_me_finance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.drivers := private.driver_me_driver();
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
begin
  if d.id is null then
    return jsonb_build_object('ok', false, 'unlinked', true);
  end if;
  return jsonb_build_object(
    'ok', true,
    'driver_id', d.id,
    'driver_name', d.full_name,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'group', c.group_name, 'requires_image', c.requires_image,
                                          'requires_approval', c.requires_approval) order by c.sort_order, c.name)
      from public.expense_categories c where c.is_active and 'driver' = any (c.allowed_role_codes)), '[]'::jsonb),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'label', s.shipment_code || ' · ' || pl.name || ' → ' || dl.name) order by s.pickup_at desc)
      from public.shipments s
      join public.locations pl on pl.id = s.pickup_location_id
      join public.locations dl on dl.id = s.delivery_location_id
      where s.driver_id = d.id and s.status in ('assigned', 'accepted', 'in_transit', 'driver_completed') and not private.shipment_is_3pl(s)
        and s.pickup_at > now() - interval '30 days'), '[]'::jsonb),
    'advances', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'amount', a.amount_requested, 'approved', a.amount_approved,
                                          'reason', a.reason, 'status', a.status, 'created_at', a.created_at,
                                          'shipment_code', s.shipment_code, 'reject_reason', ar.reject_reason) order by a.created_at desc)
      from public.advance_requests a
      left join public.shipments s on s.id = a.shipment_id
      left join public.approval_requests ar on ar.id = a.approval_request_id
      where a.driver_id = d.id and a.created_at > now() - interval '62 days'), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'code', e.code, 'amount', e.amount, 'category', c.name, 'note', e.note,
                                          'category_id', e.category_id, 'shipment_id', e.shipment_id,
                                          'editable', private.driver_expense_editable(e, s),
                                          'status', e.status, 'incurred_at', e.incurred_at, 'shipment_code', s.shipment_code,
                                          'reject_reason', ar.reject_reason,
                                          'files', (select count(*) from public.documents doc where doc.entity_type = 'shipment_expense' and doc.entity_id = e.id))
                        order by e.incurred_at desc)
      from public.shipment_expenses e
      join public.expense_categories c on c.id = e.category_id
      join public.shipments s on s.id = e.shipment_id
      left join public.approval_requests ar on ar.id = e.approval_request_id
      where e.driver_id = d.id and e.source = 'driver' and e.incurred_at > now() - interval '62 days'), '[]'::jsonb),
    'month', jsonb_build_object(
      'advance_paid', (select coalesce(sum(t.amount), 0) from public.advance_transactions t
                        where t.driver_id = d.id and t.txn_type = 'disbursement' and t.occurred_at >= v_month_start),
      'expense_approved', (select coalesce(sum(e.amount), 0) from public.shipment_expenses e
                            where e.driver_id = d.id and e.paid_by = 'driver' and e.status = 'approved' and e.incurred_at >= v_month_start),
      'expense_pending', (select coalesce(sum(e.amount), 0) from public.shipment_expenses e
                           where e.driver_id = d.id and e.paid_by = 'driver' and e.status = 'pending' and e.incurred_at >= v_month_start))
  );
end;
$$;

create function public.driver_me_payrolls()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.drivers := private.driver_me_driver();
begin
  if d.id is null then
    return jsonb_build_object('ok', false, 'unlinked', true);
  end if;
  return jsonb_build_object(
    'ok', true,
    'advance_balance', greatest(coalesce((
      select sum(case when t.txn_type in ('disbursement', 'adjustment') then t.amount else -t.amount end)
      from public.advance_transactions t where t.driver_id = d.id), 0), 0),
    'payrolls', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', p.code, 'period', to_char(p.period_month, 'MM/YYYY'), 'trip_count', p.trip_count,
        'salary', p.base_salary + p.trip_salary + p.meal_allowance + p.other_allowance + p.bonus - p.deduction,
        'expense_reimbursement', p.expense_reimbursement, 'advance_offset', p.advance_offset,
        'net_amount', p.net_amount, 'status', p.status, 'paid_at', p.paid_at) order by p.period_month desc)
      from (select * from public.driver_payrolls where driver_id = d.id and status <> 'cancelled'
            order by period_month desc limit 12) p), '[]'::jsonb));
end;
$$;

-- Ứng tiền: lúc nào cũng được, không phụ thuộc xe; gắn chuyến là không bắt buộc
create function public.driver_me_request_advance(
  p_amount numeric, p_reason text, p_shipment_id uuid default null, p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.drivers := private.driver_me_driver();
  v_id uuid;
  v_code text;
begin
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Tài khoản chưa gắn với hồ sơ tài xế. Nhờ văn phòng ghi email này vào hồ sơ tài xế.', 'unlinked', true);
  end if;
  if p_client_request_id is not null and exists (select 1 from public.advance_requests where client_request_id = p_client_request_id) then
    return jsonb_build_object('ok', true);
  end if;
  if p_shipment_id is not null and not exists (select 1 from public.shipments where id = p_shipment_id and driver_id = d.id) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến này không phân cho bạn.');
  end if;
  if p_shipment_id is not null and private.shipment_is_3pl((select s from public.shipments s where s.id = p_shipment_id)) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến chạy xe thuê ngoài 3PL không ứng tiền.');
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 1000000000 then
    return jsonb_build_object('ok', false, 'error', 'Nhập số tiền cần ứng.');
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Nhập lý do ứng tiền.');
  end if;
  insert into public.advance_requests (driver_id, shipment_id, amount_requested, reason, status, client_request_id)
  values (d.id, p_shipment_id, round(p_amount), left(trim(p_reason), 500), 'pending', p_client_request_id)
  returning id, code into v_id, v_code;
  update public.advance_requests set approval_request_id = private.submit_approval(
    'advance', 'advance_request', v_id, p_shipment_id, round(p_amount),
    'Ứng tiền ' || v_code || ' – ' || d.full_name || ': ' || left(trim(p_reason), 200), null, d.id, d.full_name || ' (điện thoại)')
  where id = v_id;
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

create function public.driver_me_cancel(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.drivers := private.driver_me_driver();
  v_req uuid;
  v_hit boolean := false;
  e public.shipment_expenses;
  v_s public.shipments;
begin
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Tài khoản chưa gắn với hồ sơ tài xế.', 'unlinked', true);
  end if;
  if p_kind = 'advance' then
    update public.advance_requests set status = 'cancelled'
     where id = p_id and driver_id = d.id and status = 'pending' returning approval_request_id into v_req;
    v_hit := found;
    if v_hit and v_req is not null then
      update public.approval_requests set status = 'cancelled', decided_at = now() where id = v_req and status = 'pending';
      insert into public.approval_steps (request_id, level, action, actor_label) values (v_req, 0, 'cancel', d.full_name || ' (điện thoại)');
    end if;
  elsif p_kind = 'expense' then
    select * into e from public.shipment_expenses where id = p_id and driver_id = d.id for update;
    select * into v_s from public.shipments where id = e.shipment_id;
    if e.id is not null and v_s.id is not null and private.driver_expense_editable(e, v_s) then
      perform private.driver_cancel_expense(e, d.full_name || ' (điện thoại)', null);
      v_hit := true;
    end if;
  end if;
  if not v_hit then
    return jsonb_build_object('ok', false, 'error', 'Chỉ hủy được khoản chưa duyệt (hoặc loại không cần duyệt, chưa vào bảng lương) của chuyến chưa đóng.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Sửa chi phí: hủy khoản cũ, tạo khoản mới (giữ lịch sử để đối chiếu)
create function public.driver_me_update_expense(
  p_expense_id uuid, p_category_id uuid, p_amount numeric, p_note text default null, p_ticket uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.drivers := private.driver_me_driver();
  e public.shipment_expenses;
  v_s public.shipments;
  c public.expense_categories;
  v_id uuid;
  v_counts jsonb;
  v_files int;
begin
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Tài khoản chưa gắn với hồ sơ tài xế.', 'unlinked', true);
  end if;
  select * into e from public.shipment_expenses where id = p_expense_id and driver_id = d.id for update;
  select * into v_s from public.shipments where id = e.shipment_id;
  if e.id is null or v_s.id is null then
    return jsonb_build_object('ok', false, 'error', 'Không tìm thấy khoản chi phí của bạn.');
  end if;
  if not private.driver_expense_editable(e, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Khoản này đã được duyệt, đã vào bảng lương hoặc chuyến đã đóng nên không sửa được. Vui lòng gọi kế toán.');
  end if;
  select * into c from public.expense_categories
   where id = p_category_id and is_active and 'driver' = any (allowed_role_codes);
  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'Chọn loại chi phí.');
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 1000000000 then
    return jsonb_build_object('ok', false, 'error', 'Nhập số tiền.');
  end if;

  perform private.driver_cancel_expense(e, d.full_name || ' (điện thoại)', 'Tài xế sửa khoản chi phí');
  v_id := private.insert_expense(v_s, c, round(p_amount), e.incurred_at, left(p_note, 500), 'driver', 'driver', e.driver_id, null,
    e.custom_fields, null, d.full_name || ' (điện thoại)');
  update public.shipment_expenses
     set note = coalesce(note, '') || case when note is null then '' else ' ' end || '(sửa từ ' || e.code || ')'
   where id = v_id;
  v_counts := private.driver_attach_uploads(p_ticket, null, 'shipment_expense', v_id, array['receipt', 'invoice', 'photo'], d.id);
  v_files := coalesce((select sum(value::int) from jsonb_each_text(v_counts)), 0);
  if v_files = 0 then
    -- Không chụp lại: dùng chứng từ của khoản cũ
    update public.documents set entity_id = v_id where entity_type = 'shipment_expense' and entity_id = e.id and archived_at is null;
    get diagnostics v_files = row_count;
  end if;
  if c.requires_image and v_files = 0 then
    raise exception 'Loại chi phí "%" cần ảnh hóa đơn/biên lai', c.name using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'code', (select code from public.shipment_expenses where id = v_id), 'needs_approval', c.requires_approval);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3b. Ảnh biên lai không bắt buộc (khách hàng chốt 22/10/2026: bốc xếp, vá lốp dọc đường không có biên lai).
--     Quản lý tự bật lại "Bắt buộc ảnh chứng từ" cho mục nào cần trong Danh mục hệ thống → Hạng mục chi phí.
-- -----------------------------------------------------------------------------
update public.expense_categories set requires_image = false where requires_image;
alter table public.expense_categories alter column allowed_role_codes set default '{admin,accountant,dispatcher}';

-- -----------------------------------------------------------------------------
-- 3c. Xe thuê ngoài 3PL (khách hàng chốt 22/10/2026): chuyến chạy xe 3PL không ứng tiền, không nhập chi phí tài xế,
--     hoàn thành chuyến không cần khai chi phí. Xe 3PL đánh dấu "Hình thức sở hữu = Thuê ngoài 3PL" trong danh mục Xe.
-- -----------------------------------------------------------------------------
alter table public.vehicles drop constraint vehicles_ownership_type_check;
alter table public.vehicles add constraint vehicles_ownership_type_check
  check (ownership_type in ('owned', 'leased', 'lease_purchase', 'outsourced'));

create or replace function private.shipment_is_3pl(s public.shipments)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select v.ownership_type = 'outsourced' from public.vehicles v where v.id = s.vehicle_id), false);
$$;
revoke all on function private.shipment_is_3pl(public.shipments) from public, anon, authenticated;

create or replace function public.driver_link_complete(
  p_token text, p_shipment_id uuid, p_ticket uuid, p_result text default 'full', p_note text default null, p_no_expense boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  v_name text;
  v_counts jsonb;
  v_photos int;
  v_3pl boolean;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến này không còn được phân công cho xe của bạn. Tải lại trang để xem.');
  end if;
  if v_s.status = 'driver_completed' then
    return jsonb_build_object('ok', true);
  end if;
  if v_s.status <> 'in_transit' then
    return jsonb_build_object('ok', false, 'error', 'Bấm "Bắt đầu chạy" trước khi hoàn thành chuyến.');
  end if;
  if coalesce(p_result, '') not in ('full', 'partial', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'Chọn kết quả giao hàng.');
  end if;
  if p_result <> 'full' and length(trim(coalesce(p_note, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Giao thiếu hoặc không giao được: vui lòng ghi lý do.');
  end if;
  v_3pl := private.shipment_is_3pl(v_s);
  if p_no_expense is null and not v_3pl then
    return jsonb_build_object('ok', false, 'error', 'Chọn "Có chi phí" và nhập chi phí, hoặc chọn "Không phát sinh chi phí".');
  end if;

  begin
    v_counts := private.driver_attach_uploads(p_ticket, v_me.vehicle_id, 'shipment', v_s.id, array['photo', 'delivery_note']);
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  v_photos := coalesce((v_counts ->> 'photo')::int, 0) + coalesce((v_counts ->> 'delivery_note')::int, 0);
  if v_photos = 0 then
    raise exception 'Cần ít nhất 1 ảnh giao hàng hoặc phiếu ký nhận' using errcode = '22023';
  end if;

  update public.shipments
     set status = 'driver_completed',
         completed_at = now(),
         arrived_delivery_at = coalesce(arrived_delivery_at, now()),
         delivery_result = p_result,
         completion_note = nullif(trim(coalesce(p_note, '')), ''),
         document_status = case when document_status in ('missing', 'rejected') then 'submitted' else document_status end,
         expense_declaration = case when v_3pl then null when p_no_expense then 'none' else 'has' end,
         expense_declared_at = case when v_3pl then null else now() end
   where id = v_s.id;
  select full_name into v_name from public.drivers where id = v_s.driver_id;
  perform private.driver_link_note(v_s.id, 'driver_completed', v_name || ' hoàn thành chuyến trên điện thoại (' || v_photos || ' ảnh'
    || case when v_3pl then '' when p_no_expense then ', không phát sinh chi phí' else '' end || ')');
  perform private.notify_dispatcher(v_s.id, 'shipment_completed', 'Tài xế ' || v_name || ' đã hoàn thành chuyến ' || v_s.shipment_code);
  return jsonb_build_object('ok', true, 'photos', v_photos);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

create or replace function public.driver_link_add_expense(
  p_token text, p_shipment_id uuid, p_category_id uuid, p_amount numeric, p_note text default null,
  p_ticket uuid default null, p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  c public.expense_categories;
  v_id uuid;
  v_counts jsonb;
  v_files int;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  if p_client_request_id is not null and exists (select 1 from public.shipment_expenses where client_request_id = p_client_request_id) then
    return jsonb_build_object('ok', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chọn chuyến của xe bạn.');
  end if;
  if v_s.status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'Chuyến đã được văn phòng đóng, không bổ sung chi phí được. Vui lòng gọi kế toán.');
  end if;
  if private.shipment_is_3pl(v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến chạy xe thuê ngoài 3PL không nhập chi phí tài xế.');
  end if;
  if v_s.status <> 'driver_completed' then
    return jsonb_build_object('ok', false, 'error', 'Chi phí được nhập khi bấm Hoàn thành chuyến.');
  end if;
  select * into c from public.expense_categories
   where id = p_category_id and is_active and 'driver' = any (allowed_role_codes);
  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'Chọn loại chi phí.');
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 1000000000 then
    return jsonb_build_object('ok', false, 'error', 'Nhập số tiền.');
  end if;

  v_id := private.insert_expense(v_s, c, round(p_amount), now(), left(p_note, 500), 'driver', 'driver', v_s.driver_id, null,
    '{}'::jsonb, p_client_request_id, (select full_name from public.drivers where id = v_s.driver_id) || ' (điện thoại)');
  v_counts := private.driver_attach_uploads(p_ticket, v_me.vehicle_id, 'shipment_expense', v_id, array['receipt', 'invoice', 'photo']);
  v_files := coalesce((select sum(value::int) from jsonb_each_text(v_counts)), 0);
  if c.requires_image and v_files = 0 then
    raise exception 'Loại chi phí "%" cần ảnh hóa đơn/biên lai', c.name using errcode = '22023';
  end if;
  update public.shipments set expense_declaration = 'has', expense_declared_at = coalesce(expense_declared_at, now())
   where id = v_s.id and expense_declaration is distinct from 'has';
  return jsonb_build_object('ok', true, 'code', (select code from public.shipment_expenses where id = v_id),
                            'needs_approval', c.requires_approval);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

drop function public.driver_link_trips(text);
create function public.driver_link_trips(p_token text)
returns table (
  shipment_id uuid,
  shipment_code text,
  status text,
  pickup_at timestamptz,
  expected_delivery_at timestamptz,
  plate_number text,
  vehicle_type_name text,
  quantity numeric,
  notes text,
  pickup_name text,
  pickup_address text,
  pickup_contact text,
  pickup_phone text,
  pickup_maps_url text,
  pickup_gate_instructions text,
  delivery_name text,
  delivery_address text,
  delivery_contact text,
  delivery_phone text,
  delivery_maps_url text,
  delivery_gate_instructions text,
  driver_name text,
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  delivery_result text,
  photo_count bigint,
  expense_declaration text,
  expense_count bigint,
  expense_total numeric,
  outsourced boolean
)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.shipment_code, s.status, s.pickup_at, s.expected_delivery_at,
         v.plate_number, vt.name, s.quantity, s.notes,
         pl.name, pl.full_address, pl.contact_name, pl.phone,
         coalesce(pl.google_maps_url, case when pl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || pl.latitude || ',' || pl.longitude end),
         pl.gate_instructions,
         dl.name, dl.full_address, dl.contact_name, dl.phone,
         coalesce(dl.google_maps_url, case when dl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || dl.latitude || ',' || dl.longitude end),
         dl.gate_instructions,
         d.full_name, a.responded_at, s.departed_pickup_at, s.completed_at, s.delivery_result,
         (select count(*) from public.documents doc
           where doc.entity_type = 'shipment' and doc.entity_id = s.id and doc.archived_at is null),
         s.expense_declaration,
         (select count(*) from public.shipment_expenses e where e.shipment_id = s.id and e.source = 'driver' and e.status in ('pending', 'approved')),
         (select coalesce(sum(e.amount), 0) from public.shipment_expenses e where e.shipment_id = s.id and e.source = 'driver' and e.status in ('pending', 'approved')),
         coalesce(v.ownership_type = 'outsourced', false)
  from private.driver_link_session(p_token) me
  join public.shipments s on private.driver_link_visible(me.vehicle_id, s)
  join public.drivers d on d.id = s.driver_id
  join public.locations pl on pl.id = s.pickup_location_id
  join public.locations dl on dl.id = s.delivery_location_id
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.vehicle_types vt on vt.id = s.vehicle_type_id
  left join public.shipment_assignments a
    on a.shipment_id = s.id and a.driver_id = s.driver_id and a.response = 'accepted'
  where (s.status in ('assigned', 'accepted', 'in_transit')
     or (s.status in ('driver_completed', 'closed') and s.pickup_at > now() - interval '3 days'))
  order by (s.status = 'assigned') desc, (s.status = 'in_transit') desc, s.pickup_at
  limit 100;
$$;
revoke all on function public.driver_link_trips(text) from public;
grant execute on function public.driver_link_trips(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Link biển số: chỉ còn chuyến. Loại chi phí cho bước hoàn thành chuyến.
-- -----------------------------------------------------------------------------
create function public.driver_link_categories(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'expired', true);
  end if;
  return jsonb_build_object('ok', true, 'categories', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'group', c.group_name, 'requires_image', c.requires_image,
                                        'requires_approval', c.requires_approval) order by c.sort_order, c.name)
    from public.expense_categories c where c.is_active and 'driver' = any (c.allowed_role_codes)), '[]'::jsonb));
end;
$$;

drop function public.driver_link_finance(text);
drop function public.driver_link_payrolls(text);
drop function public.driver_link_request_advance(text, numeric, text, uuid, uuid);
drop function public.driver_link_cancel(text, text, uuid);
drop function public.driver_link_update_expense(text, uuid, uuid, numeric, text, uuid);
drop function private.driver_link_driver(uuid);

revoke all on function public.driver_me() from public, anon;
revoke all on function public.driver_me_upload_ticket(uuid) from public, anon;
revoke all on function public.driver_me_finance() from public, anon;
revoke all on function public.driver_me_payrolls() from public, anon;
revoke all on function public.driver_me_request_advance(numeric, text, uuid, uuid) from public, anon;
revoke all on function public.driver_me_cancel(text, uuid) from public, anon;
revoke all on function public.driver_me_update_expense(uuid, uuid, numeric, text, uuid) from public, anon;
revoke all on function public.driver_link_categories(text) from public;
grant execute on function public.driver_me() to authenticated;
grant execute on function public.driver_me_upload_ticket(uuid) to authenticated;
grant execute on function public.driver_me_finance() to authenticated;
grant execute on function public.driver_me_payrolls() to authenticated;
grant execute on function public.driver_me_request_advance(numeric, text, uuid, uuid) to authenticated;
grant execute on function public.driver_me_cancel(text, uuid) to authenticated;
grant execute on function public.driver_me_update_expense(uuid, uuid, numeric, text, uuid) to authenticated;
grant execute on function public.driver_link_categories(text) to anon, authenticated;
