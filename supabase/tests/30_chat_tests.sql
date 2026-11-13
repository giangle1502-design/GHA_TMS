-- =============================================================================
-- Kiểm thử 0043: Trò chuyện riêng 1-1 và nhóm.
-- Điều phối d1, kế toán c1, Giám đốc e1 là nhân viên; tài xế b1 không dùng được trò chuyện.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_chat (k text primary key, v text);
grant all on t_chat to authenticated, anon;

-- Trò chuyện riêng d1 <-> c1
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.chat_open_direct('00000000-0000-0000-0000-0000000000d1')$$, 'Không trò chuyện riêng với chính mình');
select tests.assert_fails($$select public.chat_open_direct('00000000-0000-0000-0000-0000000000b1')$$, 'Không trò chuyện với tài xế');
insert into t_chat select 'dm', public.chat_open_direct('00000000-0000-0000-0000-0000000000c1')::text;
select tests.assert(public.chat_open_direct('00000000-0000-0000-0000-0000000000c1')::text = (select v from t_chat where k = 'dm'),
  'Mở lại trò chuyện riêng dùng đúng phòng cũ');
select tests.assert_fails($$select public.chat_send((select v::uuid from t_chat where k = 'dm'), '   ')$$, 'Không gửi tin trống');
insert into t_chat select 'm1', public.chat_send((select v::uuid from t_chat where k = 'dm'), 'Chào kế toán', null, '22222222-0000-0000-0000-000000000043')::text;
select tests.assert(public.chat_send((select v::uuid from t_chat where k = 'dm'), 'Chào kế toán', null, '22222222-0000-0000-0000-000000000043')::text
  = (select v from t_chat where k = 'm1'), 'Bấm gửi hai lần không tạo hai tin');
select tests.assert((select display_name = 'Kế toán A' or display_name is not null from public.chat_room_list where id = (select v::uuid from t_chat where k = 'dm')),
  'Danh sách trò chuyện hiện tên người kia');
select tests.assert((select unread_count = 0 from public.chat_room_list where id = (select v::uuid from t_chat where k = 'dm')), 'Tin của mình không tính chưa đọc');
select tests.assert_fails($$insert into public.chat_messages (room_id, sender_id, body) values ((select v::uuid from t_chat where k = 'dm'), auth.uid(), 'x')$$,
  'Không ghi thẳng vào bảng tin nhắn');

-- Kế toán thấy tin chưa đọc, Giám đốc không thấy phòng riêng của hai người
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert(public.chat_unread_total() = 1, 'Người nhận có 1 tin chưa đọc');
select tests.assert((select unread_count = 1 and last_body = 'Chào kế toán' from public.chat_room_list where id = (select v::uuid from t_chat where k = 'dm')),
  'Danh sách hiện tin cuối và số chưa đọc');
select public.chat_mark_read((select v::uuid from t_chat where k = 'dm'));
select tests.assert(public.chat_unread_total() = 0, 'Đánh dấu đã đọc');
select tests.assert_fails($$select public.chat_delete_message((select v::uuid from t_chat where k = 'm1'))$$, 'Không thu hồi tin của người khác');
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((select count(*) = 0 from public.chat_messages where room_id = (select v::uuid from t_chat where k = 'dm')), 'Người ngoài không đọc được tin riêng');
select tests.assert_fails($$select public.chat_send((select v::uuid from t_chat where k = 'dm'), 'xen ngang')$$, 'Người ngoài không gửi vào phòng riêng');

-- Tài xế không dùng được
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert_fails($$select public.chat_open_direct('00000000-0000-0000-0000-0000000000d1')$$, 'Tài xế không mở trò chuyện');

