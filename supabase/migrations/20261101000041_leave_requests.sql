-- =============================================================================
-- 0041: Xin nghỉ (Phép / Ốm) và bàn giao công việc (yêu cầu Khánh Hà 01/11/2026)
--   - Khách hàng có "Nhân viên phụ trách" (customers.account_manager_id). Một nhân viên phụ trách nhiều khách.
--   - Nhân viên tạo đơn xin nghỉ: loại nghỉ, từ ngày đến ngày, số ngày, lý do, bàn giao:
--       + từng khách hàng mình phụ trách -> giao cho một nhân viên khác (mỗi khách giao một người, nhiều khách giao nhiều người)
--       + việc khác (ghi chữ) -> giao cho một nhân viên.
--   - Đơn đi qua hệ thống phê duyệt chung: loại "Xin nghỉ" (leave), cấp 1 = Giám đốc (sửa ở Phê duyệt -> Cấu hình cấp duyệt).
--   - Giám đốc duyệt -> người nhận bàn giao được báo và bấm "Nhận bàn giao". Trong những ngày nghỉ,
--     khách được bàn giao hiện "Đang phụ trách thay" là người nhận (không đổi Nhân viên phụ trách gốc).
--   - KHÔNG viết lại approval_decide: trạng thái đơn đồng bộ bằng trigger trên approval_requests.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Nhân viên phụ trách khách hàng
-- -----------------------------------------------------------------------------
alter table public.customers add column if not exists account_manager_id uuid references public.profiles (id);
comment on column public.customers.account_manager_id is 'Nhân viên phụ trách (điều phối) khách hàng này';
create index if not exists customers_account_manager_idx on public.customers (account_manager_id) where account_manager_id is not null;

-- Danh bạ nhân viên (không phải tài xế) để chọn người phụ trách / người nhận bàn giao.
-- Mọi người dùng đang hoạt động đều xem được họ tên và vai trò (không lộ email, điện thoại).
create or replace view public.staff_directory as
select p.id,
       coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)) as display_name,
       p.status,
       (select string_agg(r.name, ', ' order by r.sort_order) from public.user_roles ur join public.roles r on r.id = ur.role_id
         where ur.user_id = p.id) as role_names
from public.profiles p
where (select private.is_active_user())
  and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
              where ur.user_id = p.id and r.code <> 'driver');
revoke all on public.staff_directory from anon;
grant select on public.staff_directory to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Đơn xin nghỉ và dòng bàn giao
-- -----------------------------------------------------------------------------
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  requester_id uuid not null references public.profiles (id),
  leave_type text not null check (leave_type in ('annual', 'sick', 'unpaid', 'other')),
  start_date date not null,
  end_date date not null,
  days numeric(5,1) not null check (days > 0 and days <= 366),
  reason text check (reason is null or length(reason) <= 1000),
  handover_note text check (handover_note is null or length(handover_note) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approval_request_id uuid, -- không đặt khóa ngoại: Xóa dữ liệu thử xóa approval_requests nhưng giữ đơn nghỉ
  reject_reason text,
  decided_at timestamptz,
  cancel_reason text,
  client_request_id uuid unique,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (end_date >= start_date)
);
comment on table public.leave_requests is 'Đơn xin nghỉ (phép, ốm, không lương, khác); Giám đốc duyệt qua approval_requests (entity_type leave_request)';
create index leave_requests_requester_idx on public.leave_requests (requester_id, start_date desc);
create index leave_requests_dates_idx on public.leave_requests (start_date, end_date) where status = 'approved';
select private.attach_standard_triggers('public.leave_requests');
create trigger trg_leave_requests_code before insert on public.leave_requests for each row execute function private.fill_doc_code('NP');
create trigger trg_leave_requests_audit after insert or update or delete on public.leave_requests for each row execute function private.audit_row_change('id');

