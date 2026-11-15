-- =============================================================================
-- Kiểm thử GHA 9011: chi phí ngoài chuyến, tổng hợp theo xe, phiếu đề nghị; khách hàng không thấy
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create schema if not exists tests;
create or replace function tests.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid::text, false);
$$;
grant usage on schema tests to authenticated;
grant execute on function tests.login(uuid) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000e101', 'ketoan.cn@gha.test', '{"full_name":"Kế toán CN"}'),
  ('00000000-0000-0000-0000-00000000e102', 'khach.cn@gha.test', '{"full_name":"Khách CN"}'),
  ('00000000-0000-0000-0000-00000000e103', 'dieuphoi.cn@gha.test', '{"full_name":"Điều phối CN"}')
on conflict do nothing;
update public.profiles set status = 'active'
where id in ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-00000000e103');
insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-00000000e101', id from public.roles where code = 'accountant' on conflict do nothing;
insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-00000000e102', id from public.roles where code = 'customer_admin' on conflict do nothing;
insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-00000000e103', id from public.roles where code = 'dispatcher' on conflict do nothing;
insert into public.vehicles (id, code, plate_number, vehicle_type_id)
select '50000000-0000-0000-0000-0000000000f1', 'XEF1', '61K99F01', id from public.vehicle_types order by created_at limit 1
on conflict do nothing;
\o

-- Kế toán nhập dầu theo xe (lít × đơn giá), có hóa đơn -> thuế suất lấy theo loại phí
do $$
declare v_cat uuid; r record; n int;
begin
  perform tests.login('00000000-0000-0000-0000-00000000e101');
  set local role authenticated;
  select id into v_cat from public.overhead_categories where name = 'Dầu xe (đổ dầu theo xe)';
  insert into public.overhead_expenses (expense_date, category_id, vehicle_id, quantity, unit_price, has_invoice, invoice_no)
  values ('2027-02-03', v_cat, '50000000-0000-0000-0000-0000000000f1', 100, 20000, true, 'HD001'),
         ('2027-02-20', v_cat, '50000000-0000-0000-0000-0000000000f1', 50, 21000, false, null);
  select * into r from public.overhead_expenses where invoice_no = 'HD001';
  if r.amount <> 2000000 then raise exception 'FAIL: tiền = lít × đơn giá (%)', r.amount; end if;
  if r.vat_rate <> 10 or r.vat_amount <> 200000 or r.total_amount <> 2200000 then
    raise exception 'FAIL: VAT tự tính sai (% / % / %)', r.vat_rate, r.vat_amount, r.total_amount;
  end if;
  if r.code !~ '^CN[0-9]{5}$' then raise exception 'FAIL: mã tự sinh %', r.code; end if;
  if r.paid_date <> '2027-02-03' then raise exception 'FAIL: ngày chi mặc định'; end if;
  select * into r from public.report_overhead_vehicle_month where vehicle_id = '50000000-0000-0000-0000-0000000000f1' and report_month = '2027-02-01';
  if r.fuel_liters <> 150 or r.fuel_amount <> 3050000 or r.fuel_count <> 2 then
    raise exception 'FAIL: tổng hợp dầu theo xe (% lít, % đ)', r.fuel_liters, r.fuel_amount;
  end if;
  select count(*) into n from public.report_spending_lines where source = 'overhead' and report_date between '2027-02-01' and '2027-02-28';
  if n <> 2 then raise exception 'FAIL: Tổng chi theo nhóm chưa có chi phí ngoài chuyến (%)', n; end if;
  insert into public.payment_request_forms (form_type, form_date, requester_name, content, amount)
  values ('payment', '2027-02-25', 'Lê Văn Giang', 'Thanh toán tiền dầu', 3050000),
         ('advance', '2027-02-25', 'Lê Văn Giang', 'Tạm ứng sửa xe', 5000000);
  if not exists (select 1 from public.payment_request_forms where code = 'DNTT-2702-001')
     or not exists (select 1 from public.payment_request_forms where code = 'DNTU-2702-001') then
    raise exception 'FAIL: số phiếu đề nghị';
  end if;
  reset role;
  raise notice 'PASS: chi phí ngoài chuyến (lít × giá, VAT, tổng hợp theo xe, Tổng chi, số phiếu đề nghị)';
end $$;

-- Tài khoản khách hàng và điều phối không thấy chi phí nội bộ
do $$
declare a int; b int; c int; d int; v_cat uuid;
begin
  select id into v_cat from public.overhead_categories order by sort_order limit 1;
  perform tests.login('00000000-0000-0000-0000-00000000e102');
  set local role authenticated;
  select count(*) into a from public.overhead_expenses;
  select count(*) into b from public.overhead_categories;
  select count(*) into c from public.payment_request_forms;
  select count(*) into d from public.report_overhead_vehicle_month;
  reset role;
  if a + b + c + d <> 0 then raise exception 'FAIL: khách thấy chi phí nội bộ (% % % %)', a, b, c, d; end if;
  perform tests.login('00000000-0000-0000-0000-00000000e103');
  set local role authenticated;
  select count(*) into a from public.overhead_expenses;
  begin
    insert into public.overhead_expenses (category_id, amount) values (v_cat, 1000);
    raise exception 'FAIL: điều phối ghi được chi phí ngoài chuyến';
  exception when insufficient_privilege then null;
  end;
  reset role;
  if a <> 0 then raise exception 'FAIL: điều phối thấy chi phí ngoài chuyến'; end if;
  raise notice 'PASS: khách hàng, điều phối không thấy / không ghi được chi phí ngoài chuyến';
end $$;
