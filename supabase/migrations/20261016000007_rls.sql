-- =============================================================================
-- GHA TMS - 0007: Row Level Security
-- =============================================================================
-- Mặc định TỪ CHỐI: bật RLS cho mọi bảng public; chỉ mở đúng quyền cần thiết.
-- (Không dùng FORCE RLS để các hàm security definer do chủ sở hữu bảng chạy hoạt động đúng.)
-- Các thao tác tài chính / tài xế (nhận chuyến, ứng tiền, nhập chi phí, duyệt, thanh toán)
-- KHÔNG mở ghi trực tiếp; sẽ đi qua hàm SQL security definer ở Giai đoạn 5-7 để kiểm tra
-- nghiệp vụ trong cùng transaction.
-- =============================================================================

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Không cho khách (anon) đọc/ghi bất kỳ bảng nào
revoke all on all tables in schema public from anon;

-- Sinh bộ policy chuẩn theo module: view / create / update / delete
create or replace function private.apply_module_policies(
  tbl text, module text,
  select_expr text default null,
  with_delete boolean default true
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('create policy %I on public.%I for select to authenticated using (%s)',
    tbl || '_select', tbl, coalesce(select_expr, format('private.has_perm(%L)', module || '.view')));
  execute format('create policy %I on public.%I for insert to authenticated with check (private.has_perm(%L))',
    tbl || '_insert', tbl, module || '.create');
  execute format('create policy %I on public.%I for update to authenticated using (private.has_perm(%L)) with check (private.has_perm(%L))',
    tbl || '_update', tbl, module || '.update', module || '.update');
  if with_delete then
    execute format('create policy %I on public.%I for delete to authenticated using (private.has_perm(%L))',
      tbl || '_delete', tbl, module || '.delete');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Người dùng & phân quyền
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.has_perm('users.view'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or private.has_perm('users.update'))
  with check (id = auth.uid() or private.has_perm('users.update'));

create policy roles_select on public.roles for select to authenticated using (private.is_active_user());
create policy roles_insert on public.roles for insert to authenticated with check (private.has_perm('users.configure'));
create policy roles_update on public.roles for update to authenticated using (private.has_perm('users.configure')) with check (private.has_perm('users.configure'));
create policy roles_delete on public.roles for delete to authenticated using (private.has_perm('users.configure'));

create policy permissions_select on public.permissions for select to authenticated using (private.is_active_user());

create policy role_permissions_select on public.role_permissions for select to authenticated using (private.is_active_user());
create policy role_permissions_insert on public.role_permissions for insert to authenticated with check (private.has_perm('users.configure'));
create policy role_permissions_delete on public.role_permissions for delete to authenticated using (private.has_perm('users.configure'));

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or private.has_perm('users.view'));
create policy user_roles_insert on public.user_roles for insert to authenticated with check (private.has_perm('users.configure'));
create policy user_roles_delete on public.user_roles for delete to authenticated using (private.has_perm('users.configure'));

create policy user_perm_overrides_select on public.user_permission_overrides for select to authenticated
  using (user_id = auth.uid() or private.has_perm('users.view'));
create policy user_perm_overrides_insert on public.user_permission_overrides for insert to authenticated with check (private.has_perm('users.configure'));
create policy user_perm_overrides_update on public.user_permission_overrides for update to authenticated using (private.has_perm('users.configure')) with check (private.has_perm('users.configure'));
create policy user_perm_overrides_delete on public.user_permission_overrides for delete to authenticated using (private.has_perm('users.configure'));

create policy user_invitations_select on public.user_invitations for select to authenticated using (private.has_perm('users.view'));
create policy user_invitations_update on public.user_invitations for update to authenticated
  using (private.has_perm('users.update')) with check (private.has_perm('users.update') and status in ('pending', 'revoked'));

-- -----------------------------------------------------------------------------
-- Danh mục tham chiếu: mọi người dùng đang hoạt động được đọc; ghi theo quyền catalogs.*
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['catalogs', 'catalog_items', 'company_entities', 'banks', 'payment_methods',
                           'vehicle_types', 'expense_categories', 'approval_types'] loop
    perform private.apply_module_policies(t, 'catalogs', 'private.is_active_user()');
  end loop;
end $$;

select private.apply_module_policies('salary_rules', 'catalogs', 'private.has_perm(''catalogs.view'') or private.has_perm(''drivers.view'')');
select private.apply_module_policies('approval_rules', 'approvals', 'private.has_perm(''approvals.view'')');
-- approval_rules: ghi theo approvals.configure thay vì create/update/delete
drop policy approval_rules_insert on public.approval_rules;
drop policy approval_rules_update on public.approval_rules;
drop policy approval_rules_delete on public.approval_rules;
create policy approval_rules_write on public.approval_rules for all to authenticated
  using (private.has_perm('approvals.configure')) with check (private.has_perm('approvals.configure'));

