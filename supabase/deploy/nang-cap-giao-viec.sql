-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Giao việc (Giám đốc giao việc, theo dõi tiến độ, hạn, trao đổi)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.tasks') is not null then
    raise exception 'CSDL đã được nâng cấp Giao việc (Giám đốc giao việc, theo dõi tiến độ, hạn, trao đổi) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261101000044_tasks.sql
-- =============================================================================
-- 0044: Giao việc (người dùng 01/11/2026: "Bổ sung tính năng giao việc cho giám đốc")
--   - Giám đốc (quyền tasks.create) giao việc cho một hoặc nhiều nhân viên: tiêu đề, nội dung, mức ưu tiên,
--     ngày bắt đầu, hạn (ngày + giờ), khách hàng liên quan, tệp đính kèm, trường bổ sung.
--   - Người được giao: Bắt đầu làm -> cập nhật % tiến độ -> Báo hoàn thành (kèm kết quả).
--   - Người giao: Xác nhận hoàn thành hoặc Yêu cầu làm lại (bắt buộc ghi lý do); sửa, đổi người, gia hạn, hủy.
--   - Trao đổi (bình luận) trong từng việc; mọi thay đổi trạng thái ghi vào dòng thời gian.
--   - Thông báo: giao việc, đổi hạn, bình luận, báo xong, xác nhận/làm lại, hủy, quá hạn (một lần mỗi việc).
--   - Quyền mới tasks.{view, create, delete, export}: view = xem mọi việc, create = giao việc,
--     delete = quản lý (sửa/hủy/xác nhận) việc người khác giao. Ai cũng thấy việc mình giao / được giao.
-- Không xóa dữ liệu cũ.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quyền
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, action, name, sort_order) values
  ('tasks.view', 'tasks', 'view', 'Xem tất cả - Giao việc', 2601),
  ('tasks.create', 'tasks', 'create', 'Giao việc - Giao việc', 2602),
  ('tasks.delete', 'tasks', 'delete', 'Quản lý việc người khác giao - Giao việc', 2604),
  ('tasks.export', 'tasks', 'export', 'Xuất dữ liệu - Giao việc', 2607)
on conflict (code) do nothing;

-- Mặc định: Admin toàn quyền; Giám đốc xem tất cả, giao việc, quản lý, xuất. Vai trò khác chỉ thấy việc của mình
-- (Admin cấp thêm quyền Giao việc cho Quản lý vận hành… ở Người dùng → Ma trận quyền nếu cần).
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.module = 'tasks' and r.code in ('admin', 'director')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Bảng
-- -----------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  title text not null check (length(trim(title)) between 1 and 300),
  description text check (description is null or length(description) <= 5000),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_by uuid not null references public.profiles (id),
  start_date date,
  due_date date,
  due_time time,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'submitted', 'done', 'cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  customer_id uuid references public.customers (id),
  result_note text check (result_note is null or length(result_note) <= 5000),
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  overdue_notified_at timestamptz,
  last_activity_at timestamptz not null default now(),
  client_request_id uuid unique,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (due_date is null or start_date is null or due_date >= start_date),
  check (due_time is null or due_date is not null)
);
comment on table public.tasks is 'Việc được giao (Giám đốc giao cho nhân viên), theo dõi tiến độ, hạn, kết quả';
create index tasks_assigned_by_idx on public.tasks (assigned_by, created_at desc);
create index tasks_open_due_idx on public.tasks (due_date) where status in ('todo', 'in_progress');
create index tasks_customer_idx on public.tasks (customer_id) where customer_id is not null;
select private.attach_standard_triggers('public.tasks');
create trigger trg_tasks_code before insert on public.tasks for each row execute function private.fill_doc_code('GV');
create trigger trg_tasks_audit after insert or update or delete on public.tasks for each row execute function private.audit_row_change('id');

