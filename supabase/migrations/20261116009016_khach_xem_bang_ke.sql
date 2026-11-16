-- =============================================================================
-- GHA 9016: TÀI KHOẢN KHÁCH HÀNG CHỈ XEM VÀ TẢI BẢNG KÊ CƯỚC
--   * Bảng public.user_customers: gắn một tài khoản với một hay nhiều khách hàng
--     (VD chủ chung của VAP, PLA, DAM). Dùng lại được cho chủ khác sau này.
--   * Tài khoản "bị giới hạn theo khách hàng" = có ít nhất một dòng gắn khách hàng,
--     hoặc có vai trò khách (customer_admin, customer_statement). Super Admin không bao giờ bị giới hạn.
--     Có vai trò khách mà CHƯA gắn khách hàng nào thì KHÔNG thấy gì (an toàn khi quên gán).
--   * Chặn ở CSDL (RLS dạng RESTRICTIVE, cộng thêm vào chính sách sẵn có): tài khoản bị giới hạn
--     chỉ đọc được khách hàng, đơn, chuyến, địa điểm, xe... của các khách hàng được gán.
--   * Quyền mới statements.view / statements.export + vai trò "Khách hàng – xem bảng kê":
--     chỉ vào được trang Bảng kê, không sửa / không thêm cột / không lưu mẫu.
--     Dữ liệu bảng kê đọc qua các view statement_* chỉ có cột cần cho bảng kê
--     (không có lương tài xế, nhà xe 3-PL, chi phí nội bộ).
-- =============================================================================

-- 1. Gắn tài khoản với khách hàng -----------------------------------------------
create table if not exists public.user_customers (
  user_id uuid not null references public.profiles (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) default auth.uid(),
  primary key (user_id, customer_id)
);
create index if not exists user_customers_customer_idx on public.user_customers (customer_id);
comment on table public.user_customers is 'Tài khoản khách hàng được xem dữ liệu của những khách hàng nào (một tài khoản có thể gắn nhiều khách hàng)';
create trigger trg_user_customers_audit after insert or update or delete on public.user_customers
  for each row execute function private.audit_row_change('user_id');
alter table public.user_customers enable row level security;
create policy user_customers_select on public.user_customers for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_perm('users.view')));
create policy user_customers_insert on public.user_customers for insert to authenticated
  with check ((select private.has_perm('users.configure')) and user_id <> (select auth.uid()));
create policy user_customers_delete on public.user_customers for delete to authenticated
  using ((select private.has_perm('users.configure')) and user_id <> (select auth.uid()));
revoke all on public.user_customers from anon;
grant select, insert, delete on public.user_customers to authenticated;

-- 2. Hàm phạm vi khách hàng -----------------------------------------------------
create or replace function private.my_customer_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(uc.customer_id), '{}'::uuid[]) from public.user_customers uc where uc.user_id = auth.uid()
$$;

create or replace function private.is_customer_scoped() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and not private.is_super_admin(auth.uid())
     and (
       exists (select 1 from public.user_customers uc where uc.user_id = auth.uid())
       or exists (
         select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
         where ur.user_id = auth.uid() and r.code in ('customer_admin', 'customer_statement')
       )
     )
$$;

-- Địa điểm có trên đơn / chuyến của các khách hàng được gán
create or replace function private.my_customer_location_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[]) from (
    select unnest(array[s.pickup_location_id, s.delivery_location_id, s.empty_return_location_id, s.offroute_return_location_id]) as x
    from public.shipments s join public.transport_orders o on o.id = s.order_id
    where o.customer_id = any(private.my_customer_ids())
    union all
    select unnest(array[o.pickup_location_id, o.delivery_location_id])
    from public.transport_orders o where o.customer_id = any(private.my_customer_ids())
  ) t where x is not null
$$;

-- Xe đã chạy chuyến của các khách hàng được gán
create or replace function private.my_customer_vehicle_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[]) from (
    select unnest(array[s.vehicle_id, s.trailer_id]) as x
    from public.shipments s join public.transport_orders o on o.id = s.order_id
    where o.customer_id = any(private.my_customer_ids())
  ) t where x is not null
$$;

