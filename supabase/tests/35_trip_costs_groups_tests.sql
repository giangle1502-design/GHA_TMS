-- =============================================================================
-- Kiểm thử 0050: nhóm chi phí trong danh mục, số chứng từ, hủy khoản chi, báo cáo có khoản chờ duyệt
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

select tests.assert((select count(*) from public.expense_categories where group_id is null) = 0, 'Mọi hạng mục chi phí cũ đã được xếp vào nhóm');
select tests.assert((select count(*) from public.expense_groups where name = 'Nhiên liệu') = 1, 'Nhóm cũ được tạo từ group_name, không trùng');
select tests.assert_fails($$insert into public.expense_categories (code, name, group_name) values ('X_SAI', 'Sai nhóm', 'Nhom go tay')$$,
  'Không tạo hạng mục với nhóm gõ tay không có trong danh mục');
insert into public.expense_categories (code, name, group_name) values ('X_DUNG', 'Đúng nhóm', 'nhiên liệu');
select tests.assert((select group_name from public.expense_categories where code = 'X_DUNG') = 'Nhiên liệu', 'Nhóm gõ khớp danh mục thì gắn đúng nhóm, tên chuẩn');
update public.expense_groups set name = 'Nhiên liệu, dầu' where name = 'Nhiên liệu';
select tests.assert((select group_name from public.expense_categories where code = 'DIESEL') = 'Nhiên liệu, dầu', 'Đổi tên nhóm thì tên nhóm của hạng mục đổi theo');
select tests.assert_fails($$insert into public.expense_groups (name) values ('  nhiên liệu, DẦU ')$$, 'Không tạo hai nhóm trùng tên');

create temp table t_tc (k text primary key, v text);
grant all on t_tc to authenticated;
insert into t_tc select 's', id::text from public.shipments where status not in ('cancelled') order by created_at limit 1;
insert into t_tc select 'cat', id::text from public.expense_categories where code = 'DIESEL';
update public.expense_categories set requires_approval = true where code = 'DIESEL';

select tests.login('00000000-0000-0000-0000-0000000000a2'); -- admin
set role authenticated;
insert into t_tc select 'e1', public.add_shipment_expense((select v::uuid from t_tc where k = 's'), (select v::uuid from t_tc where k = 'cat'), 1500000,
  null, 'Đổ dầu', 'driver', null, '{}'::jsonb, gen_random_uuid(), null, ' HD-0012 ')::text;
select tests.assert((select ref_no from public.expense_list where id = (select v::uuid from t_tc where k = 'e1')) = 'HD-0012', 'Lưu số chứng từ (gọn khoảng trắng)');
select tests.assert((select group_name from public.expense_list where id = (select v::uuid from t_tc where k = 'e1')) = 'Nhiên liệu, dầu', 'Danh sách chi phí có tên nhóm');
select tests.assert((select status from public.report_cost_lines where id = 'cp:' || (select v from t_tc where k = 'e1')) = 'pending', 'Báo cáo chi theo nhóm hiện cả khoản chờ duyệt');
select tests.assert((select pending_amount from public.report_expense_by_category where category_id = (select v::uuid from t_tc where k = 'cat')) = 1500000,
  'Chi phí theo loại có cột chờ duyệt');
select tests.assert_fails($$select public.cancel_shipment_expense((select v::uuid from t_tc where k = 'e1'), '  ')$$, 'Hủy khoản chi phải có lý do');
select public.cancel_shipment_expense((select v::uuid from t_tc where k = 'e1'), 'Nhập nhầm số tiền');
reset role;
select tests.assert((select status from public.shipment_expenses where id = (select v::uuid from t_tc where k = 'e1')) = 'cancelled', 'Khoản chi đã hủy');
select tests.assert((select r.status from public.approval_requests r join public.shipment_expenses e on e.approval_request_id = r.id
  where e.id = (select v::uuid from t_tc where k = 'e1')) = 'cancelled', 'Yêu cầu duyệt của khoản chi cũng hủy');
select tests.assert(not exists (select 1 from public.report_cost_lines where id = 'cp:' || (select v from t_tc where k = 'e1')), 'Khoản đã hủy không còn trong báo cáo');

select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select tests.assert_fails($$select public.cancel_shipment_expense((select v::uuid from t_tc where k = 'e1'), 'Hủy lần hai')$$, 'Không hủy lại khoản đã hủy');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1'); -- tài xế
set role authenticated;
select tests.assert_fails($$select public.add_shipment_expense((select v::uuid from t_tc where k = 's'), (select v::uuid from t_tc where k = 'cat'), 1000)$$,
  'Tài xế không dùng hàm nhập chi phí của văn phòng');
reset role;

-- dọn dẹp
update public.expense_groups set name = 'Nhiên liệu' where name = 'Nhiên liệu, dầu';
delete from public.expense_categories where code = 'X_DUNG';
\o
\echo 'TẤT CẢ KIỂM THỬ NHÓM CHI PHÍ, NHẬP CHI PHÍ ĐẦU RA ĐỀU ĐẠT'
