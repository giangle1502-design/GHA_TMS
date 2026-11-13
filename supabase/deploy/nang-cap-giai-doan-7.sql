-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Giai đoạn 7 (đối soát lương tài xế, công nợ, báo cáo)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.driver_payrolls') is not null then
    raise exception 'CSDL đã được nâng cấp Giai đoạn 7 (đối soát lương tài xế, công nợ, báo cáo) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261022000017_payroll_debts_reports.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0017: Giai đoạn 7
--   1. Đối soát lương tài xế cuối tháng: lương + chi phí tài xế tự trả - tiền đã ứng = thực nhận.
--      Kế toán lập bảng lương -> Giám đốc duyệt -> Kế toán trả lương (ghi phiếu chi và cấn trừ tiền ứng).
--   2. Công nợ phải thu (lập từ các chuyến đã hoàn thành) và phải trả, thu/trả nhiều lần, hủy phiếu có lý do.
--   3. Báo cáo: lợi nhuận từng chuyến, theo tháng, theo xe, tài xế, khách hàng, loại chi phí, số dư tạm ứng.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Bảng lương tài xế theo tháng
-- -----------------------------------------------------------------------------
create table public.driver_payrolls (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  driver_id uuid not null references public.drivers (id),
  period_month date not null check (extract(day from period_month) = 1),
  trip_count integer not null default 0 check (trip_count >= 0),
  base_salary numeric(18,2) not null default 0 check (base_salary >= 0),
  per_trip_salary numeric(18,2) not null default 0 check (per_trip_salary >= 0),
  trip_salary numeric(18,2) not null default 0 check (trip_salary >= 0),
  meal_allowance numeric(18,2) not null default 0 check (meal_allowance >= 0),
  other_allowance numeric(18,2) not null default 0 check (other_allowance >= 0),
  bonus numeric(18,2) not null default 0 check (bonus >= 0),
  deduction numeric(18,2) not null default 0 check (deduction >= 0),
  expense_count integer not null default 0,
  expense_reimbursement numeric(18,2) not null default 0 check (expense_reimbursement >= 0),
  advance_balance numeric(18,2) not null default 0,
  advance_offset numeric(18,2) not null default 0 check (advance_offset >= 0),
  gross_amount numeric(18,2) not null default 0,
  net_amount numeric(18,2) not null default 0 check (net_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  approval_request_id uuid references public.approval_requests (id),
  payment_id uuid references public.payments (id),
  paid_at timestamptz,
  cancel_reason text,
  note text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
-- Mỗi tài xế một bảng lương còn hiệu lực cho một tháng
create unique index driver_payrolls_one_per_month on public.driver_payrolls (driver_id, period_month)
  where status not in ('cancelled', 'rejected');
create index driver_payrolls_period_idx on public.driver_payrolls (period_month desc);
create trigger trg_driver_payrolls_code before insert on public.driver_payrolls for each row execute function private.fill_doc_code('BL');
select private.attach_standard_triggers('public.driver_payrolls'::regclass);
create trigger trg_driver_payrolls_audit after insert or update or delete on public.driver_payrolls
  for each row execute function private.audit_row_change('id');

-- Bảng lương đã duyệt / đã trả thì không sửa số tiền
create or replace function private.guard_driver_payrolls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa bảng lương; hãy hủy có lý do' using errcode = '42501';
  end if;
  if old.status = 'paid' and new.status <> 'paid' then
    raise exception 'Bảng lương đã trả không thể đổi trạng thái' using errcode = '42501';
  end if;
  if (new.driver_id, new.period_month, new.net_amount, new.advance_offset, new.expense_reimbursement, new.gross_amount)
     is distinct from (old.driver_id, old.period_month, old.net_amount, old.advance_offset, old.expense_reimbursement, old.gross_amount) then
    raise exception 'Không được sửa số tiền bảng lương; hãy hủy và lập lại' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_driver_payrolls_guard before update or delete on public.driver_payrolls
  for each row execute function private.guard_driver_payrolls();

alter table public.driver_payrolls enable row level security;
create policy driver_payrolls_select on public.driver_payrolls for select to authenticated
  using (private.has_perm('settlements.view') or driver_id = private.my_driver_id());
-- Không có policy ghi: mọi thao tác qua hàm nghiệp vụ

-- Chi phí tài xế tự trả đã được hoàn vào bảng lương nào
alter table public.shipment_expenses add column payroll_id uuid references public.driver_payrolls (id);
create index shipment_expenses_payroll_idx on public.shipment_expenses (payroll_id);

alter table public.payments add column payroll_id uuid references public.driver_payrolls (id);
create unique index payments_one_per_payroll on public.payments (payroll_id) where status = 'posted' and payroll_id is not null;
alter table public.advance_transactions add column payroll_id uuid references public.driver_payrolls (id);

alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check check (entity_type in (
  'shipment', 'shipment_expense', 'advance_request', 'payment', 'vehicle', 'driver', 'driver_payroll',
  'maintenance_record', 'approval_request', 'receivable', 'payable', 'transport_order', 'location', 'customer'));

-- Loại phê duyệt bảng lương: Giám đốc duyệt một cấp (theo quy trình khách hàng chốt 22/10/2026)
insert into public.approval_types (code, name, requires_document, sla_hours, sort_order)
values ('driver_payroll', 'Duyệt bảng lương tài xế', false, 72, 3)
on conflict (code) do nothing;
insert into public.approval_rules (approval_type_id, level, approver_role_id, min_amount, max_amount)
select t.id, 1, (select id from public.roles where code = 'director'), 0, null
from public.approval_types t
where t.code = 'driver_payroll'
  and not exists (select 1 from public.approval_rules r where r.approval_type_id = t.id);

-- Số dư tạm ứng tài xế đang giữ (đã chuyển - đã hoàn/cấn trừ), trừ phần đã đưa vào bảng lương chưa trả
create or replace function private.driver_advance_balance(p_driver_id uuid, p_exclude_payroll uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select sum(case when t.txn_type in ('disbursement', 'adjustment') then t.amount else -t.amount end)
    from public.advance_transactions t where t.driver_id = p_driver_id), 0)
  - coalesce((
    select sum(p.advance_offset) from public.driver_payrolls p
    where p.driver_id = p_driver_id and p.status in ('pending', 'approved')
      and p.id is distinct from p_exclude_payroll), 0);
$$;
revoke all on function private.driver_advance_balance(uuid, uuid) from public, anon, authenticated;

-- Tính bảng lương (không ghi): trả về các khoản để xem trước và để lập bảng lương
create or replace function private.payroll_compute(p_driver_id uuid, p_month date, p_bonus numeric, p_deduction numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.drivers;
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_trips int;
  v_exp_count int;
  v_exp numeric;
  v_balance numeric;
  v_trip_salary numeric;
  v_gross numeric;
  v_offset numeric;
begin
  select * into d from public.drivers where id = p_driver_id;
  if d.id is null then
    raise exception 'Không tìm thấy tài xế' using errcode = 'P0001';
  end if;
  if coalesce(p_bonus, 0) < 0 or coalesce(p_deduction, 0) < 0 then
    raise exception 'Thưởng và khấu trừ không được âm' using errcode = '22023';
  end if;
  select count(*) into v_trips from public.shipments s
  where s.driver_id = d.id and s.status in ('driver_completed', 'closed')
    and (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to;
  select count(*), coalesce(sum(e.amount), 0) into v_exp_count, v_exp from public.shipment_expenses e
  where e.driver_id = d.id and e.paid_by = 'driver' and e.status = 'approved' and e.payroll_id is null
    and (e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= v_to;
  v_balance := greatest(private.driver_advance_balance(d.id), 0);
  v_trip_salary := v_trips * coalesce(d.per_trip_salary, 0);
  v_gross := coalesce(d.base_salary, 0) + v_trip_salary + coalesce(d.meal_allowance, 0) + coalesce(d.other_allowance, 0)
             + coalesce(p_bonus, 0) - coalesce(p_deduction, 0) + v_exp;
  -- Cấn trừ tối đa bằng số được nhận; phần tạm ứng còn lại chuyển sang tháng sau
  v_offset := least(v_balance, greatest(v_gross, 0));
  return jsonb_build_object(
    'driver_id', d.id, 'driver_name', d.full_name, 'period_month', v_from, 'period_from', v_from, 'period_to', v_to,
    'trip_count', v_trips, 'base_salary', coalesce(d.base_salary, 0), 'per_trip_salary', coalesce(d.per_trip_salary, 0),
    'trip_salary', v_trip_salary, 'meal_allowance', coalesce(d.meal_allowance, 0), 'other_allowance', coalesce(d.other_allowance, 0),
    'bonus', coalesce(p_bonus, 0), 'deduction', coalesce(p_deduction, 0),
    'expense_count', v_exp_count, 'expense_reimbursement', v_exp,
    'advance_balance', v_balance, 'advance_offset', v_offset,
    'gross_amount', v_gross, 'net_amount', greatest(v_gross - v_offset, 0),
    'advance_carry', v_balance - v_offset,
    'existing', (select p.code from public.driver_payrolls p where p.driver_id = d.id and p.period_month = v_from
                   and p.status not in ('cancelled', 'rejected') limit 1));
end;
$$;
revoke all on function private.payroll_compute(uuid, date, numeric, numeric) from public, anon, authenticated;

create or replace function public.driver_payroll_preview(p_driver_id uuid, p_month date, p_bonus numeric default 0, p_deduction numeric default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền lập bảng lương' using errcode = '42501';
  end if;
  return private.payroll_compute(p_driver_id, p_month, p_bonus, p_deduction);
end;
$$;

create or replace function private.payroll_insert(p_driver_id uuid, p_month date, p_bonus numeric, p_deduction numeric, p_note text, p_custom_fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  v_id uuid;
  v_to date;
begin
  -- Khóa theo tài xế để hai người lập cùng lúc không trùng
  perform 1 from public.drivers where id = p_driver_id for update;
  c := private.payroll_compute(p_driver_id, p_month, p_bonus, p_deduction);
  if c ->> 'existing' is not null then
    raise exception 'Tài xế đã có bảng lương tháng này (%). Hủy bảng cũ nếu muốn lập lại.', c ->> 'existing' using errcode = '23505';
  end if;
  if (c ->> 'gross_amount')::numeric < 0 then
    raise exception 'Khấu trừ lớn hơn tổng lương, kiểm tra lại số tiền' using errcode = '22023';
  end if;
  v_to := (c ->> 'period_to')::date;
  insert into public.driver_payrolls (driver_id, period_month, trip_count, base_salary, per_trip_salary, trip_salary,
    meal_allowance, other_allowance, bonus, deduction, expense_count, expense_reimbursement, advance_balance, advance_offset,
    gross_amount, net_amount, note, custom_fields)
  values (p_driver_id, (c ->> 'period_month')::date, (c ->> 'trip_count')::int, (c ->> 'base_salary')::numeric,
    (c ->> 'per_trip_salary')::numeric, (c ->> 'trip_salary')::numeric, (c ->> 'meal_allowance')::numeric,
    (c ->> 'other_allowance')::numeric, (c ->> 'bonus')::numeric, (c ->> 'deduction')::numeric, (c ->> 'expense_count')::int,
    (c ->> 'expense_reimbursement')::numeric, (c ->> 'advance_balance')::numeric, (c ->> 'advance_offset')::numeric,
    (c ->> 'gross_amount')::numeric, (c ->> 'net_amount')::numeric, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_custom_fields, '{}'))
  returning id into v_id;
  update public.shipment_expenses set payroll_id = v_id
  where driver_id = p_driver_id and paid_by = 'driver' and status = 'approved' and payroll_id is null
    and (incurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= v_to;
  update public.driver_payrolls set approval_request_id = private.submit_approval(
      'driver_payroll', 'driver_payroll', v_id, null, (c ->> 'net_amount')::numeric,
      'Lương tháng ' || to_char((c ->> 'period_month')::date, 'MM/YYYY') || ' - ' || (c ->> 'driver_name'),
      auth.uid(), p_driver_id, null)
  where id = v_id;
  return v_id;
end;
$$;
revoke all on function private.payroll_insert(uuid, date, numeric, numeric, text, jsonb) from public, anon, authenticated;

create or replace function public.create_driver_payroll(
  p_driver_id uuid, p_month date, p_bonus numeric default 0, p_deduction numeric default 0,
  p_note text default null, p_custom_fields jsonb default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền lập bảng lương' using errcode = '42501';
  end if;
  v_id := private.payroll_insert(p_driver_id, p_month, p_bonus, p_deduction, p_note, p_custom_fields);
  return (select code from public.driver_payrolls where id = v_id);
end;
$$;

-- Lập bảng lương cho mọi tài xế đang làm việc có phát sinh trong tháng (bỏ qua tài xế đã có bảng)
create or replace function public.create_driver_payrolls_for_month(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  n int := 0;
  skipped int := 0;
  v_from date := date_trunc('month', p_month)::date;
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền lập bảng lương' using errcode = '42501';
  end if;
  for d in
    select dr.id from public.drivers dr
    where dr.archived_at is null and (dr.status <> 'terminated'
      or exists (select 1 from public.shipments s where s.driver_id = dr.id
                   and (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date >= v_from))
    order by dr.full_name
  loop
    if exists (select 1 from public.driver_payrolls p where p.driver_id = d.id and p.period_month = v_from and p.status not in ('cancelled', 'rejected')) then
      skipped := skipped + 1;
      continue;
    end if;
    -- Bỏ qua tài xế không có lương, không chuyến, không chi phí, không tạm ứng
    if (private.payroll_compute(d.id, v_from, 0, 0) ->> 'gross_amount')::numeric = 0
       and private.driver_advance_balance(d.id) = 0 then
      continue;
    end if;
    perform private.payroll_insert(d.id, v_from, 0, 0, null, '{}');
    n := n + 1;
  end loop;
  return jsonb_build_object('created', n, 'skipped', skipped);
end;
$$;

create or replace function public.cancel_driver_payroll(p_payroll_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.driver_payrolls;
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền hủy bảng lương' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Nhập lý do hủy' using errcode = '22023';
  end if;
  select * into p from public.driver_payrolls where id = p_payroll_id for update;
  if p.id is null then
    raise exception 'Không tìm thấy bảng lương' using errcode = 'P0001';
  end if;
  if p.status = 'paid' then
    raise exception 'Bảng lương đã trả, không hủy được' using errcode = '22023';
  end if;
  if p.status = 'cancelled' then
    return;
  end if;
  update public.driver_payrolls set status = 'cancelled', cancel_reason = trim(p_reason) where id = p.id;
  update public.shipment_expenses set payroll_id = null where payroll_id = p.id;
  if p.approval_request_id is not null then
    update public.approval_requests set status = 'cancelled', decided_at = coalesce(decided_at, now())
    where id = p.approval_request_id and status in ('pending', 'approved');
    insert into public.approval_steps (request_id, level, action, actor_id, comment)
    values (p.approval_request_id, 99, 'cancel', auth.uid(), trim(p_reason));
  end if;
end;
$$;

create or replace function public.pay_driver_payroll(
  p_payroll_id uuid, p_payment_method_id uuid default null, p_company_bank_account_id uuid default null,
  p_reference_no text default null, p_paid_at timestamptz default null, p_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.driver_payrolls;
  pay public.payments;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền trả lương' using errcode = '42501';
  end if;
  select * into p from public.driver_payrolls where id = p_payroll_id for update;
  if p.id is null then
    raise exception 'Không tìm thấy bảng lương' using errcode = 'P0001';
  end if;
  if p.status = 'paid' then
    raise exception 'Bảng lương này đã trả' using errcode = '22023';
  end if;
  if p.status <> 'approved' then
    raise exception 'Chỉ trả lương cho bảng lương đã được duyệt' using errcode = '22023';
  end if;
  if p.advance_offset > greatest(private.driver_advance_balance(p.driver_id, p.id), 0) then
    raise exception 'Số dư tạm ứng của tài xế đã thay đổi. Hủy bảng lương này và lập lại.' using errcode = '22023';
  end if;
  if p.net_amount > 0 then
    insert into public.payments (direction, purpose, payment_method_id, company_bank_account_id, amount, paid_at, driver_id,
      approval_request_id, payroll_id, reference_no, note)
    values ('out', 'driver_settlement', p_payment_method_id, p_company_bank_account_id, p.net_amount, v_paid_at, p.driver_id,
      p.approval_request_id, p.id, nullif(trim(coalesce(p_reference_no, '')), ''),
      coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Trả lương ' || p.code))
    returning * into pay;
  end if;
  if p.advance_offset > 0 then
    insert into public.advance_transactions (driver_id, payment_id, payroll_id, txn_type, amount, occurred_at, note)
    values (p.driver_id, pay.id, p.id, 'settlement_offset', p.advance_offset, v_paid_at, 'Cấn trừ tạm ứng vào lương ' || p.code);
  end if;
  update public.driver_payrolls set status = 'paid', payment_id = pay.id, paid_at = v_paid_at where id = p.id;
  if p.approval_request_id is not null then
    update public.approval_requests set status = 'paid' where id = p.approval_request_id;
    insert into public.approval_steps (request_id, level, action, actor_id, comment)
    values (p.approval_request_id, 99, 'mark_paid', auth.uid(), coalesce('Trả lương ' || pay.code, 'Thực nhận 0 đ, chỉ cấn trừ tạm ứng'));
  end if;
  return coalesce(pay.code, p.code);
end;
$$;

-- Duyệt / từ chối: thêm xử lý cho bảng lương (giữ nguyên ứng tiền và chi phí như 0016)
create or replace function public.approval_decide(p_request_id uuid, p_action text, p_comment text default null, p_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_type text;
  v_next int;
  v_amount numeric;
begin
  select * into r from public.approval_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'Không tìm thấy yêu cầu' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'Yêu cầu không còn chờ duyệt' using errcode = '22023';
  end if;
  if not private.can_approve(r.id) then
    raise exception 'Bạn không được duyệt yêu cầu này (không đúng cấp duyệt hoặc là khoản của chính bạn)' using errcode = '42501';
  end if;
  select code into v_type from public.approval_types where id = r.approval_type_id;

  if p_action = 'reject' then
    if length(trim(coalesce(p_comment, ''))) = 0 then
      raise exception 'Nhập lý do từ chối' using errcode = '22023';
    end if;
    insert into public.approval_steps (request_id, level, action, actor_id, comment) values (r.id, r.current_level, 'reject', auth.uid(), trim(p_comment));
    update public.approval_requests set status = 'rejected', reject_reason = trim(p_comment), decided_at = now() where id = r.id;
    if r.entity_type = 'advance_request' then
      update public.advance_requests set status = 'rejected' where id = r.entity_id;
    elsif r.entity_type = 'shipment_expense' then
      update public.shipment_expenses set status = 'rejected' where id = r.entity_id;
    elsif r.entity_type = 'driver_payroll' then
      update public.driver_payrolls set status = 'rejected' where id = r.entity_id;
      update public.shipment_expenses set payroll_id = null where payroll_id = r.entity_id;
    end if;
    if r.requested_by is not null then
      insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
      values (r.requested_by, 'approval_rejected', 'Bị từ chối: ' || r.content, trim(p_comment), 'approval_request', r.id, '/phe-duyet');
    end if;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  if p_action <> 'approve' then
    raise exception 'Thao tác không hợp lệ' using errcode = '22023';
  end if;

  v_amount := r.amount;
  if p_amount is not null then
    if r.entity_type <> 'advance_request' then
      raise exception 'Chỉ được sửa số tiền khi duyệt ứng tiền' using errcode = '22023';
    end if;
    if p_amount <= 0 or p_amount > r.amount then
      raise exception 'Số tiền duyệt phải lớn hơn 0 và không vượt số tiền xin ứng' using errcode = '22023';
    end if;
    v_amount := p_amount;
  end if;

  insert into public.approval_steps (request_id, level, action, actor_id, comment)
  values (r.id, r.current_level, 'approve', auth.uid(),
          nullif(trim(coalesce(p_comment, '')), '') || case when v_amount <> r.amount then ' (duyệt ' || to_char(v_amount, 'FM999G999G999G990') || ' đ)' else '' end);
  select min(l) into v_next from unnest(r.levels) l where l > r.current_level;
  if v_next is not null then
    update public.approval_requests set current_level = v_next where id = r.id;
    if r.entity_type = 'advance_request' and v_amount <> r.amount then
      update public.advance_requests set amount_approved = v_amount where id = r.entity_id;
    end if;
    perform private.notify_approvers(r.id);
    return jsonb_build_object('ok', true, 'status', 'pending', 'level', v_next);
  end if;

  update public.approval_requests set status = 'approved', decided_at = now() where id = r.id;
  if r.entity_type = 'advance_request' then
    update public.advance_requests
       set status = 'approved', amount_approved = least(coalesce(amount_approved, v_amount), v_amount)
     where id = r.entity_id;
    perform private.notify_permission_holders('advances.pay', 'advance_to_pay', 'Chờ chuyển tiền: ' || r.content, null,
      'advance_request', r.entity_id, '/chi-phi?tab=advances&f_status=approved');
  elsif r.entity_type = 'shipment_expense' then
    update public.shipment_expenses set status = 'approved' where id = r.entity_id;
  elsif r.entity_type = 'driver_payroll' then
    update public.driver_payrolls set status = 'approved' where id = r.entity_id;
    perform private.notify_permission_holders('settlements.update', 'payroll_to_pay', 'Chờ trả lương: ' || r.content, null,
      'driver_payroll', r.entity_id, '/chi-phi?tab=payrolls&f_status=approved');
  end if;
  if r.requested_by is not null then
    insert into public.notifications (recipient_id, type, title, entity_type, entity_id, link)
    values (r.requested_by, 'approval_approved', 'Đã duyệt: ' || r.content, 'approval_request', r.id, '/phe-duyet');
  end if;
  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

-- Trạng thái chi phí khi xem: đã hoàn vào lương
create or replace view public.expense_list with (security_invoker = true) as
select e.id, e.code, e.shipment_id, s.shipment_code, e.category_id, c.name as category_name, c.report_bucket,
       e.amount, e.incurred_at, e.note, e.source, e.paid_by, e.driver_id, d.full_name as driver_name,
       v.plate_number, e.status, e.created_at, e.approval_request_id, ar.reject_reason,
       private.requester_name(e.entered_by, case when e.entered_by is null then e.driver_id end) as entered_by_name,
       (select count(*) from public.documents doc where doc.entity_type = 'shipment_expense' and doc.entity_id = e.id and doc.archived_at is null) as file_count,
       e.custom_fields,
       e.payroll_id, pr.code as payroll_code
from public.shipment_expenses e
join public.shipments s on s.id = e.shipment_id
join public.expense_categories c on c.id = e.category_id
left join public.drivers d on d.id = e.driver_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.approval_requests ar on ar.id = e.approval_request_id
left join public.driver_payrolls pr on pr.id = e.payroll_id;

create or replace view public.payroll_list with (security_invoker = true) as
select p.id, p.code, p.driver_id, d.full_name as driver_name, d.code as driver_code,
       p.period_month, to_char(p.period_month, 'MM/YYYY') as period_label,
       p.trip_count, p.base_salary, p.per_trip_salary, p.trip_salary, p.meal_allowance, p.other_allowance,
       p.meal_allowance + p.other_allowance as allowance_total,
       p.bonus, p.deduction, p.expense_count, p.expense_reimbursement, p.advance_balance, p.advance_offset,
       p.advance_balance - p.advance_offset as advance_carry,
       p.gross_amount, p.net_amount, p.status, p.note, p.cancel_reason, ar.reject_reason,
       p.created_at, ar.decided_at, p.paid_at, pay.code as payment_code, pay.reference_no,
       (p.status = 'approved' and private.has_perm('settlements.update')) as can_pay,
       (p.status in ('pending', 'approved') and private.has_perm('settlements.update')) as can_cancel,
       p.approval_request_id, p.custom_fields
from public.driver_payrolls p
join public.drivers d on d.id = p.driver_id
left join public.approval_requests ar on ar.id = p.approval_request_id
left join public.payments pay on pay.id = p.payment_id;

-- Tài xế xem bảng lương của mình trên điện thoại (qua link biển số)
create or replace function public.driver_link_payrolls(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_driver uuid;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'expired', true);
  end if;
  v_driver := (private.driver_link_driver(v_me.vehicle_id)).id;
  if v_driver is null then
    return jsonb_build_object('ok', true, 'payrolls', '[]'::jsonb, 'advance_balance', 0);
  end if;
  return jsonb_build_object(
    'ok', true,
    'advance_balance', greatest(coalesce((
      select sum(case when t.txn_type in ('disbursement', 'adjustment') then t.amount else -t.amount end)
      from public.advance_transactions t where t.driver_id = v_driver), 0), 0),
    'payrolls', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', p.code, 'period', to_char(p.period_month, 'MM/YYYY'), 'trip_count', p.trip_count,
        'salary', p.base_salary + p.trip_salary + p.meal_allowance + p.other_allowance + p.bonus - p.deduction,
        'expense_reimbursement', p.expense_reimbursement, 'advance_offset', p.advance_offset,
        'net_amount', p.net_amount, 'status', p.status, 'paid_at', p.paid_at) order by p.period_month desc)
      from (select * from public.driver_payrolls where driver_id = v_driver and status <> 'cancelled'
            order by period_month desc limit 12) p), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Công nợ phải thu / phải trả
-- -----------------------------------------------------------------------------
alter table public.receivables
  add column invoice_no text,
  add column cancel_reason text,
  add column custom_fields jsonb not null default '{}'::jsonb;
alter table public.payables
  add column invoice_no text,
  add column content text,
  add column cancel_reason text,
  add column custom_fields jsonb not null default '{}'::jsonb;
alter table public.shipments add column receivable_id uuid references public.receivables (id);
create index shipments_receivable_idx on public.shipments (receivable_id);

-- Chuyến đã lập công nợ: khóa giá
create or replace function private.guard_billed_shipment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.receivable_id is not null and new.receivable_id is not distinct from old.receivable_id and (
       new.unit_price, new.quantity, new.surcharge_amount, new.fuel_support_amount
     ) is distinct from (old.unit_price, old.quantity, old.surcharge_amount, old.fuel_support_amount) then
    raise exception 'Chuyến đã lập công nợ, không được sửa giá. Hủy phiếu công nợ trước.' using errcode = '42501';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' and old.receivable_id is not null then
    raise exception 'Chuyến đã lập công nợ, không hủy được. Hủy phiếu công nợ trước.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_shipments_billed_guard before update on public.shipments
  for each row execute function private.guard_billed_shipment();

create or replace function private.debt_status(p_amount numeric, p_paid numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_paid <= 0 then 'open' when p_paid >= p_amount then 'paid' else 'partial' end;
$$;

-- Lập phiếu công nợ phải thu từ các chuyến đã hoàn thành của cùng một khách hàng thanh toán
create or replace function public.create_receivable_from_shipments(
  p_shipment_ids uuid[], p_issued_date date default null, p_due_date date default null,
  p_invoice_no text default null, p_note text default null, p_custom_fields jsonb default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customers uuid[];
  v_customer public.customers;
  v_amount numeric;
  v_count int;
  v_issued date := coalesce(p_issued_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  r public.receivables;
begin
  if not private.has_perm('receivables.create') then
    raise exception 'Bạn không có quyền lập công nợ' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_shipment_ids), 0) = 0 then
    raise exception 'Chọn ít nhất một chuyến' using errcode = '22023';
  end if;
  perform 1 from public.shipments where id = any (p_shipment_ids) for update;
  select array_agg(distinct o.payer_customer_id), count(*), sum(s.freight_amount + s.surcharge_amount + s.fuel_support_amount)
    into v_customers, v_count, v_amount
  from public.shipments s join public.transport_orders o on o.id = s.order_id
  where s.id = any (p_shipment_ids);
  if v_count <> cardinality(p_shipment_ids) then
    raise exception 'Có chuyến không tồn tại' using errcode = 'P0001';
  end if;
  if cardinality(v_customers) > 1 then
    raise exception 'Các chuyến phải cùng một khách hàng thanh toán' using errcode = '22023';
  end if;
  if exists (select 1 from public.shipments where id = any (p_shipment_ids) and receivable_id is not null) then
    raise exception 'Có chuyến đã lập công nợ rồi' using errcode = '22023';
  end if;
  if exists (select 1 from public.shipments where id = any (p_shipment_ids) and status not in ('driver_completed', 'closed')) then
    raise exception 'Chỉ lập công nợ cho chuyến đã hoàn thành' using errcode = '22023';
  end if;
  if coalesce(v_amount, 0) <= 0 then
    raise exception 'Tổng tiền các chuyến bằng 0, kiểm tra lại đơn giá' using errcode = '22023';
  end if;
  select * into v_customer from public.customers where id = v_customers[1];
  insert into public.receivables (customer_id, shipment_id, amount, issued_date, due_date, invoice_no, note, custom_fields)
  values (v_customer.id, case when v_count = 1 then p_shipment_ids[1] end, v_amount, v_issued,
    coalesce(p_due_date, v_issued + coalesce(v_customer.payment_term_days, 0)),
    nullif(trim(coalesce(p_invoice_no, '')), ''),
    coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Cước vận chuyển ' || v_count || ' chuyến'), coalesce(p_custom_fields, '{}'))
  returning * into r;
  update public.shipments set receivable_id = r.id where id = any (p_shipment_ids);
  return r.code;
end;
$$;

-- Công nợ phải thu khác (không gắn chuyến)
create or replace function public.create_receivable(
  p_customer_id uuid, p_amount numeric, p_issued_date date default null, p_due_date date default null,
  p_invoice_no text default null, p_note text default null, p_custom_fields jsonb default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
  v_issued date := coalesce(p_issued_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_code text;
begin
  if not private.has_perm('receivables.create') then
    raise exception 'Bạn không có quyền lập công nợ' using errcode = '42501';
  end if;
  select * into c from public.customers where id = p_customer_id;
  if c.id is null then
    raise exception 'Chọn khách hàng' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Số tiền phải lớn hơn 0' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'Nhập nội dung công nợ' using errcode = '22023';
  end if;
  insert into public.receivables (customer_id, amount, issued_date, due_date, invoice_no, note, custom_fields)
  values (c.id, p_amount, v_issued, coalesce(p_due_date, v_issued + coalesce(c.payment_term_days, 0)),
    nullif(trim(coalesce(p_invoice_no, '')), ''), trim(p_note), coalesce(p_custom_fields, '{}'))
  returning code into v_code;
  return v_code;
end;
$$;

create or replace function public.create_payable(
  p_supplier_id uuid, p_driver_id uuid, p_amount numeric, p_content text, p_issued_date date default null,
  p_due_date date default null, p_shipment_id uuid default null, p_invoice_no text default null,
  p_note text default null, p_custom_fields jsonb default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term int;
  v_issued date := coalesce(p_issued_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_code text;
begin
  if not private.has_perm('receivables.create') then
    raise exception 'Bạn không có quyền lập công nợ' using errcode = '42501';
  end if;
  if p_supplier_id is null and p_driver_id is null then
    raise exception 'Chọn nhà cung cấp hoặc tài xế' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Số tiền phải lớn hơn 0' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_content, ''))) = 0 then
    raise exception 'Nhập nội dung công nợ' using errcode = '22023';
  end if;
  select payment_term_days into v_term from public.suppliers where id = p_supplier_id;
  insert into public.payables (supplier_id, driver_id, shipment_id, amount, issued_date, due_date, invoice_no, content, note, custom_fields)
  values (p_supplier_id, p_driver_id, p_shipment_id, p_amount, v_issued, coalesce(p_due_date, v_issued + coalesce(v_term, 0)),
    nullif(trim(coalesce(p_invoice_no, '')), ''), trim(p_content), nullif(trim(coalesce(p_note, '')), ''), coalesce(p_custom_fields, '{}'))
  returning code into v_code;
  return v_code;
end;
$$;

-- Ghi nhận thu tiền khách (nhiều lần) hoặc trả tiền nhà cung cấp (nhiều lần)
create or replace function public.record_debt_payment(
  p_kind text, p_debt_id uuid, p_amount numeric, p_payment_method_id uuid default null,
  p_company_bank_account_id uuid default null, p_reference_no text default null,
  p_paid_at timestamptz default null, p_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ar public.receivables;
  ap public.payables;
  pay public.payments;
begin
  if not private.has_perm('receivables.pay') then
    raise exception 'Bạn không có quyền ghi nhận thu/trả công nợ' using errcode = '42501';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Số tiền phải lớn hơn 0' using errcode = '22023';
  end if;
  if p_kind = 'receivable' then
    select * into ar from public.receivables where id = p_debt_id for update;
    if ar.id is null then
      raise exception 'Không tìm thấy công nợ' using errcode = 'P0001';
    end if;
    if ar.status in ('paid', 'cancelled') then
      raise exception 'Công nợ đã thu đủ hoặc đã hủy' using errcode = '22023';
    end if;
    if p_amount > ar.amount - ar.paid_amount then
      raise exception 'Số tiền thu (%) lớn hơn số còn phải thu (%)', to_char(p_amount, 'FM999G999G999G990'),
        to_char(ar.amount - ar.paid_amount, 'FM999G999G999G990') using errcode = '22023';
    end if;
    insert into public.payments (direction, purpose, payment_method_id, company_bank_account_id, amount, paid_at, customer_id,
      shipment_id, receivable_id, reference_no, note)
    values ('in', 'receivable', p_payment_method_id, p_company_bank_account_id, p_amount, coalesce(p_paid_at, now()), ar.customer_id,
      ar.shipment_id, ar.id, nullif(trim(coalesce(p_reference_no, '')), ''), nullif(trim(coalesce(p_note, '')), ''))
    returning * into pay;
    update public.receivables set paid_amount = paid_amount + p_amount,
      status = private.debt_status(amount, paid_amount + p_amount) where id = ar.id;
  elsif p_kind = 'payable' then
    select * into ap from public.payables where id = p_debt_id for update;
    if ap.id is null then
      raise exception 'Không tìm thấy công nợ' using errcode = 'P0001';
    end if;
    if ap.status in ('paid', 'cancelled') then
      raise exception 'Công nợ đã trả đủ hoặc đã hủy' using errcode = '22023';
    end if;
    if p_amount > ap.amount - ap.paid_amount then
      raise exception 'Số tiền trả (%) lớn hơn số còn phải trả (%)', to_char(p_amount, 'FM999G999G999G990'),
        to_char(ap.amount - ap.paid_amount, 'FM999G999G999G990') using errcode = '22023';
    end if;
    insert into public.payments (direction, purpose, payment_method_id, company_bank_account_id, amount, paid_at, supplier_id,
      driver_id, shipment_id, payable_id, reference_no, note)
    values ('out', 'payable', p_payment_method_id, p_company_bank_account_id, p_amount, coalesce(p_paid_at, now()), ap.supplier_id,
      ap.driver_id, ap.shipment_id, ap.id, nullif(trim(coalesce(p_reference_no, '')), ''), nullif(trim(coalesce(p_note, '')), ''))
    returning * into pay;
    update public.payables set paid_amount = paid_amount + p_amount,
      status = private.debt_status(amount, paid_amount + p_amount) where id = ap.id;
  else
    raise exception 'Loại công nợ không hợp lệ' using errcode = '22023';
  end if;
  return pay.code;
end;
$$;

create or replace function public.cancel_debt(p_kind text, p_debt_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid numeric;
begin
  if not private.has_perm('receivables.delete') then
    raise exception 'Bạn không có quyền hủy công nợ' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Nhập lý do hủy' using errcode = '22023';
  end if;
  if p_kind = 'receivable' then
    select paid_amount into v_paid from public.receivables where id = p_debt_id and status <> 'cancelled' for update;
  elsif p_kind = 'payable' then
    select paid_amount into v_paid from public.payables where id = p_debt_id and status <> 'cancelled' for update;
  else
    raise exception 'Loại công nợ không hợp lệ' using errcode = '22023';
  end if;
  if v_paid is null then
    raise exception 'Không tìm thấy công nợ hoặc đã hủy' using errcode = 'P0001';
  end if;
  if v_paid > 0 then
    raise exception 'Công nợ đã có phiếu thu/chi. Hủy các phiếu đó trước.' using errcode = '22023';
  end if;
  if p_kind = 'receivable' then
    update public.receivables set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_debt_id;
    update public.shipments set receivable_id = null where receivable_id = p_debt_id;
  else
    update public.payables set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_debt_id;
  end if;
end;
$$;

-- Hủy phiếu thu/chi công nợ (ghi nhầm): không xóa, đánh dấu hủy có lý do và trả lại số còn nợ
create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
begin
  if not private.has_perm('payments.delete') then
    raise exception 'Bạn không có quyền hủy phiếu thu/chi' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Nhập lý do hủy phiếu' using errcode = '22023';
  end if;
  select * into p from public.payments where id = p_payment_id for update;
  if p.id is null then
    raise exception 'Không tìm thấy phiếu' using errcode = 'P0001';
  end if;
  if p.status = 'voided' then
    raise exception 'Phiếu đã hủy trước đó' using errcode = '22023';
  end if;
  if p.purpose not in ('receivable', 'payable') then
    raise exception 'Hiện chỉ hủy được phiếu thu/chi công nợ. Phiếu chuyển tiền ứng và trả lương chưa hỗ trợ hủy.' using errcode = '22023';
  end if;
  update public.payments set status = 'voided', void_reason = trim(p_reason) where id = p.id;
  if p.receivable_id is not null then
    update public.receivables set paid_amount = paid_amount - p.amount,
      status = private.debt_status(amount, paid_amount - p.amount) where id = p.receivable_id;
  elsif p.payable_id is not null then
    update public.payables set paid_amount = paid_amount - p.amount,
      status = private.debt_status(amount, paid_amount - p.amount) where id = p.payable_id;
  end if;
end;
$$;

-- Chuyến đã hoàn thành chưa lập công nợ
create or replace view public.billing_shipment_list with (security_invoker = true) as
select s.id, s.shipment_code, s.order_id, o.order_code, o.payer_customer_id as customer_id, c.name as customer_name,
       s.pickup_at, s.completed_at, pl.name as pickup_name, dl.name as delivery_name, v.plate_number, d.full_name as driver_name,
       s.freight_amount, s.surcharge_amount, s.fuel_support_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount as total_revenue, s.status
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
where s.receivable_id is null and s.status in ('driver_completed', 'closed');

create or replace function private.aging_bucket(p_due date, p_remaining numeric, p_status text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status in ('paid', 'cancelled') or p_remaining <= 0 then 'none'
    when p_due >= (now() at time zone 'Asia/Ho_Chi_Minh')::date then 'current'
    when (now() at time zone 'Asia/Ho_Chi_Minh')::date - p_due <= 30 then 'd1_30'
    when (now() at time zone 'Asia/Ho_Chi_Minh')::date - p_due <= 60 then 'd31_60'
    when (now() at time zone 'Asia/Ho_Chi_Minh')::date - p_due <= 90 then 'd61_90'
    else 'd90' end;
$$;

create or replace view public.receivable_list with (security_invoker = true) as
select r.id, r.code, r.customer_id, c.name as customer_name, c.code as customer_code, r.invoice_no,
       r.issued_date, r.due_date, r.amount, r.paid_amount, r.remaining_amount, r.status, r.note, r.cancel_reason,
       greatest((now() at time zone 'Asia/Ho_Chi_Minh')::date - r.due_date, 0) * (r.status in ('open', 'partial'))::int as overdue_days,
       private.aging_bucket(r.due_date, r.remaining_amount, r.status) as aging,
       (select count(*) from public.shipments s where s.receivable_id = r.id) as shipment_count,
       (select string_agg(s.shipment_code, ', ' order by s.shipment_code) from public.shipments s where s.receivable_id = r.id) as shipment_codes,
       (select max(p.paid_at) from public.payments p where p.receivable_id = r.id and p.status = 'posted') as last_paid_at,
       (r.status in ('open', 'partial') and private.has_perm('receivables.pay')) as can_pay,
       (r.status in ('open') and r.paid_amount = 0 and private.has_perm('receivables.delete')) as can_cancel,
       r.created_at, r.custom_fields
from public.receivables r
join public.customers c on c.id = r.customer_id;

create or replace view public.payable_list with (security_invoker = true) as
select r.id, r.code, r.supplier_id, r.driver_id,
       coalesce(sp.name, d.full_name || ' (tài xế)') as partner_name, r.content, r.invoice_no, r.shipment_id, s.shipment_code,
       r.issued_date, r.due_date, r.amount, r.paid_amount, r.remaining_amount, r.status, r.note, r.cancel_reason,
       greatest((now() at time zone 'Asia/Ho_Chi_Minh')::date - r.due_date, 0) * (r.status in ('open', 'partial'))::int as overdue_days,
       private.aging_bucket(r.due_date, r.remaining_amount, r.status) as aging,
       (select max(p.paid_at) from public.payments p where p.payable_id = r.id and p.status = 'posted') as last_paid_at,
       (r.status in ('open', 'partial') and private.has_perm('receivables.pay')) as can_pay,
       (r.status in ('open') and r.paid_amount = 0 and private.has_perm('receivables.delete')) as can_cancel,
       r.created_at, r.custom_fields
from public.payables r
left join public.suppliers sp on sp.id = r.supplier_id
left join public.drivers d on d.id = r.driver_id
left join public.shipments s on s.id = r.shipment_id;

create or replace view public.payment_list with (security_invoker = true) as
select p.id, p.code, p.direction, p.purpose, p.amount, p.paid_at, p.status, p.void_reason, p.reference_no, p.note,
       coalesce(c.name, sp.name, d.full_name) as partner_name,
       p.customer_id, p.supplier_id, p.driver_id, p.payment_method_id, pm.name as payment_method_name,
       p.company_bank_account_id, s.shipment_code,
       coalesce(ar.code, ap.code, adv.code, pr.code) as source_code,
       (p.status = 'posted' and p.purpose in ('receivable', 'payable') and private.has_perm('payments.delete')) as can_void,
       p.created_at
from public.payments p
left join public.customers c on c.id = p.customer_id
left join public.suppliers sp on sp.id = p.supplier_id
left join public.drivers d on d.id = p.driver_id
left join public.payment_methods pm on pm.id = p.payment_method_id
left join public.shipments s on s.id = p.shipment_id
left join public.receivables ar on ar.id = p.receivable_id
left join public.payables ap on ap.id = p.payable_id
left join public.advance_requests adv on adv.id = p.advance_request_id
left join public.driver_payrolls pr on pr.id = p.payroll_id;

-- Trường bổ sung cho bảng lương, công nợ
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
  end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Báo cáo (chỉ người có quyền Xem báo cáo; dữ liệu thật, tính trực tiếp từ chuyến và chi phí đã duyệt)
-- -----------------------------------------------------------------------------
create or replace view public.report_shipment_profit as
select s.id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_month,
       o.payer_customer_id as customer_id, c.name as customer_name,
       s.vehicle_id, v.plate_number, s.driver_id, d.full_name as driver_name,
       pl.name as pickup_name, dl.name as delivery_name, s.status,
       s.freight_amount, s.surcharge_amount, s.fuel_support_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount as revenue,
       coalesce(x.cost, 0) as cost,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount - coalesce(x.cost, 0) as profit,
       case when s.freight_amount + s.surcharge_amount + s.fuel_support_amount > 0
            then round((s.freight_amount + s.surcharge_amount + s.fuel_support_amount - coalesce(x.cost, 0)) * 100
                       / (s.freight_amount + s.surcharge_amount + s.fuel_support_amount), 1) end as margin_percent,
       (s.receivable_id is not null) as billed
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join lateral (select sum(e.amount) as cost from public.shipment_expenses e where e.shipment_id = s.id and e.status = 'approved') x on true
where s.status in ('in_transit', 'driver_completed', 'closed') and private.has_perm('reports.view');

create or replace view public.report_monthly as
select to_char(m.report_month, 'YYYY-MM') as id, m.report_month, to_char(m.report_month, 'MM/YYYY') as month_label,
       coalesce(t.trips, 0) as trips, coalesce(t.revenue, 0) as revenue, coalesce(t.cost, 0) as cost,
       coalesce(t.revenue, 0) - coalesce(t.cost, 0) as profit,
       coalesce(p.cash_in, 0) as cash_in, coalesce(p.cash_out, 0) as cash_out,
       coalesce(pr.payroll, 0) as payroll
from (
  select report_month from public.report_shipment_profit
  union select date_trunc('month', paid_at at time zone 'Asia/Ho_Chi_Minh')::date from public.payments where status = 'posted'
) m
left join (select report_month, count(*) as trips, sum(revenue) as revenue, sum(cost) as cost
           from public.report_shipment_profit group by 1) t on t.report_month = m.report_month
left join (select date_trunc('month', paid_at at time zone 'Asia/Ho_Chi_Minh')::date as mo,
                  sum(amount) filter (where direction = 'in') as cash_in, sum(amount) filter (where direction = 'out') as cash_out
           from public.payments where status = 'posted' group by 1) p on p.mo = m.report_month
left join (select period_month, sum(gross_amount - expense_reimbursement) as payroll
           from public.driver_payrolls where status in ('approved', 'paid') group by 1) pr on pr.period_month = m.report_month
where private.has_perm('reports.view');

create or replace view public.report_by_vehicle as
select to_char(r.report_month, 'YYYY-MM') || ':' || coalesce(r.vehicle_id::text, '-') as id, r.report_month, to_char(r.report_month, 'MM/YYYY') as month_label, r.vehicle_id, coalesce(r.plate_number, '(chưa gán xe)') as plate_number,
       count(*) as trips, sum(r.revenue) as revenue, sum(r.cost) as cost, sum(r.profit) as profit
from public.report_shipment_profit r group by r.report_month, r.vehicle_id, r.plate_number;

create or replace view public.report_by_driver as
select to_char(r.report_month, 'YYYY-MM') || ':' || coalesce(r.driver_id::text, '-') as id, r.report_month, to_char(r.report_month, 'MM/YYYY') as month_label, r.driver_id, coalesce(r.driver_name, '(chưa gán tài xế)') as driver_name,
       count(*) as trips, sum(r.revenue) as revenue, sum(r.cost) as cost, sum(r.profit) as profit
from public.report_shipment_profit r group by r.report_month, r.driver_id, r.driver_name;

create or replace view public.report_by_customer as
select to_char(r.report_month, 'YYYY-MM') || ':' || coalesce(r.customer_id::text, '-') as id, r.report_month, to_char(r.report_month, 'MM/YYYY') as month_label, r.customer_id, r.customer_name,
       count(*) as trips, sum(r.revenue) as revenue, sum(r.cost) as cost, sum(r.profit) as profit
from public.report_shipment_profit r group by r.report_month, r.customer_id, r.customer_name;

create or replace view public.report_expense_by_category as
select to_char(date_trunc('month', e.incurred_at at time zone 'Asia/Ho_Chi_Minh'), 'YYYY-MM') || ':' || e.category_id as id,
       date_trunc('month', e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date as report_month,
       to_char(date_trunc('month', e.incurred_at at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label,
       e.category_id, c.name as category_name, c.report_bucket,
       count(*) as expense_count, sum(e.amount) as amount,
       sum(e.amount) filter (where e.paid_by = 'driver') as driver_paid,
       sum(e.amount) filter (where e.paid_by = 'company') as company_paid
from public.shipment_expenses e
join public.expense_categories c on c.id = e.category_id
where e.status = 'approved' and private.has_perm('reports.view')
group by 1, 2, 3, e.category_id, c.name, c.report_bucket;

create or replace view public.report_advance_balance as
select d.id, d.id as driver_id, d.code as driver_code, d.full_name as driver_name, d.status as driver_status,
       coalesce(sum(t.amount) filter (where t.txn_type = 'disbursement'), 0) as disbursed,
       coalesce(sum(t.amount) filter (where t.txn_type = 'settlement_offset'), 0) as offset_amount,
       coalesce(sum(t.amount) filter (where t.txn_type = 'refund'), 0) as refunded,
       coalesce(sum(case when t.txn_type in ('disbursement', 'adjustment') then t.amount else -t.amount end), 0) as balance,
       max(t.occurred_at) as last_txn_at
from public.drivers d
left join public.advance_transactions t on t.driver_id = d.id
where private.has_perm('reports.view') or private.has_perm('advances.view')
group by d.id, d.code, d.full_name, d.status
having count(t.id) > 0;

-- -----------------------------------------------------------------------------
-- 4. Quyền gọi hàm và đọc view
-- -----------------------------------------------------------------------------
revoke all on function public.driver_payroll_preview(uuid, date, numeric, numeric) from public, anon;
revoke all on function public.create_driver_payroll(uuid, date, numeric, numeric, text, jsonb) from public, anon;
revoke all on function public.create_driver_payrolls_for_month(date) from public, anon;
revoke all on function public.cancel_driver_payroll(uuid, text) from public, anon;
revoke all on function public.pay_driver_payroll(uuid, uuid, uuid, text, timestamptz, text) from public, anon;
revoke all on function public.approval_decide(uuid, text, text, numeric) from public, anon;
revoke all on function public.create_receivable_from_shipments(uuid[], date, date, text, text, jsonb) from public, anon;
revoke all on function public.create_receivable(uuid, numeric, date, date, text, text, jsonb) from public, anon;
revoke all on function public.create_payable(uuid, uuid, numeric, text, date, date, uuid, text, text, jsonb) from public, anon;
revoke all on function public.record_debt_payment(text, uuid, numeric, uuid, uuid, text, timestamptz, text) from public, anon;
revoke all on function public.cancel_debt(text, uuid, text) from public, anon;
revoke all on function public.void_payment(uuid, text) from public, anon;
revoke all on function public.driver_link_payrolls(text) from public;
grant execute on function public.driver_payroll_preview(uuid, date, numeric, numeric) to authenticated;
grant execute on function public.create_driver_payroll(uuid, date, numeric, numeric, text, jsonb) to authenticated;
grant execute on function public.create_driver_payrolls_for_month(date) to authenticated;
grant execute on function public.cancel_driver_payroll(uuid, text) to authenticated;
grant execute on function public.pay_driver_payroll(uuid, uuid, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.approval_decide(uuid, text, text, numeric) to authenticated;
grant execute on function public.create_receivable_from_shipments(uuid[], date, date, text, text, jsonb) to authenticated;
grant execute on function public.create_receivable(uuid, numeric, date, date, text, text, jsonb) to authenticated;
grant execute on function public.create_payable(uuid, uuid, numeric, text, date, date, uuid, text, text, jsonb) to authenticated;
grant execute on function public.record_debt_payment(text, uuid, numeric, uuid, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.cancel_debt(text, uuid, text) to authenticated;
grant execute on function public.void_payment(uuid, text) to authenticated;
grant execute on function public.driver_link_payrolls(text) to anon, authenticated;

revoke all on public.driver_payrolls from anon;
grant select on public.driver_payrolls to authenticated;
revoke all on public.payroll_list, public.billing_shipment_list, public.receivable_list, public.payable_list, public.payment_list,
  public.report_shipment_profit, public.report_monthly, public.report_by_vehicle, public.report_by_driver,
  public.report_by_customer, public.report_expense_by_category, public.report_advance_balance from anon;
grant select on public.payroll_list, public.billing_shipment_list, public.receivable_list, public.payable_list, public.payment_list,
  public.report_shipment_profit, public.report_monthly, public.report_by_vehicle, public.report_by_driver,
  public.report_by_customer, public.report_expense_by_category, public.report_advance_balance to authenticated;

commit;
