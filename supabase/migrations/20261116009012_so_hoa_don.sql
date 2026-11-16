-- =============================================================================
-- GHA 9012: Sổ hóa đơn riêng để cân đối thuế (LE yêu cầu 16/11/2026)
--   Cân đối thuế KHÔNG lấy từ dữ liệu chuyến nữa mà từ hai sổ hóa đơn:
--   * Hóa đơn bán ra: hóa đơn GHA xuất cho khách hàng (doanh thu, VAT đầu ra).
--   * Hóa đơn mua vào: hóa đơn nhận của nhà cung cấp: 3PL, điện, ăn uống, taxi, vé máy bay, xăng dầu…
--     (chi phí, VAT đầu vào). Từ hóa đơn mua vào lập được Giấy đề nghị thanh toán.
--   * tax_invoice_categories: loại hóa đơn (thêm được), chia theo bán ra / mua vào.
--   * payment_request_forms.invoice_ids: các hóa đơn mua vào đã đưa vào phiếu đề nghị thanh toán.
--   Dùng lại quyền overhead.* (chỉ Super Admin, Admin, Giám đốc, Kế toán). Tài khoản khách hàng không thấy.
-- Không xóa, không sửa dữ liệu có sẵn.
-- =============================================================================

-- 1. Loại hóa đơn
create table if not exists public.tax_invoice_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  direction text not null check (direction in ('sale', 'purchase')),
  name text not null check (length(trim(name)) between 1 and 150),
  group_name text check (group_name is null or length(group_name) <= 100),
  default_vat_rate text check (default_vat_rate is null or default_vat_rate in ('0', '5', '8', '10', 'KCT', 'KKKNT')),
  tax_deductible boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.tax_invoice_categories is 'Loại hóa đơn bán ra / mua vào (cước vận chuyển, 3PL, điện, ăn uống, taxi, vé máy bay, xăng dầu…)';
create unique index if not exists tax_invoice_categories_name_uq on public.tax_invoice_categories (direction, lower(name));
select private.attach_standard_triggers('public.tax_invoice_categories');
create trigger trg_tax_invoice_categories_code before insert on public.tax_invoice_categories
  for each row execute function private.fill_master_code('LH');
create trigger trg_tax_invoice_categories_audit after insert or update or delete on public.tax_invoice_categories
  for each row execute function private.audit_row_change('id');
alter table public.tax_invoice_categories enable row level security;
create policy tax_invoice_categories_select on public.tax_invoice_categories for select to authenticated
  using ((select private.has_perm('overhead.view')) or (select private.has_perm('overhead.create')));
create policy tax_invoice_categories_insert on public.tax_invoice_categories for insert to authenticated
  with check ((select private.has_perm('overhead.create')));
create policy tax_invoice_categories_update on public.tax_invoice_categories for update to authenticated
  using ((select private.has_perm('overhead.update'))) with check ((select private.has_perm('overhead.update')));
create policy tax_invoice_categories_delete on public.tax_invoice_categories for delete to authenticated
  using ((select private.has_perm('overhead.delete')));
revoke all on public.tax_invoice_categories from anon;
grant select, insert, update, delete on public.tax_invoice_categories to authenticated;

insert into public.tax_invoice_categories (direction, name, group_name, default_vat_rate, tax_deductible, sort_order)
select v.dir, v.name, v.grp, v.vat, true, v.ord
from (values
  ('sale', 'Cước vận chuyển', 'Vận chuyển', '8', 10),
  ('sale', 'Phí bốc xếp, nâng hạ', 'Dịch vụ khác', '8', 20),
  ('sale', 'Phí lưu kho, lưu bãi', 'Dịch vụ khác', '8', 30),
  ('sale', 'Doanh thu khác', 'Khác', null, 990),
  ('purchase', 'Thuê xe ngoài 3PL', 'Vận chuyển', '8', 10),
  ('purchase', 'Xăng dầu', 'Xe', '10', 20),
  ('purchase', 'Sửa chữa, bảo dưỡng xe', 'Xe', '8', 30),
  ('purchase', 'Phí cầu đường, bến bãi', 'Xe', null, 40),
  ('purchase', 'Bốc xếp thuê ngoài', 'Vận chuyển', '8', 50),
  ('purchase', 'Điện', 'Văn phòng', '8', 60),
  ('purchase', 'Nước', 'Văn phòng', '5', 70),
  ('purchase', 'Internet, điện thoại', 'Văn phòng', '8', 80),
  ('purchase', 'Thuê văn phòng, kho bãi', 'Văn phòng', '8', 90),
  ('purchase', 'Văn phòng phẩm', 'Văn phòng', '8', 100),
  ('purchase', 'Ăn uống, tiếp khách', 'Công tác, tiếp khách', '8', 110),
  ('purchase', 'Taxi, Grab', 'Công tác, tiếp khách', '8', 120),
  ('purchase', 'Vé máy bay, tàu xe', 'Công tác, tiếp khách', '8', 130),
  ('purchase', 'Khách sạn công tác', 'Công tác, tiếp khách', '8', 140),
  ('purchase', 'Thuê kế toán, dịch vụ thuế', 'Thuế, kế toán', '8', 150),
  ('purchase', 'Phí ngân hàng', 'Tài chính', 'KCT', 160),
  ('purchase', 'Chi phí khác', 'Khác', null, 990)
) as v(dir, name, grp, vat, ord)
where not exists (select 1 from public.tax_invoice_categories c where c.direction = v.dir and lower(c.name) = lower(v.name))
order by v.dir, v.ord;