revoke all on function private.my_customer_ids(), private.is_customer_scoped(), private.my_customer_location_ids(), private.my_customer_vehicle_ids() from public, anon;
grant execute on function private.my_customer_ids(), private.is_customer_scoped(), private.my_customer_location_ids(), private.my_customer_vehicle_ids() to authenticated;

-- 3. RLS RESTRICTIVE: tài khoản bị giới hạn chỉ thấy dữ liệu khách hàng được gán ----------
--    (AND với chính sách sẵn có; nhân viên GHA không bị ảnh hưởng)
drop policy if exists customers_customer_scope on public.customers;
create policy customers_customer_scope on public.customers as restrictive for all to authenticated
  using (not (select private.is_customer_scoped()) or id = any((select private.my_customer_ids())::uuid[]));

drop policy if exists locations_customer_scope on public.locations;
create policy locations_customer_scope on public.locations as restrictive for all to authenticated
  using (not (select private.is_customer_scoped()) or id = any((select private.my_customer_location_ids())::uuid[]));

drop policy if exists vehicles_customer_scope on public.vehicles;
create policy vehicles_customer_scope on public.vehicles as restrictive for all to authenticated
  using (not (select private.is_customer_scoped()) or id = any((select private.my_customer_vehicle_ids())::uuid[]));

drop policy if exists shipments_customer_scope on public.shipments;
create policy shipments_customer_scope on public.shipments as restrictive for all to authenticated
  using (not (select private.is_customer_scoped())
         or order_id in (select o.id from public.transport_orders o where o.customer_id = any((select private.my_customer_ids())::uuid[])));

-- Bảng có cột customer_id
do $$
declare t text;
begin
  foreach t in array array['transport_orders', 'transport_plans', 'transport_price_lists', 'fuel_support_rules', 'receivables',
                           'payments', 'tax_invoices', 'tasks', 'bank_accounts', 'leave_handovers'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', t || '_customer_scope', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (not (select private.is_customer_scoped()) or customer_id = any((select private.my_customer_ids())::uuid[]))',
      t || '_customer_scope', t);
  end loop;
end $$;

-- Bảng gắn với chuyến (shipment_id): chỉ dòng thuộc chuyến xem được
do $$
declare t text;
begin
  foreach t in array array['shipment_assignments', 'shipment_status_history', 'shipment_fees', 'shipment_items', 'shipment_expenses',
                           'shipment_carrier_costs', 'shipment_edit_locks', 'advance_requests', 'advance_transactions', 'approval_requests', 'payables'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', t || '_customer_scope', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (not (select private.is_customer_scoped()) or exists (select 1 from public.shipments s where s.id = %I.shipment_id))',
      t || '_customer_scope', t, t);
  end loop;
end $$;

-- Danh sách xe cho khách (9001): tài khoản bị giới hạn chỉ thấy xe đã chạy chuyến của mình
create or replace view public.vehicles_for_customer as
select v.id, v.code, v.plate_number, v.vehicle_kind, vt.name as vehicle_type_name, coalesce(v.payload_tons, vt.payload_tons) as payload_tons,
       v.body_type, v.body_length_m, v.body_width_m, v.body_height_m, v.body_volume_m3, v.trailer_size, v.status
from public.vehicles v
left join public.vehicle_types vt on vt.id = v.vehicle_type_id
where v.archived_at is null
  and ((select private.has_perm('vehicles.view_basic')) or (select private.has_perm('vehicles.view')))
  and (not (select private.is_customer_scoped()) or v.id = any((select private.my_customer_vehicle_ids())::uuid[]));
revoke all on public.vehicles_for_customer from anon;
grant select on public.vehicles_for_customer to authenticated;

-- 4. Quyền và vai trò ----------------------------------------------------------
insert into public.permissions (code, module, action, name, description, sort_order) values
  ('statements.view', 'statements', 'view', 'Xem bảng kê cước (chỉ đọc)', 'Cho tài khoản khách hàng: chỉ thấy bảng kê của các khách hàng được gán, không sửa được', 2720),
  ('statements.export', 'statements', 'export', 'Tải bảng kê cước (Excel)', 'Cho tài khoản khách hàng: tải bảng kê về Excel', 2721)
