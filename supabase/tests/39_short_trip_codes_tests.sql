-- =============================================================================
-- Kiểm thử 0056: mã chuyến / mã đơn rút gọn dạng SNOV-0001 / ONOV-0001.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
select tests.assert(private.next_month_code('T56', 'S', '2026-11-02 10:00+07') = 'SNOV-0001', 'Mã đầu tháng 11 là SNOV-0001');
select tests.assert(private.next_month_code('T56', 'S', '2026-11-03 10:00+07') = 'SNOV-0002', 'Cùng tháng đếm tiếp, không quay lại theo ngày');
select tests.assert(private.next_month_code('T56', 'S', '2026-12-01 10:00+07') = 'SDEC-0001', 'Sang tháng 12 bắt đầu SDEC-0001');
select tests.assert(private.next_month_code('T56', 'S', '2026-11-30 17:30+00') = 'SDEC-0002', 'Tính tháng theo giờ Việt Nam (00:30 ngày 01/12)');
select tests.assert(private.next_month_code('T56', 'S', '2027-11-01 10:00+07') = 'SNOV-0003', 'Tháng 11 năm sau đếm tiếp, không trùng mã năm trước');
select tests.assert(private.next_month_code('T56', 'O', '2026-01-05 10:00+07') = 'OJAN-0001', 'Chữ đầu theo loại chứng từ');
delete from public.code_sequences where scope = 'T56';
select tests.assert(not has_function_privilege('anon', 'private.next_month_code(text, text, timestamptz)', 'execute'), 'Khách chưa đăng nhập không gọi được hàm sinh mã');
\o
\echo '39_short_trip_codes_tests: OK'
