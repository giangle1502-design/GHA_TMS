# Trạng thái chức năng

Cập nhật: 21/10/2026 · Ký hiệu: ✅ hoạt động (đã kiểm thử) · 🟡 có CSDL/RLS, chưa có giao diện · ⏳ chưa triển khai (trong ứng dụng hiển thị nhãn "GĐx" và trang "Đang phát triển").

## Đã hoạt động (Giai đoạn 1–2)

| Chức năng | Trạng thái | Kiểm thử |
|---|---|---|
| Đăng nhập Google, đăng xuất, làm mới phiên | ✅ | E2E (phiên Supabase Auth thật cục bộ); Google OAuth cần chạy thử trên dự án thật |
| Chỉ email được mời mới vào; người lạ ở "chờ cấp quyền" và báo Admin | ✅ | E2E + CSDL |
| Mời người dùng (vai trò, gắn hồ sơ tài xế), thu hồi lời mời | ✅ | E2E + CSDL |
| Khóa/mở tài khoản, gán vai trò, ma trận quyền theo vai trò, cấp/chặn quyền riêng | ✅ | E2E + CSDL (chặn tự cấp quyền, bảo vệ Super Admin) |
| Menu và trang theo quyền; chặn truy cập bằng URL | ✅ | E2E |
| Tổng quan: thẻ số liệu so với kỳ trước (hôm qua, cùng kỳ tháng trước), biểu đồ số chuyến 14 ngày, trạng thái chuyến trong tháng, sản lượng 6 tháng, chuyến gần đây, khách hàng nhiều chuyến nhất, việc cần xử lý, giấy tờ xe sắp hết hạn | ✅ | E2E + 6 kiểm thử CSDL (số liệu tính trực tiếp từ bảng chuyến qua RLS; tài xế chỉ được tính chuyến của mình) |
| Tổng quan có bộ lọc (2026-11-01): kỳ Hôm nay / 7 ngày / Tuần này / Tháng này / 30 ngày / Năm nay hoặc tự chọn từ ngày – đến ngày; lọc khách hàng, tài xế, xe, tuyến (ô chọn có tìm kiếm); mọi thẻ, biểu đồ, chuyến gần đây, xếp hạng, tài chính tính lại theo bộ lọc, giữ trên địa chỉ trang; không cần nâng cấp CSDL | ✅ | 11 kiểm thử đơn vị + chạy thử với CSDL cục bộ |
| Thông báo trong ứng dụng, đánh dấu đã đọc | ✅ | E2E |
| Nhật ký hệ thống (chỉ đọc, không sửa/xóa, che dữ liệu nhạy cảm) | ✅ | E2E + CSDL |
| Cấu hình tham số hệ thống | ✅ | E2E |
| Hồ sơ cá nhân | ✅ | Kiểm thử đơn vị/thủ công |
| Ứng dụng tài xế (GĐ5a): mở link /tx không cần tài khoản, nhập biển số xe (tự viết hoa, bỏ ký tự đặc biệt), xem chuyến dạng thẻ (giờ nhận/giao, điểm nhận/giao, chỉ đường, gọi điện, ghi chú), bấm Nhận đơn; máy nhớ xe 30 ngày; điều phối nhận thông báo. Người dùng chọn chỉ cần biển số (ai biết biển số cũng xem/nhận được chuyến của xe đó) | ✅ | 19 kiểm thử CSDL + E2E |
| Toàn bộ CSDL 54 bảng, RLS mọi bảng, trigger chống sửa sau duyệt, mã tự sinh, nhật ký tự động | ✅ | 68 kiểm thử CSDL; sinh mã đồng thời 300/300 không trùng |

## Đã hoạt động (Giai đoạn 3)

| Chức năng | Trạng thái | Kiểm thử |
|---|---|---|
| Phương tiện: danh sách, chi tiết, tài chính xe và lịch trả góp (chỉ người có quyền xem dữ liệu nhạy cảm), lịch sử bảo dưỡng | ✅ | E2E + CSDL (điều phối không đọc/ghi được tài chính xe) |
| Tài xế: danh sách, chi tiết, xe được giao, tài khoản đăng nhập, CCCD và tài khoản ngân hàng tách riêng (dữ liệu nhạy cảm) | ✅ | E2E |
| Khách hàng, nhà cung cấp, địa điểm, tuyến đường | ✅ | E2E (tạo nhanh địa điểm bằng nút "+" ngay trong form tuyến) |
| Bảng giá vận chuyển (chặn trùng hiệu lực cùng ưu tiên), quy tắc hỗ trợ dầu, tra cứu giá theo độ cụ thể | ✅ | E2E (kế toán bị chặn khi trùng, đổi ưu tiên thì lưu được) |
| 9 danh mục: loại xe, hạng mục chi phí, ngân hàng, tài khoản công ty, hình thức thanh toán, đơn vị, quy tắc lương, danh mục chung | ✅ | Kiểm thử đơn vị + E2E |
| Mã tự sinh cho danh mục (XE001, TX001, KH001…), mã nhập tay tự chuẩn hóa chữ hoa | ✅ | CSDL |
| Bảng dữ liệu: tìm kiếm, lọc, sắp xếp, phân trang, ẩn/hiện/sắp cột, kéo rộng cột, ghim cột, mật độ dòng; lưu cấu hình theo từng người | ✅ | E2E + CSDL (không đọc/ghi được cấu hình người khác) |
| Nút "+" tạo nhanh bản ghi liên kết mà không rời form | ✅ | E2E |
| Xuất Excel (tối đa 5.000 dòng, theo bộ lọc và cột đang hiện); nhập Excel/CSV có file mẫu, xem trước, báo lỗi từng dòng, ghi một lần toàn bộ hoặc không ghi gì | ✅ | E2E + kiểm thử đơn vị |
| Kiểm tra trùng và khóa lạc quan khi hai người cùng sửa | ✅ | E2E |
| Không xóa được bản ghi đang được dùng (gợi ý ngừng sử dụng thay vì xóa) | ✅ | E2E |
| Giao diện theo mẫu người dùng chọn (21/10/2026): menu xanh đậm, thẻ số liệu có biểu tượng màu, nhãn trạng thái màu, tab lọc trạng thái có số lượng, ô tìm nhanh chức năng (gõ có hoặc không dấu) | ✅ | E2E |
| Điều phối (GĐ4): tạo đơn hàng nhiều chuyến trong một giao dịch, tự tìm bảng giá (bắt chọn khi ngang nhau, nhập tay khi không có), hỗ trợ dầu theo thứ tự ưu tiên và chụp lại tham số trên chuyến, phân công/đổi/gỡ tài xế và xe (gợi ý tài xế phụ trách xe), thông báo cho tài xế, hủy chuyến bắt buộc lý do, xem theo ngày với tab trạng thái và chuyến trễ, chi tiết đơn hàng, thêm chuyến vào đơn đang mở | ✅ | 46 kiểm thử CSDL + 42 kiểm thử giao diện E2E |
| Quản lý chuyến xe (GĐ4): bảng kiểu Excel cố định cột mã chuyến, lọc theo ngày/khách hàng/trạng thái/từ khóa, tổng tiền theo bộ lọc, sửa nhanh số lượng/đơn giá/phụ phí/% hỗ trợ dầu/ghi chú (chống hai người sửa cùng lúc), xuất Excel; chi tiết chuyến với nguồn giá, lịch sử trạng thái, lịch sử phân công, lịch sử thay đổi giá | ✅ | CSDL + E2E |
| Trường dữ liệu động: 19 kiểu, bắt buộc, giá trị mặc định, hiện theo điều kiện, quyền xem/sửa riêng, công thức an toàn (không dùng eval), phiên bản + khôi phục, phân tích ảnh hưởng trước khi sửa, không xóa/đổi kiểu khi đã có dữ liệu | ✅ | 29 kiểm thử CSDL + kiểm thử đơn vị + E2E |

## Đã hoạt động (Giai đoạn 5 hoàn thiện và Giai đoạn 6, 22/10/2026)

| Chức năng | Trạng thái | Kiểm thử |
|---|---|---|
| Tài xế bấm Bắt đầu chạy, Hoàn thành chuyến; bắt buộc ít nhất 1 ảnh (ảnh hàng hoặc phiếu ký nhận); giao thiếu/không giao phải ghi lý do; điều phối nhận thông báo | ✅ | CSDL + E2E |
| Gửi ảnh từ điện thoại không cần tài khoản: ảnh thu nhỏ trên máy, tải thẳng lên Storage riêng tư bằng "vé" 2 giờ do CSDL cấp (tối đa 10 tệp/vé), không dùng khóa bí mật | ✅ | CSDL (vé bịa, tên tệp lạ, vé đã dùng bị chặn) + E2E với Storage thật cục bộ |
| Xem ảnh, chứng từ qua đường dẫn tạm 10 phút; nhân viên tải thêm chứng từ trên chi tiết chuyến | ✅ | E2E |
| Tài xế xin ứng tiền, nhập chi phí kèm ảnh hóa đơn, xem trạng thái, hủy yêu cầu đang chờ; gửi trùng do mạng chập chờn chỉ ghi 1 lần | ✅ | CSDL + E2E |
| Quy trình khách chốt: tài xế gửi → Giám đốc duyệt (được duyệt ít hơn số xin) → Kế toán ghi nhận chuyển tiền (phiếu chi, sổ tạm ứng). Không tự duyệt khoản của mình, không duyệt/chuyển tiền hai lần, từ chối bắt buộc lý do | ✅ | 40+ kiểm thử CSDL + E2E |
| Tắt duyệt cho từng loại chi phí (Danh mục → Hạng mục chi phí → Cần phê duyệt) | ✅ | CSDL |
| Cấu hình cấp duyệt (Phê duyệt → Cấu hình cấp duyệt): vai trò duyệt, cấp, khoảng số tiền | ✅ | E2E |
| Màn hình Ứng tiền và chi phí, Phê duyệt: đủ quy chuẩn (tìm kiếm, tìm kiếm nâng cao, chọn/kéo/giãn cột, xuất Excel, thêm trường cho biểu mẫu) | ✅ | E2E |
| Chi tiết chuyến: kết quả giao hàng, ảnh, chi phí chuyến, chi phí đã duyệt và lợi nhuận gộp | ✅ | E2E |
| Chưa làm: hủy duyệt sau khi đã duyệt, hủy phiếu chi, yêu cầu bổ sung thông tin | ⏳ | Làm khi có nhu cầu |

