-- =============================================================================
-- Kiểm thử GHA 9012: sổ hóa đơn bán ra / mua vào; khách hàng, điều phối không thấy
-- (dùng lại người dùng e101 kế toán, e102 khách, e103 điều phối của tệp 57)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
insert into public.customers (id, code, name, tax_code) values
  ('50000000-0000-0000-0000-0000000000f7', 'KHHD1', 'Công ty Khách Hóa Đơn', '0301234567')
on conflict do nothing;
insert into public.suppliers (id, code, name, tax_code) values
  ('50000000-0000-0000-0000-0000000000f8', 'NCCHD1', 'Nhà xe 3PL Hóa Đơn', '0309876543')
on conflict do nothing;
\o

do $$
declare v_sale uuid; v_buy uuid; v_fuel uuid; r record; n int;
begin
  perform tests.login('00000000-0000-0000-0000-00000000e101');
  set local role authenticated;
  select id into v_sale from public.tax_invoice_categories where direction = 'sale' and name = 'Cước vận chuyển';
  select id into v_buy from public.tax_invoice_categories where direction = 'purchase' and name = 'Thuê xe ngoài 3PL';
  select id into v_fuel from public.tax_invoice_categories where direction = 'purchase' and name = 'Xăng dầu';
  -- Bán ra: tên, MST lấy từ khách hàng; thuế suất theo loại (8%)
  insert into public.tax_invoices (direction, invoice_date, invoice_symbol, invoice_no, category_id, customer_id, amount)
  values ('sale', '2027-03-05', 'c27tgh', '0000123', v_sale, '50000000-0000-0000-0000-0000000000f7', 10000000);
  select * into r from public.tax_invoices where invoice_no = '123';
  if r.partner_name <> 'Công ty Khách Hóa Đơn' or r.partner_tax_code <> '0301234567' then
    raise exception 'FAIL: tên / MST khách (% / %)', r.partner_name, r.partner_tax_code;
  end if;
  if r.vat_rate <> '8' or r.vat_amount <> 800000 or r.total_amount <> 10800000 then
    raise exception 'FAIL: VAT bán ra (% / % / %)', r.vat_rate, r.vat_amount, r.total_amount;
  end if;
  if r.invoice_symbol <> 'C27TGH' or r.code !~ '^HD[0-9]{5}$' then raise exception 'FAIL: ký hiệu / mã (% %)', r.invoice_symbol, r.code; end if;
  -- Sửa tiền: VAT tự tính lại; nhập tay VAT thì giữ
  update public.tax_invoices set amount = 20000000 where id = r.id;
  select vat_amount into r from public.tax_invoices where invoice_no = '123';
  if r.vat_amount <> 1600000 then raise exception 'FAIL: VAT không tính lại khi sửa tiền (%)', r.vat_amount; end if;
  -- Mua vào: 3PL, xăng KKKNT (thuế 0), nhập VAT tay
  insert into public.tax_invoices (direction, invoice_date, invoice_no, category_id, supplier_id, amount, vat_amount, payment_status)
  values ('purchase', '2027-03-10', '555', v_buy, '50000000-0000-0000-0000-0000000000f8', 5000000, 400001, 'unpaid');
  insert into public.tax_invoices (direction, invoice_date, invoice_symbol, invoice_no, category_id, partner_name, partner_tax_code, amount, vat_rate)
  values ('purchase', '2027-03-11', 'C26MAV', '422579', v_fuel, 'CÔNG TY CỔ PHẦN AV CONNECT VIỆT NAM', '0313650711', 500000, 'KKKNT');
  select * into r from public.tax_invoices where invoice_no = '555';
  if r.partner_name <> 'Nhà xe 3PL Hóa Đơn' or r.vat_amount <> 400001 or r.customer_id is not null then
    raise exception 'FAIL: mua vào 3PL (% / %)', r.partner_name, r.vat_amount;
  end if;
  select * into r from public.tax_invoices where invoice_no = '422579';
  if r.vat_amount <> 0 or r.total_amount <> 500000 then raise exception 'FAIL: KKKNT phải 0 thuế (%)', r.vat_amount; end if;
  -- Trùng hóa đơn bị chặn (ký hiệu chữ thường, số có 0 đầu vẫn là trùng)
  begin
    insert into public.tax_invoices (direction, invoice_symbol, invoice_no, partner_tax_code, amount)
    values ('purchase', 'c26mav', '00422579', '0313650711', 1);
    raise exception 'FAIL: nhập trùng hóa đơn';
  exception when unique_violation then null;
  end;
  -- Loại hóa đơn sai bên bị chặn
  begin
    insert into public.tax_invoices (direction, category_id, partner_name, amount) values ('sale', v_buy, 'X', 1);
    raise exception 'FAIL: loại mua vào dùng cho hóa đơn bán ra';
  exception when check_violation then null;
  end;
  select count(*) into n from public.report_tax_invoice_month where report_month = '2027-03-01' and direction = 'purchase';
  if n <> 2 then raise exception 'FAIL: tổng hợp tháng (%)', n; end if;
  update public.payment_request_forms set invoice_ids = array[(select id from public.tax_invoices where invoice_no = '555')]
  where code = 'DNTT-2702-001';
  reset role;
  raise notice 'PASS: sổ hóa đơn (bán ra / mua vào, VAT tự tính, KKKNT, chặn trùng, phiếu đề nghị)';
end $$;

do $$
declare a int; b int; c int;
begin
  perform tests.login('00000000-0000-0000-0000-00000000e102');
  set local role authenticated;
  select count(*) into a from public.tax_invoices;
  select count(*) into b from public.tax_invoice_categories;
  select count(*) into c from public.report_tax_invoice_month;
  reset role;
  if a + b + c <> 0 then raise exception 'FAIL: khách thấy sổ hóa đơn (% % %)', a, b, c; end if;
  perform tests.login('00000000-0000-0000-0000-00000000e103');
  set local role authenticated;
  select count(*) into a from public.tax_invoices;
  begin
    insert into public.tax_invoices (direction, partner_name, amount) values ('purchase', 'X', 1000);
    raise exception 'FAIL: điều phối ghi được hóa đơn';
  exception when insufficient_privilege then null;
  end;
  reset role;
  if a <> 0 then raise exception 'FAIL: điều phối thấy sổ hóa đơn'; end if;
  raise notice 'PASS: khách hàng, điều phối không thấy / không ghi được sổ hóa đơn';
end $$;
