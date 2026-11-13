-- =============================================================================
-- Kiểm thử 0044: Giao việc. Giám đốc e1 giao việc cho điều phối d1 và kế toán c1; tài xế b1 không được giao.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_tk (k text primary key, v text);
grant all on t_tk to authenticated, anon;

-- Người không có quyền tasks.create không giao được
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.create_task('Việc thử', array['00000000-0000-0000-0000-0000000000c1']::uuid[])$$,
  'Điều phối (không có quyền Giao việc) không giao được');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert_fails($$select public.create_task('', array['00000000-0000-0000-0000-0000000000c1']::uuid[])$$, 'Phải có tên việc');
select tests.assert_fails($$select public.create_task('Việc A', array[]::uuid[])$$, 'Phải chọn người được giao');
select tests.assert_fails($$select public.create_task('Việc A', array['00000000-0000-0000-0000-0000000000b1']::uuid[])$$, 'Không giao cho tài xế');
select tests.assert_fails($$select public.create_task('Việc A', array['00000000-0000-0000-0000-0000000000c1']::uuid[], null, 'normal',
  current_date + 2, current_date + 1)$$, 'Hạn trước ngày bắt đầu bị chặn');
select tests.assert_fails($$select public.create_task('Việc A', array['00000000-0000-0000-0000-0000000000c1']::uuid[], null, 'gấp')$$, 'Mức ưu tiên sai bị chặn');

-- Giao việc cho 2 người, hạn ngày mai
insert into t_tk select 't1', public.create_task('Đối chiếu công nợ khách tháng 10', array['00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1']::uuid[],
  'Gửi bảng đối chiếu cho khách trước thứ 6', 'high', current_date, current_date + 1, '17:00', null, '{}', '22222222-0000-0000-0000-000000000044')::text;
select tests.assert((select public.create_task('Đối chiếu công nợ khách tháng 10', array['00000000-0000-0000-0000-0000000000c1']::uuid[], null, 'normal',
  null, null, null, null, '{}', '22222222-0000-0000-0000-000000000044')::text) = (select v from t_tk where k = 't1'), 'Bấm giao hai lần không tạo hai việc');
select tests.assert((select status = 'todo' and assignee_count = 2 and assigned_by_me and not is_mine and can_edit and not can_work and not is_overdue
  and code like 'GV-%' from public.task_list where id = (select v::uuid from t_tk where k = 't1')), 'Việc mới: Chưa bắt đầu, 2 người, người giao sửa được');
reset role;
select tests.assert((select count(*) = 2 from public.notifications where type = 'task_assigned' and entity_id = (select v::uuid from t_tk where k = 't1')
  and link like '/giao-viec/%'), 'Hai người được giao nhận thông báo');
select tests.assert((select count(*) = 1 from public.task_comments where task_id = (select v::uuid from t_tk where k = 't1') and kind = 'event'),
  'Dòng thời gian ghi sự kiện giao việc');

-- Người ngoài (tài xế b1) không thấy việc
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((select count(*) = 0 from public.task_list where id = (select v::uuid from t_tk where k = 't1')), 'Tài xế không thấy việc của người khác');
select tests.assert((select count(*) = 0 from public.task_comments where task_id = (select v::uuid from t_tk where k = 't1')), 'Tài xế không thấy trao đổi');
select tests.assert_fails($$select public.add_task_comment((select v::uuid from t_tk where k = 't1'), 'xin chào')$$, 'Tài xế không trao đổi được');
select tests.assert_fails($$insert into public.tasks (title, assigned_by) values ('ghi thẳng', auth.uid())$$, 'Không ghi thẳng vào bảng việc');
reset role;

-- Người được giao d1: xem, bắt đầu, cập nhật tiến độ, trao đổi
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((select is_mine and can_work and is_new_for_me and not can_edit from public.task_list where id = (select v::uuid from t_tk where k = 't1')),
  'Người được giao thấy việc mới, làm được, không sửa được');