create table public.leave_handovers (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references public.leave_requests (id) on delete cascade,
  line_no integer not null default 1,
  customer_id uuid references public.customers (id),
  task text check (task is null or length(task) <= 1000),
  receiver_id uuid not null references public.profiles (id),
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  accepted_at timestamptz,
  receiver_note text check (receiver_note is null or length(receiver_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (customer_id is not null or length(trim(coalesce(task, ''))) > 0)
);
comment on table public.leave_handovers is 'Bàn giao khi nghỉ: một khách hàng (hoặc một việc) giao cho một người nhận';
create unique index leave_handovers_customer_uq on public.leave_handovers (leave_request_id, customer_id) where customer_id is not null;
create index leave_handovers_receiver_idx on public.leave_handovers (receiver_id);
create index leave_handovers_customer_idx on public.leave_handovers (customer_id) where customer_id is not null;
select private.attach_standard_triggers('public.leave_handovers');
create trigger trg_leave_handovers_audit after insert or update or delete on public.leave_handovers for each row execute function private.audit_row_change('id');

-- Ai xem được đơn: người xin nghỉ, người nhận bàn giao, người có quyền xem người dùng hoặc phê duyệt
create or replace function private.can_view_leave(p_leave_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_perm('users.view') or private.has_perm('approvals.view') or exists (
    select 1 from public.leave_requests l where l.id = p_leave_id and l.requester_id = auth.uid()) or exists (
    select 1 from public.leave_handovers h where h.leave_request_id = p_leave_id and h.receiver_id = auth.uid());
$$;
revoke all on function private.can_view_leave(uuid) from public, anon;
grant execute on function private.can_view_leave(uuid) to authenticated;

alter table public.leave_requests enable row level security;
alter table public.leave_handovers enable row level security;
create policy leave_requests_select on public.leave_requests for select to authenticated using (
  requester_id = (select auth.uid()) or (select private.has_perm('users.view')) or (select private.has_perm('approvals.view'))
  or private.can_view_leave(id));
create policy leave_handovers_select on public.leave_handovers for select to authenticated using (
  receiver_id = (select auth.uid()) or (select private.has_perm('users.view')) or (select private.has_perm('approvals.view'))
  or private.can_view_leave(leave_request_id));
-- Chỉ ghi qua các hàm nghiệp vụ bên dưới
revoke all on public.leave_requests, public.leave_handovers from anon, authenticated;
grant select on public.leave_requests, public.leave_handovers to authenticated;

-- Trường động cho biểu mẫu Xin nghỉ (module leaves)
create or replace function private.custom_field_table(p_module text)
returns text
language sql
immutable
set search_path = ''
as $$
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
  end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Loại phê duyệt "Xin nghỉ": cấp 1 = Giám đốc. Giám đốc tự nghỉ thì tự ghi nhận được (allow_self_approval).
-- -----------------------------------------------------------------------------
insert into public.approval_types (code, name, description, requires_document, requires_reject_reason, allow_self_approval, sla_hours, sort_order)
values ('leave', 'Xin nghỉ', 'Đơn xin nghỉ phép, nghỉ ốm của nhân viên; kèm bàn giao khách hàng, công việc', false, true, true, 24, 5)
on conflict (code) do nothing;
insert into public.approval_rules (approval_type_id, level, approver_role_id, min_amount, max_amount)
select t.id, 1, (select id from public.roles where code = 'director'), 0, null
from public.approval_types t
where t.code = 'leave'
  and not exists (select 1 from public.approval_rules r where r.approval_type_id = t.id);

-- -----------------------------------------------------------------------------
-- 4. Hàm phụ
-- -----------------------------------------------------------------------------
create or replace function private.leave_type_label(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p when 'annual' then 'Nghỉ phép' when 'sick' then 'Nghỉ ốm' when 'unpaid' then 'Nghỉ không lương' else 'Nghỉ khác' end;
$$;
grant execute on function private.leave_type_label(text) to authenticated;

create or replace function private.person_name(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)) from public.profiles p where p.id = p_id;
$$;
revoke all on function private.person_name(uuid) from public, anon;
grant execute on function private.person_name(uuid) to authenticated;

-- Người đang được phép làm nhân viên nhận bàn giao: đang hoạt động và có vai trò khác tài xế
create or replace function private.is_staff(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_id and p.status = 'active')
     and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_id and r.code <> 'driver');
$$;
revoke all on function private.is_staff(uuid) from public, anon;
grant execute on function private.is_staff(uuid) to authenticated;

create or replace function private.leave_period_text(l public.leave_requests)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when l.start_date = l.end_date then to_char(l.start_date, 'DD/MM/YYYY')
              else to_char(l.start_date, 'DD/MM/YYYY') || ' - ' || to_char(l.end_date, 'DD/MM/YYYY') end
         || ' (' || trim(to_char(l.days, 'FM990.0')) || ' ngày)';
$$;

-- Ghi các dòng bàn giao (dùng khi tạo đơn)
create or replace function private.write_leave_handovers(p_leave_id uuid, p_requester uuid, p_handovers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h jsonb;
  v_line int := 0;
  v_customer uuid;
  v_receiver uuid;
  v_task text;
begin
  if p_handovers is null or jsonb_typeof(p_handovers) <> 'array' then
    return;
  end if;
  if jsonb_array_length(p_handovers) > 200 then
    raise exception 'Tối đa 200 dòng bàn giao' using errcode = '22023';
  end if;
  for h in select * from jsonb_array_elements(p_handovers) loop
    v_customer := nullif(h->>'customer_id', '')::uuid;
    v_receiver := nullif(h->>'receiver_id', '')::uuid;
    v_task := nullif(trim(coalesce(h->>'task', '')), '');
    if v_customer is null and v_task is null and v_receiver is null then
      continue;
    end if;
    if v_receiver is null then
      raise exception 'Mỗi dòng bàn giao phải chọn người nhận' using errcode = '22023';
    end if;
    if v_receiver = p_requester then
      raise exception 'Không bàn giao cho chính người xin nghỉ' using errcode = '22023';
    end if;
    if not private.is_staff(v_receiver) then
      raise exception 'Người nhận bàn giao không tồn tại hoặc chưa được kích hoạt' using errcode = '22023';
    end if;
    if v_customer is null and v_task is null then
      raise exception 'Mỗi dòng bàn giao phải chọn khách hàng hoặc ghi công việc' using errcode = '22023';
    end if;
    if v_customer is not null and not exists (select 1 from public.customers c where c.id = v_customer) then
      raise exception 'Khách hàng bàn giao không tồn tại' using errcode = '22023';
    end if;
    if v_customer is not null and exists (select 1 from public.leave_handovers x where x.leave_request_id = p_leave_id and x.customer_id = v_customer) then
      raise exception 'Một khách hàng chỉ bàn giao cho một người trong cùng đơn' using errcode = '22023';
    end if;
    v_line := v_line + 1;
    insert into public.leave_handovers (leave_request_id, line_no, customer_id, task, receiver_id)
    values (p_leave_id, v_line, v_customer, v_task, v_receiver);
  end loop;
end;
$$;
revoke all on function private.write_leave_handovers(uuid, uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Tạo đơn xin nghỉ (gửi Giám đốc duyệt ngay)
--   p_handovers: [{"customer_id": "...", "receiver_id": "...", "task": "..."}]
-- -----------------------------------------------------------------------------
create or replace function public.create_leave_request(
  p_leave_type text, p_start_date date, p_end_date date, p_days numeric, p_reason text default null,
  p_handover_note text default null, p_handovers jsonb default '[]'::jsonb, p_custom jsonb default '{}'::jsonb,
  p_client_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.leave_requests;
  v_id uuid;
  v_req uuid;
  v_name text;
  v_content text;
  v_customers int;
begin
  if not private.is_active_user() or not private.is_staff(auth.uid()) then
    raise exception 'Chỉ nhân viên đang hoạt động mới tạo được đơn xin nghỉ' using errcode = '42501';
  end if;
  if p_client_request_id is not null then
    select id into v_id from public.leave_requests where client_request_id = p_client_request_id and requester_id = auth.uid();
    if v_id is not null then return v_id; end if;
  end if;
  if p_leave_type is null or p_leave_type not in ('annual', 'sick', 'unpaid', 'other') then
    raise exception 'Chọn loại nghỉ' using errcode = '22023';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception 'Chọn ngày bắt đầu và ngày kết thúc nghỉ' using errcode = '22023';
  end if;
  if p_end_date < p_start_date then
    raise exception 'Ngày kết thúc phải từ ngày bắt đầu trở đi' using errcode = '22023';
  end if;
  if p_start_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date - 30 then
    raise exception 'Ngày bắt đầu nghỉ không được trước hôm nay quá 30 ngày' using errcode = '22023';
  end if;
  if p_days is null or p_days <= 0 or p_days > (p_end_date - p_start_date + 1) or p_days * 2 <> trunc(p_days * 2) then
    raise exception 'Số ngày nghỉ phải lớn hơn 0, theo bước 0.5 và không vượt số ngày từ ngày bắt đầu đến ngày kết thúc' using errcode = '22023';
  end if;
  if p_leave_type in ('other', 'unpaid') and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Nhập lý do nghỉ' using errcode = '22023';
  end if;
  if exists (select 1 from public.leave_requests x where x.requester_id = auth.uid() and x.status in ('pending', 'approved')
             and x.start_date <= p_end_date and x.end_date >= p_start_date) then
    raise exception 'Bạn đã có đơn nghỉ trùng ngày (đang chờ duyệt hoặc đã duyệt)' using errcode = '22023';
  end if;

  insert into public.leave_requests (requester_id, leave_type, start_date, end_date, days, reason, handover_note, custom_fields, client_request_id)
  values (auth.uid(), p_leave_type, p_start_date, p_end_date, p_days, nullif(trim(coalesce(p_reason, '')), ''),
          nullif(trim(coalesce(p_handover_note, '')), ''), coalesce(p_custom, '{}'::jsonb), p_client_request_id)
  returning * into l;
  perform private.write_leave_handovers(l.id, auth.uid(), p_handovers);

  v_name := private.person_name(auth.uid());
  select count(*) into v_customers from public.leave_handovers where leave_request_id = l.id and customer_id is not null;
  v_content := private.leave_type_label(l.leave_type) || ': ' || coalesce(v_name, '') || ', ' || private.leave_period_text(l)
    || case when v_customers > 0 then ', bàn giao ' || v_customers || ' khách' else '' end
    || coalesce(' - ' || l.reason, '');
  v_req := private.submit_approval('leave', 'leave_request', l.id, null, null, left(v_content, 500), auth.uid(), null, null);
  update public.leave_requests set approval_request_id = v_req where id = l.id;
  return l.id;
end;
$$;
revoke all on function public.create_leave_request(text, date, date, numeric, text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_leave_request(text, date, date, numeric, text, text, jsonb, jsonb, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Đồng bộ trạng thái khi Giám đốc duyệt / từ chối (approval_decide đổi status của approval_requests)
-- -----------------------------------------------------------------------------
create or replace function private.leave_on_approval_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.leave_requests;
  v_name text;
  r record;
begin
  if new.entity_type <> 'leave_request' or new.status is not distinct from old.status then
    return null;
  end if;
  select * into l from public.leave_requests where id = new.entity_id and approval_request_id = new.id;
  if l.id is null or l.status <> 'pending' then
    return null;
  end if;
  if new.status = 'approved' then
    update public.leave_requests set status = 'approved', decided_at = coalesce(new.decided_at, now()) where id = l.id;
    v_name := private.person_name(l.requester_id);
    -- Báo từng người nhận bàn giao (gộp các khách hàng/việc của cùng một người)
    for r in
      select h.receiver_id,
             string_agg(coalesce(c.name, h.task), '; ' order by h.line_no) as items
      from public.leave_handovers h left join public.customers c on c.id = h.customer_id
      where h.leave_request_id = l.id
      group by h.receiver_id
    loop
      insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
      values (r.receiver_id, 'leave_handover', 'Bạn nhận bàn giao khi ' || coalesce(v_name, '') || ' nghỉ ' || private.leave_period_text(l),
              left('Bấm Nhận bàn giao để xác nhận. ' || r.items, 1000), 'leave_request', l.id, '/nghi-phep?tab=leave_handovers');
    end loop;
  elsif new.status = 'rejected' then
    update public.leave_requests set status = 'rejected', reject_reason = new.reject_reason, decided_at = coalesce(new.decided_at, now()) where id = l.id;
  elsif new.status = 'cancelled' then
    update public.leave_requests set status = 'cancelled', decided_at = coalesce(new.decided_at, now()) where id = l.id;
  end if;
  return null;
end;
$$;
create trigger trg_approval_requests_leave after update of status on public.approval_requests
for each row execute function private.leave_on_approval_status();

-- Thông báo duyệt dùng chung ghi "… 0 đ" và mở /phe-duyet: sửa lại cho đơn xin nghỉ
create or replace function private.leave_fix_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content text;
begin
  if new.entity_type = 'approval_request' and new.entity_id is not null then
    select r.content into v_content from public.approval_requests r where r.id = new.entity_id and r.entity_type = 'leave_request';
    if v_content is not null then
      if new.type in ('approval_pending', 'approval_pending_delegate') then
        new.title := 'Đơn xin nghỉ chờ duyệt';
        new.body := v_content;
        new.link := '/nghi-phep?tab=leave_requests&f_status=pending';
      elsif new.type in ('approval_approved', 'approval_rejected') then
        new.link := '/nghi-phep?tab=leave_requests';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_notifications_leave_fix before insert on public.notifications
for each row execute function private.leave_fix_notification();

-- -----------------------------------------------------------------------------
-- 7. Hủy đơn (người xin nghỉ; hoặc người có quyền users.update). Chưa hết thời gian nghỉ mới hủy được.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_leave_request(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.leave_requests;
  v_was text;
begin
  select * into l from public.leave_requests where id = p_id for update;
  if l.id is null then
    raise exception 'Không tìm thấy đơn xin nghỉ' using errcode = 'P0001';
  end if;
  if l.requester_id is distinct from auth.uid() and not private.has_perm('users.update') then
    raise exception 'Chỉ người xin nghỉ mới hủy được đơn' using errcode = '42501';
  end if;
  if l.status not in ('pending', 'approved') then
    raise exception 'Đơn đã bị từ chối hoặc đã hủy' using errcode = '22023';
  end if;
  if l.end_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Đã qua ngày nghỉ, không hủy được' using errcode = '22023';
  end if;
  v_was := l.status;
  update public.leave_requests set status = 'cancelled', cancel_reason = nullif(trim(coalesce(p_reason, '')), ''), decided_at = now()
   where id = l.id;
  if v_was = 'pending' and l.approval_request_id is not null then
    update public.approval_requests set status = 'cancelled', decided_at = now() where id = l.approval_request_id and status = 'pending';
    insert into public.approval_steps (request_id, level, action, actor_id, comment)
    values (l.approval_request_id, 0, 'cancel', auth.uid(), coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Hủy đơn xin nghỉ'));
  end if;
  if v_was = 'approved' then
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
    select distinct h.receiver_id, 'leave_handover', 'Đã hủy đơn nghỉ ' || l.code || ', không cần nhận bàn giao nữa',
           nullif(trim(coalesce(p_reason, '')), ''), 'leave_request', l.id, '/nghi-phep?tab=leave_handovers'
    from public.leave_handovers h where h.leave_request_id = l.id;
  end if;
end;
$$;
revoke all on function public.cancel_leave_request(uuid, text) from public, anon;
grant execute on function public.cancel_leave_request(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Người nhận bấm "Nhận bàn giao" (một dòng, hoặc mọi dòng của mình trong đơn khi p_all)
-- -----------------------------------------------------------------------------
create or replace function public.accept_leave_handover(p_handover_id uuid, p_note text default null, p_all boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.leave_handovers;
  l public.leave_requests;
  n int;
begin
  select * into h from public.leave_handovers where id = p_handover_id;
  if h.id is null then
    raise exception 'Không tìm thấy dòng bàn giao' using errcode = 'P0001';
  end if;
  if h.receiver_id is distinct from auth.uid() then
    raise exception 'Chỉ người được bàn giao mới bấm nhận' using errcode = '42501';
  end if;
  select * into l from public.leave_requests where id = h.leave_request_id;
  if l.status <> 'approved' then
    raise exception 'Đơn nghỉ chưa được Giám đốc duyệt (hoặc đã hủy) nên chưa nhận bàn giao được' using errcode = '22023';
  end if;
  update public.leave_handovers
     set status = 'accepted', accepted_at = now(), receiver_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), receiver_note)
   where status = 'pending' and receiver_id = auth.uid()
     and (id = h.id or (p_all and leave_request_id = h.leave_request_id));
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
    values (l.requester_id, 'leave_handover_accepted', coalesce(private.person_name(auth.uid()), 'Người nhận') || ' đã nhận bàn giao (' || n || ' mục) cho đơn ' || l.code,
            nullif(trim(coalesce(p_note, '')), ''), 'leave_request', l.id, '/nghi-phep?tab=leave_requests');
  end if;
  return n;
end;
$$;
revoke all on function public.accept_leave_handover(uuid, text, boolean) from public, anon;
grant execute on function public.accept_leave_handover(uuid, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Danh sách cho giao diện
-- -----------------------------------------------------------------------------
-- Người đang phụ trách khách hàng tại một ngày: người nhận bàn giao (đơn đã duyệt, đang trong ngày nghỉ) hoặc Nhân viên phụ trách
create or replace function public.customer_acting_manager(p_customer_id uuid, p_on date default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select h.receiver_id from public.leave_handovers h join public.leave_requests l on l.id = h.leave_request_id
      where h.customer_id = p_customer_id and l.status = 'approved'
        and coalesce(p_on, (now() at time zone 'Asia/Ho_Chi_Minh')::date) between l.start_date and l.end_date
      order by l.start_date desc limit 1),
    (select c.account_manager_id from public.customers c where c.id = p_customer_id))
  where private.is_active_user();
$$;
revoke all on function public.customer_acting_manager(uuid, date) from public, anon;
grant execute on function public.customer_acting_manager(uuid, date) to authenticated;

create or replace view public.leave_list with (security_invoker = true) as
select l.id, l.code, l.requester_id, private.person_name(l.requester_id) as requester_name,
       l.leave_type, l.start_date, l.end_date, l.days, l.reason, l.handover_note, l.status,
       l.approval_request_id, l.reject_reason, l.decided_at, l.cancel_reason, l.created_at, l.custom_fields,
       (l.status = 'approved' and (now() at time zone 'Asia/Ho_Chi_Minh')::date between l.start_date and l.end_date) as on_leave_now,
       hs.handover_count, hs.accepted_count, hs.customer_count, hs.receivers, hs.customers,
       (l.requester_id = (select auth.uid())) as is_mine,
       coalesce(hs.i_receive, false) as i_receive,
       (l.status = 'pending' and l.approval_request_id is not null and private.can_approve(l.approval_request_id)) as can_approve,
       (l.status in ('pending', 'approved') and l.end_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date
         and (l.requester_id = (select auth.uid()) or (select private.has_perm('users.update')))) as can_cancel,
       (select private.person_name(s.actor_id) from public.approval_steps s
         where s.request_id = l.approval_request_id and s.action in ('approve', 'reject') order by s.acted_at desc limit 1) as decided_by_name
from public.leave_requests l
left join lateral (
  select count(*) as handover_count,
         count(*) filter (where h.status = 'accepted') as accepted_count,
         count(*) filter (where h.customer_id is not null) as customer_count,
         string_agg(distinct private.person_name(h.receiver_id), ', ') as receivers,
         string_agg(c.name, ', ' order by h.line_no) as customers,
         bool_or(h.receiver_id = (select auth.uid())) as i_receive
  from public.leave_handovers h left join public.customers c on c.id = h.customer_id
  where h.leave_request_id = l.id) hs on true;
revoke all on public.leave_list from anon;
grant select on public.leave_list to authenticated;

create or replace view public.leave_handover_list with (security_invoker = true) as
select h.id, h.leave_request_id, l.code as leave_code, l.requester_id, private.person_name(l.requester_id) as requester_name,
       l.leave_type, l.start_date, l.end_date, l.days, l.status as leave_status,
       h.line_no, h.customer_id, c.code as customer_code, c.name as customer_name, h.task,
       coalesce(c.name, h.task) as item_label,
       h.receiver_id, private.person_name(h.receiver_id) as receiver_name,
       h.status, h.accepted_at, h.receiver_note, l.handover_note,
       (h.receiver_id = (select auth.uid())) as is_mine,
       (h.receiver_id = (select auth.uid()) and h.status = 'pending' and l.status = 'approved') as can_accept,
       (l.status = 'approved' and (now() at time zone 'Asia/Ho_Chi_Minh')::date between l.start_date and l.end_date) as active_now,
       h.created_at
from public.leave_handovers h
join public.leave_requests l on l.id = h.leave_request_id
left join public.customers c on c.id = h.customer_id;
revoke all on public.leave_handover_list from anon;
grant select on public.leave_handover_list to authenticated;