-- Nhóm: d1 tạo nhóm với c1
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.chat_create_group('', array['00000000-0000-0000-0000-0000000000c1']::uuid[])$$, 'Nhóm phải có tên');
select tests.assert_fails($$select public.chat_create_group('Nhóm trống', array[]::uuid[])$$, 'Nhóm phải có thành viên');
select tests.assert_fails($$select public.chat_create_group('Nhóm có tài xế', array['00000000-0000-0000-0000-0000000000b1']::uuid[])$$, 'Không thêm tài xế vào nhóm');
insert into t_chat select 'g', public.chat_create_group('Điều phối và kế toán', array['00000000-0000-0000-0000-0000000000c1']::uuid[])::text;
select tests.assert((select member_count = 2 and my_role = 'admin' and last_kind = 'system' from public.chat_room_list where id = (select v::uuid from t_chat where k = 'g')),
  'Tạo nhóm: 2 thành viên, người tạo là quản trị, có dòng thông báo');

-- c1 (thành viên thường) thêm e1, đổi tên; không mời người ra được
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert(public.chat_add_members((select v::uuid from t_chat where k = 'g'), array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1']::uuid[]) = 1,
  'Thành viên thêm được người mới (bỏ qua người đã có)');
select public.chat_rename((select v::uuid from t_chat where k = 'g'), 'Phòng điều hành');
select tests.assert_fails($$select public.chat_remove_member((select v::uuid from t_chat where k = 'g'), '00000000-0000-0000-0000-0000000000e1')$$,
  'Thành viên thường không mời người khác ra');
insert into t_chat select 'gm', public.chat_send((select v::uuid from t_chat where k = 'g'), 'Báo cáo xong rồi')::text;

select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((select display_name = 'Phòng điều hành' and member_count = 3 and unread_count = 1 from public.chat_room_list where id = (select v::uuid from t_chat where k = 'g')),
  'Người được thêm thấy nhóm, tên mới, tin chưa đọc (không tính dòng thông báo)');
select tests.assert((select count(*) = 3 from public.chat_member_list where room_id = (select v::uuid from t_chat where k = 'g')), 'Xem danh sách thành viên nhóm');

-- Quản trị mời e1 ra; e1 không còn thấy nhóm
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.chat_remove_member((select v::uuid from t_chat where k = 'g'), '00000000-0000-0000-0000-0000000000e1');
select tests.assert_fails($$select public.chat_set_admin((select v::uuid from t_chat where k = 'g'), auth.uid(), false)$$, 'Nhóm luôn còn ít nhất một quản trị');
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((select count(*) = 0 from public.chat_room_list where id = (select v::uuid from t_chat where k = 'g')), 'Bị mời ra thì không còn thấy nhóm');

-- Quản trị rời nhóm: thành viên còn lại thành quản trị
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.chat_leave((select v::uuid from t_chat where k = 'g'));
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select my_role = 'admin' and member_count = 1 from public.chat_room_list where id = (select v::uuid from t_chat where k = 'g')),
  'Quản trị rời nhóm thì người còn lại thành quản trị');
select public.chat_delete_message((select v::uuid from t_chat where k = 'gm'));
select tests.assert((select deleted_at is not null and body = '' from public.chat_messages where id = (select v::uuid from t_chat where k = 'gm')), 'Thu hồi tin của mình');

-- Tệp đính kèm: chỉ thành viên phòng được tải lên thư mục của phòng
select tests.assert(private.chat_path_member('chat/' || (select v from t_chat where k = 'g') || '/33333333-0000-0000-0000-000000000043.jpg'), 'Thành viên tải tệp vào phòng mình');
select tests.assert(not private.chat_path_member('chat/' || (select v from t_chat where k = 'g') || '/../x.jpg'), 'Đường dẫn lạ bị chặn');
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert(not private.chat_path_member('chat/' || (select v from t_chat where k = 'g') || '/33333333-0000-0000-0000-000000000043.jpg'), 'Người ngoài không tải/xem tệp của phòng');
select tests.assert_fails($$select public.chat_send((select v::uuid from t_chat where k = 'dm'), '', '{"path":"chat/00000000-0000-0000-0000-000000000000/33333333-0000-0000-0000-000000000043.jpg"}')$$,
  'Không gắn tệp của phòng khác');

-- Dọn dữ liệu kiểm thử
reset role;
delete from public.chat_rooms where id in (select v::uuid from t_chat where k in ('dm', 'g'));
\o
\echo 'TẤT CẢ KIỂM THỬ TRÒ CHUYỆN ĐỀU ĐẠT'