## Đã hoạt động (Giai đoạn 7, 22/10/2026)

| Chức năng | Trạng thái | Kiểm thử |
|---|---|---|
| Đối soát lương tài xế cuối tháng (Ứng tiền và chi phí → Đối soát lương): thực nhận = lương cơ bản + số chuyến hoàn thành × lương chuyến + phụ cấp + thưởng − khấu trừ + chi phí tài xế tự trả đã duyệt − tiền đã ứng. Xem trước bảng tính trước khi lập; lập cho một tài xế hoặc tất cả tài xế | ✅ | CSDL + E2E |
| Quy trình bảng lương: Kế toán lập → Giám đốc duyệt → Kế toán ghi nhận trả lương (phiếu chi + cấn trừ sổ tạm ứng). Không lập hai bảng cùng tháng, không trả hai lần, không sửa số tiền trực tiếp; từ chối/hủy thì chi phí được trả lại để lập lại | ✅ | CSDL + E2E |
| Tạm ứng lớn hơn số được nhận: chỉ trừ đến hết lương, phần còn lại tự chuyển sang tháng sau | ✅ | CSDL |
| Tài xế xem bảng lương 12 tháng và tiền ứng đang giữ trên điện thoại | ✅ | CSDL + E2E |
| Công nợ phải thu: lập từ các chuyến đã hoàn thành của cùng khách hàng thanh toán (cước + phụ thu + hỗ trợ dầu), hoặc khoản thu khác; hạn thanh toán tự tính theo số ngày công nợ của khách; chuyến đã lập công nợ bị khóa giá | ✅ | CSDL + E2E |
| Thu/trả nhiều lần, lịch sử từng lần, hủy phiếu ghi nhầm có lý do (không xóa, công nợ tự cộng lại); hủy công nợ chưa thu có lý do | ✅ | CSDL + E2E |
| Công nợ phải trả nhà cung cấp hoặc tài xế/xe ngoài; tuổi nợ (chưa đến hạn, quá hạn 1-30, 31-60, 61-90, trên 90 ngày) | ✅ | CSDL + E2E |
| Danh sách phiếu thu chi (mọi dòng tiền: thu công nợ, trả công nợ, chuyển tiền ứng, trả lương) | ✅ | E2E |
| Báo cáo: lợi nhuận từng chuyến, tổng hợp theo tháng (doanh thu, chi phí, lợi nhuận, lương, tiền thu/chi thực tế), theo xe, tài xế, khách hàng, chi phí theo loại, số dư tạm ứng; thẻ số liệu và biểu đồ 6 tháng; mọi bảng tìm kiếm nâng cao, chọn cột, xuất Excel | ✅ | CSDL + E2E |
| Tổng quan: chỉ tiêu tài chính tháng này tính từ dữ liệu thật (người có quyền xem báo cáo) | ✅ | E2E |
| Lương tính theo quy tắc lương (theo km, % doanh thu, công thức) | ⏳ | Hiện tính theo mức trong hồ sơ tài xế; phụ cấp tính theo tháng |
| Hủy phiếu chuyển tiền ứng, hủy phiếu trả lương | ⏳ | Chưa hỗ trợ (chỉ hủy được phiếu thu/chi công nợ) |
| Báo cáo theo tuyến, nhiên liệu, giao trễ, chứng từ thiếu, lịch sử phê duyệt | ⏳ | Làm khi có nhu cầu |

## Giai đoạn 7b: chi phí tài xế nhập khi hoàn thành chuyến (khách hàng chốt 22/10/2026)

| Chức năng | Trạng thái | Kiểm thử |
|---|---|---|
| Bước "Hoàn thành chuyến" bắt buộc chọn: "Có chi phí" (nhập nhiều khoản: loại, số tiền, ghi chú, ảnh hóa đơn) hoặc "Không phát sinh chi phí" | ✅ | CSDL + E2E |
| Xác nhận không phát sinh chi phí lưu trên chuyến và lịch sử; văn phòng thấy trên chi tiết chuyến | ✅ | CSDL |
| Thẻ chuyến đã xong hiện số khoản, tổng chi phí; nút "Bổ sung chi phí" cho tới khi văn phòng đóng chuyến | ✅ | CSDL + E2E |
| Bỏ nút "Nhập chi phí" riêng trên trang tiền; chi phí chỉ nhập cho chuyến đã hoàn thành | ✅ | CSDL + E2E |
| Tài xế sửa/hủy khoản chưa duyệt (hoặc loại không cần duyệt, chưa vào bảng lương, chuyến chưa đóng). Sửa = khoản cũ chuyển Đã hủy, tạo khoản mới ghi "sửa từ ..."; không chụp lại thì giữ ảnh cũ | ✅ | CSDL + E2E |
| Khoản đã duyệt hoặc chuyến đã đóng: tài xế không sửa được, kế toán xử lý | ✅ | CSDL |
| Cấu hình loại chi phí tài xế được nhập: Danh mục hệ thống → Hạng mục chi phí (Vai trò được nhập có "Tài xế", Bắt buộc ảnh chứng từ, Cần phê duyệt, Đang dùng) | ✅ | Có sẵn từ GĐ3 |

## Giai đoạn 7c: tài xế đăng nhập Google để ứng tiền (khách hàng chốt 22/10/2026)

| Chức năng | Trạng thái | Kiểm thử |
|---|---|---|
| Trang "Ứng tiền & chi phí" bắt buộc đăng nhập Google; nhận ra tài xế theo người, không theo xe (chạy xe nào do điều phối sắp xếp) | ✅ | CSDL + E2E |
| Tự gắn tài khoản: email Google trùng "Email Gmail" trong hồ sơ tài xế (đúng 1 hồ sơ) → tự kích hoạt, chỉ cấp vai trò Tài xế; ghi email sau khi tài xế đã đăng nhập cũng gắn được; tài khoản bị khóa không tự mở lại | ✅ | CSDL |
| Ứng tiền lúc nào cũng được, không cần chuyến; gắn chuyến là không bắt buộc (chỉ chuyến phân cho chính tài xế) | ✅ | CSDL + E2E |
| Sửa/hủy chi phí, xem bảng lương theo tài khoản đăng nhập; link biển số không còn xem được lương, tiền ứng | ✅ | CSDL + E2E |
| Link biển số chỉ dùng cho chuyến: nhận, chạy, hoàn thành, nhập/bổ sung chi phí của chuyến | ✅ | E2E |
| Ảnh biên lai không bắt buộc mặc định (bốc xếp, vá lốp dọc đường không có biên lai); quản lý bật "Bắt buộc ảnh chứng từ" cho từng mục nếu cần | ✅ | CSDL + E2E |
| Quản lý chọn mục chi phí tài xế được thấy: Hạng mục chi phí → "Vai trò được nhập" có "Tài xế" (cột hiện trên danh sách); mục mới mặc định không cho tài xế | ✅ | CSDL |
| Xe thuê ngoài 3PL (Hình thức sở hữu = "Thuê ngoài 3PL"): chuyến không ứng tiền, không nhập chi phí tài xế, hoàn thành không cần khai chi phí | ✅ | CSDL |
| Google OAuth đang ở chế độ Testing: tài xế phải được thêm vào Test users, hoặc chuyển ứng dụng sang Production | ⏳ | Việc cấu hình của chủ tài khoản Google Cloud |

## Cải tiến màn hình Điều phối (khách hàng yêu cầu 29/10/2026)