on conflict (code) do nothing;

insert into public.roles (code, name, description, is_system, sort_order)
values ('customer_statement', 'Khách hàng – xem bảng kê',
        'Tài khoản của khách (VD chủ VAP, PLA, DAM): chỉ xem, in và tải bảng kê cước của các khách hàng được gán ở trang Người dùng. Không sửa, không thêm cột.',
        true, 91)
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join (values ('statements.view'), ('statements.export')) p(code)
where r.code = 'customer_statement'
on conflict do nothing;

-- 5. View dữ liệu bảng kê cho tài khoản khách (chỉ cột của bảng kê) ------------------
--    Chạy với quyền chủ view nên không cần cấp quyền đọc bảng gốc cho khách;
--    lọc theo khách hàng được gán ngay trong view.
create or replace view public.statement_customers with (security_barrier = true) as
select c.id, c.code, c.name, c.tax_code, c.billing_address
from public.customers c
where c.status = 'active'
  and (select private.has_perm('statements.view'))
  and c.id = any((select private.my_customer_ids())::uuid[]);
comment on view public.statement_customers is 'Khách hàng tài khoản khách được lập bảng kê (theo user_customers)';

create or replace view public.statement_shipment_list with (security_barrier = true) as
select s.id,
       s.shipment_code,
       s.order_id,
       o.order_code,
       o.customer_id,
       c.code as customer_code,
       c.name as customer_name,
       s.pickup_at,
       s.expected_delivery_at,
       s.pickup_location_id,
       pl.name as pickup_name,
       pl.billing_address as pickup_billing_address,
       s.delivery_location_id,
       dl.name as delivery_name,
       dl.billing_address as delivery_billing_address,
       (pl.name || ' → ') || dl.name as route_label,
       er.name as empty_return_name,
       orl.name as offroute_return_name,
       vt.name as vehicle_type_name,
       v.plate_number,
       d.full_name as driver_name,
       s.quantity,
       s.pricing_unit,
       s.unit_price,
       s.freight_amount,
       s.surcharge_amount,
       s.fuel_support_rate,
       s.fuel_support_amount,
       s.extra_fee_amount,
       s.pass_through_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as total_revenue,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due,
       coalesce(ft.transport_fee, s.freight_amount + s.surcharge_amount + s.fuel_support_amount) as transport_fee,
       coalesce(ft.pass_through_fee, 0::numeric) as pass_through_fee,
       coalesce(ft.declaration_fee, 0::numeric) as declaration_fee,
       coalesce(ft.loading_fee, 0::numeric) as loading_fee,
       coalesce(ft.other_fee, 0::numeric) as other_fee,
       s.status,
       s.notes,
       s.custom_fields,
       o.custom_fields as order_custom_fields
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.locations er on er.id = s.empty_return_location_id
left join public.locations orl on orl.id = s.offroute_return_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join lateral (
  select t.transport_fee, t.pass_through_fee, t.declaration_fee, t.loading_fee, t.other_fee
  from public.shipment_fee_role_totals t where t.shipment_id = s.id
) ft on true
where s.status <> 'cancelled'
  and (select private.has_perm('statements.view'))
  and o.customer_id = any((select private.my_customer_ids())::uuid[]);
comment on view public.statement_shipment_list is 'Chuyến cho bảng kê của tài khoản khách: chỉ cột của bảng kê, chỉ khách hàng được gán';

create or replace view public.statement_shipment_fees with (security_barrier = true) as
select f.shipment_id, f.fee_type_id, f.amount
from public.shipment_fees f
join public.shipments s on s.id = f.shipment_id
join public.transport_orders o on o.id = s.order_id
where s.status <> 'cancelled'
  and (select private.has_perm('statements.view'))
  and o.customer_id = any((select private.my_customer_ids())::uuid[]);
comment on view public.statement_shipment_fees is 'Từng loại phí của chuyến cho bảng kê tài khoản khách';

revoke all on public.statement_customers, public.statement_shipment_list, public.statement_shipment_fees from anon;
grant select on public.statement_customers, public.statement_shipment_list, public.statement_shipment_fees to authenticated;
