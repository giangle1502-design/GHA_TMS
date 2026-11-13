-- =============================================================================
-- 0058: Gộp danh mục phí (người dùng 03/11/2026): 4 tab Hạng mục chi phí, Nhóm chi phí, Loại phí thu khách,
--       Nhóm phí → 2 tab "Nhóm phí" và "Danh mục phí", mỗi dòng có Nguồn phí: Thu khách / Chi ra.
-- - Bảng giữ nguyên (fee_groups, fee_types = thu khách; expense_groups, expense_categories = chi ra),
--   chỉ thêm cột fee_source (cố định theo bảng) và 2 view gộp để xem chung một danh sách.
-- - Mã tự sinh 4 chữ số, đánh số riêng từng nguồn: TK0001 (phí thu khách), CP0001 (phí chi ra);
--   nhóm: NTK001 (nhóm thu khách), NCP001 (nhóm chi ra). Mã cũ được đánh lại theo thứ tự nhóm → thứ tự → tên.
-- - Nhóm phí thu khách có ô "Tính vào": Doanh thu / Chi hộ (không tính doanh thu); để trống = theo từng phí.
--   Khi có giá trị, mọi phí trong nhóm theo đúng cách tính đó (fee_types.fee_kind).
-- =============================================================================

-- 1. Mã tự sinh: thêm tham số độ dài số (mặc định 3 như cũ)
create or replace function private.fill_master_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix text := tg_argv[0];
  width integer := coalesce(nullif(tg_argv[1], '')::integer, 3);
  v integer;
  candidate text;
  taken boolean;
begin
  if new.code is not null and btrim(new.code) <> '' then
    new.code := upper(btrim(new.code));
    return new;
  end if;
  loop
    insert into public.code_sequences as cs (scope, period, last_value)
    values ('master:' || tg_table_name, 'all', 1)
    on conflict (scope, period) do update set last_value = cs.last_value + 1
    returning last_value into v;
    candidate := prefix || lpad(v::text, greatest(width, length(v::text)), '0');
    execute format('select exists (select 1 from %I.%I where code = $1)', tg_table_schema, tg_table_name)
      into taken using candidate;
    exit when not taken;
  end loop;
  new.code := candidate;
  return new;
end;
$$;

drop trigger if exists trg_fee_types_code on public.fee_types;
create trigger trg_fee_types_code before insert on public.fee_types for each row execute function private.fill_master_code('TK', '4');
drop trigger if exists trg_expense_categories_code on public.expense_categories;
create trigger trg_expense_categories_code before insert on public.expense_categories for each row execute function private.fill_master_code('CP', '4');
drop trigger if exists trg_fee_groups_code on public.fee_groups;
create trigger trg_fee_groups_code before insert on public.fee_groups for each row execute function private.fill_master_code('NTK', '3');
drop trigger if exists trg_expense_groups_code on public.expense_groups;
create trigger trg_expense_groups_code before insert on public.expense_groups for each row execute function private.fill_master_code('NCP', '3');

-- 2. Nguồn phí (cố định theo bảng, chỉ để hiển thị / lọc)
alter table public.fee_groups add column if not exists fee_source text generated always as ('customer') stored;
alter table public.fee_types add column if not exists fee_source text generated always as ('customer') stored;
alter table public.expense_groups add column if not exists fee_source text generated always as ('expense') stored;
alter table public.expense_categories add column if not exists fee_source text generated always as ('expense') stored;
comment on column public.fee_types.fee_source is 'Nguồn phí: customer = Thu khách (đầu vào), expense = Chi ra (đầu ra)';

-- 3. Nhóm phí thu khách: Tính vào (doanh thu / chi hộ); null = theo từng phí
alter table public.fee_groups add column if not exists counts_as text check (counts_as in ('revenue', 'pass_through'));
comment on column public.fee_groups.counts_as is 'Tính vào: revenue = Doanh thu, pass_through = Chi hộ (không tính doanh thu); null = theo từng phí';

-- Nhóm đang có: mọi phí trong nhóm cùng một cách tính thì lấy cách đó
update public.fee_groups g set counts_as = k.kind
from (
  select fee_group_id, min(fee_kind) as kind
  from public.fee_types where fee_group_id is not null
  group by fee_group_id having count(distinct fee_kind) = 1
) k
where k.fee_group_id = g.id and g.counts_as is null;
-- Nhóm chưa có phí: theo vai trò
update public.fee_groups set counts_as = case when report_role in ('pass_through', 'loading') then 'pass_through' else 'revenue' end
where counts_as is null and report_role <> 'other'
  and not exists (select 1 from public.fee_types t where t.fee_group_id = fee_groups.id);

