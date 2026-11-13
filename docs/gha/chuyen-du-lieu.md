# Chuyển dữ liệu app QLVT cũ → GHA-TMS

Gói này gồm 2 migration, 1 script nhập và 1 bộ kiểm thử. Đã chạy thử trên Postgres tạm với **file sao lưu thật ngày 13/11/2026**: số chuyến, số lượng hàng, tổng cước và tổng phí **khớp 100%** với app cũ. Bộ kiểm thử CSDL có sẵn của Khánh Hà vẫn đạt hết sau khi thêm migration 9001.

| File | Việc |
|---|---|
| `9001_gha_xe_tai_ma_hang.sql` | Phân loại xe tải / đầu kéo / rơ moóc, danh mục mã hàng, đơn cha + dòng mã hàng con, ẩn 3-PL với tài khoản khách |
| `9002_legacy_import.sql` | Schema `legacy` giữ nguyên bản gốc + hàm chuyển `legacy.run_import()` + view đối chiếu `legacy.reconcile` |
| `scripts/import-legacy.mjs` | Đọc file JSON, chạy thử (mặc định hủy) hoặc ghi thật (`--commit`), in báo cáo |
| `tests/90_gha_an_3pl_tests.sql` | Kiểm thử: khách không thấy nhà xe, cước 3-PL; điều phối GHA vẫn thấy |

## Kết quả chạy thử với file thật

| Bước | Nguồn | Sang GHA-TMS |
|---|---:|---:|
| Công ty xuất hàng → Khách hàng | 5 | 4 (VAP trùng 2 bản ghi, đã gộp) |
| Kho / điểm nhận → Địa điểm | 28 | 28 |
| Khách hàng (điểm giao) → Địa điểm | 1,333 | 1,333 |
| Mã hàng → Danh mục mã hàng | 237 | 237 |
| Đơn vị vận tải + 3-PL → Nhà cung cấp | 21 | 21 |
| Tài xế | 49 | 49 |
| Phương tiện | | 41 (3 xe nội bộ + 38 xe đã chạy) |
| Dòng đơn hàng → Đơn cha | 122 dòng | 120 đơn (2 shipment có 2 mã hàng) |
| Dòng đơn hàng → Mã hàng của đơn | 122 | 122 |
| Xe / chuyến → Chuyến | 122 | 122 |
| Cước GHA | 118 | 118 |

| Đối chiếu | App cũ | GHA-TMS |
|---|---:|---:|
| Số chuyến | 122 | 122 |
| Tổng SL hàng trên xe (kg) | 2,534,978 | 2,534,978 |
| Tổng SL đơn hàng (kg) | 2,536,479 | 2,536,479 |
| Tổng cước GHA (đơn giá + dầu + phụ thu) | 435,683,600 | 435,683,600 |
| Tổng phí khác (bốc xếp, hạ, nâng…) | 75,873,700 | 75,873,700 |

## Ánh xạ

| App cũ (Firestore) | GHA-TMS (Supabase) | Ghi chú |
|---|---|---|
| `companies` (VAP, PLA, DAM…) | `customers` | Người thuê vận chuyển, trả cước. "Bên ngoài" → `custom_fields.is_external` |
| `warehouses` | `locations` (điểm nhận) | Mã tự sinh DDxxx; thông tin xuất hóa đơn → `billing_address` |
| `customers` (điểm giao) | `locations` (điểm giao) | Giữ mã cũ, MST, SĐT người nhận; thông tin xuất hóa đơn → `billing_address` |
| `products` | `products` (mới) | ĐVT KG, quy đổi 1 kg |
| `carriers`, `subCarriers` | `suppliers` | `custom_fields.supplier_kind` = carrier / 3pl / internal_fleet / self_pickup |
| `internalTrucks` + biển số trên chuyến | `vehicles` | Gộp biển số viết khác nhau (50H-043.24 = 50H04324). Xe nội bộ = sở hữu, còn lại = thuê ngoài gắn nhà xe |
| `driverProfiles` + tài xế trên chuyến | `drivers` + `driver_sensitive` | Gộp theo CCCD, không có CCCD thì theo tên |
| `orders` (mỗi mã hàng 1 dòng) | `transport_orders` + `transport_order_items` | Gộp theo số shipment: mã đơn = SHP-…, số ORD-… → `ref_no`, PXK → `voucher_no` |
| `shipmentDetails` | `shipments` + `shipment_items` | 1 xe = 1 chuyến, giữ số SHD-…; container → `container_no` |
| `costsGha` | giá chuyến + `shipment_fees` | Đơn giá, % dầu → hỗ trợ dầu; phụ thu vé/hạ trái tuyến → phí doanh thu; bốc xếp, phí hạ → chi hộ (giữ số HĐ chi hộ) |
| Trạng thái "Hoàn thành" | `driver_completed` | Chờ kế toán đóng chuyến; "Chờ đến điểm nhận" → `assigned` |
| `users`, `config`, ảnh base64 | giữ trong `legacy.raw_docs` | Tài khoản cấp lại (mật khẩu cũ không dùng được); ảnh chuyển sang Storage ở bước sau |

