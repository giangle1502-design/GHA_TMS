-- =============================================================================
-- GHA TMS - 0005: Chứng từ, phê duyệt, chi phí chuyến, ứng tiền, thanh toán, công nợ
-- =============================================================================
-- Nguyên tắc tài chính:
--   * Tạm ứng là khoản trả trước cho tài xế, KHÔNG phải chi phí.
--   * Chi phí chuyến chỉ được ghi nhận khi status = 'approved'.
--   * Hỗ trợ dầu là một khoản doanh thu/thu từ khách hàng, KHÔNG phải chi phí dầu thực tế.
--   * Một yêu cầu phê duyệt chỉ được ghi nhận thanh toán một lần (unique index).
--   * Mọi thao tác tài chính đi qua hàm SQL trong transaction (Giai đoạn 6-7).
-- =============================================================================

-- Chứng từ / tệp đính kèm (metadata; tệp nằm trong Supabase Storage bucket riêng tư)
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'documents',
  storage_path text not null,
  file_name text not null,
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  entity_type text not null check (entity_type in (
    'shipment', 'shipment_expense', 'advance_request', 'payment', 'vehicle', 'driver',
    'maintenance_record', 'approval_request', 'receivable', 'payable', 'transport_order', 'location', 'customer')),
  entity_id uuid not null,
  doc_type text not null default 'other' check (doc_type in (
    'delivery_note', 'invoice', 'receipt', 'photo', 'contract', 'id_card', 'registration', 'insurance', 'bank', 'other')),
  is_sensitive boolean not null default false,
  uploaded_by uuid references public.profiles (id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bucket, storage_path)
);
create index documents_entity_idx on public.documents (entity_type, entity_id) where archived_at is null;

-- Hạng mục phê duyệt (cấu hình)
create table public.approval_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  requires_document boolean not null default false,
  requires_reject_reason boolean not null default true,
  allow_self_approval boolean not null default false,
  sla_hours integer check (sla_hours > 0),
  max_amount numeric(18,2) check (max_amount >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- Cấp duyệt theo hạng mục và hạn mức
create table public.approval_rules (
  id uuid primary key default gen_random_uuid(),
  approval_type_id uuid not null references public.approval_types (id) on delete cascade,
  level integer not null check (level between 1 and 5),
  approver_role_id uuid references public.roles (id),
  approver_user_id uuid references public.profiles (id),
  min_amount numeric(18,2) not null default 0 check (min_amount >= 0),
  max_amount numeric(18,2) check (max_amount is null or max_amount >= min_amount),
  notify_role_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (approver_role_id is not null or approver_user_id is not null)
);
create index approval_rules_type_idx on public.approval_rules (approval_type_id, level);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  approval_type_id uuid not null references public.approval_types (id),
  entity_type text not null,
  entity_id uuid,
  shipment_id uuid references public.shipments (id),
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  amount numeric(18,2) check (amount >= 0),
  content text not null,
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'paid', 'cancelled', 'info_requested')),
  current_level integer not null default 1,
  required_levels integer not null default 1,
  reject_reason text,
  decided_at timestamptz,
  due_at timestamptz,
  workflow_version_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index approval_requests_status_idx on public.approval_requests (status, requested_at desc);
create index approval_requests_shipment_idx on public.approval_requests (shipment_id);

create table public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.approval_requests (id) on delete restrict,
  level integer not null,
  action text not null check (action in ('submit', 'approve', 'reject', 'request_info', 'cancel', 'revoke', 'comment', 'mark_paid')),
  actor_id uuid not null references public.profiles (id),
  acted_at timestamptz not null default now(),
  comment text
);
create unique index approval_steps_one_approve_per_level on public.approval_steps (request_id, level) where action = 'approve';
create index approval_steps_request_idx on public.approval_steps (request_id, acted_at);