create or replace function private.fee_types_sync_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
begin
  if new.fee_group_id is not null then
    select report_role, counts_as into g from public.fee_groups where id = new.fee_group_id;
    if found then
      if tg_op = 'INSERT' or new.fee_group_id is distinct from old.fee_group_id then
        new.is_loading := g.report_role = 'loading';
      end if;
      if g.counts_as is not null then
        new.fee_kind := g.counts_as;
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_fee_types_sync_group on public.fee_types;
create trigger trg_fee_types_sync_group before insert or update of fee_group_id, fee_kind on public.fee_types
for each row execute function private.fee_types_sync_group();

create or replace function private.fee_groups_sync_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report_role is distinct from old.report_role then
    update public.fee_types set is_loading = (new.report_role = 'loading')
    where fee_group_id = new.id and is_loading <> (new.report_role = 'loading');
  end if;
  if new.counts_as is not null and new.counts_as is distinct from old.counts_as then
    update public.fee_types set fee_kind = new.counts_as
    where fee_group_id = new.id and fee_kind <> new.counts_as;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_fee_groups_sync_types on public.fee_groups;
create trigger trg_fee_groups_sync_types after update of report_role, counts_as on public.fee_groups
for each row execute function private.fee_groups_sync_types();

-- 4. Đánh lại mã theo nguồn (mã cũ giữ ở legacy_code: vẫn tìm được theo mã cũ)
alter table public.fee_groups add column if not exists legacy_code text;
alter table public.fee_types add column if not exists legacy_code text;
alter table public.expense_groups add column if not exists legacy_code text;
alter table public.expense_categories add column if not exists legacy_code text;
-- Đánh hai bước để không đụng ràng buộc mã không trùng
create or replace function private.renumber_master_codes(p_table text, p_prefix text, p_width integer, p_order text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  execute format('update public.%I set legacy_code = code where legacy_code is null', p_table);
  execute format('update public.%I set code = ''~'' || id::text', p_table);
  execute format(
    'update public.%1$I t set code = %2$L || lpad(o.rn::text, greatest(%3$s, length(o.rn::text)), ''0'')
     from (select x.id, row_number() over (order by %4$s) as rn from public.%1$I x) o
     where o.id = t.id',
    p_table, p_prefix, p_width, p_order);
  execute format('select count(*) from public.%I', p_table) into n;
  insert into public.code_sequences as cs (scope, period, last_value)
  values ('master:' || p_table, 'all', n)
  on conflict (scope, period) do update set last_value = excluded.last_value;
end;
$$;
revoke all on function private.renumber_master_codes(text, text, integer, text) from public;

select private.renumber_master_codes('fee_groups', 'NTK', 3, 'x.sort_order, x.name, x.created_at');
select private.renumber_master_codes('expense_groups', 'NCP', 3, 'x.sort_order, x.name, x.created_at');
select private.renumber_master_codes('fee_types', 'TK', 4,
  '(select g.sort_order from public.fee_groups g where g.id = x.fee_group_id) nulls last, x.sort_order, x.name, x.created_at');
select private.renumber_master_codes('expense_categories', 'CP', 4,
  '(select g.sort_order from public.expense_groups g where g.id = x.group_id) nulls last, x.sort_order, x.name, x.created_at');

-- 5. Hai danh sách gộp (chỉ xem; thêm / sửa ở từng nguồn). Theo quyền xem danh mục của người gọi.
create or replace view public.fee_catalog_groups with (security_invoker = true) as
select g.id, 'customer'::text as fee_source, g.code, g.name,
       coalesce(g.counts_as, 'mixed') as counts_as, g.report_role, g.description, g.sort_order, g.is_active,
       (select count(*) from public.fee_types t where t.fee_group_id = g.id)::integer as item_count,
       g.created_at, g.updated_at
from public.fee_groups g
union all
select g.id, 'expense', g.code, g.name, 'cost', null, g.description, g.sort_order, g.is_active,
       (select count(*) from public.expense_categories c where c.group_id = g.id)::integer,
       g.created_at, g.updated_at
from public.expense_groups g;
comment on view public.fee_catalog_groups is 'Nhóm phí gộp: nhóm thu khách (fee_groups) + nhóm chi ra (expense_groups)';

create or replace view public.fee_catalog_items with (security_invoker = true) as
select t.id, 'customer'::text as fee_source, t.code, t.name, g.name as group_name,
       t.fee_kind as counts_as, t.description, t.sort_order, t.is_active, g.sort_order as group_sort,
       t.created_at, t.updated_at
from public.fee_types t
left join public.fee_groups g on g.id = t.fee_group_id
union all
select c.id, 'expense', c.code, c.name, coalesce(g.name, c.group_name), 'cost', null, c.sort_order, c.is_active, g.sort_order,
       c.created_at, c.updated_at
from public.expense_categories c
left join public.expense_groups g on g.id = c.group_id;
comment on view public.fee_catalog_items is 'Danh mục phí gộp: phí thu khách (fee_types) + phí chi ra (expense_categories)';

grant select on public.fee_catalog_groups, public.fee_catalog_items to authenticated;
