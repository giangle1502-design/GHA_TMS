-- =============================================================================
-- 0060: Bỏ % hỗ trợ dầu mặc định toàn công ty (39%)
-- % dầu tùy khách thỏa thuận: không tự điền 39% cho mọi khách nữa.
-- Thứ tự lấy % dầu khi tạo đơn giữ nguyên: nhập tay → bảng giá → quy tắc theo
-- khách + tuyến / tuyến / khách / loại xe. Không có thì để trống (tiền dầu = 0).
-- Chuyến đã tạo giữ nguyên số tiền dầu cũ. Chỉ tắt (không xóa) quy tắc mặc định.
-- =============================================================================
update public.fuel_support_rules
set is_active = false,
    notes = concat_ws(' ', notes, '[Tắt 2026-11-04: % dầu tùy từng khách, không dùng mặc định toàn công ty.]')
where scope_type = 'default' and is_active;