-- Chi phí chuyến xe
create table public.shipment_expenses (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete restrict,
  category_id uuid not null references public.expense_categories (id),
  amount numeric(18,2) not null check (amount >= 0),
  incurred_at timestamptz not null default now(),
  note text,
  source text not null check (source in ('driver', 'admin', 'other')),
  supplier_id uuid references public.suppliers (id),
  status text not null default 'pending' check (status in ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
  approval_request_id uuid references public.approval_requests (id),
  client_request_id uuid unique, -- chống gửi trùng khi mạng chập chờn
  entered_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index shipment_expenses_shipment_idx on public.shipment_expenses (shipment_id);

-- Yêu cầu ứng tiền
create table public.advance_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  shipment_id uuid references public.shipments (id),
  driver_id uuid not null references public.drivers (id),
  amount_requested numeric(18,2) not null check (amount_requested > 0),
  amount_approved numeric(18,2) check (amount_approved >= 0),
  reason text not null,
  payment_method_id uuid references public.payment_methods (id),
  bank_account_id uuid references public.bank_accounts (id),
  note text,
  status text not null default 'pending' check (status in ('draft', 'pending', 'approved', 'rejected', 'paid', 'cancelled', 'info_requested')),
  approval_request_id uuid unique references public.approval_requests (id),
  client_request_id uuid unique,
  requested_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index advance_requests_driver_idx on public.advance_requests (driver_id, created_at desc);

-- Thanh toán / thu tiền (mọi dòng tiền thực tế)
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  direction text not null check (direction in ('in', 'out')),
  purpose text not null check (purpose in ('advance', 'advance_refund', 'expense_reimbursement', 'driver_settlement', 'receivable', 'payable', 'other')),
  payment_method_id uuid references public.payment_methods (id),
  company_bank_account_id uuid references public.bank_accounts (id),
  amount numeric(18,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  driver_id uuid references public.drivers (id),
  customer_id uuid references public.customers (id),
  supplier_id uuid references public.suppliers (id),
  shipment_id uuid references public.shipments (id),
  approval_request_id uuid references public.approval_requests (id),
  advance_request_id uuid references public.advance_requests (id),
  receivable_id uuid,
  payable_id uuid,
  reference_no text,
  note text,
  status text not null default 'posted' check (status in ('posted', 'voided')),
  void_reason text,
  idempotency_key uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (status <> 'voided' or void_reason is not null)
);
-- Một yêu cầu phê duyệt / một yêu cầu ứng chỉ được chi một lần
create unique index payments_one_per_approval on public.payments (approval_request_id) where status = 'posted' and approval_request_id is not null;
create unique index payments_one_per_advance on public.payments (advance_request_id) where status = 'posted' and purpose = 'advance';

-- Giao dịch tạm ứng (sổ phụ tạm ứng theo tài xế/chuyến)
create table public.advance_transactions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (id),
  shipment_id uuid references public.shipments (id),
  advance_request_id uuid references public.advance_requests (id),
  payment_id uuid references public.payments (id),
  txn_type text not null check (txn_type in ('disbursement', 'refund', 'settlement_offset', 'adjustment')),
  amount numeric(18,2) not null check (amount <> 0),
  occurred_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index advance_transactions_driver_idx on public.advance_transactions (driver_id, occurred_at);

-- Công nợ phải thu
create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_id uuid not null references public.customers (id),
  shipment_id uuid references public.shipments (id),
  order_id uuid references public.transport_orders (id),
  amount numeric(18,2) not null check (amount > 0),
  issued_date date not null,
  due_date date not null,
  paid_amount numeric(18,2) not null default 0 check (paid_amount >= 0),
  remaining_amount numeric(18,2) generated always as (amount - paid_amount) stored,
  status text not null default 'open' check (status in ('open', 'partial', 'paid', 'cancelled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (paid_amount <= amount),
  check (due_date >= issued_date)
);
create index receivables_customer_idx on public.receivables (customer_id, due_date);

-- Công nợ phải trả
create table public.payables (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  supplier_id uuid references public.suppliers (id),
  driver_id uuid references public.drivers (id),
  shipment_id uuid references public.shipments (id),
  maintenance_record_id uuid references public.maintenance_records (id),
  amount numeric(18,2) not null check (amount > 0),
  issued_date date not null,
  due_date date not null,
  paid_amount numeric(18,2) not null default 0 check (paid_amount >= 0),
  remaining_amount numeric(18,2) generated always as (amount - paid_amount) stored,
  status text not null default 'open' check (status in ('open', 'partial', 'paid', 'cancelled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (paid_amount <= amount),
  check (due_date >= issued_date),
  check (supplier_id is not null or driver_id is not null)
);
create index payables_supplier_idx on public.payables (supplier_id, due_date);

alter table public.payments
  add constraint payments_receivable_fk foreign key (receivable_id) references public.receivables (id),
  add constraint payments_payable_fk foreign key (payable_id) references public.payables (id);

do $$
declare t text;
begin
  foreach t in array array[
    'approval_types', 'approval_rules', 'approval_requests', 'shipment_expenses', 'advance_requests',
    'payments', 'receivables', 'payables'
  ] loop
    perform private.attach_standard_triggers(('public.' || t)::regclass);
  end loop;
end $$;

-- Mã chứng từ tự sinh
create or replace function private.fill_doc_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null or new.code = '' then
    new.code := private.next_code(tg_argv[0], now());
  end if;
  return new;
end;
$$;
create trigger trg_approval_requests_code before insert on public.approval_requests for each row execute function private.fill_doc_code('APR');
create trigger trg_advance_requests_code before insert on public.advance_requests for each row execute function private.fill_doc_code('ADV');
create trigger trg_payments_code before insert on public.payments for each row execute function private.fill_doc_code('PAY');
create trigger trg_receivables_code before insert on public.receivables for each row execute function private.fill_doc_code('AR');
create trigger trg_payables_code before insert on public.payables for each row execute function private.fill_doc_code('AP');

-- Đã duyệt thì không sửa trực tiếp số tiền / nội dung
create or replace function private.guard_approval_requests()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('approved', 'paid') and (new.amount, new.content, new.approval_type_id, new.entity_id)
       is distinct from (old.amount, old.content, old.approval_type_id, old.entity_id) then
    raise exception 'Yêu cầu đã duyệt: không được sửa số tiền hoặc nội dung. Hãy tạo yêu cầu điều chỉnh.' using errcode = '42501';
  end if;
  if old.status = 'paid' and new.status <> 'paid' then
    raise exception 'Yêu cầu đã thanh toán không thể đổi trạng thái' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;
create trigger trg_approval_requests_guard before update on public.approval_requests
for each row execute function private.guard_approval_requests();

create or replace function private.guard_approved_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'shipment_expenses' and old.status = 'approved'
     and (new.amount, new.category_id, new.shipment_id) is distinct from (old.amount, old.category_id, old.shipment_id) then
    raise exception 'Chi phí đã duyệt: không được sửa trực tiếp số tiền/loại chi phí' using errcode = '42501';
  end if;
  if tg_table_name = 'advance_requests' and old.status in ('approved', 'paid')
     and (new.amount_requested, new.amount_approved, new.driver_id) is distinct from (old.amount_requested, old.amount_approved, old.driver_id) then
    raise exception 'Yêu cầu ứng đã duyệt: không được sửa trực tiếp số tiền' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_shipment_expenses_guard before update on public.shipment_expenses
for each row execute function private.guard_approved_amount();
create trigger trg_advance_requests_guard before update on public.advance_requests
for each row execute function private.guard_approved_amount();

-- Thanh toán đã ghi nhận chỉ được hủy (void) có lý do, không được sửa số tiền hay xóa
create or replace function private.guard_payments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa thanh toán; hãy hủy (void) có lý do' using errcode = '42501';
  end if;
  if old.status = 'voided' then
    raise exception 'Thanh toán đã hủy không thể sửa' using errcode = '42501';
  end if;
  if (new.amount, new.direction, new.purpose, new.approval_request_id, new.advance_request_id, new.receivable_id, new.payable_id)
     is distinct from (old.amount, old.direction, old.purpose, old.approval_request_id, old.advance_request_id, old.receivable_id, old.payable_id) then
    raise exception 'Không được sửa số tiền/đối tượng thanh toán; hãy hủy và tạo lại' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_payments_guard before update or delete on public.payments
for each row execute function private.guard_payments();

-- Không xóa cứng chuyến đã phát sinh tài chính hoặc đã qua bước nháp
create or replace function private.guard_shipment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     or exists (select 1 from public.shipment_expenses where shipment_id = old.id)
     or exists (select 1 from public.advance_requests where shipment_id = old.id)
     or exists (select 1 from public.payments where shipment_id = old.id)
     or exists (select 1 from public.receivables where shipment_id = old.id)
     or exists (select 1 from public.payables where shipment_id = old.id)
     or exists (select 1 from public.approval_requests where shipment_id = old.id) then
    raise exception 'Chuyến đã phát sinh nghiệp vụ, chỉ được hủy (không xóa)' using errcode = '42501';
  end if;
  delete from public.shipment_status_history where shipment_id = old.id;
  delete from public.shipment_assignments where shipment_id = old.id;
  return old;
end;
$$;
create trigger trg_shipments_delete_guard before delete on public.shipments
for each row execute function private.guard_shipment_delete();