-- -----------------------------------------------------------------------------
-- Tài xế, phương tiện, khách hàng, địa điểm, bảng giá
-- -----------------------------------------------------------------------------
select private.apply_module_policies('drivers', 'drivers',
  'private.has_perm(''drivers.view'') or (profile_id = auth.uid() and private.is_active_user())');

create policy driver_sensitive_select on public.driver_sensitive for select to authenticated
  using (private.has_perm('drivers.view_sensitive') or driver_id = private.my_driver_id());
create policy driver_sensitive_write on public.driver_sensitive for all to authenticated
  using (private.has_perm('drivers.view_sensitive') and private.has_perm('drivers.update'))
  with check (private.has_perm('drivers.view_sensitive') and private.has_perm('drivers.update'));

select private.apply_module_policies('vehicles', 'vehicles');
create policy vehicle_financials_select on public.vehicle_financials for select to authenticated
  using (private.has_perm('vehicles.view_sensitive'));
create policy vehicle_financials_write on public.vehicle_financials for all to authenticated
  using (private.has_perm('vehicles.view_sensitive') and private.has_perm('vehicles.update'))
  with check (private.has_perm('vehicles.view_sensitive') and private.has_perm('vehicles.update'));
create policy loan_schedules_select on public.loan_schedules for select to authenticated
  using (private.has_perm('vehicles.view_sensitive'));
create policy loan_schedules_write on public.loan_schedules for all to authenticated
  using (private.has_perm('vehicles.view_sensitive') and private.has_perm('vehicles.update'))
  with check (private.has_perm('vehicles.view_sensitive') and private.has_perm('vehicles.update'));
select private.apply_module_policies('maintenance_records', 'vehicles', null, false);

select private.apply_module_policies('customers', 'customers');
select private.apply_module_policies('suppliers', 'customers');
select private.apply_module_policies('locations', 'locations');
select private.apply_module_policies('routes', 'locations');
select private.apply_module_policies('transport_price_lists', 'price_lists');
select private.apply_module_policies('fuel_support_rules', 'price_lists');

-- Tài khoản ngân hàng: của tài xế thuộc dữ liệu nhạy cảm
create policy bank_accounts_select on public.bank_accounts for select to authenticated using (
  (owner_type = 'driver' and (private.has_perm('drivers.view_sensitive') or driver_id = private.my_driver_id()))
  or (owner_type <> 'driver' and (private.has_perm('catalogs.view') or private.has_perm('payments.view')))
);
create policy bank_accounts_write on public.bank_accounts for all to authenticated using (
  (owner_type = 'driver' and private.has_perm('drivers.view_sensitive') and private.has_perm('drivers.update'))
  or (owner_type <> 'driver' and private.has_perm('catalogs.update'))
) with check (
  (owner_type = 'driver' and private.has_perm('drivers.view_sensitive') and private.has_perm('drivers.update'))
  or (owner_type <> 'driver' and private.has_perm('catalogs.update'))
);

-- -----------------------------------------------------------------------------
-- Điều phối & Shipment
-- -----------------------------------------------------------------------------
create policy transport_orders_select on public.transport_orders for select to authenticated
  using (private.has_perm('dispatch.view') or private.has_perm('shipments.view'));
create policy transport_orders_insert on public.transport_orders for insert to authenticated
  with check (private.has_perm('dispatch.create'));
create policy transport_orders_update on public.transport_orders for update to authenticated
  using (private.has_perm('dispatch.update')) with check (private.has_perm('dispatch.update'));

create policy shipments_select on public.shipments for select to authenticated using (
  private.has_perm('shipments.view') or private.has_perm('dispatch.view')
  or (driver_id is not null and driver_id = private.my_driver_id() and private.has_perm('driver_app.use'))
);
create policy shipments_insert on public.shipments for insert to authenticated
  with check (private.has_perm('dispatch.create') or private.has_perm('shipments.create'));
create policy shipments_update on public.shipments for update to authenticated
  using (private.has_perm('dispatch.update') or private.has_perm('shipments.update'))
  with check (private.has_perm('dispatch.update') or private.has_perm('shipments.update'));
create policy shipments_delete on public.shipments for delete to authenticated
  using ((private.has_perm('dispatch.delete') or private.has_perm('shipments.delete')) and status = 'draft');

create policy shipment_assignments_select on public.shipment_assignments for select to authenticated using (
  private.has_perm('shipments.view') or private.has_perm('dispatch.view')
  or (driver_id = private.my_driver_id() and private.has_perm('driver_app.use'))
);
create policy shipment_assignments_insert on public.shipment_assignments for insert to authenticated
  with check (private.has_perm('dispatch.update'));
create policy shipment_assignments_update on public.shipment_assignments for update to authenticated
  using (private.has_perm('dispatch.update')) with check (private.has_perm('dispatch.update'));

create policy shipment_status_history_select on public.shipment_status_history for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id));