create table public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
comment on table public.task_assignees is 'Người được giao việc (một việc giao nhiều người); seen_at = lần đầu mở xem';
create index task_assignees_user_idx on public.task_assignees (user_id);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid references public.profiles (id),
  kind text not null default 'comment' check (kind in ('comment', 'event')),
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
comment on table public.task_comments is 'Trao đổi trong việc (comment) và dòng thời gian thay đổi trạng thái (event)';
create index task_comments_task_idx on public.task_comments (task_id, created_at);

-- Trường động cho biểu mẫu Giao việc (module tasks)
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
    when 'tasks' then 'tasks'
  end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Quyền xem / quản lý
-- -----------------------------------------------------------------------------
create or replace function private.can_view_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and (
    private.has_perm('tasks.view')
    or exists (select 1 from public.tasks t where t.id = p_task_id and t.assigned_by = auth.uid())
    or exists (select 1 from public.task_assignees a where a.task_id = p_task_id and a.user_id = auth.uid()));
$$;
revoke all on function private.can_view_task(uuid) from public, anon;
grant execute on function private.can_view_task(uuid) to authenticated;

-- Người giao hoặc người có quyền tasks.delete: sửa, đổi người, gia hạn, xác nhận, làm lại, hủy
create or replace function private.can_manage_task(t public.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and (t.assigned_by = auth.uid() or private.has_perm('tasks.delete'));
$$;
revoke all on function private.can_manage_task(public.tasks) from public, anon;
grant execute on function private.can_manage_task(public.tasks) to authenticated;

create or replace function private.is_task_assignee(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.task_assignees a where a.task_id = p_task_id and a.user_id = auth.uid());
$$;
revoke all on function private.is_task_assignee(uuid) from public, anon;
grant execute on function private.is_task_assignee(uuid) to authenticated;

alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_comments enable row level security;
create policy tasks_select on public.tasks for select to authenticated using (
  assigned_by = (select auth.uid()) or (select private.has_perm('tasks.view')) or private.is_task_assignee(id));
create policy task_assignees_select on public.task_assignees for select to authenticated using (
  user_id = (select auth.uid()) or (select private.has_perm('tasks.view')) or private.can_view_task(task_id));
create policy task_comments_select on public.task_comments for select to authenticated using (private.can_view_task(task_id));
-- Chỉ ghi qua các hàm nghiệp vụ bên dưới
revoke all on public.tasks, public.task_assignees, public.task_comments from anon, authenticated;
grant select on public.tasks, public.task_assignees, public.task_comments to authenticated;

-- Tệp đính kèm của việc: ai xem được việc thì xem và tải tệp lên được (không cần quyền Chứng từ)
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check check (entity_type in (
  'shipment', 'shipment_expense', 'advance_request', 'payment', 'vehicle', 'driver', 'driver_payroll',
  'maintenance_record', 'approval_request', 'receivable', 'payable', 'transport_order', 'location', 'customer',
  'purchase_request', 'task'));
create policy documents_task_select on public.documents for select to authenticated using (
  archived_at is null and entity_type = 'task' and private.can_view_task(entity_id));
create policy documents_task_insert on public.documents for insert to authenticated with check (
  entity_type = 'task' and uploaded_by = (select auth.uid()) and storage_path like 'task/' || entity_id::text || '/%'
  and private.can_view_task(entity_id));

-- Đường dẫn task/<id việc>/<tệp>: kiểm tra quyền xem việc (an toàn khi tên thư mục không phải uuid)
create or replace function private.can_attach_task_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_name is null or split_part(p_name, '/', 1) <> 'task' then
    return false;
  end if;
  begin
    v_id := split_part(p_name, '/', 2)::uuid;
  exception when others then
    return false;
  end;
  return private.can_view_task(v_id);
end;
$$;
revoke all on function private.can_attach_task_path(text) from public, anon;
grant execute on function private.can_attach_task_path(text) to authenticated;

do $outer$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists documents_task_bucket_insert on storage.objects';
    execute $p$
      create policy documents_task_bucket_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and private.can_attach_task_path(name))
    $p$;
  end if;
end
$outer$;