| Chức năng | Trạng thái | Ghi chú |
|---|---|---|
| Lọc theo khoảng ngày nhận hàng (từ ngày – đến ngày, tối đa 92 ngày, nút nhanh Hôm qua/Hôm nay/Ngày mai/7 ngày tới/Tháng này), công ty/khách hàng, số xe, tài xế, từ khóa, tìm kiếm nâng cao theo mọi cột của chuyến | ✅ | Liên kết cũ `?ngay=` vẫn chạy |
| Báo cáo "Xe chưa có đơn": xe công ty đang hoạt động (không tính 3PL) còn trống trong ngày/khoảng ngày, số ngày trống và danh sách ngày trống | ✅ | Chuyến chạy nhiều ngày tính bận đến ngày giao dự kiến; bảng có tìm kiếm, tìm nâng cao, chọn/kéo/giãn cột, lưu cấu hình |
| Cảnh báo khi giao xe đã có chuyến cùng ngày (khi phân công và khi tạo đơn); tích "Vẫn giao cho xe này" và bắt buộc nhập thứ tự chuyến của xe trong ngày (1, 2…) | ✅ | Migration 0023 (`shipments.vehicle_day_order`), app tài xế xếp chuyến trong ngày theo thứ tự này |
| Bảng chuyến Điều phối (02/11/2026): kéo tiêu đề đổi thứ tự cột, bấm tiêu đề để sắp xếp (Shift sắp nhiều cột, ô trống luôn cuối), ẩn/hiện, cố định, kéo giãn cột/dòng, "Lưu cấu hình" theo từng người dùng (lưu cả sắp xếp); cột Loại hình vận chuyển, Loại cont và mọi trường bổ sung của chuyến/đơn | ✅ | Không migration. Loại cont = loại xe của chuyến. Loại hình vận chuyển = trường bổ sung có tên chứa "Loại hình" (chuyến ưu tiên, sau đó đơn hàng); chưa có thì cột trống và gợi ý bấm "Thêm cột (trường)". Chi tiết đơn hàng dùng cùng bảng, cấu hình lưu riêng (`order_shipments`) |

## Chưa triển khai

| Chức năng | Giai đoạn |
|---|---|
| Trường động kiểu tệp | GĐ8 |
| Trình thiết kế biểu mẫu, quy trình (trang đang ghi "Giai đoạn 8") | GĐ8 |
| Kiểm thử tải, triển khai production | GĐ8 |

## Tạo đơn: ngày, khách thanh toán, giá sau (khách hàng yêu cầu 30/10/2026)

Cần chạy `supabase/deploy/nang-cap-khach-thanh-toan-gia-sau.sql` (migration 0024, 0025) trên CSDL thật trước khi đưa lên main.

| Chức năng | Trạng thái | Ghi chú |
|---|---|---|
| Ngày nhận hàng, ngày giao dự kiến chỉ chọn ngày (bỏ giờ) | ✅ | Lưu ngày nhận = 00:00, ngày giao dự kiến = 23:59:59 giờ Việt Nam, nên chuyến chỉ bị tính trễ khi qua hết ngày giao dự kiến. Mọi màn hình hiện dạng dd/mm/yyyy |
| Sửa, ngừng dùng, xóa trường bổ sung ngay trong khung "Thứ tự trên biểu mẫu" | ✅ | Trường đã có dữ liệu không xóa được, chỉ ngừng dùng |
| Khách thanh toán mặc định trên hồ sơ khách hàng, tự điền khi tạo đơn | ✅ | Khách hàng và địa điểm → sửa khách hàng → "Khách thanh toán mặc định". Vẫn đổi được trên đơn |
| Tạo chuyến khi chưa có giá | ✅ | Để trống đơn giá: chuyến ghi "Chưa có giá" (đơn giá 0), nhập sau ở bảng Quản lý chuyến xe hoặc chi tiết chuyến; tiền cước và hỗ trợ dầu tự tính lại |

## Điều phối làm thay tài xế (khách hàng yêu cầu 30/10/2026)

Cần chạy `supabase/deploy/nang-cap-dieu-phoi-lam-thay.sql` (migration 0026) trên CSDL thật trước khi đưa lên main.

| Chức năng | Trạng thái | Ghi chú |
|---|---|---|
| Điều phối bấm thay tài xế: Nhận đơn, Bắt đầu chạy, Hoàn thành chuyến | ✅ | Chi tiết chuyến → mục "Giao hàng và chứng từ". Cần quyền dispatch.update. Lịch sử ghi tên người làm thay |
| Hoàn thành thay khi chưa có ảnh/phiếu ký nhận: bắt buộc ghi lý do | ✅ | Chỉ điều phối; tài xế trên điện thoại vẫn bắt buộc ảnh. Chứng từ giữ "Thiếu", trang chi tiết nhắc bổ sung; tải ảnh bằng nút Chứng từ thì tự chuyển "Đã nộp" và bỏ nhắc |
| Nhập chi phí thay tài xế | ✅ | Nút "Nhập chi phí" có sẵn ở mục Chi phí chuyến, hóa đơn không bắt buộc |

## Hàng hóa nhiều mã hàng của chuyến (khách hàng yêu cầu 30/10/2026)

Cần chạy `supabase/deploy/nang-cap-hang-hoa-chuyen.sql` (migration 0027) trên CSDL thật trước khi đưa lên main.

| Chức năng | Trạng thái | Ghi chú |
|---|---|---|
| Bảng hàng hóa trên mỗi chuyến khi tạo đơn: Mã hàng, Tên hàng, Số lượng, ĐVT, Ghi chú; nút Thêm dòng, Xóa dòng, Dán từ Excel | ✅ | Không bắt buộc; tối đa 500 dòng/chuyến; tổng số lượng ở cuối bảng |
| Cột bổ sung và cột công thức cho bảng hàng hóa (VD Thành tiền = quantity * N(don_gia_hang)) | ✅ | Quản lý trường dữ liệu → "Hàng hóa của chuyến (mã hàng)"; sắp thứ tự cột ở "Thứ tự trên biểu mẫu"; cộng tổng cột số và cột công thức |
| Xem, sửa hàng hóa ở chi tiết chuyến | ✅ | Sửa cần quyền điều phối; chuyến đã đóng/hủy không sửa |
| Hàng hóa trên app tài xế, xuất Excel bảng chuyến | Chưa làm | Làm khi người dùng cần |

## Quy chuẩn màn hình (áp dụng mọi màn hình, 2026-10-21)

| Chức năng | Trạng thái | Ghi chú |
|---|---|---|
| Ô chọn danh mục thêm mới ngay tại ô (gõ tên chưa có → Thêm mới, điền sẵn tên) | ✅ | Mọi ô chọn danh mục; theo quyền tạo của vai trò |
| Người dùng tự thêm trường, kể cả trường công thức, cho mọi biểu mẫu | ✅ | Xe, tài xế, khách hàng, nhà cung cấp, địa điểm, loại xe, tuyến, bảng giá, quy tắc dầu, loại chi phí, ngân hàng, phương thức thanh toán, pháp nhân, quy tắc lương, bảo dưỡng, mục danh mục, đơn hàng, chuyến. Liên kết "+ Thêm trường" ngay trong biểu mẫu |
| Kéo thả sắp thứ tự trường trên biểu mẫu (trường hệ thống và trường bổ sung xen kẽ), áp dụng cho mọi người dùng | ✅ | Quản lý trường dữ liệu → chọn màn hình → "Thứ tự trên biểu mẫu". Áp dụng cho form tạo đơn hàng/chuyến (Điều phối) và hộp thêm/sửa của mọi danh mục. Hộp tạo ứng tiền, chi phí, lương, công nợ: trường hệ thống giữ cố định, chỉ trường bổ sung theo thứ tự |
| Nút + cạnh ô chọn của trường bổ sung (chọn một, chọn nhiều, bảng hàng hóa): gõ tên lựa chọn mới → lưu vào trường và chọn luôn, không phải sang Quản lý trường | ✅ | Người có quyền Cấu hình trường hoặc người nhập liệu (quyền Thêm/Sửa; không gồm tài xế, người chỉ xem). Trùng tên thì chọn lựa chọn cũ. Mỗi lần thêm tạo phiên bản mới của trường. Hàm add_field_option (0048), tệp nang-cap-them-lua-chon.sql, dòng kiểm tra 28, kiểm thử supabase/tests/34_inline_field_options_tests.sql |
| Hiện/ẩn trường bổ sung theo giá trị trường khác (ví dụ NCC = 3-PL thì mới hiện trường 3-PL); trường đang ẩn không bắt buộc và lưu trống | ✅ | Quản lý trường → sửa trường → "Điều kiện hiện trường". Trường điều kiện phải là danh sách chọn một hoặc Có/Không cùng màn hình. Áp dụng cho form tạo đơn/chuyến và hộp thêm/sửa danh mục |
| Ô tìm kiếm trên mọi danh sách | ✅ | Danh mục, bảng chuyến, điều phối, thông báo, người dùng, nhật ký |
| Tìm kiếm nâng cao: người dùng tự thêm điều kiện theo trường (kể cả trường bổ sung) | ✅ | Mọi bảng danh mục và bảng chuyến; xuất Excel theo đúng điều kiện |
| Chọn cột hiển thị, kéo đổi thứ tự cột, kéo giãn cột, kéo giãn dòng, cố định cột, lưu cấu hình theo người dùng | ✅ | Mọi bảng danh mục và bảng chuyến |
| Danh sách trạng thái cố định (trạng thái chuyến, chứng từ, quyết toán) | Không thêm tại ô | Đây là trạng thái quy trình của hệ thống, thêm giá trị mới sẽ làm sai quy trình |

## Sửa chuyến, hủy đơn hàng, đổi kiểu trường khi đã có dữ liệu (khách hàng yêu cầu 30/10/2026)

Cần chạy `supabase/deploy/nang-cap-sua-huy-don.sql` (migration 0028) trên CSDL thật trước khi đưa lên main.

