-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Bỏ % hỗ trợ dầu mặc định 39% (tùy từng khách)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if not exists (select 1 from public.fuel_support_rules where scope_type = 'default' and is_active) then
    raise exception 'CSDL đã được nâng cấp Bỏ % hỗ trợ dầu mặc định 39% (tùy từng khách) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261104000060_no_default_fuel_rate.sql
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

commit;