-- -----------------------------------------------------------------------------
-- Chứng từ
-- -----------------------------------------------------------------------------
create policy documents_select on public.documents for select to authenticated using (
  archived_at is null and (
    uploaded_by = auth.uid()
    or (private.has_perm('documents.view') and (not is_sensitive or private.has_perm('documents.view_sensitive')))
    or (entity_type = 'shipment' and not is_sensitive
        and exists (select 1 from public.shipments s where s.id = entity_id and s.driver_id = private.my_driver_id()))
  )
);
create policy documents_insert on public.documents for insert to authenticated
  with check (private.has_perm('documents.create') and uploaded_by = auth.uid());
create policy documents_archive on public.documents for update to authenticated
  using (private.has_perm('documents.delete')) with check (private.has_perm('documents.delete'));

-- -----------------------------------------------------------------------------
-- Tài chính: chỉ đọc qua RLS; ghi qua hàm nghiệp vụ (Giai đoạn 6-7)
-- -----------------------------------------------------------------------------
create policy approval_requests_select on public.approval_requests for select to authenticated
  using (private.has_perm('approvals.view') or requested_by = auth.uid());
create policy approval_steps_select on public.approval_steps for select to authenticated
  using (exists (select 1 from public.approval_requests r where r.id = request_id));

create policy shipment_expenses_select on public.shipment_expenses for select to authenticated using (
  private.has_perm('expenses.view') or entered_by = auth.uid()
);
create policy advance_requests_select on public.advance_requests for select to authenticated using (
  private.has_perm('advances.view') or requested_by = auth.uid() or driver_id = private.my_driver_id()
);
create policy advance_transactions_select on public.advance_transactions for select to authenticated using (
  private.has_perm('advances.view') or driver_id = private.my_driver_id()
);
create policy payments_select on public.payments for select to authenticated using (private.has_perm('payments.view'));
create policy receivables_select on public.receivables for select to authenticated using (private.has_perm('receivables.view'));
create policy payables_select on public.payables for select to authenticated using (private.has_perm('receivables.view'));

-- -----------------------------------------------------------------------------
-- Cấu hình động
-- -----------------------------------------------------------------------------
create policy field_definitions_select on public.field_definitions for select to authenticated using (private.is_active_user());
create policy field_definitions_write on public.field_definitions for all to authenticated
  using (private.has_perm('fields.configure')) with check (private.has_perm('fields.configure'));
create policy field_definition_versions_select on public.field_definition_versions for select to authenticated
  using (private.has_perm('fields.view') or private.has_perm('fields.configure'));

create policy form_definitions_select on public.form_definitions for select to authenticated using (private.is_active_user());
create policy form_definitions_write on public.form_definitions for all to authenticated
  using (private.has_perm('forms.configure')) with check (private.has_perm('forms.configure'));
create policy form_versions_select on public.form_versions for select to authenticated using (private.is_active_user());
create policy form_versions_insert on public.form_versions for insert to authenticated with check (private.has_perm('forms.configure'));

create policy workflow_definitions_select on public.workflow_definitions for select to authenticated
  using (private.has_perm('workflows.view') or private.has_perm('approvals.view'));
create policy workflow_definitions_write on public.workflow_definitions for all to authenticated
  using (private.has_perm('workflows.configure')) with check (private.has_perm('workflows.configure'));
create policy workflow_versions_select on public.workflow_versions for select to authenticated
  using (private.has_perm('workflows.view') or private.has_perm('approvals.view'));
create policy workflow_versions_insert on public.workflow_versions for insert to authenticated with check (private.has_perm('workflows.configure'));

create policy table_view_prefs_select on public.table_view_preferences for select to authenticated using (
  private.is_active_user() and (
    scope = 'system'
    or user_id = auth.uid()
    or (scope = 'role' and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role_id = table_view_preferences.role_id))
    or private.has_perm('settings.configure')
  )
);
create policy table_view_prefs_write on public.table_view_preferences for all to authenticated using (
  private.is_active_user() and (
    (scope = 'user' and user_id = auth.uid())
    or (scope in ('system', 'role') and private.has_perm('settings.configure'))
  )
) with check (
  private.is_active_user() and (
    (scope = 'user' and user_id = auth.uid())
    or (scope in ('system', 'role') and private.has_perm('settings.configure'))
  )
);

create policy notifications_select on public.notifications for select to authenticated using (recipient_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create or replace function private.guard_notifications()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.recipient_id, new.type, new.title, new.body, new.entity_type, new.entity_id, new.link, new.created_at)
     is distinct from (old.recipient_id, old.type, old.title, old.body, old.entity_type, old.entity_id, old.link, old.created_at) then
    raise exception 'Chỉ được đánh dấu đã đọc' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_notifications_guard before update on public.notifications
for each row execute function private.guard_notifications();

create policy audit_logs_select on public.audit_logs for select to authenticated using (private.has_perm('audit_logs.view'));

create policy system_settings_select on public.system_settings for select to authenticated using (private.is_active_user());
create policy system_settings_write on public.system_settings for all to authenticated
  using (private.has_perm('settings.configure')) with check (private.has_perm('settings.configure'));

create or replace function private.system_settings_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
create trigger trg_system_settings_actor before insert or update on public.system_settings
for each row execute function private.system_settings_actor();