select public.mark_task_seen((select v::uuid from t_tk where k = 't1'));
select tests.assert((select not is_new_for_me and seen_count = 1 from public.task_list where id = (select v::uuid from t_tk where k = 't1')), 'Đánh dấu đã xem');
select tests.assert_fails($$select public.update_task((select v::uuid from t_tk where k = 't1'), 'Đổi tên', array['00000000-0000-0000-0000-0000000000d1']::uuid[])$$,
  'Người được giao không sửa việc');
select tests.assert_fails($$select public.task_action((select v::uuid from t_tk where k = 't1'), 'approve')$$, 'Người được giao không tự xác nhận');
select tests.assert((select public.task_action((select v::uuid from t_tk where k = 't1'), 'start')) = 'in_progress', 'Bắt đầu làm');
select tests.assert_fails($$select public.task_action((select v::uuid from t_tk where k = 't1'), 'progress', null, 120)$$, 'Tiến độ quá 100% bị chặn');
select public.task_action((select v::uuid from t_tk where k = 't1'), 'progress', 'Đã gửi 3/5 khách', 60);
select tests.assert((select progress = 60 and status = 'in_progress' from public.task_list where id = (select v::uuid from t_tk where k = 't1')), 'Tiến độ 60%');
select public.add_task_comment((select v::uuid from t_tk where k = 't1'), 'Khách B chưa trả lời email');
select tests.assert_fails($$select public.add_task_comment((select v::uuid from t_tk where k = 't1'), '   ')$$, 'Trao đổi rỗng bị chặn');
select tests.assert((select comment_count = 1 from public.task_list where id = (select v::uuid from t_tk where k = 't1')), 'Đếm 1 trao đổi');
select public.task_action((select v::uuid from t_tk where k = 't1'), 'submit', 'Đã đối chiếu xong 5 khách');
select tests.assert((select status = 'submitted' and progress = 100 and result_note = 'Đã đối chiếu xong 5 khách' and not can_work
  from public.task_list where id = (select v::uuid from t_tk where k = 't1')), 'Báo xong: chờ xác nhận');
select tests.assert_fails($$select public.task_action((select v::uuid from t_tk where k = 't1'), 'progress', null, 50)$$, 'Chờ xác nhận thì không cập nhật tiến độ');
reset role;
select tests.assert((select count(*) >= 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000e1' and type = 'task_submitted'),
  'Giám đốc được báo khi báo xong');
select tests.assert((select count(*) = 2 from public.notifications where type = 'task_comment' and entity_id = (select v::uuid from t_tk where k = 't1')),
  'Trao đổi báo cho người giao và người cùng làm, không báo người viết');

-- Kế toán c1 (cùng làm) thấy trao đổi
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select count(*) = 1 from public.task_comment_list where task_id = (select v::uuid from t_tk where k = 't1') and kind = 'comment'),
  'Người cùng làm thấy trao đổi');
reset role;

-- Giám đốc: yêu cầu làm lại (bắt buộc lý do), rồi xác nhận
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((select can_confirm from public.task_list where id = (select v::uuid from t_tk where k = 't1')), 'Giám đốc thấy nút xác nhận');
select tests.assert_fails($$select public.task_action((select v::uuid from t_tk where k = 't1'), 'reopen')$$, 'Làm lại phải ghi lý do');
select public.task_action((select v::uuid from t_tk where k = 't1'), 'reopen', 'Thiếu khách C');
select tests.assert((select status = 'in_progress' and progress = 90 from public.task_list where id = (select v::uuid from t_tk where k = 't1')), 'Làm lại: Đang làm, 90%');
-- Gia hạn + bỏ c1
select public.update_task((select v::uuid from t_tk where k = 't1'), 'Đối chiếu công nợ khách tháng 10', array['00000000-0000-0000-0000-0000000000d1']::uuid[],
  'Gửi bảng đối chiếu cho khách trước thứ 6', 'urgent', current_date, current_date + 3, null);
select tests.assert((select assignee_count = 1 and priority = 'urgent' and due_date = current_date + 3 from public.task_list where id = (select v::uuid from t_tk where k = 't1')),
  'Sửa việc: bỏ người, đổi ưu tiên, gia hạn');