| Tính năng | Trạng thái | Ghi chú |
|---|---|---|
| Nút "Sửa chuyến" trên trang chi tiết chuyến | ✅ | Sửa ngày nhận/giao, điểm nhận/giao, loại xe, số lượng, đơn giá, phụ phí, % hỗ trợ dầu, ghi chú; khóa khi tài xế đã hoàn thành hoặc đã đóng chuyến; nhật ký ghi lại thay đổi |
| Nút "Hủy đơn hàng" | ✅ | Hủy cả đơn và mọi chuyến chưa hoàn thành, bắt buộc lý do; không xóa cứng; không hủy được khi đã có chuyến hoàn thành |
| Đổi kiểu trường khi đã có dữ liệu | ✅ | Chỉ cho đổi kiểu tương thích (số → tiền/thập phân/%, chữ ngắn ↔ chữ dài, ngày → ngày giờ, mọi kiểu → văn bản); kiểu khác vẫn bị từ chối ở cả giao diện và CSDL |

## Tách cước phí theo loại phí thu khách (khách hàng yêu cầu 30/10/2026)

Cần chạy `supabase/deploy/nang-cap-loai-phi-thu-khach.sql` (migration 0029) trên CSDL thật trước khi đưa lên main.

| Tính năng | Trạng thái | Ghi chú |
|---|---|---|
| Danh mục "Loại phí thu khách" | ✅ | Danh mục hệ thống → Loại phí thu khách; có sẵn Phí bốc xếp, Phí chi hộ; Cách tính: Tính doanh thu hoặc Chi hộ (không tính doanh thu); thêm nhanh ngay trong ô chọn (cần quyền danh mục) |
| Nhập nhiều dòng phí cho mỗi chuyến | ✅ | Form tạo đơn (khung Giá → "Phí khác thu khách") và chi tiết chuyến ("Thêm/Sửa phí thu khách"); khóa khi chuyến đã lập công nợ, đã đóng hoặc đã hủy |
| Doanh thu, công nợ | ✅ | Doanh thu = cước + phụ phí + hỗ trợ dầu + phí tính doanh thu; công nợ phải thu cộng thêm tiền chi hộ ("Khách phải trả") |
| Báo cáo | ✅ | Báo cáo → "Doanh thu theo loại phí" (tháng × khách hàng × loại phí) và "Cước phí từng chuyến" (mỗi khoản một dòng); Lợi nhuận từng chuyến thêm cột Phụ phí, Phí khác, Chi hộ, Khách phải trả |
| Bảng chéo mỗi loại phí một cột trên từng chuyến | Chưa làm | Hiện xem theo dòng; xuất Excel rồi dùng Pivot nếu cần dạng cột |

## Báo cáo riêng Cước vận chuyển, Phí chi hộ, Bốc xếp; trả bốc xếp (khách hàng yêu cầu 30/10/2026)

Cần chạy `supabase/deploy/nang-cap-bao-cao-boc-xep.sql` (migration 0030) trên CSDL thật trước khi đưa lên main.

| Tính năng | Trạng thái | Ghi chú |
|---|---|---|
| Báo cáo Cước vận chuyển | ✅ | Từng chuyến: số lượng, đơn giá, cước, phụ phí, hỗ trợ dầu, tổng cước |
| Báo cáo Phí chi hộ | ✅ | Mỗi khoản chi hộ một dòng |
| Báo cáo Bốc xếp | ✅ | Từng chuyến: thu khách bốc xếp, chi tài xế trả (hoàn vào lương), chi công ty/nhà thầu trả, chênh lệch, chi chờ duyệt, nhà thầu |
| Nhà thầu nhận tiền khi nhập chi phí công ty trả | ✅ | Thêm nhanh nhà thầu ngay trong ô chọn; lập công nợ phải trả nhà thầu vẫn làm ở Công nợ (chưa tự động) |
| Nhóm báo cáo chi phí "Bốc xếp, nâng hạ" tách khỏi "Bến bãi, vào cổng"; loại phí thu khách có cờ "Thuộc nhóm bốc xếp" | ✅ | |
| Nút "Sửa đơn hàng" | ✅ | Sửa khách hàng, khách thanh toán, đơn vị nội bộ, ngày đơn, ghi chú, trường bổ sung của đơn; không đổi khách khi đơn đã có chuyến lập công nợ (kiểm tra cả ở CSDL) |
| Sửa chuyến đã đóng | ✅ | Chuyến đã đóng vẫn sửa giá, phí, trường bổ sung khi chưa lập công nợ; chuyến đã hủy hoặc đã lập công nợ bị khóa |

## Màn hình gọn, mã khách hàng (migration 0031) – 30/10/2026
- Điều phối, Quản lý chuyến xe, Báo cáo: trên màn hình rộng (từ 768px) chữ và khoảng cách thu nhỏ còn 87,5% để thấy nhiều chuyến hơn; điện thoại giữ cỡ thường.
- Lối vào báo cáo cước phí ở Điều phối, Quản lý chuyến thu thành một dòng chữ nhỏ.
- Cột khách hàng hiển thị mã khách (rê chuột xem tên). Bảng Quản lý chuyến và các báo cáo theo chuyến: cột "Mã KH" hiện mặc định, cột tên khách ẩn, bật lại trong Chọn cột. Tìm kiếm theo cả mã và tên.
- 0031 thêm `customer_code` vào report_shipment_profit, report_by_customer, report_fee_lines, report_by_fee_type, report_pass_through_fees, report_loading. Tệp nâng cấp: supabase/deploy/nang-cap-ma-khach-bao-cao.sql.
- Tệp xóa dữ liệu thử (/mnt/project-files/du-lieu-thu/) đã thêm hàng hóa chuyến (shipment_items) và phí thu khách (shipment_fees).
- Xóa dữ liệu thử trong ứng dụng (cũng trong 0031): Cấu hình → Xóa dữ liệu thử. Chỉ Super Admin/Admin. Mật khẩu xóa dữ liệu riêng (bcrypt trong private.admin_secrets, đặt/đổi bằng set_purge_password), sai 5 lần/15 phút thì khóa, mỗi lần sai ghi audit 'test_data.password_failed'. test_data_counts(p_password) xem trước, purge_test_data(p_password, 'XOA DU LIEU') xóa và ghi audit 'test_data.purge'. App đăng nhập bằng Google nên không dùng mật khẩu đăng nhập.
- Định dạng số: dấu phẩy phân cách hàng nghìn, dấu chấm thập phân (3,500,000 ₫; 39.5). parseNumberVN: "1,500" = 1500, "1.5" = 1.5; "1.500.000" (nhiều dấu chấm) và tiền "500.000" vẫn hiểu là hàng nghìn; "39,5" hiểu là 39.5.
- Tiêu đề bảng cố định khi cuộn (Điều phối, Quản lý chuyến, Báo cáo, danh mục): bảng cuộn trong khung cao tối đa màn hình trừ 12rem.

## Giám đốc duyệt chuyến trước khi tài xế nhận (migration 0033) – 01/11/2026
- Điều phối phân công tài xế (tạo đơn có tài xế, nút Phân công) → chuyến "Chờ GĐ duyệt". Tài xế chưa thấy chuyến trên điện thoại, không bấm Nhận đơn được; điều phối cũng không nhận đơn thay được.
- Giám đốc nhận thông báo (bấm mở thẳng chuyến). Duyệt ở: trang chuyến, bảng Điều phối (nút ✓ / ✗ trên từng dòng, "Duyệt tất cả" trên dải vàng), hoặc Phê duyệt (loại "Duyệt chuyến xe", nút Xem chuyến).
- Từ chối bắt buộc lý do; điều phối nhận thông báo, thấy lý do trên bảng và trang chuyến, sửa rồi bấm "Gửi duyệt lại". Đổi tài xế tự gửi duyệt lại (kể cả chuyến đã duyệt); chỉ đổi xe cùng tài xế thì giữ đã duyệt. Gỡ phân công hoặc hủy chuyến tự hủy yêu cầu đang chờ.
- Điều phối có thẻ "Chờ GĐ duyệt / bị từ chối"; Quản lý chuyến xe có cột "Giám đốc duyệt" và lọc nâng cao theo trường này.
- Bật/tắt: Cấu hình → `dispatch.require_director_approval` (nút gạt). Tắt thì chuyến đang chờ/bị từ chối được thả cho tài xế ngay. Chuyến có trước bản nâng cấp không cần duyệt.
- Người duyệt: Phê duyệt → Cấu hình cấp duyệt, loại "Duyệt chuyến xe" (mặc định cấp 1 = Giám đốc). Giám đốc/Super Admin tự điều phối thì vẫn tự duyệt được (allow_self_approval).
- CSDL: shipments.dispatch_approval (not_required | pending | approved | rejected), dispatch_approval_request_id, dispatch_approved_by/at, dispatch_reject_reason; trigger trg_shipments_dispatch_approval (gửi duyệt, chặn chuyển sang Đã nhận khi chưa duyệt, chặn sửa trực tiếp), private.driver_link_visible chỉ trả chuyến đã duyệt/không cần duyệt; approval_decide xử lý entity 'shipment_dispatch'; resubmit_trip_approval. Tệp nâng cấp: supabase/deploy/nang-cap-giam-doc-duyet-chuyen.sql.
- Kiểm thử CSDL: supabase/tests/21_trip_director_approval_tests.sql. scripts/test-db.sh tắt tham số cho các tệp kiểm thử cũ. Các kịch bản E2E có tài xế nhận đơn (phase4, phase6, phase7, act-for-driver, smoke) viết trước tính năng: chạy với tham số tắt hoặc duyệt chuyến trước.
- Ủy quyền duyệt hộ (migration 0034, khách yêu cầu 01/11/2026): Giám đốc bấm "Ủy quyền duyệt hộ" (Điều phối hoặc Phê duyệt), chọn người có quyền điều phối, ngày hết hạn (trống = đến khi thu hồi), ghi chú. Người được ủy quyền duyệt/từ chối được chuyến (chỉ loại Duyệt chuyến xe, kể cả chuyến tự phân công, duyệt thay mọi cấp), thấy dải xanh "Bạn đang được ủy quyền", nhận thông báo chuyến chờ duyệt (type approval_pending_delegate). Lịch sử ghi "Duyệt hộ Giám đốc (ủy quyền)", shipments.dispatch_approved_on_behalf = true, Giám đốc nhận thông báo trip_delegate_decided. Bảng public.trip_approval_delegations (RLS bật, không cấp quyền đọc thẳng; dùng trip_delegation_info, grant_trip_delegation, revoke_trip_delegation). private.can_approve = can_approve_regular (quy tắc cũ) hoặc đang được ủy quyền. Kiểm thử: supabase/tests/22_trip_approval_delegation_tests.sql.
## Tách phí bốc xếp khỏi chi hộ (migration 0032) – 30/10/2026
- Phí bốc xếp bản chất là chi hộ nhưng không xuất hóa đơn; phí nâng, hạ, cược cont là chi hộ có hóa đơn. Loại phí bật "Thuộc nhóm bốc xếp" không còn hiện ở báo cáo Phí chi hộ, chỉ ở báo cáo Bốc xếp. Khách phải trả vẫn gồm mọi khoản chi hộ.
- report_fee_lines thêm cột is_loading; report_pass_through_fees lọc `not is_loading`. Tệp nâng cấp: supabase/deploy/nang-cap-tach-boc-xep-chi-ho.sql.
- Chi bốc xếp: tài xế tự bốc thì tài xế nhập (Tài xế trả, hoàn qua lương); 3PL/nhà thầu thuê công nhân trả tiền mặt thì văn phòng nhập ở chuyến (Công ty trả + Nhà thầu nhận tiền), áp dụng cả chuyến xe 3PL.