-- 2. Sổ hóa đơn
create table if not exists public.tax_invoices (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  direction text not null check (direction in ('sale', 'purchase')),
  invoice_date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  invoice_symbol text check (invoice_symbol is null or length(invoice_symbol) <= 20),
  invoice_no text check (invoice_no is null or length(invoice_no) <= 50),
  category_id uuid references public.tax_invoice_categories (id),
  customer_id uuid references public.customers (id),
  supplier_id uuid references public.suppliers (id),
  partner_name text not null default '' check (length(partner_name) <= 300),
  partner_tax_code text check (partner_tax_code is null or length(partner_tax_code) <= 20),
  vehicle_id uuid references public.vehicles (id),
  description text check (description is null or length(description) <= 500),
  amount numeric(18,2) not null default 0 check (amount >= 0),
  vat_rate text check (vat_rate is null or vat_rate in ('0', '5', '8', '10', 'KCT', 'KKKNT')),
  vat_amount numeric(18,2) check (vat_amount is null or vat_amount >= 0),
  total_amount numeric(18,2) generated always as (amount + coalesce(vat_amount, 0)) stored,
  tax_deductible boolean not null default true,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  paid_date date,
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.tax_invoices is 'Sổ hóa đơn: bán ra (GHA xuất cho khách) và mua vào (nhà cung cấp xuất cho GHA). Nguồn duy nhất của Cân đối thuế';
comment on column public.tax_invoices.direction is 'sale = hóa đơn bán ra (doanh thu, VAT đầu ra); purchase = hóa đơn mua vào (chi phí, VAT đầu vào)';
comment on column public.tax_invoices.amount is 'Tiền hàng, dịch vụ chưa thuế GTGT';
comment on column public.tax_invoices.vat_amount is 'Tiền thuế GTGT ghi trên hóa đơn; để trống thì tự tính = tiền chưa thuế × thuế suất';
comment on column public.tax_invoices.payment_status is 'Bán ra: khách đã trả chưa. Mua vào: GHA đã trả nhà cung cấp chưa';
create index if not exists tax_invoices_date_idx on public.tax_invoices (direction, invoice_date desc);
-- Chặn nhập trùng một hóa đơn (cùng bên, MST đối tác, ký hiệu, số)
create unique index if not exists tax_invoices_no_uq on public.tax_invoices
  (direction, coalesce(partner_tax_code, ''), coalesce(upper(invoice_symbol), ''), invoice_no)
  where invoice_no is not null and invoice_no <> '';
select private.attach_standard_triggers('public.tax_invoices');
create trigger trg_tax_invoices_code before insert on public.tax_invoices
  for each row execute function private.fill_master_code('HD', '5');
create trigger trg_tax_invoices_audit after insert or update or delete on public.tax_invoices
  for each row execute function private.audit_row_change('id');

-- Tên, MST đối tác lấy từ khách hàng / nhà cung cấp khi để trống; thuế suất theo loại; tiền thuế tự tính
create or replace function private.tax_invoice_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_name text;
  p_tax text;
  c public.tax_invoice_categories;
  r numeric;
begin
  new.invoice_symbol := nullif(upper(btrim(coalesce(new.invoice_symbol, ''))), '');
  -- Số hóa đơn điện tử là số: bỏ số 0 đầu (0000045 = 45) để chặn nhập trùng đúng
  new.invoice_no := nullif(regexp_replace(btrim(coalesce(new.invoice_no, '')), '^0+(?=[0-9])', ''), '');
  new.partner_tax_code := nullif(regexp_replace(coalesce(new.partner_tax_code, ''), '\s', '', 'g'), '');
  if new.direction = 'sale' then new.supplier_id := null; new.vehicle_id := null; else new.customer_id := null; end if;
  if new.customer_id is not null then
    select name, tax_code into p_name, p_tax from public.customers where id = new.customer_id;
  elsif new.supplier_id is not null then
    select name, tax_code into p_name, p_tax from public.suppliers where id = new.supplier_id;
  end if;
  if btrim(coalesce(new.partner_name, '')) = '' then new.partner_name := coalesce(p_name, ''); end if;
  if new.partner_tax_code is null then new.partner_tax_code := nullif(btrim(coalesce(p_tax, '')), ''); end if;
  if new.category_id is not null then
    select * into c from public.tax_invoice_categories where id = new.category_id;
    if c.direction is distinct from new.direction then
      raise exception 'Loại hóa đơn không đúng (bán ra / mua vào)' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and new.vat_rate is null then new.vat_rate := c.default_vat_rate; end if;
  end if;
  r := case when new.vat_rate in ('5', '8', '10') then new.vat_rate::numeric else 0 end;
  if new.vat_amount is null
     or (tg_op = 'UPDATE' and new.vat_amount = old.vat_amount
         and (new.amount is distinct from old.amount or new.vat_rate is distinct from old.vat_rate)) then
    new.vat_amount := round(new.amount * r / 100, 0);
  end if;
  if new.payment_status = 'paid' and new.paid_date is null then new.paid_date := new.invoice_date; end if;
  if new.payment_status = 'unpaid' then new.paid_date := null; end if;
  return new;
end;
$$;
create trigger trg_tax_invoices_fill before insert or update on public.tax_invoices
  for each row execute function private.tax_invoice_fill();

alter table public.tax_invoices enable row level security;
create policy tax_invoices_select on public.tax_invoices for select to authenticated
  using ((select private.has_perm('overhead.view')));
create policy tax_invoices_insert on public.tax_invoices for insert to authenticated
  with check ((select private.has_perm('overhead.create')));
create policy tax_invoices_update on public.tax_invoices for update to authenticated
  using ((select private.has_perm('overhead.update'))) with check ((select private.has_perm('overhead.update')));
create policy tax_invoices_delete on public.tax_invoices for delete to authenticated
  using ((select private.has_perm('overhead.delete')));
revoke all on public.tax_invoices from anon;
grant select, insert, update, delete on public.tax_invoices to authenticated;

-- 3. Tổng hợp theo tháng, loại hóa đơn (tab "Theo tháng")
create or replace view public.report_tax_invoice_month with (security_invoker = true) as
select to_char(date_trunc('month', i.invoice_date), 'YYYY-MM') || ':' || i.direction || ':' || coalesce(i.category_id::text, '-') as id,
       date_trunc('month', i.invoice_date)::date as report_month,
       to_char(date_trunc('month', i.invoice_date), 'MM/YYYY') as month_label,
       i.direction, i.category_id,
       coalesce(c.name, 'Chưa phân loại') as category_name,
       count(*) as invoice_count,
       coalesce(sum(i.amount), 0) as amount,
       coalesce(sum(i.vat_amount), 0) as vat_amount,
       coalesce(sum(i.total_amount), 0) as total_amount,
       coalesce(sum(i.total_amount) filter (where i.payment_status = 'unpaid'), 0) as unpaid_amount
from public.tax_invoices i
left join public.tax_invoice_categories c on c.id = i.category_id
group by 1, 2, 3, i.direction, i.category_id, c.name;
comment on view public.report_tax_invoice_month is 'Hóa đơn bán ra / mua vào theo tháng, loại hóa đơn';
revoke all on public.report_tax_invoice_month from anon;
grant select on public.report_tax_invoice_month to authenticated;

-- 4. Phiếu đề nghị thanh toán: ghi các hóa đơn mua vào đã lấy
alter table public.payment_request_forms add column if not exists invoice_ids uuid[] not null default '{}';
comment on column public.payment_request_forms.invoice_ids is 'Hóa đơn mua vào (tax_invoices) đưa vào phiếu đề nghị thanh toán';
