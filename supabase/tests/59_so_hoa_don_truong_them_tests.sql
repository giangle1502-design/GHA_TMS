-- Kiểm thử GHA 9013: sổ hóa đơn nhận trường bổ sung tự thêm
\set ON_ERROR_STOP 1
do $$
begin
  if private.custom_field_table('tax_invoices') is distinct from 'tax_invoices' then
    raise exception 'FAIL: module tax_invoices chưa được phép thêm trường';
  end if;
  update public.tax_invoices set custom_fields = '{"so_hop_dong":"HD-01"}' where invoice_no = '123';
  if not exists (select 1 from public.tax_invoices where custom_fields ->> 'so_hop_dong' = 'HD-01') then
    raise exception 'FAIL: không lưu được trường bổ sung';
  end if;
  raise notice 'PASS: sổ hóa đơn có trường bổ sung tự thêm';
end $$;
