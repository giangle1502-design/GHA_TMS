-- =============================================================================
-- GHA TMS - 9023: Bảng giá xe tải — giá trong bảng là ĐƠN GIÁ CHƯA hỗ trợ dầu
--   LE xác nhận 18/11/2026: tiêu đề file BANG_GIA_NOI_BO.xlsx ("đã điều chỉnh hỗ trợ xăng dầu 20%") ghi nhầm;
--   các số trong bảng là đơn giá chưa hỗ trợ dầu. Cước = Đơn giá × (1 + % hỗ trợ dầu / 100).
--   - Đổi cột fuel_pct_included (% dầu đã gồm, dùng để chia ngược) thành default_fuel_pct (% dầu mặc định khi không nhập giá dầu).
--   - Bảng giá đã nạp từ file: giữ nguyên số (đã đúng là đơn giá chưa dầu), đặt % dầu mặc định = 0, sửa tên và ghi chú.
--   Chạy lại nhiều lần được.
-- =============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'truck_rate_cards' and column_name = 'fuel_pct_included') then
    alter table public.truck_rate_cards rename column fuel_pct_included to default_fuel_pct;
    -- Giá trị cũ là "% dầu đã gồm trong giá" (hiểu sai): bỏ, để 0
    update public.truck_rate_cards set default_fuel_pct = 0;
  end if;
end $$;

comment on column public.truck_rate_cards.default_fuel_pct is '% hỗ trợ dầu mặc định khi tính cước mà không nhập giá dầu (giá trong bảng là đơn giá chưa dầu)';
comment on column public.truck_rate_cards.prices is 'prices[i][j] = đơn giá CHƯA hỗ trợ dầu của khoảng km i, trọng tải j (null = chưa có giá)';
comment on table public.truck_rate_cards is 'Bảng giá xe tải (nội bộ): đơn giá chưa hỗ trợ dầu theo khoảng km × trọng tải, phí bốc xếp theo trọng tải, hệ số hỗ trợ dầu theo giá dầu';

update public.truck_rate_cards
set name = 'Bảng giá vận chuyển xe tải nội bộ (đơn giá chưa hỗ trợ dầu)',
    notes = 'Nhập từ file BANG_GIA_NOI_BO.xlsx (sheet BẢNG GIÁ XE TẢI (2)). Giá trong bảng là đơn giá CHƯA hỗ trợ dầu; Cước = Đơn giá × (1 + % hỗ trợ dầu theo giá dầu).'
where source_file = 'BANG_GIA_NOI_BO.xlsx' and name = 'Bảng giá vận chuyển xe tải nội bộ (đã gồm hỗ trợ dầu 20%)';