-- -----------------------------------------------------------------------------
-- 4. Hàm phụ
-- -----------------------------------------------------------------------------
create or replace function private.task_due_at(p_date date, p_time time)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when p_date is null then null
              else ((p_date + coalesce(p_time, time '23:59:59'))::timestamp at time zone 'Asia/Ho_Chi_Minh') end;
$$;
grant execute on function private.task_due_at(date, time) to authenticated;

create or replace function private.task_due_text(p_date date, p_time time)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_date is null then 'không có hạn'
              else to_char(p_date, 'DD/MM/YYYY') || coalesce(' ' || to_char(p_time, 'HH24:MI'), '') end;
$$;

create or replace function private.task_status_label(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p when 'todo' then 'Chưa bắt đầu' when 'in_progress' then 'Đang làm' when 'submitted' then 'Chờ xác nhận'
                when 'done' then 'Hoàn thành' when 'cancelled' then 'Đã hủy' else p end;
$$;

create or replace function private.task_log(p_task_id uuid, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.task_comments (task_id, author_id, kind, body) values (p_task_id, auth.uid(), 'event', left(p_body, 5000));
  update public.tasks set last_activity_at = now() where id = p_task_id;
$$;
revoke all on function private.task_log(uuid, text) from public, anon, authenticated;

-- Báo cho những người liên quan đến việc (người giao + người được giao), trừ người đang thao tác
create or replace function private.task_notify(p_task_id uuid, p_type text, p_title text, p_body text,
                                               p_to_assigner boolean default true, p_to_assignees boolean default true,
                                               p_only uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
  select distinct x.uid, p_type, left(p_title, 300), left(p_body, 1000), 'task', p_task_id, '/giao-viec/' || p_task_id::text
  from (
    select t.assigned_by as uid from public.tasks t where t.id = p_task_id and p_to_assigner
    union
    select a.user_id from public.task_assignees a where a.task_id = p_task_id and p_to_assignees
  ) x
  join public.profiles p on p.id = x.uid and p.status = 'active'
  where x.uid is distinct from auth.uid() and (p_only is null or x.uid = any (p_only));
$$;
revoke all on function private.task_notify(uuid, text, text, text, boolean, boolean, uuid[]) from public, anon, authenticated;

-- Ghi danh sách người được giao (thêm người mới, bỏ người không còn trong danh sách). Trả về người mới thêm.
create or replace function private.write_task_assignees(p_task_id uuid, p_assignees uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_new uuid[];
  u uuid;
begin
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_assignees, '{}')) x where x is not null;
  if cardinality(v_ids) = 0 then
    raise exception 'Chọn ít nhất một người được giao việc' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 50 then
    raise exception 'Một việc giao tối đa 50 người' using errcode = '22023';
  end if;
  foreach u in array v_ids loop
    if not private.is_staff(u) then
      raise exception 'Người được giao không tồn tại, chưa kích hoạt hoặc là tài xế' using errcode = '22023';
    end if;
  end loop;
  select coalesce(array_agg(x), '{}') into v_new from unnest(v_ids) x
   where not exists (select 1 from public.task_assignees a where a.task_id = p_task_id and a.user_id = x);
  delete from public.task_assignees where task_id = p_task_id and not (user_id = any (v_ids));
  insert into public.task_assignees (task_id, user_id) select p_task_id, x from unnest(v_new) x;
  return v_new;
end;
$$;
revoke all on function private.write_task_assignees(uuid, uuid[]) from public, anon, authenticated;

create or replace function private.task_check_input(p_title text, p_description text, p_priority text, p_start date, p_due date, p_due_time time,
                                                    p_customer uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'Nhập tên công việc' using errcode = '22023';
  end if;
  if length(trim(p_title)) > 300 then
    raise exception 'Tên công việc tối đa 300 ký tự' using errcode = '22023';
  end if;
  if length(coalesce(p_description, '')) > 5000 then
    raise exception 'Nội dung tối đa 5000 ký tự' using errcode = '22023';
  end if;
  if coalesce(p_priority, 'normal') not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Mức ưu tiên không hợp lệ' using errcode = '22023';
  end if;
  if p_due is not null and p_start is not null and p_due < p_start then
    raise exception 'Hạn hoàn thành phải từ ngày bắt đầu trở đi' using errcode = '22023';
  end if;
  if p_due_time is not null and p_due is null then
    raise exception 'Chọn ngày hạn trước khi chọn giờ' using errcode = '22023';
  end if;
  if p_customer is not null and not exists (select 1 from public.customers c where c.id = p_customer) then
    raise exception 'Khách hàng không tồn tại' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Giao việc
-- -----------------------------------------------------------------------------
create or replace function public.create_task(
  p_title text, p_assignees uuid[], p_description text default null, p_priority text default 'normal',
  p_start_date date default null, p_due_date date default null, p_due_time time default null,
  p_customer_id uuid default null, p_custom jsonb default '{}'::jsonb, p_client_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  v_id uuid;
begin
  if not private.is_active_user() or not private.has_perm('tasks.create') then
    raise exception 'Bạn chưa có quyền giao việc (quyền Giao việc → Giao việc)' using errcode = '42501';
  end if;
  if p_client_request_id is not null then
    select id into v_id from public.tasks where client_request_id = p_client_request_id and assigned_by = auth.uid();
    if v_id is not null then return v_id; end if;
  end if;
  perform private.task_check_input(p_title, p_description, p_priority, p_start_date, p_due_date, p_due_time, p_customer_id);

  insert into public.tasks (title, description, priority, assigned_by, start_date, due_date, due_time, customer_id, custom_fields, client_request_id)
  values (trim(p_title), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_priority, 'normal'), auth.uid(),
          p_start_date, p_due_date, p_due_time, p_customer_id, coalesce(p_custom, '{}'::jsonb), p_client_request_id)
  returning * into t;
  perform private.write_task_assignees(t.id, p_assignees);
  perform private.task_log(t.id, 'Giao việc cho ' || (select string_agg(private.person_name(a.user_id), ', ') from public.task_assignees a where a.task_id = t.id)
    || ', hạn ' || private.task_due_text(t.due_date, t.due_time));
  perform private.task_notify(t.id, 'task_assigned',
    case when t.priority = 'urgent' then '[GẤP] ' else '' end || coalesce(private.person_name(auth.uid()), 'Giám đốc') || ' giao việc: ' || t.title,
    'Hạn ' || private.task_due_text(t.due_date, t.due_time) || coalesce('. ' || t.description, ''), false, true);
  return t.id;
end;
$$;
revoke all on function public.create_task(text, uuid[], text, text, date, date, time, uuid, jsonb, uuid) from public, anon;
grant execute on function public.create_task(text, uuid[], text, text, date, date, time, uuid, jsonb, uuid) to authenticated;

-- Sửa việc (người giao / người có tasks.delete): nội dung, ưu tiên, ngày, người được giao, khách, trường bổ sung
create or replace function public.update_task(
  p_id uuid, p_title text, p_assignees uuid[], p_description text default null, p_priority text default 'normal',
  p_start_date date default null, p_due_date date default null, p_due_time time default null,
  p_customer_id uuid default null, p_custom jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  v_new uuid[];
  v_changes text[] := '{}';
begin
  select * into t from public.tasks where id = p_id for update;
  if t.id is null then
    raise exception 'Không tìm thấy công việc' using errcode = 'P0001';
  end if;
  if not private.can_manage_task(t) then
    raise exception 'Chỉ người giao việc mới sửa được' using errcode = '42501';
  end if;
  if t.status in ('done', 'cancelled') then
    raise exception 'Việc đã hoàn thành hoặc đã hủy, không sửa được' using errcode = '22023';
  end if;
  perform private.task_check_input(p_title, p_description, p_priority, p_start_date, p_due_date, p_due_time, p_customer_id);

  if (t.due_date, t.due_time) is distinct from (p_due_date, p_due_time) then
    v_changes := v_changes || ('đổi hạn ' || private.task_due_text(t.due_date, t.due_time) || ' → ' || private.task_due_text(p_due_date, p_due_time));
  end if;
  if t.priority <> coalesce(p_priority, 'normal') then
    v_changes := v_changes || 'đổi mức ưu tiên'::text;
  end if;
  if t.title <> trim(p_title) or t.description is distinct from nullif(trim(coalesce(p_description, '')), '') then
    v_changes := v_changes || 'sửa nội dung'::text;
  end if;
  update public.tasks
     set title = trim(p_title), description = nullif(trim(coalesce(p_description, '')), ''), priority = coalesce(p_priority, 'normal'),
         start_date = p_start_date, due_date = p_due_date, due_time = p_due_time, customer_id = p_customer_id,
         custom_fields = coalesce(p_custom, custom_fields),
         overdue_notified_at = case when (t.due_date, t.due_time) is distinct from (p_due_date, p_due_time) then null else overdue_notified_at end
   where id = t.id;
  v_new := private.write_task_assignees(t.id, p_assignees);
  if cardinality(v_new) > 0 then
    v_changes := v_changes || ('thêm người: ' || (select string_agg(private.person_name(x), ', ') from unnest(v_new) x));
  end if;
  if cardinality(v_changes) > 0 then
    perform private.task_log(t.id, 'Sửa việc: ' || array_to_string(v_changes, '; '));
  end if;
  if cardinality(v_new) > 0 then
    perform private.task_notify(t.id, 'task_assigned', coalesce(private.person_name(auth.uid()), 'Giám đốc') || ' giao việc: ' || trim(p_title),
      'Hạn ' || private.task_due_text(p_due_date, p_due_time) || coalesce('. ' || nullif(trim(coalesce(p_description, '')), ''), ''), false, true, v_new);
  end if;
  if (t.due_date, t.due_time) is distinct from (p_due_date, p_due_time) then
    perform private.task_notify(t.id, 'task_updated', 'Đổi hạn việc ' || t.code || ': ' || private.task_due_text(p_due_date, p_due_time),
      trim(p_title), false, true);
  end if;
end;
$$;
revoke all on function public.update_task(uuid, text, uuid[], text, text, date, date, time, uuid, jsonb) from public, anon;
grant execute on function public.update_task(uuid, text, uuid[], text, text, date, date, time, uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Đổi trạng thái
--   start    (người được giao) Chưa bắt đầu -> Đang làm
--   progress (người được giao) cập nhật % tiến độ (kèm ghi chú)
--   submit   (người được giao) -> Chờ xác nhận (người giao tự làm thì Hoàn thành luôn); p_note = kết quả
--   approve  (người giao)      Chờ xác nhận -> Hoàn thành
--   reopen   (người giao)      Chờ xác nhận / Hoàn thành -> Đang làm (bắt buộc lý do)
--   cancel   (người giao)      -> Đã hủy (bắt buộc lý do)
-- -----------------------------------------------------------------------------
create or replace function public.task_action(p_id uuid, p_action text, p_note text default null, p_progress integer default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_me text := coalesce(private.person_name(auth.uid()), 'Người dùng');
  v_assignee boolean;
  v_manage boolean;
  v_status text;
begin
  select * into t from public.tasks where id = p_id for update;
  if t.id is null or not private.can_view_task(t.id) then
    raise exception 'Không tìm thấy công việc' using errcode = 'P0001';
  end if;
  v_assignee := private.is_task_assignee(t.id);
  v_manage := private.can_manage_task(t);
  if length(coalesce(v_note, '')) > 5000 then
    raise exception 'Ghi chú tối đa 5000 ký tự' using errcode = '22023';
  end if;

  if p_action in ('start', 'progress', 'submit') then
    if not v_assignee then
      raise exception 'Chỉ người được giao mới cập nhật tiến độ việc này' using errcode = '42501';
    end if;
    if t.status not in ('todo', 'in_progress') then
      raise exception 'Việc đang ở trạng thái "%", không cập nhật tiến độ được', private.task_status_label(t.status) using errcode = '22023';
    end if;
  end if;

  if p_action = 'start' then
    update public.tasks set status = 'in_progress', started_at = coalesce(started_at, now()) where id = t.id;
    perform private.task_log(t.id, v_me || ' bắt đầu làm' || coalesce(': ' || v_note, ''));
    perform private.task_notify(t.id, 'task_progress', v_me || ' bắt đầu làm việc ' || t.code, t.title, true, false);
    v_status := 'in_progress';
  elsif p_action = 'progress' then
    if p_progress is null or p_progress < 0 or p_progress > 100 then
      raise exception 'Tiến độ từ 0 đến 100%%' using errcode = '22023';
    end if;
    update public.tasks set status = 'in_progress', started_at = coalesce(started_at, now()), progress = p_progress where id = t.id;
    perform private.task_log(t.id, v_me || ' cập nhật tiến độ ' || t.progress || '% → ' || p_progress || '%' || coalesce(': ' || v_note, ''));
    perform private.task_notify(t.id, 'task_progress', 'Việc ' || t.code || ' đạt ' || p_progress || '%', coalesce(v_note, t.title), true, false);
    v_status := 'in_progress';
  elsif p_action = 'submit' then
    v_status := case when t.assigned_by = auth.uid() then 'done' else 'submitted' end;
    update public.tasks
       set status = v_status, progress = 100, result_note = coalesce(v_note, result_note), started_at = coalesce(started_at, now()),
           submitted_at = now(), completed_at = case when v_status = 'done' then now() else null end
     where id = t.id;
    perform private.task_log(t.id, v_me || ' báo hoàn thành' || coalesce(': ' || v_note, ''));
    perform private.task_notify(t.id, 'task_submitted', v_me || ' báo xong việc ' || t.code || ', chờ xác nhận', coalesce(v_note, t.title), true, false);
  elsif p_action in ('approve', 'reopen', 'cancel') then
    if not v_manage then
      raise exception 'Chỉ người giao việc mới xác nhận, yêu cầu làm lại hoặc hủy' using errcode = '42501';
    end if;
    if p_action = 'approve' then
      if t.status not in ('submitted', 'in_progress', 'todo') then
        raise exception 'Việc đang ở trạng thái "%"', private.task_status_label(t.status) using errcode = '22023';
      end if;
      update public.tasks set status = 'done', progress = 100, completed_at = now(), submitted_at = coalesce(submitted_at, now()) where id = t.id;
      perform private.task_log(t.id, v_me || ' xác nhận hoàn thành' || coalesce(': ' || v_note, ''));
      perform private.task_notify(t.id, 'task_done', 'Việc ' || t.code || ' đã được xác nhận hoàn thành', coalesce(v_note, t.title), false, true);
      v_status := 'done';
    elsif p_action = 'reopen' then
      if t.status not in ('submitted', 'done') then
        raise exception 'Chỉ yêu cầu làm lại việc đã báo xong hoặc đã hoàn thành' using errcode = '22023';
      end if;
      if v_note is null then
        raise exception 'Ghi lý do yêu cầu làm lại' using errcode = '22023';
      end if;
      update public.tasks set status = 'in_progress', progress = least(progress, 90), completed_at = null, overdue_notified_at = null where id = t.id;
      perform private.task_log(t.id, v_me || ' yêu cầu làm lại: ' || v_note);
      perform private.task_notify(t.id, 'task_reopened', 'Yêu cầu làm lại việc ' || t.code, v_note, false, true);
      v_status := 'in_progress';
    else
      if t.status in ('done', 'cancelled') then
        raise exception 'Việc đã hoàn thành hoặc đã hủy' using errcode = '22023';
      end if;
      if v_note is null then
        raise exception 'Ghi lý do hủy việc' using errcode = '22023';
      end if;
      update public.tasks set status = 'cancelled', cancelled_at = now(), cancel_reason = v_note where id = t.id;
      perform private.task_log(t.id, v_me || ' hủy việc: ' || v_note);
      perform private.task_notify(t.id, 'task_cancelled', 'Đã hủy việc ' || t.code || ': ' || t.title, v_note, false, true);
      v_status := 'cancelled';
    end if;
  else
    raise exception 'Thao tác không hợp lệ' using errcode = '22023';
  end if;
  return v_status;
end;
$$;
revoke all on function public.task_action(uuid, text, text, integer) from public, anon;
grant execute on function public.task_action(uuid, text, text, integer) to authenticated;

-- Trao đổi trong việc
create or replace function public.add_task_comment(p_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  v_id uuid;
  v_body text := trim(coalesce(p_body, ''));
begin
  select * into t from public.tasks where id = p_id;
  if t.id is null or not private.can_view_task(t.id) then
    raise exception 'Không tìm thấy công việc' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 then
    raise exception 'Nhập nội dung trao đổi' using errcode = '22023';
  end if;
  if length(v_body) > 5000 then
    raise exception 'Nội dung tối đa 5000 ký tự' using errcode = '22023';
  end if;
  insert into public.task_comments (task_id, author_id, kind, body) values (t.id, auth.uid(), 'comment', v_body) returning id into v_id;
  update public.tasks set last_activity_at = now() where id = t.id;
  perform private.task_notify(t.id, 'task_comment', coalesce(private.person_name(auth.uid()), 'Người dùng') || ' trao đổi trong việc ' || t.code, v_body, true, true);
  return v_id;
end;
$$;
revoke all on function public.add_task_comment(uuid, text) from public, anon;
grant execute on function public.add_task_comment(uuid, text) to authenticated;

-- Người được giao mở xem việc lần đầu (người giao thấy "Đã xem")
create or replace function public.mark_task_seen(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.task_assignees set seen_at = now() where task_id = p_id and user_id = auth.uid() and seen_at is null;
$$;
revoke all on function public.mark_task_seen(uuid) from public, anon;
grant execute on function public.mark_task_seen(uuid) to authenticated;

-- Báo quá hạn: mỗi việc báo một lần (đổi hạn hoặc làm lại thì báo lại). Gọi khi mở trang Giao việc / Thông báo.
create or replace function public.task_overdue_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  if not private.is_active_user() then
    return 0;
  end if;
  for r in
    update public.tasks t set overdue_notified_at = now()
     where t.status in ('todo', 'in_progress') and t.overdue_notified_at is null and t.due_date is not null
       and t.due_date <= (now() at time zone 'Asia/Ho_Chi_Minh')::date
       and private.task_due_at(t.due_date, t.due_time) < now()
    returning t.id, t.code, t.title, t.assigned_by, t.due_date, t.due_time
  loop
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
    select distinct x.uid, 'task_overdue', left('Quá hạn: việc ' || r.code || ' (hạn ' || private.task_due_text(r.due_date, r.due_time) || ')', 300),
           left(r.title, 1000), 'task', r.id, '/giao-viec/' || r.id::text
    from (select r.assigned_by as uid union select a.user_id from public.task_assignees a where a.task_id = r.id) x
    join public.profiles p on p.id = x.uid and p.status = 'active';
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.task_overdue_sweep() from public, anon;
grant execute on function public.task_overdue_sweep() to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Danh sách, báo cáo
-- -----------------------------------------------------------------------------
create or replace view public.task_list with (security_invoker = true) as
select t.id, t.code, t.title, t.description, t.priority, t.status, t.progress,
       t.assigned_by, private.person_name(t.assigned_by) as assigner_name,
       a.assignee_ids, a.assignee_names, a.assignee_count, a.seen_count,
       t.start_date, t.due_date, t.due_time, private.task_due_at(t.due_date, t.due_time) as due_at,
       (t.status in ('todo', 'in_progress', 'submitted') and t.due_date is not null and private.task_due_at(t.due_date, t.due_time) < now()) as is_overdue,
       case when t.status in ('todo', 'in_progress', 'submitted') and t.due_date is not null
            then t.due_date - (now() at time zone 'Asia/Ho_Chi_Minh')::date end as days_left,
       (t.status = 'done' and t.due_date is not null and coalesce(t.submitted_at, t.completed_at) > private.task_due_at(t.due_date, t.due_time)) as done_late,
       t.customer_id, c.name as customer_name,
       t.result_note, t.started_at, t.submitted_at, t.completed_at, t.cancelled_at, t.cancel_reason, t.last_activity_at,
       (select count(*) from public.task_comments m where m.task_id = t.id and m.kind = 'comment') as comment_count,
       (select count(*) from public.documents d where d.entity_type = 'task' and d.entity_id = t.id and d.archived_at is null) as file_count,
       coalesce(a.i_am_assignee, false) as is_mine,
       (t.assigned_by = (select auth.uid())) as assigned_by_me,
       (t.status in ('todo', 'in_progress') and coalesce(a.i_am_assignee, false)) as can_work,
       (t.status in ('todo', 'in_progress', 'submitted') and private.can_manage_task(t)) as can_edit,
       (t.status = 'submitted' and private.can_manage_task(t)) as can_confirm,
       (t.status in ('todo', 'in_progress', 'submitted') and coalesce(a.i_am_assignee, false) and a.my_seen_at is null) as is_new_for_me,
       t.custom_fields, t.created_at, t.updated_at
from public.tasks t
left join public.customers c on c.id = t.customer_id
left join lateral (
  select array_agg(x.user_id order by x.created_at) as assignee_ids,
         string_agg(private.person_name(x.user_id), ', ' order by x.created_at) as assignee_names,
         count(*) as assignee_count,
         count(x.seen_at) as seen_count,
         bool_or(x.user_id = (select auth.uid())) as i_am_assignee,
         max(x.seen_at) filter (where x.user_id = (select auth.uid())) as my_seen_at
  from public.task_assignees x where x.task_id = t.id) a on true;
revoke all on public.task_list from anon;
grant select on public.task_list to authenticated;

create or replace view public.task_comment_list with (security_invoker = true) as
select m.id, m.task_id, m.author_id, private.person_name(m.author_id) as author_name, m.kind, m.body, m.created_at,
       (m.author_id = (select auth.uid())) as is_mine
from public.task_comments m;
revoke all on public.task_comment_list from anon;
grant select on public.task_comment_list to authenticated;

create or replace view public.task_assignee_list with (security_invoker = true) as
select a.task_id, a.user_id, private.person_name(a.user_id) as user_name, a.seen_at, a.created_at
from public.task_assignees a;
revoke all on public.task_assignee_list from anon;
grant select on public.task_assignee_list to authenticated;

-- Báo cáo theo người được giao (RLS: chỉ tính các việc người xem thấy được)
create or replace view public.report_task_by_person with (security_invoker = true) as
select a.user_id, private.person_name(a.user_id) as person_name,
       count(*) as total_count,
       count(*) filter (where t.status in ('todo', 'in_progress')) as open_count,
       count(*) filter (where t.status in ('todo', 'in_progress', 'submitted') and t.due_date is not null
                          and private.task_due_at(t.due_date, t.due_time) < now()) as overdue_count,
       count(*) filter (where t.status = 'submitted') as submitted_count,
       count(*) filter (where t.status = 'done') as done_count,
       count(*) filter (where t.status = 'done' and (t.due_date is null
                          or coalesce(t.submitted_at, t.completed_at) <= private.task_due_at(t.due_date, t.due_time))) as on_time_count,
       count(*) filter (where t.status = 'done' and t.due_date is not null
                          and coalesce(t.submitted_at, t.completed_at) > private.task_due_at(t.due_date, t.due_time)) as late_count,
       round(100.0 * count(*) filter (where t.status = 'done' and (t.due_date is null
                          or coalesce(t.submitted_at, t.completed_at) <= private.task_due_at(t.due_date, t.due_time)))
             / nullif(count(*) filter (where t.status = 'done'), 0), 1) as on_time_rate,
       max(t.last_activity_at) as last_activity_at
from public.task_assignees a
join public.tasks t on t.id = a.task_id and t.status <> 'cancelled'
group by a.user_id;
revoke all on public.report_task_by_person from anon;
grant select on public.report_task_by_person to authenticated;

commit;
