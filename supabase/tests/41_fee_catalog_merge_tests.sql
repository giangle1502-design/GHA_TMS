-- =============================================================================
-- Kiểm thử 0058: Gộp danh mục phí (Thu khách / Chi ra), mã TK0001 / CP0001, Tính vào theo nhóm
-- (test-db.sh trả mã cũ từ legacy_code trước các kiểm thử cũ; ở đây đánh lại mã rồi kiểm tra)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
select private.renumber_master_codes('fee_types', 'TK', 4,
  '(select g.sort_order from public.fee_groups g where g.id = x.fee_group_id) nulls last, x.sort_order, x.name, x.created_at');
select private.renumber_master_codes('expense_categories', 'CP', 4,
  '(select g.sort_order from public.expense_groups g where g.id = x.group_id) nulls last, x.sort_order, x.name, x.created_at');
select tests.assert(not exists (select 1 from public.fee_types where code !~ '^TK\d{4}$'), 'Mọi phí thu khách có mã TK0001');
select tests.assert(not exists (select 1 from public.expense_categories where code !~ '^CP\d{4}$'), 'Mọi phí chi ra có mã CP0001');
select tests.assert(exists (select 1 from public.expense_categories where legacy_code = 'TOLL'), 'Giữ mã cũ ở legacy_code');

select tests.login('00000000-0000-0000-0000-0000000000c1'); -- kế toán
set role authenticated;
-- Mã mới tự sinh nối tiếp, 4 chữ số
insert into public.fee_groups (name, report_role, counts_as) values ('Nhóm thử 58', 'other', 'pass_through');
select tests.assert((select code ~ '^NTK\d{3}$' from public.fee_groups where name = 'Nhóm thử 58'), 'Nhóm thu khách mới có mã NTK001');
insert into public.fee_types (name, fee_kind, fee_group_id)
select 'Phí thử 58', 'revenue', id from public.fee_groups where name = 'Nhóm thử 58';
select tests.assert((select code = 'TK' || lpad((select count(*) from public.fee_types)::text, 4, '0') from public.fee_types where name = 'Phí thử 58'),
  'Phí thu khách mới lấy mã TK kế tiếp');
select tests.assert((select fee_kind = 'pass_through' from public.fee_types where name = 'Phí thử 58'), 'Phí theo Tính vào của nhóm (chi hộ)');
update public.fee_types set fee_kind = 'revenue' where name = 'Phí thử 58';
select tests.assert((select fee_kind = 'pass_through' from public.fee_types where name = 'Phí thử 58'), 'Không đổi được cách tính khác nhóm');
update public.fee_groups set counts_as = 'revenue' where name = 'Nhóm thử 58';
select tests.assert((select fee_kind = 'revenue' from public.fee_types where name = 'Phí thử 58'), 'Đổi Tính vào của nhóm thì đổi mọi phí trong nhóm');
update public.fee_groups set counts_as = null where name = 'Nhóm thử 58';
update public.fee_types set fee_kind = 'pass_through' where name = 'Phí thử 58';
select tests.assert((select fee_kind = 'pass_through' from public.fee_types where name = 'Phí thử 58'), 'Nhóm để trống Tính vào: theo từng phí');

insert into public.expense_categories (name, group_id) select 'Chi thử 58', id from public.expense_groups order by sort_order limit 1;
select tests.assert((select code ~ '^CP\d{4}$' and fee_source = 'expense' from public.expense_categories where name = 'Chi thử 58'), 'Phí chi ra mới có mã CP, nguồn Chi ra');

-- Danh sách gộp
select tests.assert((select count(*) from public.fee_catalog_items) = (select count(*) from public.fee_types) + (select count(*) from public.expense_categories),
  'Danh mục phí gộp đủ hai nguồn');
select tests.assert((select fee_source = 'customer' and group_name = 'Nhóm thử 58' from public.fee_catalog_items where name = 'Phí thử 58'), 'Danh mục phí gộp có nguồn, nhóm');
select tests.assert((select count(*) from public.fee_catalog_groups) = (select count(*) from public.fee_groups) + (select count(*) from public.expense_groups),
  'Nhóm phí gộp đủ hai nguồn');
select tests.assert((select counts_as = 'mixed' and item_count = 1 from public.fee_catalog_groups where name = 'Nhóm thử 58'), 'Nhóm phí gộp: Tính vào, số phí');

reset role;
delete from public.expense_categories where name = 'Chi thử 58';
delete from public.fee_types where name = 'Phí thử 58';
delete from public.fee_groups where name = 'Nhóm thử 58';
\o
select 'TẤT CẢ KIỂM THỬ GỘP DANH MỤC PHÍ ĐỀU ĐẠT' as ket_qua;