## Nhóm phí và báo cáo chi phí theo nhóm (migration 0035) – 01/11/2026
- Mọi bảng có đường kẻ dọc giữa các cột (tiêu đề và dữ liệu), quy tắc chung trong globals.css.
- Danh mục mới: **Nhóm phí** (fee_groups, vai trò khi tổng kết: freight = cộng vào Tổng cước, pass_through, declaration = có ô Loại tờ khai, loading = đưa vào báo cáo Bốc xếp, other) và **Loại tờ khai** (declaration_types: Xanh, Vàng, Đỏ). Loại phí thu khách có ô Nhóm phí; chọn nhóm vai trò Bốc xếp thì tự bật "Thuộc nhóm bốc xếp".
- Có sẵn theo yêu cầu khách: Phí vận chuyển (Cước vận chuyển, Phụ phí, % hỗ trợ dầu lấy từ khung giá + Phụ thu vé SP-ITC, Phụ thu hạ rỗng xa + BOT, Phí neo xe); Phí chi hộ (Phí hạ, Phí nâng, Phí cược cont); Phí tờ khai (Loại tờ khai + Phí tờ khai theo cont); Phí bốc xếp (Bốc xếp bởi tài xế, Bốc xếp bởi 3-PL, Phí bồi dưỡng). Loại phí cũ được xếp nhóm theo cờ bốc xếp / chi hộ.
- Tổng cước = cước + phụ phí + hỗ trợ dầu + phí thuộc nhóm vai trò freight (report_shipment_profit.freight_total, thêm cột freight_fee_amount).
- Ô nhập phí (tạo đơn ở Điều phối, Sửa phí ở chuyến) dựng lại theo nhóm: mỗi nhóm liệt kê sẵn loại phí, chỉ gõ số tiền; nhóm Tờ khai có ô Loại tờ khai; "Phí khác" để chọn/thêm nhanh loại phí ngoài nhóm. shipment_fees.declaration_type_id; set_shipment_fees nhận declaration_type_id (chỉ chọn loại tờ khai thì lưu 0 đ).
- Báo cáo **Chi phí theo nhóm** (/bao-cao/nhom-phi; lối vào ở Điều phối, Quản lý chuyến, Báo cáo): lọc Từ ngày–đến ngày, Tuần, Tháng, Năm; chia bảng theo ngày/tuần/tháng. Thẻ tổng bên thu (từng nhóm phí) và bên chi (theo "Nhóm chi phí" của hạng mục chi phí chuyến đã duyệt, Bảo trì sửa chữa, Kiểm định bảo hiểm từ Bảo dưỡng sửa chữa xe, Ứng tiền đã duyệt/đã chuyển). Bảng: Tổng theo kỳ, Từng chuyến, Theo loại phí, Bên chi chi tiết; tìm kiếm, tìm nâng cao, chọn/kéo/giãn cột, tải Excel (CSV).
- Bảo dưỡng, sửa chữa xe thêm loại Vá lốp, Bảo hiểm; Đăng kiểm đổi tên Kiểm định.
- View: report_fee_group_lines, report_cost_lines. Kiểm thử CSDL: supabase/tests/23_fee_groups_tests.sql. Tệp nâng cấp: supabase/deploy/nang-cap-nhom-phi.sql.
- Chưa làm: chi phí cầu đường import Excel theo số xe (chờ mẫu Excel của khách).

## Nhập đơn hàng, chuyến từ Excel (migration 0036) – 01/11/2026
- Màn hình /dieu-phoi/nhap-excel (quyền dispatch.create); nút "Nhập từ Excel" ở Điều phối và Quản lý chuyến xe.
- File mẫu sinh theo dữ liệu hiện tại: cột chính (Gộp đơn, Mã khách hàng, Khách thanh toán, Ngày đơn/nhận/giao, Điểm nhận/giao, Loại xe, Biển số, Tài xế, Trạng thái, Ngày hoàn thành, Số lượng, Đơn vị tính, Đơn giá, Phụ phí, Hỗ trợ dầu, Ghi chú), trường bổ sung của chuyến, Loại tờ khai, mỗi loại phí thu khách một cột "<Nhóm phí> - <Loại phí>". Danh sách chọn (sheet Danh mục), ghi chú trên tiêu đề, sheet Hướng dẫn.
- Kiểm tra trước khi ghi: khách hàng theo mã (hoặc đúng tên), xe theo biển số chuẩn hóa, tài xế theo mã/SĐT/họ tên (trống = tài xế phụ trách xe), địa điểm theo mã/tên (tùy chọn tạo địa điểm mới), ngày dd/mm/yyyy, số dấu phẩy hàng nghìn; cảnh báo trùng trong file và trùng chuyến đã có (cùng khách, ngày, tuyến, xe). Tìm kiếm, lọc dòng lỗi/cần xem lại, bỏ chọn dòng.
- Trạng thái: Chờ phân công (nháp), Đã phân công (qua Giám đốc duyệt như tạo tay), Đã hoàn thành (chuyến cũ: không duyệt, không báo tài xế, chuyển thẳng Tài xế đã hoàn thành, chứng từ Thiếu, photo_skip_reason "Chuyến cũ nhập từ Excel", không phát sinh chi phí). Có đơn giá trong file thì dùng đúng giá đó (pricing_snapshot.price_source = 'excel').
- CSDL: public.import_transport_order(p_order, p_shipments) mỗi đơn một giao dịch; private.trip_approval_on() bỏ qua duyệt khi app.trip_import_done = on (chỉ trong giao dịch nhập). Kiểm thử: supabase/tests/24_import_trips_tests.sql, tests/import-trips*.test.ts. Tệp nâng cấp: supabase/deploy/nang-cap-nhap-chuyen-excel.sql.

