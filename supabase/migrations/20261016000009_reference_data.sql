-- =============================================================================
-- GHA TMS - 0009: Dữ liệu tham chiếu mặc định (cần có ở mọi môi trường)
-- Đây là cấu hình mặc định theo đặc tả, KHÔNG phải dữ liệu mẫu nghiệp vụ.
-- Quản trị viên có thể sửa/ẩn sau khi triển khai.
-- =============================================================================

insert into public.payment_methods (code, name, requires_bank_account, sort_order) values
  ('cash', 'Tiền mặt', false, 1),
  ('bank_transfer', 'Chuyển khoản', true, 2),
  ('offset', 'Cấn trừ', false, 3),
  ('other', 'Khác', false, 4);

insert into public.banks (code, short_name, name) values
  ('VCB', 'Vietcombank', 'Ngân hàng TMCP Ngoại thương Việt Nam'),
  ('CTG', 'VietinBank', 'Ngân hàng TMCP Công Thương Việt Nam'),
  ('BIDV', 'BIDV', 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam'),
  ('AGRIBANK', 'Agribank', 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam'),
  ('TCB', 'Techcombank', 'Ngân hàng TMCP Kỹ Thương Việt Nam'),
  ('MB', 'MB', 'Ngân hàng TMCP Quân đội'),
  ('ACB', 'ACB', 'Ngân hàng TMCP Á Châu'),
  ('VPB', 'VPBank', 'Ngân hàng TMCP Việt Nam Thịnh Vượng'),
  ('STB', 'Sacombank', 'Ngân hàng TMCP Sài Gòn Thương Tín'),
  ('TPB', 'TPBank', 'Ngân hàng TMCP Tiên Phong');

insert into public.catalogs (code, name, description, is_system) values
  ('province', 'Tỉnh/thành phố', 'Danh sách tỉnh/thành dùng cho địa điểm. Quản trị viên tự nhập theo danh mục hành chính hiện hành.', true),
  ('vehicle_brand', 'Hãng xe', null, true),
  ('contract_type', 'Loại hợp đồng lao động', null, true),
  ('reject_reason', 'Lý do từ chối chuyến', 'Danh sách lý do tài xế chọn khi từ chối chuyến', true),
  ('expense_group', 'Nhóm chi phí', null, true);

insert into public.catalog_items (catalog_id, code, name, sort_order)
select c.id, v.code, v.name, v.ord
from public.catalogs c
join (values
  ('contract_type', 'indefinite', 'Không xác định thời hạn', 1),
  ('contract_type', 'definite', 'Xác định thời hạn', 2),
  ('contract_type', 'probation', 'Thử việc', 3),
  ('contract_type', 'service', 'Hợp đồng dịch vụ / khoán', 4),
  ('reject_reason', 'busy', 'Đang chạy chuyến khác', 1),
  ('reject_reason', 'vehicle_issue', 'Xe gặp sự cố', 2),
  ('reject_reason', 'health', 'Lý do sức khỏe', 3),
  ('reject_reason', 'personal', 'Việc cá nhân', 4),
  ('reject_reason', 'other', 'Lý do khác', 99),
  ('expense_group', 'fuel', 'Nhiên liệu', 1),
  ('expense_group', 'road', 'Cầu đường, bến bãi', 2),
  ('expense_group', 'loading', 'Bốc xếp, nâng hạ', 3),
  ('expense_group', 'vehicle', 'Sửa chữa, bảo dưỡng xe', 4),
  ('expense_group', 'driver', 'Chi phí tài xế', 5),
  ('expense_group', 'other', 'Khác', 99)
) as v(catalog_code, code, name, ord) on v.catalog_code = c.code;

insert into public.expense_categories
  (code, name, group_name, report_bucket, requires_invoice, requires_image, requires_approval, sort_order) values
  ('DIESEL', 'Dầu diesel', 'Nhiên liệu', 'fuel', true, true, true, 1),
  ('GASOLINE', 'Xăng', 'Nhiên liệu', 'fuel', true, true, true, 2),
  ('TOLL', 'Cầu đường', 'Cầu đường, bến bãi', 'toll', false, true, true, 3),
  ('YARD', 'Phí bến bãi', 'Cầu đường, bến bãi', 'loading_yard', false, true, true, 4),
  ('GATE', 'Phí vào cổng', 'Cầu đường, bến bãi', 'loading_yard', false, true, true, 5),
  ('LOADING', 'Bốc xếp', 'Bốc xếp, nâng hạ', 'loading_yard', false, true, true, 6),
  ('LIFTING', 'Nâng hạ', 'Bốc xếp, nâng hạ', 'loading_yard', false, true, true, 7),
  ('TIRE_PATCH', 'Vá lốp', 'Sửa chữa, bảo dưỡng xe', 'repair', false, true, true, 8),
  ('TIRE_REPLACE', 'Thay lốp', 'Sửa chữa, bảo dưỡng xe', 'repair', true, true, true, 9),
  ('REPAIR', 'Sửa chữa', 'Sửa chữa, bảo dưỡng xe', 'repair', true, true, true, 10),
  ('MAINTENANCE', 'Bảo dưỡng', 'Sửa chữa, bảo dưỡng xe', 'repair', true, true, true, 11),
  ('WASH', 'Rửa xe', 'Sửa chữa, bảo dưỡng xe', 'repair', false, false, true, 12),
  ('MEAL', 'Ăn uống', 'Chi phí tài xế', 'driver', false, false, true, 13),
  ('OVERNIGHT', 'Lưu đêm', 'Chi phí tài xế', 'driver', false, false, true, 14),
  ('OTHER', 'Chi phí phát sinh khác', 'Khác', 'other', false, true, true, 99);

insert into public.approval_types (code, name, requires_document, sla_hours, sort_order) values
  ('advance', 'Ứng tiền', false, 24, 1),
  ('expense', 'Duyệt chi phí', true, 48, 2),
  ('invoice_payment', 'Thanh toán hóa đơn', true, 72, 3),
  ('supplier_payment', 'Thanh toán nhà cung cấp', true, 72, 4),
  ('revenue_adjustment', 'Điều chỉnh doanh thu', false, 48, 5),
  ('expense_adjustment', 'Điều chỉnh chi phí', false, 48, 6),
  ('trip_settlement', 'Duyệt quyết toán chuyến', false, 72, 7),
  ('vehicle_repair', 'Duyệt sửa chữa xe', true, 48, 8),
  ('purchase', 'Duyệt mua sắm', true, 72, 9),
  ('other', 'Yêu cầu khác', false, 72, 99);

-- Cấp duyệt mặc định: cấp 1 Kế toán; cấp 2 Giám đốc khi số tiền từ 5.000.000đ (cần xác nhận với Khánh Hà)
insert into public.approval_rules (approval_type_id, level, approver_role_id, min_amount, max_amount)
select t.id, 1, (select id from public.roles where code = 'accountant'), 0, null from public.approval_types t;
insert into public.approval_rules (approval_type_id, level, approver_role_id, min_amount, max_amount)
select t.id, 2, (select id from public.roles where code = 'director'), 5000000, null from public.approval_types t;

-- Hỗ trợ dầu mặc định 39% trên doanh thu cước vận chuyển (cơ sở tính cần xác nhận)
insert into public.fuel_support_rules (scope_type, rate_percent, calculation_base, effective_from, notes)
values ('default', 39, 'freight_revenue', date '2026-01-01',
        'Mặc định theo yêu cầu ban đầu. Cơ sở tính (doanh thu cước / đơn giá / khác) cần Khánh Hà xác nhận.');

insert into public.system_settings (key, value, description, is_public) values
  ('company.name', '"Công ty Vận tải Khánh Hà"', 'Tên doanh nghiệp hiển thị', true),
  ('app.timezone', '"Asia/Ho_Chi_Minh"', 'Múi giờ hệ thống', true),
  ('app.currency', '"VND"', 'Tiền tệ', true),
  ('documents.max_file_mb', '10', 'Dung lượng tối đa mỗi tệp (MB)', true),
  ('approval.allow_self_approval', 'false', 'Cho phép người tạo tự duyệt (mặc định không)', false),
  ('shipment.require_delivery_photo', 'true', 'Bắt buộc ảnh giao hàng khi hoàn thành chuyến', false),
  ('alerts.vehicle_document_days_before', '30', 'Số ngày cảnh báo trước khi giấy tờ xe hết hạn', false);