## Xe tải / đầu kéo / rơ moóc

- `vehicle_types.vehicle_kind` và `vehicles.vehicle_kind`: `truck` xe tải, `tractor` đầu kéo, `trailer` rơ moóc. Loại xe quyết định loại phương tiện.
- Xe tải có thêm tải trọng, kiểu thùng (kín, mui bạt, lửng, ben, đông lạnh, bồn), kích thước và thể tích thùng.
- Đầu kéo có rơ moóc mặc định; chuyến chạy đầu kéo tự lấy rơ moóc đó (`shipments.trailer_id`), sửa được.
- Chặn sai: rơ moóc không có tài xế, không chạy chuyến; xe tải không gắn rơ moóc.
- Loại xe mẫu: xe tải 1.5 / 2.5 / 5 / 8 / 10 / 15 tấn, đầu kéo, sơ mi rơ moóc 20' / 40', rơ moóc sàn.
- Dữ liệu cũ không ghi loại xe: chuyến có số container thì xe được xếp là **đầu kéo** (11 xe), còn lại là **xe tải** (30 xe). Ghi chú "cần kiểm lại" trên từng xe.

## Danh mục mã hàng

- Bảng `products`: mã, tên, ĐVT, nhóm hàng, quy cách đóng gói, chủ hàng (VAP/PLA…), kg/đơn vị, m³/đơn vị, hàng nguy hiểm, trường thêm tùy ý.
- Chọn mã hàng trên đơn hoặc trên xe thì tự điền mã, tên, ĐVT và quy ra kg (để tính tấn cho cước, bốc xếp).
- `order_item_balance` cho biết từng mã hàng của đơn đã xếp xe bao nhiêu, còn bao nhiêu; `order_totals` tính tổng SL đơn cha.

## Ẩn 3-PL với tài khoản khách hàng

- Quyền mới `carriers.view` (Xem nhà xe 3-PL và cước 3-PL), chỉ vai trò nội bộ GHA có.
- Vai trò mới `customer_admin` (Quản trị bên khách hàng): xem đơn, chuyến, danh sách xe qua `vehicles_for_customer` (không có chủ xe, không có "thuê ngoài").
- Không có quyền đó thì không đọc được nhà xe, cước 3-PL, công nợ trả 3-PL (chặn ở CSDL, không chỉ ẩn trên giao diện).
- **Còn phải làm:** giới hạn tài khoản khách chỉ thấy đơn/chuyến của công ty mình, và giao diện cổng khách hàng.

## Cần người dùng xử lý

1. **Xuất lại file sao lưu bằng tài khoản quản trị chính.** File hiện tại thiếu 8 phần do thiếu quyền: cước 3-PL (`costs3pl`), tài chính từng xe, đề nghị thanh toán, chi phí chung, bảng giá, báo giá, công tác phí, thông tin công ty. Chạy lại script với file mới chỉ thêm phần còn thiếu, không nhân đôi dữ liệu.
2. Kiểm lại công ty **VAP**: có 2 bản ghi, một bản đánh dấu "bên ngoài", một bản không. Hiện đã gộp và đặt là bên ngoài.
3. Mã khách hàng **SOTRANS** trùng 2 bản ghi, bản thứ hai đổi thành `SOTRANS-2`.
4. Kiểm lại loại xe (đầu kéo / xe tải) của 41 xe.

## Cách chạy trên Supabase thật

1. **Dựng CSDL:** Supabase → SQL Editor → dán toàn bộ `supabase/deploy/cai-dat-lan-dau.sql` → Run (chỉ một lần, trên dự án mới). Tệp đã gồm 2 migration GHA.
2. **Thử trước trên máy (không đụng CSDL thật):** `bash scripts/test-gha-import.sh qlvt_backup.json` cần Postgres cục bộ.
3. **Nhập thật:** `npm ci`, rồi
   ```
   DATABASE_URL="postgresql://postgres:<mật khẩu>@db.<project>.supabase.co:5432/postgres" node scripts/import-legacy.mjs qlvt_backup.json
   ```
   Lệnh trên chạy thử rồi hủy. Xem báo cáo, đúng thì thêm `--commit`.

**Khi không kết nối thẳng được cổng 5432** (VD môi trường cloud chỉ đi HTTPS): dùng API quản lý của Supabase.
```
SUPABASE_ACCESS_TOKEN=sbp_... node scripts/supabase-api-import.mjs --ref <mã dự án> --install          # dựng CSDL (dự án trống)
SUPABASE_ACCESS_TOKEN=sbp_... node scripts/supabase-api-import.mjs --ref <mã dự án> --file qlvt_backup.json   # chạy thử
... --commit                                                                                           # ghi thật
```
Sau proxy HTTPS thêm `NODE_USE_ENV_PROXY=1`.

File sao lưu chứa dữ liệu thật (tên, SĐT, CCCD, ảnh): **không đưa vào repo** (repo đang công khai).