## Sửa toàn bộ đơn hàng bằng form tạo đơn (không có migration) – 01/11/2026
- Khách hàng hỏi vì sao Điều phối chỉ sửa được một phần. Trước đây sửa chia nhiều hộp nhỏ (phần đầu đơn; ngày/điểm/giá của chuyến; hàng hóa; phí; trường bổ sung; phân công) nên không sửa được tất cả ở một chỗ.
- Trang mới /dieu-phoi/don-hang/[id]/sua (quyền dispatch.update): nút "Sửa toàn bộ đơn" ở trang đơn hàng (thay hộp "Sửa đơn hàng"), nút "Sửa" ở từng dòng bảng Điều phối mở trang này và cuộn tới đúng chuyến (#chuyen-<mã chuyến>).
- Dùng lại OrderForm ở chế độ sửa: nạp sẵn phần đầu đơn (thêm Đơn vị nội bộ), từng chuyến (ngày, điểm, loại xe, xe, tài xế, số lượng, ghi chú, trường bổ sung, khung giá, nhóm phí, hàng hóa). Thêm chuyến mới (cần dispatch.create), nhân bản, hủy chuyến có lý do (cần quyền hủy) ngay trong form; lưu một lần (action updateOrderFull).
- Giá: chuyến đã có giữ giá đang lưu và sửa tay được; đổi điểm nhận/giao hoặc loại xe, hoặc bấm "Tính lại theo bảng giá", thì tìm lại bảng giá như lúc tạo (quote_shipment; nhiều bảng giá ngang nhau phải chọn). Đổi khách hàng không tự đổi giá.
- Khóa giữ nguyên: chuyến đã lập công nợ không sửa giá, phí, số lượng; đơn có chuyến lập công nợ không đổi khách hàng/khách thanh toán/đơn vị nội bộ; chuyến đang chạy/đã xong không đổi xe, tài xế; chuyến đã đóng không sửa hàng hóa; đổi tài xế đi qua assign_shipment nên chuyến chờ Giám đốc duyệt lại; kiểm tra trùng lịch xe chỉ khi đổi xe hoặc ngày; kiểm tra phiên bản chuyến (người khác vừa sửa thì báo tải lại).
- Kiểm thử CSDL: supabase/tests/25_edit_full_order_tests.sql. E2E: scripts/e2e-edit-order.mjs dùng trang mới.

## Xin nghỉ (phép/ốm), bàn giao khách hàng, nhân viên phụ trách khách (migration 0041) – 01/11/2026
- Khách hàng có ô "Nhân viên phụ trách" (customers.account_manager_id, chọn từ danh bạ nhân viên public.staff_directory, không gồm tài xế): hiện trong hồ sơ khách, cột và bộ lọc ở danh sách Khách hàng.
- Trang mới /nghi-phep "Xin nghỉ, bàn giao" (nhóm menu Nhân sự, mọi nhân viên): thẻ Đang nghỉ hôm nay / Đơn chờ tôi duyệt / Bàn giao chờ tôi nhận, khung "Hôm nay bạn đang phụ trách thay"; tab Đơn xin nghỉ và Bàn giao công việc (tìm kiếm, lọc nâng cao, chọn cột như mọi bảng).
- Tạo đơn: loại nghỉ (Phép, Ốm, Không lương, Khác), từ ngày đến ngày, số ngày (tự tính không tính Chủ nhật, sửa được theo bước 0.5), lý do, bàn giao từng khách mình phụ trách (liệt kê sẵn, mỗi khách một người nhận, "Giao tất cả cho"), thêm khách khác, việc khác (chữ + người nhận), ghi chú bàn giao chung, trường bổ sung (module leaves).
- Duyệt dùng hệ thống phê duyệt chung: loại "Xin nghỉ" (leave), cấp 1 = Giám đốc (Phê duyệt → Cấu hình cấp duyệt). Duyệt/Từ chối ở trang Xin nghỉ hoặc Phê duyệt. Giám đốc tự nghỉ thì tự ghi nhận được. Ủy quyền duyệt hộ hiện chỉ áp dụng cho chuyến.
- Duyệt xong: mỗi người nhận được báo một lần, bấm "Nhận bàn giao" (một dòng hoặc mọi dòng của mình); người xin nghỉ được báo khi có người nhận. Trong ngày nghỉ, public.customer_acting_manager(khách) trả người nhận bàn giao; Nhân viên phụ trách gốc không đổi. Người xin hủy được đơn chờ duyệt hoặc đã duyệt khi chưa hết ngày nghỉ (người nhận được báo).
- Kỹ thuật: không viết lại approval_decide; trigger trg_approval_requests_leave đồng bộ trạng thái, trg_notifications_leave_fix sửa tiêu đề/link thông báo. leave_requests.approval_request_id không có khóa ngoại (để Xóa dữ liệu thử không vướng). Kiểm thử: supabase/tests/27_leave_requests_tests.sql, tests/leave-days.test.ts. Tệp nâng cấp: supabase/deploy/nang-cap-xin-nghi-ban-giao.sql.

## Phiếu đề nghị chi, mua sắm (migration 0040) – 01/11/2026
- Khách hàng yêu cầu: ngoài Ứng tiền và Chi phí chuyến cần mục "Đề nghị" (mua văn phòng phẩm, sửa văn phòng, mua sắm máy móc thiết bị…): Giám đốc duyệt → Kế toán thực hiện → báo cáo.
- Menu Tài chính → **Đề nghị chi, mua sắm** (/de-nghi): thẻ Chờ GĐ duyệt, Đã duyệt chờ chi, Đề nghị trong tháng, Đã chi; tab Phiếu đề nghị, Báo cáo theo tháng/loại, Loại đề nghị. Báo cáo cũng có ở menu Báo cáo (tab Đề nghị chi theo loại).
- Lập phiếu: Loại đề nghị (thêm nhanh ngay ở ô chọn), Nội dung, nhập tổng số tiền HOẶC liệt kê hàng hóa (tên, SL, ĐVT, đơn giá → tự cộng), Cần trước ngày, Nhà cung cấp, Người nhận tiền, Ghi chú, đính kèm báo giá/hóa đơn, trường bổ sung (Thêm trường cho biểu mẫu này).
- Duyệt: loại phê duyệt `purchase_request`, mặc định Giám đốc duyệt 1 cấp (sửa ở Phê duyệt → Cấu hình cấp duyệt, chia theo số tiền được). Người lập không tự duyệt phiếu của mình. Duyệt được số tiền ít hơn số đề nghị. Ủy quyền duyệt hộ hiện chỉ áp dụng cho chuyến (theo yêu cầu trước), không áp dụng cho phiếu đề nghị.
- Kế toán: Chi tiền một lần hoặc nhiều lần (đặt cọc, đợt sau), tổng không vượt số duyệt; phiếu chi (payments.purpose = purchase_request) hiện ở Công nợ → Phiếu thu chi, hủy được khi ghi nhầm (trả lại số còn được chi). Mua xong mà chi ít hơn số duyệt thì bấm **Hoàn tất**. Hủy phiếu: người lập (khi còn chờ duyệt) hoặc người có quyền hủy (phiếu chưa chi đồng nào).
- Thông báo: Giám đốc khi có phiếu chờ duyệt; Kế toán khi phiếu được duyệt (chờ chi); người lập khi bị từ chối / được duyệt / được chi.
- Quyền mới (module purchase_requests): view (xem tất cả phiếu), create (lập phiếu, thấy phiếu của mình), delete (hủy), pay (chi tiền), export. Mặc định: Admin tất cả; Giám đốc xem, lập, xuất; Kế toán xem, lập, hủy, chi, xuất; Điều phối, Quản lý vận hành lập phiếu.
- CSDL: purchase_request_types, purchase_requests (items jsonb), view purchase_request_list, report_purchase_requests, hàm create/cancel/pay/complete_purchase_request, purchase_request_history; approval_decide thêm nhánh purchase_request và móc mở rộng private.on_approval_<entity_type>(request, entity, action, comment); void_payment, payment_list, purge_test_data cập nhật. Kiểm thử CSDL: supabase/tests/28_purchase_requests_tests.sql. Tệp nâng cấp: supabase/deploy/nang-cap-de-nghi-chi.sql.

## Chi phí và thanh toán xe thuê ngoài 3PL (migration 0042) – 01/11/2026
- Phương tiện: trường **Nhà xe 3PL** (nhà cung cấp chủ xe) cho xe Thuê ngoài 3PL; chuyến chạy xe này tự điền nhà xe.
- Chi tiết chuyến: khung **Chi phí trả 3PL** (hiện khi xe là 3PL hoặc chuyến đã có nhà xe/chi phí 3PL): nhà xe, số hóa đơn, hạn trả, các khoản Cước 3PL / Chi hộ 3PL (chọn loại phí nâng, hạ, cược…) / Chi phí khác; SL × đơn giá tự tính; nút **Chép phí chi hộ thu khách**. Lưu là tự lập/cập nhật MỘT công nợ phải trả (payables.kind = carrier) cho nhà xe; đã trả thì không giảm dưới số đã trả, không đổi nhà xe; xóa hết khoản hoặc hủy chuyến thì hủy công nợ chưa trả.
- Lời/lỗ chuyến và báo cáo lợi nhuận (tháng, xe, tài xế, khách) trừ Cước + Chi phí khác trả 3PL; Chi hộ 3PL không trừ (đã thu lại của khách).
- Trang **Xe thuê ngoài 3PL** (/thue-ngoai, quyền reports.view hoặc receivables.view): KPI tháng, bảng Chuyến 3PL (cước, chi hộ, đã trả, còn nợ, tình trạng, hạn, quá hạn; nút Chi phí / Trả tiền / Lịch sử từng dòng), bảng 3PL theo nhà xe theo tháng, nút **Trả tiền 3PL nhiều chuyến** (một nhà xe, tick chuyến, mỗi chuyến một phiếu chi cùng số giao dịch). Hai bảng cũng có ở Báo cáo.
- CSDL: vehicles.supplier_id, shipments.carrier_supplier_id, payables.kind, bảng shipment_carrier_costs, view shipment_carrier_totals, report_carrier_trips, report_carrier_by_supplier; hàm set_shipment_carrier_costs, pay_carrier_payables. Kiểm thử: supabase/tests/29_carrier_costs_tests.sql.

## Trò chuyện riêng và nhóm (migration 0043) – 01/11/2026

- Trang mới /tro-chuyen "Trò chuyện" (nhóm menu Nhân sự, mọi nhân viên văn phòng; tài xế chưa dùng) và biểu tượng tin nhắn trên đầu trang có số tin chưa đọc, tự cập nhật.
- Nhắn tin riêng 1-1 (mỗi cặp người chỉ một cuộc trò chuyện) và nhóm: đặt tên, chọn thành viên; mọi thành viên thêm người, đổi tên nhóm; quản trị nhóm mời người ra, giao/bỏ quyền quản trị; ai cũng rời nhóm được (quản trị cuối rời thì người vào sớm nhất thành quản trị).
- Gửi chữ (Enter gửi, Shift+Enter xuống dòng, link bấm được), gửi kèm ảnh/PDF/Excel/Word ≤ 10 MB (chọn tệp hoặc dán ảnh), thu hồi tin của mình, đếm tin chưa đọc từng cuộc trò chuyện, tin mới hiện ngay (Supabase Realtime).
- Tìm kiếm: ô tìm ở danh sách tìm theo tên người/nhóm (gõ không dấu được) và nội dung tin nhắn trong mọi cuộc trò chuyện; nút kính lúp tìm trong một cuộc trò chuyện; bấm kết quả mở đúng chỗ tin nhắn.
- Bảo mật: chỉ thành viên đọc được tin và tệp của phòng (RLS + chính sách Storage thư mục chat/{phòng}/); ghi qua hàm chat_* (security definer). Kiểm thử: supabase/tests/30_chat_tests.sql.

## Giao việc (migration 0044) – 01/11/2026
- Trang mới /giao-viec "Giao việc" (nhóm menu Nhân sự): thẻ Việc của tôi đang mở / Quá hạn / Chờ tôi xác nhận / Tôi giao, chưa xong; tab Danh sách công việc (tìm kiếm, lọc nâng cao, chọn cột, tab trạng thái) và Kết quả theo người (tổng việc, đang làm, quá hạn, xong đúng/trễ hạn, tỷ lệ đúng hạn).
- Quyền mới tasks.{view, create, delete, export}: Giám đốc và Admin mặc định có hết (giao việc, xem mọi việc, quản lý việc người khác giao). Nhân viên khác thấy việc mình được giao / mình giao. Cấp thêm quyền Giao việc cho vai trò khác ở Người dùng → Ma trận quyền.
- Giao việc: tên, nội dung, nhiều người được giao (không gồm tài xế), ưu tiên (Thấp/Bình thường/Cao/Gấp), ngày bắt đầu, hạn ngày + giờ (chọn nhanh Hôm nay/Ngày mai/3 ngày/1 tuần), khách hàng liên quan (thêm nhanh được), trường bổ sung (module tasks).
- Trang chi tiết /giao-viec/[id]: tiến độ %, kết quả, người được giao kèm Đã xem/Chưa xem, tệp đính kèm (ảnh, PDF, xlsx, docx; ai trong việc cũng tải lên được, không cần quyền Chứng từ), trao đổi + lịch sử thay đổi.
- Luồng: Chưa bắt đầu → Bắt đầu làm → cập nhật % → Báo hoàn thành (Chờ xác nhận) → người giao Xác nhận (Hoàn thành) hoặc Yêu cầu làm lại (bắt buộc lý do). Người giao sửa/gia hạn/đổi người/hủy (bắt buộc lý do). Tự giao cho mình thì báo xong là hoàn thành.
- Thông báo: giao việc ([GẤP] nếu gấp), đổi hạn, tiến độ, báo xong, xác nhận, làm lại, hủy, trao đổi; quá hạn báo một lần mỗi việc (quét khi mở trang Giao việc hoặc Thông báo, task_overdue_sweep).
- Kiểm thử: supabase/tests/31_tasks_tests.sql. Tệp nâng cấp: supabase/deploy/nang-cap-giao-viec.sql (dòng kiểm tra 24). Việc giao không bị xóa bởi Xóa dữ liệu thử.

## Ô chọn có tìm kiếm, chặn khách ngừng hoạt động – 02/11/2026 (không cần nâng cấp CSDL)
- Mọi ô chọn danh sách (NativeSelect) thành ô bật danh sách: từ 8 lựa chọn trở lên có ô "Gõ để tìm…" (gõ không dấu được, nhiều từ), phím mũi tên + Enter để chọn, gõ chữ ngay trên ô là tìm luôn. Nút + thêm lựa chọn bên cạnh giữ nguyên. Vẫn có thẻ <select> thật ẩn bên dưới nên biểu mẫu, bắt buộc nhập, e2e selectOption chạy như cũ. Ô chọn nhiều giữ kiểu cũ. Thành phần: src/components/ui/search-select.tsx.
- Khách hàng (và mọi danh mục có trạng thái Ngừng hoạt động) không hiện trong ô chọn khi tạo đơn, lập kế hoạch; máy chủ còn chặn chọn MỚI bản ghi ngừng hoạt động khi lưu (saveRecord, tạo đơn, sửa toàn bộ đơn), khi tích tạo đơn từ kế hoạch có khách đã ngừng, và không tự điền khách thanh toán mặc định đã ngừng. Đơn, kế hoạch cũ giữ nguyên khách cũ vẫn sửa, lưu được. Hàm: src/lib/entities/active-check.ts.
## Thứ tự xe, tài xế thấy từng chuyến, hủy nhận xe / sửa xe, tài xế (0049, 02/11/2026)

- Điều phối: cột "Thứ tự xe" hiện sẵn trên bảng chuyến, bấm vào ô để nhập 1, 2, 3… (Enter lưu, để trống = bỏ). Chưa nhập thì hiện thứ tự từ kế hoạch (chữ nhạt).
- Ứng dụng tài xế: nhập số xe chỉ thấy MỘT chuyến (đang chạy / đã nhận, nếu không thì chuyến chờ nhận có ngày nhận sớm nhất rồi thứ tự xe nhỏ nhất). Hoàn thành xong hiện thẻ chuyến vừa xong + nút "Tìm chuyến khác"; không còn chuyến thì "Chưa có chuyến, chờ điều phối sắp xếp". Chuyến đã xong gần đây nằm trong mục thu gọn (xem, bổ sung chi phí).
- Sửa lỗi kẹt màn hình sau khi bấm "Gửi và hoàn thành": máy chủ không làm mới trang khi hộp thoại còn mở; đóng hộp thoại rồi mới chuyển màn hình.
- "Hủy nhận / đổi xe" (chuyến Tài xế đã nhận / Đang vận chuyển): chọn xe mới (tài xế giữ nguyên hoặc đổi), bắt buộc lý do → chuyến về Chờ tài xế nhận trên xe mới. Giữ tài xế thì không phải Giám đốc duyệt lại; đổi tài xế thì duyệt lại. RPC unaccept_shipment.
- "Sửa xe, TX" (Đang vận chuyển / Đã giao / Đã đóng): sửa thẳng số xe, tài xế, bắt buộc lý do, ghi nhật ký (audit_logs.reason). Chi phí tài xế tự trả của chuyến chưa vào bảng lương chuyển theo tài xế đúng. Chặn đổi tài xế khi bảng lương tháng hoàn thành của tài xế cũ/mới đã lập. RPC correct_shipment_crew.
- Kiểm thử: supabase/tests/35_trip_vehicle_change_tests.sql, tests/driver-view.test.ts. Tệp nâng cấp: supabase/deploy/nang-cap-doi-xe-tai-xe.sql (dòng kiểm tra 29).

## Đính kèm PDF / ảnh hóa đơn cho phí chi hộ (migration 0053) – 02/11/2026
- Tạo đơn, Sửa toàn bộ đơn, Sửa phí thu khách ở chi tiết chuyến: mỗi dòng nhóm Phí chi hộ có nút 📎 ngay sau ô Số hóa đơn. Chọn PDF hoặc ảnh (tối đa 10 tệp, 10 MB mỗi tệp, không bắt buộc); tệp chờ và tải lên khi bấm Lưu. Chuyến đã có tệp thì hiện số tệp, bấm để xem, tải thêm.
- Chi tiết chuyến → Doanh thu chuyến: dòng phí chi hộ có nút "PDF (n)" / "Đính kèm" để xem hoặc tải thêm ngay.
- Lưu trữ: documents.entity_type = 'shipment_fee', entity_id = id chuyến, cột mới fee_type_id (loại phí). Gắn theo chuyến + loại phí nên sửa phí nhiều lần vẫn giữ tệp; không tính là chứng từ giao hàng, tài xế không thấy. Quyền như chứng từ khác (documents.create / documents.view).
- Kiểm thử: supabase/tests/36_pass_through_fee_files_tests.sql. Tệp nâng cấp: supabase/deploy/nang-cap-hoa-don-chi-ho.sql (dòng kiểm tra 33).

## Thông tin tài xế gửi khách hàng (migration 0055) – 02/11/2026
- Nút "Thông tin tài xế" (biểu tượng thẻ) ở: Điều phối (từng dòng chuyến + nút đầu trang cho mọi chuyến trong tab đang xem), Quản lý chuyến xe (cạnh tên tài xế + nút đầu trang cho trang đang xem), chi tiết chuyến.
- Hộp thoại có sẵn văn bản đúng mẫu "Tên / Số xe / Số CCCD / Số GPLX" (nhiều chuyến cách nhau một dòng trống), sửa được trước khi chép, nút Sao chép. Bỏ qua chuyến hủy, chưa có tài xế.
- Tài xế thiếu CCCD / GPLX: cảnh báo + ô điền nhanh "Lưu vào hồ sơ". Điều phối chỉ điền ô đang trống; người có quyền sửa giấy tờ tài xế sửa được mọi giá trị (trong hồ sơ tài xế).
- Hồ sơ tài xế → Giấy tờ tùy thân: thêm Số GPLX, Hạng GPLX, Ngày hết hạn GPLX (bảng driver_sensitive).
- Điều phối không có quyền xem giấy tờ trong hồ sơ vẫn xem được CCCD/GPLX qua hàm shipment_driver_info (cần dispatch.view hoặc shipments.view).
- Kiểm thử: supabase/tests/38_driver_share_info_tests.sql. Tệp nâng cấp: supabase/deploy/nang-cap-thong-tin-tai-xe.sql (dòng kiểm tra 35).

## Rút gọn mã chuyến và mã đơn (migration 0056) – 03/11/2026
- Mã chuyến `SNOV-0001`, mã đơn `ONOV-0001`: chữ đầu (S chuyến, O đơn) + 3 chữ tiếng Anh của tháng (giờ Việt Nam) + số thứ tự trong tháng.
- Cùng tháng năm sau đếm tiếp (không quay về 0001) để mã không bao giờ trùng.
- Mã cũ `SHP-YYYYMMDD-xxxx` / `ORD-YYYYMMDD-xxxx` được đánh số lại theo thứ tự tạo trong từng tháng; mã đơn trong Lập kế hoạch và nội dung thông báo đổi theo. Nhật ký thao tác giữ nguyên mã cũ (lịch sử).
- Tệp nâng cấp: `supabase/deploy/nang-cap-ma-chuyen-ngan.sql`. Kiểm thử: `supabase/tests/39_short_trip_codes_tests.sql`.

## Một chuyến chỉ một người sửa (migration 0061) – 04/11/2026
- Mở khung sửa hoặc gõ vào ô nhập ở trang chi tiết chuyến thì nhận quyền sửa chuyến. Người khác vào cùng chuyến thấy thanh đỏ "X đang sửa chuyến này (từ HH:MM)", chỉ xem được; mọi thao tác lưu vào chuyến (thông tin chuyến, phí thu khách, chi phí đầu ra, chi phí 3PL, hàng hóa, giao xe, duyệt…) bị CSDL chặn, ở mọi màn hình (Điều phối, Quản lý chuyến, Sửa đơn).
- Nút "Báo người đang sửa thoát ra": gửi thông báo cho người đang sửa, người đó thấy thanh vàng "X đang chờ sửa".
- Không bị kẹt: quyền sửa tự hết sau 2 phút máy người sửa không báo (tắt tab, mất mạng) và tự nhả sau 10 phút không thao tác.
- Không ghi đè: người khác đã lưu sau khi trang được tải thì không lưu được, báo "dữ liệu đã cũ, tải lại trang". Không mở khung sửa thì trang tự tải bản mới.
- Tài xế (app tài xế) không bị khóa chặn. Nâng cấp: supabase/deploy/nang-cap-khoa-sua-chuyen.sql (dòng kiểm tra 40).

## Thông tin tài xế: tự chọn, thêm trường (migration 0066) – 08/11/2026
- Hộp "Thông tin tài xế gửi khách hàng" có nút "Chọn trường, thêm trường" (người có quyền dispatch.update hoặc settings.configure): đổi tên dòng, đổi trường lấy dữ liệu, lên/xuống, bỏ dòng, thêm dòng từ danh sách (Ngày cấp CCCD, Nơi cấp, SĐT, Ngày sinh, Hạng/hạn GPLX, Loại xe, Mã chuyến, Ngày nhận hàng, Khách hàng… và mọi trường bổ sung tự tạo của Tài xế / Xe). Văn bản xem trước ngay; "Lưu mẫu" dùng chung cho mọi người; "Mẫu mặc định" về 4 dòng cũ.
- "Tạo trường mới cho tài xế" (người có quyền Trường dữ liệu): tạo trường bổ sung module drivers ngay trong hộp, điền giá trị ở hồ sơ tài xế.
- Ô trống theo mẫu: cảnh báo từng tài xế + link hồ sơ; CCCD / GPLX vẫn điền nhanh được.
- Mẫu lưu ở system_settings 'driver.share_template'; dữ liệu qua shipment_driver_share (jsonb). CSDL chưa nâng cấp thì hộp dùng mẫu cố định cũ. Kiểm thử: supabase/tests/48_driver_share_template_tests.sql, tests/driver-share.test.ts. Tệp nâng cấp: supabase/deploy/nang-cap-mau-thong-tin-tai-xe.sql (dòng kiểm tra 45).

## Tổng chi theo nhóm, trừ chi hộ (migration 0067) – 08/11/2026
- Menu Tài chính → "Tổng chi theo nhóm" (/tong-chi, quyền reports.view). Lọc từ ngày–đến ngày / tuần / tháng / năm, bật tắt từng nguồn chi.
- Nguồn chi (view report_spending_lines): chi phí chuyến đã duyệt (shipment_expenses, nhóm = Nhóm phí chi ra), chi phí xe (maintenance_records), trả nhà xe 3PL (shipment_carrier_costs), phiếu chi Đề nghị chi (payments). Không gồm ứng tiền tài xế; chưa gồm lương tài xế.
- Chi hộ không cộng: phí chi ra đánh dấu "Chi hộ khách" (expense_categories.is_pass_through; tự đánh dấu sẵn phí tên có "chi hộ", "nâng", "cược") và chi hộ trả 3PL. Khoản chờ duyệt để riêng.
- Tab: Tổng theo nhóm (theo nguồn, %), Theo khoản chi, Theo kỳ, Chi tiết chi (bấm tên nhóm/khoản để xem; lọc Đã tính / Chờ duyệt / Chi hộ). Tìm kiếm, tìm kiếm nâng cao, chọn/đổi cột, Xuất Excel (.xlsx tạo ngay trên trình duyệt, ReportGrid onExport).
- Kiểm thử: supabase/tests/49_spending_report_tests.sql, tests/spending-report.test.ts. Tệp nâng cấp: supabase/deploy/nang-cap-tong-chi-theo-nhom.sql (dòng kiểm tra 46).

## Dầu theo xe (migration 0068) – 10/11/2026
- Menu Vận hành → "Dầu theo xe" (/dau-xe, quyền mới fuel.view / fuel.update / fuel.approve / fuel.export). Mỗi xe công ty (không gồm xe thuê ngoài 3PL), mỗi tháng một dòng.
- Trên: thẻ tổng + bảng "Tổng theo loại xe" (xe cont, xe tải…). Dưới: chi tiết từng xe, sửa ngay tại ô: Số KM đầu/cuối tháng, Tồn dầu đầu tháng, Dầu đổ thêm, Dầu còn lại, Tỷ trọng (lít/km), Ghi chú.
- Tự lấy (chữ nghiêng): KM đầu = KM cuối tháng gần nhất trước đó, Tồn đầu = Dầu còn lại tháng trước, Tỷ trọng = vehicles.fuel_ratio_l_per_km (Phương tiện, lấy sẵn từ định mức lít/100km ÷ 100).
- Tính: Dầu thực tế = tồn đầu + đổ thêm − còn lại; Dầu theo KM = (KM cuối − KM đầu) × tỷ trọng; Chênh lệch = thực tế − theo KM.
- Giám đốc (fuel.approve): nhập số chốt + ghi chú, chọn xe → Chốt (ô trống lấy số thực tế / theo KM), Mở chốt. Đã chốt thì không sửa; chốt ghi cố định số tự lấy.
- Bảng chi tiết dùng ReportGrid (ẩn/hiện, kéo đổi cột, tìm kiếm nâng cao, lưu cấu hình), Xuất Excel, In / PDF (tiêu đề nền đen chữ trắng, căn giữa dòng), Nhập Excel + file mẫu có ghi chú từng cột.
- ReportGrid (mọi báo cáo dùng chung): tiêu đề chữ đậm nền xanh nhạt, có vạch phân cách giữa các cột, thêm nút In tùy chọn (onPrint).
- Kiểm thử: supabase/tests/50_vehicle_fuel_tests.sql, tests/vehicle-fuel.test.ts. Tệp nâng cấp: supabase/deploy/nang-cap-dau-theo-xe.sql (dòng kiểm tra 47).
- 10/11/2026 (0069): thêm Đơn giá dầu (đồng/lít, trống thì lấy tháng trước của xe, nút "Đơn giá cho mọi xe") và Thành tiền = số chốt × đơn giá (chưa chốt thì tạm tính theo dầu thực tế, chữ nghiêng). Tệp nâng cấp nang-cap-don-gia-dau.sql (dòng kiểm tra 48), kiểm thử 51_vehicle_fuel_price_tests.sql.
- 10/11/2026: Phân tích dầu (/dau-xe/phan-tich, nút ở Dầu theo xe, không cần SQL): chọn từ tháng–đến tháng; tab So sánh xe (lít/100 km, vượt định mức, so với TB cùng loại, tiền dầu/km, KM/chuyến), Theo tuyến (ước tính: dầu xe/tháng chia cho chuyến theo km tuyến), Theo tháng (lít/100 km từng xe qua các tháng). src/lib/fuel-analysis.ts, tests/fuel-analysis.test.ts.
