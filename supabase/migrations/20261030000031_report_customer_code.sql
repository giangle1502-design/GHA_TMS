-- Mã khách hàng trong các báo cáo: bảng báo cáo hiện mã khách cho gọn, tên khách vẫn chọn hiện được
-- Cột mới thêm vào cuối từng view (create or replace view chỉ cho phép thêm cột ở cuối)

create or replace view public.report_shipment_profit as
select s.id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_month,
       o.payer_customer_id as customer_id, c.name as customer_name,
       s.vehicle_id, v.plate_number, s.driver_id, d.full_name as driver_name,
       pl.name as pickup_name, dl.name as delivery_name, s.status,
       s.freight_amount, s.surcharge_amount, s.fuel_support_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue,
       coalesce(x.cost, 0) as cost,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0) as profit,
       case when s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount > 0
            then round((s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0)) * 100
                       / (s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount), 1) end as margin_percent,
       (s.receivable_id is not null) as billed,
       s.extra_fee_amount, s.pass_through_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due,
       s.quantity, s.pricing_unit, s.unit_price,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount as freight_total,
       vt.name as vehicle_type_name, to_char(date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label,
       c.code as customer_code
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join lateral (select sum(e.amount) as cost from public.shipment_expenses e where e.shipment_id = s.id and e.status = 'approved') x on true
where s.status in ('in_transit', 'driver_completed', 'closed') and private.has_perm('reports.view');

create or replace view public.report_by_customer as
select to_char(r.report_month, 'YYYY-MM') || ':' || coalesce(r.customer_id::text, '-') as id, r.report_month, to_char(r.report_month, 'MM/YYYY') as month_label, r.customer_id, r.customer_name,
       count(*) as trips, sum(r.revenue) as revenue, sum(r.cost) as cost, sum(r.profit) as profit,
       r.customer_code
from public.report_shipment_profit r group by r.report_month, r.customer_id, r.customer_name, r.customer_code;

create or replace view public.report_fee_lines as
select r.id || ':' || f.kind_key as id, r.id as shipment_id, r.shipment_code, r.order_code, r.report_date, r.report_month,
       to_char(r.report_month, 'MM/YYYY') as month_label, r.customer_id, r.customer_name, r.plate_number, r.driver_name,
       r.pickup_name, r.delivery_name, f.fee_name, f.fee_kind, f.sort_order, f.amount, f.note,
       r.customer_code
from public.report_shipment_profit r
join public.shipments s on s.id = r.id
cross join lateral (
  select 'cuoc' as kind_key, 'Cước vận chuyển' as fee_name, 'revenue' as fee_kind, -3 as sort_order, s.freight_amount as amount, null::text as note
  where s.freight_amount > 0
  union all
  select 'phu-phi', 'Phụ phí', 'revenue', -2, s.surcharge_amount, null where s.surcharge_amount > 0
  union all
  select 'dau', 'Hỗ trợ dầu', 'revenue', -1, s.fuel_support_amount, null where s.fuel_support_amount > 0
  union all
  select 'phi-' || sf.line_no, ft.name, sf.fee_kind, ft.sort_order, sf.amount, sf.note
  from public.shipment_fees sf join public.fee_types ft on ft.id = sf.fee_type_id
  where sf.shipment_id = s.id
) f;

create or replace view public.report_by_fee_type as
select to_char(report_month, 'YYYY-MM') || ':' || coalesce(customer_id::text, '-') || ':' || fee_name as id,
       report_month, month_label, customer_id, customer_name, fee_name, fee_kind, min(sort_order) as sort_order,
       count(distinct shipment_id) as trips, sum(amount) as amount,
       customer_code
from public.report_fee_lines
group by report_month, month_label, customer_id, customer_name, fee_name, fee_kind, customer_code;

-- Báo cáo phí chi hộ lấy thêm cột mã khách của report_fee_lines
create or replace view public.report_pass_through_fees as
select * from public.report_fee_lines where fee_kind = 'pass_through';

create or replace view public.report_loading as
select r.id, r.shipment_code, r.order_code, r.report_date, r.report_month, r.month_label,
       r.customer_id, r.customer_name, r.plate_number, r.driver_id, r.driver_name, r.pickup_name, r.delivery_name,
       coalesce(fl.amount, 0) as loading_revenue,
       coalesce(ex.driver_paid, 0) as driver_paid,
       coalesce(ex.company_paid, 0) as company_paid,
       coalesce(ex.driver_paid, 0) + coalesce(ex.company_paid, 0) as loading_cost,
       coalesce(fl.amount, 0) - coalesce(ex.driver_paid, 0) - coalesce(ex.company_paid, 0) as loading_margin,
       coalesce(ex.pending, 0) as pending_cost,
       ex.contractors,
       r.customer_code
from public.report_shipment_profit r
left join lateral (
  select sum(sf.amount) as amount
  from public.shipment_fees sf join public.fee_types ft on ft.id = sf.fee_type_id
  where sf.shipment_id = r.id and ft.is_loading
) fl on true
left join lateral (
  select sum(e.amount) filter (where e.status = 'approved' and e.paid_by = 'driver') as driver_paid,
         sum(e.amount) filter (where e.status = 'approved' and e.paid_by = 'company') as company_paid,
         sum(e.amount) filter (where e.status = 'pending') as pending,
         string_agg(distinct sp.name, ', ') as contractors
  from public.shipment_expenses e
  join public.expense_categories c on c.id = e.category_id
  left join public.suppliers sp on sp.id = e.supplier_id
  where e.shipment_id = r.id and c.report_bucket = 'loading' and e.status in ('approved', 'pending')
) ex on true
where coalesce(fl.amount, 0) > 0 or coalesce(ex.driver_paid, 0) + coalesce(ex.company_paid, 0) + coalesce(ex.pending, 0) > 0;

revoke all on public.report_shipment_profit, public.report_by_customer, public.report_fee_lines, public.report_by_fee_type,
  public.report_pass_through_fees, public.report_loading from anon;
grant select on public.report_shipment_profit, public.report_by_customer, public.report_fee_lines, public.report_by_fee_type,
  public.report_pass_through_fees, public.report_loading to authenticated;

-- =============================================================================
-- Xóa dữ liệu thử ngay trong ứng dụng: chỉ Super Admin/Admin, nhập "mật khẩu xóa dữ liệu"
-- (đặt riêng trong ứng dụng, lưu dạng băm bcrypt) và gõ đúng chữ xác nhận XOA DU LIEU.
-- Sai mật khẩu 5 lần trong 15 phút thì khóa thử lại 15 phút.
-- XÓA: đơn hàng, chuyến (kèm hàng hóa, phí thu khách), chi phí, ứng tiền, phê duyệt, lương tài xế,
--      công nợ, phiếu thu/chi, thông báo, chứng từ gắn với các mục đó.
-- GIỮ: danh mục (khách hàng, xe, tài xế, bảng giá, hạng mục chi phí, loại phí...), người dùng, cấu hình, nhật ký.
-- =============================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists private.admin_secrets (
  key text primary key,
  secret_hash text not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
revoke all on private.admin_secrets from public, anon, authenticated;

create or replace function private.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.code in ('super_admin', 'admin'));
$$;
revoke all on function private.is_admin_user() from public, anon;
grant execute on function private.is_admin_user() to authenticated;

-- Kiểm tra mật khẩu xóa dữ liệu; ghi nhật ký mỗi lần sai, khóa khi sai quá nhiều
create or replace function private.check_purge_password(p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_fails integer;
begin
  if not private.is_admin_user() then
    raise exception 'Chỉ Super Admin hoặc Admin được xem và xóa dữ liệu thử.' using errcode = '42501';
  end if;
  select secret_hash into v_hash from private.admin_secrets where key = 'purge_password';
  if v_hash is null then
    raise exception 'Chưa đặt mật khẩu xóa dữ liệu. Bấm "Đặt mật khẩu xóa dữ liệu" trước.' using errcode = '22023';
  end if;
  select count(*) into v_fails from public.audit_logs
  where action = 'test_data.password_failed' and occurred_at > now() - interval '15 minutes';
  if v_fails >= 5 then
    raise exception 'Nhập sai mật khẩu quá 5 lần. Thử lại sau 15 phút.' using errcode = '42501';
  end if;
  if p_password is null or extensions.crypt(p_password, v_hash) <> v_hash then
    raise exception 'Mật khẩu xóa dữ liệu không đúng.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.check_purge_password(text) from public, anon, authenticated;

create or replace function public.purge_password_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin_user() then
    raise exception 'Chỉ Super Admin hoặc Admin được xóa dữ liệu thử.' using errcode = '42501';
  end if;
  return jsonb_build_object('is_set', exists (select 1 from private.admin_secrets where key = 'purge_password'),
    'updated_at', (select updated_at from private.admin_secrets where key = 'purge_password'));
end;
$$;

-- Đặt lần đầu không cần mật khẩu cũ; đổi lại phải nhập đúng mật khẩu cũ
create or replace function public.set_purge_password(p_new text, p_old text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin_user() then
    raise exception 'Chỉ Super Admin hoặc Admin được đặt mật khẩu xóa dữ liệu.' using errcode = '42501';
  end if;
  if length(coalesce(p_new, '')) < 8 then
    raise exception 'Mật khẩu xóa dữ liệu cần ít nhất 8 ký tự.' using errcode = '22023';
  end if;
  if exists (select 1 from private.admin_secrets where key = 'purge_password') then
    perform private.check_purge_password(p_old);
  end if;
  insert into private.admin_secrets (key, secret_hash, updated_by, updated_at)
  values ('purge_password', extensions.crypt(p_new, extensions.gen_salt('bf', 10)), auth.uid(), now())
  on conflict (key) do update set secret_hash = excluded.secret_hash, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'test_data.password_set', 'system', 'du-lieu-thu', 'Đặt mật khẩu xóa dữ liệu');
end;
$$;

create or replace function private.test_data_counts_raw()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'transport_orders', (select count(*) from public.transport_orders),
    'shipments', (select count(*) from public.shipments),
    'shipment_items', (select count(*) from public.shipment_items),
    'shipment_fees', (select count(*) from public.shipment_fees),
    'shipment_expenses', (select count(*) from public.shipment_expenses),
    'advance_requests', (select count(*) from public.advance_requests),
    'approval_requests', (select count(*) from public.approval_requests),
    'driver_payrolls', (select count(*) from public.driver_payrolls),
    'receivables', (select count(*) from public.receivables),
    'payables', (select count(*) from public.payables),
    'payments', (select count(*) from public.payments),
    'notifications', (select count(*) from public.notifications),
    'customers', (select count(*) from public.customers),
    'vehicles', (select count(*) from public.vehicles),
    'drivers', (select count(*) from public.drivers),
    'profiles', (select count(*) from public.profiles));
$$;
revoke all on function private.test_data_counts_raw() from public, anon, authenticated;

-- Bước 1: nhập mật khẩu, xem trước số dòng sẽ xóa / giữ lại.
-- Sai mật khẩu thì trả {ok:false} (không raise) để lần sai được ghi lại vào nhật ký.
create or replace function public.test_data_counts(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.check_purge_password(p_password);
  exception when sqlstate '42501' or sqlstate '22023' then
    if sqlerrm = 'Mật khẩu xóa dữ liệu không đúng.' then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
      values (auth.uid(), 'test_data.password_failed', 'system', 'du-lieu-thu', 'Nhập sai mật khẩu xóa dữ liệu');
    end if;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'counts', private.test_data_counts_raw());
end;
$$;

-- Bước 2: nhập lại mật khẩu + gõ XOA DU LIEU (sai mật khẩu cũng trả {ok:false} và ghi nhật ký)
create or replace function public.purge_test_data(p_password text, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  begin
    perform private.check_purge_password(p_password);
  exception when sqlstate '42501' or sqlstate '22023' then
    if sqlerrm = 'Mật khẩu xóa dữ liệu không đúng.' then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
      values (auth.uid(), 'test_data.password_failed', 'system', 'du-lieu-thu', 'Nhập sai mật khẩu xóa dữ liệu');
    end if;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  if coalesce(upper(trim(p_confirm)), '') <> 'XOA DU LIEU' then
    raise exception 'Chữ xác nhận chưa đúng. Gõ XOA DU LIEU để xóa.' using errcode = '22023';
  end if;

  v_before := private.test_data_counts_raw();
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, reason)
  values (auth.uid(), 'test_data.purge', 'system', 'du-lieu-thu', v_before, 'Xóa dữ liệu thử trong ứng dụng');

  delete from public.documents
  where entity_type in ('shipment', 'shipment_expense', 'advance_request', 'payment', 'driver_payroll', 'approval_request', 'receivable', 'payable', 'transport_order');

  truncate table
    public.advance_transactions,
    public.payments,
    public.shipment_expenses,
    public.advance_requests,
    public.driver_payrolls,
    public.approval_steps,
    public.approval_requests,
    public.payables,
    public.receivables,
    public.shipment_assignments,
    public.shipment_status_history,
    public.shipment_items,
    public.shipment_fees,
    public.shipments,
    public.transport_orders,
    public.notifications,
    private.driver_upload_tickets;

  delete from public.code_sequences where scope in ('ORD', 'SHP', 'APR', 'ADV', 'PAY', 'AR', 'AP', 'BL');
  return jsonb_build_object('ok', true, 'counts', v_before);
end;
$$;

revoke all on function public.purge_password_status(), public.set_purge_password(text, text),
  public.test_data_counts(text), public.purge_test_data(text, text) from public, anon;
grant execute on function public.purge_password_status(), public.set_purge_password(text, text),
  public.test_data_counts(text), public.purge_test_data(text, text) to authenticated;