select public.task_action((select v::uuid from t_tk where k = 't1'), 'approve', 'Tốt');
select tests.assert((select status = 'done' and not done_late and not can_edit from public.task_list where id = (select v::uuid from t_tk where k = 't1')), 'Hoàn thành đúng hạn');
select tests.assert_fails($$select public.update_task((select v::uuid from t_tk where k = 't1'), 'X', array['00000000-0000-0000-0000-0000000000d1']::uuid[])$$,
  'Việc đã hoàn thành không sửa được');

-- Việc quá hạn: hạn hôm qua
insert into t_tk select 't2', public.create_task('Nộp báo cáo tuần', array['00000000-0000-0000-0000-0000000000c1']::uuid[], null, 'normal',
  current_date - 3, current_date - 1)::text;
select tests.assert((select is_overdue and days_left = -1 from public.task_list where id = (select v::uuid from t_tk where k = 't2')), 'Việc quá hạn');
select tests.assert((select public.task_overdue_sweep()) >= 1, 'Quét quá hạn gửi báo');
select tests.assert((select public.task_overdue_sweep()) = 0, 'Quét lại không báo trùng');
reset role;
select tests.assert((select count(*) = 2 from public.notifications where type = 'task_overdue' and entity_id = (select v::uuid from t_tk where k = 't2')),
  'Báo quá hạn cho người giao và người được giao');
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select public.task_action((select v::uuid from t_tk where k = 't2'), 'submit', 'Nộp muộn');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select public.task_action((select v::uuid from t_tk where k = 't2'), 'approve');
select tests.assert((select done_late from public.task_list where id = (select v::uuid from t_tk where k = 't2')), 'Hoàn thành trễ hạn');
select tests.assert((select done_count = 1 and late_count = 1 and on_time_rate = 0 from public.report_task_by_person where user_id = '00000000-0000-0000-0000-0000000000c1'),
  'Báo cáo theo người: kế toán 1 việc xong trễ');
select tests.assert((select done_count = 1 and on_time_count = 1 and on_time_rate = 100 from public.report_task_by_person where user_id = '00000000-0000-0000-0000-0000000000d1'),
  'Báo cáo theo người: điều phối xong đúng hạn');

-- Hủy việc (bắt buộc lý do); Giám đốc tự giao cho mình thì báo xong là hoàn thành luôn
insert into t_tk select 't3', public.create_task('Gọi khách D', array['00000000-0000-0000-0000-0000000000e1']::uuid[])::text;
select tests.assert((select public.task_action((select v::uuid from t_tk where k = 't3'), 'submit')) = 'done', 'Tự giao cho mình: báo xong là hoàn thành');
insert into t_tk select 't4', public.create_task('Việc bỏ', array['00000000-0000-0000-0000-0000000000c1']::uuid[])::text;
select tests.assert_fails($$select public.task_action((select v::uuid from t_tk where k = 't4'), 'cancel')$$, 'Hủy phải ghi lý do');
select public.task_action((select v::uuid from t_tk where k = 't4'), 'cancel', 'Không cần nữa');
select tests.assert((select status = 'cancelled' from public.task_list where id = (select v::uuid from t_tk where k = 't4')), 'Đã hủy');
reset role;

-- Tệp đính kèm: người được giao ghi chứng từ cho việc (không cần quyền Chứng từ), người ngoài không thấy
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
insert into public.documents (bucket, storage_path, file_name, mime_type, size_bytes, entity_type, entity_id, doc_type, uploaded_by)
values ('documents', 'task/' || (select v from t_tk where k = 't2') || '/11111111-1111-1111-1111-111111111111.pdf', 'bao-cao.pdf', 'application/pdf', 100,
        'task', (select v::uuid from t_tk where k = 't2'), 'other', auth.uid());
reset role;
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((select file_count = 1 from public.task_list where id = (select v::uuid from t_tk where k = 't2')), 'Người giao thấy tệp đính kèm');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((select count(*) = 0 from public.documents where entity_type = 'task'), 'Tài xế không thấy tệp của việc');
reset role;

-- Dọn dữ liệu kiểm thử
delete from public.documents where entity_type = 'task';
delete from public.tasks where id in (select v::uuid from t_tk);
\o
\echo 'TẤT CẢ KIỂM THỬ GIAO VIỆC ĐỀU ĐẠT'
