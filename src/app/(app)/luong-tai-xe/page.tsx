import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntityListSection } from "@/components/entities/entity-list-section";
import { entityAccess } from "@/lib/entities/access";
import { getEntity } from "@/lib/entities/definitions";
import type { PayrollSettings } from "@/lib/finance/actions";
import { cn } from "@/lib/utils";
import { PayrollSettingsCard } from "./payroll-settings-card";

export const metadata: Metadata = { title: "Lương tài xế" };

type SP = Record<string, string | string[] | undefined>;

const GUIDE = "huong-dan";
const TABS: { key: string; label?: string }[] = [
  { key: GUIDE, label: "Hướng dẫn, thiết lập chung" },
  { key: "trip_pay_rates" },
  { key: "pay_zones" },
  { key: "pay_components" },
  { key: "driver_pay_matrix" },
  { key: "pay_holidays", label: "Ngày nghỉ lễ" },
  { key: "attendance_reasons" },
  { key: "trip_pay_lines" },
  { key: "payrolls", label: "Bảng lương" },
];

/** Gợi ý ngắn trên từng tab để người mới biết phải làm gì */
const HINTS: Record<string, string> = {
  trip_pay_rates:
    "App tìm giá cho mỗi chuyến theo thứ tự: giá riêng tài xế → tuyến Điểm 1 ↔ Điểm 2 (tính cả chiều ngược lại) → một địa điểm → vùng → giá mặc định. Chỉ cần khai các tuyến có giá khác giá mặc định. Để trống Loại cont = cont 20 và 40 cùng giá. Cột % chiều về để trống = theo Thiết lập chung. Nhiều dòng thì bấm Nhập Excel, tải file mẫu (có sheet Ví dụ) rồi nhập.",
  pay_zones: "Nhóm các địa điểm có cùng lương chuyến (ví dụ Bến Tre, Đồng Tháp 1,000,000). Gán vùng cho từng địa điểm ở Khách hàng và địa điểm → Địa điểm.",
  pay_components:
    "Các khoản trên bảng lương. Lương cơ bản và Lương chuyến là khoản có sẵn. Khoản có Mức mặc định áp cho mọi tài xế; muốn mỗi người một mức thì nhập ở tab Mức lương theo tài xế. Bốc xếp, vá vỏ, vệ sinh cont không đặt ở đây: tài xế nhập chi phí trong chuyến, bảng lương tự hoàn.",
  driver_pay_matrix:
    "Mỗi dòng là mức của một khoản cho một tài xế. Nhập nhiều tài xế một lần bằng Nhập Excel (tài xế, khoản lương ghi theo mã như TX001, LCB). Tăng lương thì thêm dòng mới với ngày áp dụng mới. Hình thức lương (cơ bản + chuyến, chỉ chuyến, chỉ tháng) chọn trong hồ sơ tài xế.",
  pay_holidays: "Các ngày nghỉ lễ của công ty. Chuyến chạy ngày lễ được tính khoản Thêm tiền chuyến ngày nghỉ, lễ (nếu khoản đó có mức).",
  attendance_reasons:
    "Các lý do điều phối chọn trên bảng Chấm công tài xế. Thêm lý do mới bằng nút Thêm mới, chọn Tính lương như để bảng lương biết có tính công, có trừ lương cơ bản không. Lý do có sẵn đổi tên được, không xóa.",
  trip_pay_lines:
    "Các chuyến tài xế công ty đã hoàn thành và lương chuyến app tính được. Lọc Chưa có đơn giá để bổ sung giá trước khi lập bảng lương.",
  payrolls: "Lập bảng lương tháng theo các thiết lập ở các tab trước, gửi Giám đốc duyệt, rồi chi trả.",
};

const STEPS: { title: string; tab?: string; href?: string; body: string; example: string }[] = [
  {
    title: "Chọn Hình thức lương cho từng tài xế",
    href: "/tai-xe",
    body: "Mở Tài xế, sửa hồ sơ, chọn Lương cơ bản + chuyến, Chỉ lương chuyến hoặc Chỉ lương tháng. Tài xế mới mặc định Lương cơ bản + chuyến.",
    example: "Anh Nam: Lương cơ bản + chuyến.",
  },
  {
    title: "Khai Vùng lương và gán vùng cho địa điểm",
    tab: "pay_zones",
    body: "Thêm các vùng có lương chuyến khác giá mặc định, rồi mở từng địa điểm giao hàng chọn ô Vùng lương. Bỏ qua bước này nếu chỉ tính theo tuyến.",
    example: "Vùng Bến Tre, Đồng Tháp; địa điểm KCN Giao Long chọn vùng Bến Tre, Đồng Tháp.",
  },
  {
    title: "Nhập Đơn giá lương chuyến",
    tab: "trip_pay_rates",
    body: "Dòng đầu tiên là giá mặc định (để trống Điểm 1, Điểm 2, Vùng). Sau đó bấm Lấy tuyến từ các chuyến để điền giá cho từng tuyến đã chạy, không phải tự nhập tuyến. Thêm giá vùng, địa điểm đặc biệt nếu cần. Chiều về rẻ hơn thì đặt % chiều về. Nhiều tuyến thì dùng Nhập Excel với file mẫu.",
    example: "Mặc định 700,000 · Vùng Bến Tre 1,000,000 · Địa điểm Sân bay TSN 1,150,000 · Tuyến Cát Lái ↔ Kho Hương Lộ 80 là 750,000.",
  },
  {
    title: "Xem lại Khoản lương",
    tab: "pay_components",
    body: "Bật / tắt khoản, đổi tên, đặt Mức mặc định cho khoản ai cũng như nhau. Thưởng vượt chuyến: đặt Mốc số chuyến. Thêm khoản mới bằng nút Thêm mới.",
    example: "Thưởng vượt chuyến: mốc 41; Phụ cấp điện thoại mặc định 200,000.",
  },
  {
    title: "Nhập Mức lương theo tài xế",
    tab: "driver_pay_matrix",
    body: "Mỗi tài xế một dòng cho mỗi khoản có mức riêng: lương cơ bản, tiền ăn mỗi ngày, đi lại, trọ, thưởng mỗi chuyến vượt... Ngày áp dụng để trống = từ trước tới nay.",
    example: "Anh Nam: Lương cơ bản 7,000,000 · Phụ cấp tiền ăn 40,000 mỗi ngày.",
  },
  {
    title: "Đặt Thiết lập chung và Ngày nghỉ lễ",
    tab: "pay_holidays",
    body: "Ở thẻ Thiết lập chung bên dưới chọn có trừ tiền ứng vào lương không và ngày nghỉ trong tuần. Thêm các ngày lễ ở tab Ngày nghỉ lễ. Muốn trả thêm cho chuyến ngày nghỉ thì đặt mức cho khoản Thêm tiền chuyến ngày nghỉ, lễ.",
    example: "Nghỉ Chủ nhật; lễ 01/09 và 02/09.",
  },
  {
    title: "Kiểm tra Bảng kê lương chuyến",
    tab: "trip_pay_lines",
    body: "Lọc Chưa có đơn giá. Chuyến nào chưa có giá thì thêm dòng ở Đơn giá lương chuyến, bảng kê tự cập nhật.",
    example: "Cột Giá lấy từ cho biết giá đến từ tuyến, địa điểm, vùng hay giá mặc định.",
  },
  {
    title: "Xác nhận Chấm công tài xế",
    href: "/cham-cong",
    body: "Ngày nhận hàng của chuyến điều phối đã chỉ định được tự chấm công (chuyến đi xa: nhập Số ngày giao ở Điều phối để cộng đủ ngày), ngày có đơn xin nghỉ đã duyệt tự ghi nghỉ. Xe 3PL không tính. Ngày đã qua mà không có chuyến, không có đơn nghỉ hiện ô vàng: điều phối chọn ô rồi bấm Có đi làm, Nghỉ phép, Nghỉ không lương... Cuối tháng kế toán bấm Chốt công tháng.",
    example: "Anh Nam ngày 15 chờ hàng ở bãi, không có chuyến: chọn ô ngày 15 → Có đi làm, ghi chú Chờ hàng.",
  },
  {
    title: "Lập Bảng lương",
    tab: "payrolls",
    body: "Bấm Thêm mới, chọn tài xế và tháng, xem từng khoản bên phải, nhập thưởng / khấu trừ nếu có, rồi gửi Giám đốc duyệt. Hoặc bấm Lập cho tất cả tài xế.",
    example: "Lương chuyến = tổng đơn giá các chuyến hoàn thành trong tháng; hoàn chi phí bốc xếp, nâng hạ lấy từ chi phí tài xế đã duyệt.",
  },
];

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePagePermission("settlements.view", "settlements.update");
  const sp = await searchParams;
  const allowed = TABS.filter((t) => t.key === GUIDE || entityAccess(getEntity(t.key), me.permissions).view);
  const tabParam = typeof sp.tab === "string" ? sp.tab : undefined;
  const active = allowed.find((t) => t.key === tabParam)?.key ?? GUIDE;
  const label = (k: string) => allowed.find((t) => t.key === k)?.label ?? getEntity(k).label;

  let settings: PayrollSettings | null = null;
  if (active === GUIDE) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("payroll_settings");
    settings = (data as PayrollSettings | null) ?? null;
  }

  return (
    <>
      <PageHeader
        title="Lương tài xế"
        description="Thiết lập đơn giá lương chuyến, phụ cấp và mức lương từng tài xế; app tự tính lương chuyến từ các chuyến đã hoàn thành."
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b">
        {allowed.map((t) => (
          <Link
            key={t.key}
            href={`/luong-tai-xe?tab=${t.key}`}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-4 py-2 text-sm whitespace-nowrap",
              active === t.key ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label(t.key)}
          </Link>
        ))}
      </div>
      {active === GUIDE ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Các bước thiết lập (làm một lần, sau đó chỉ cập nhật khi đổi giá)</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{i + 1}</span>
                    <div className="min-w-0 space-y-1">
                      <div className="font-medium">
                        {s.tab || s.href ? (
                          <Link href={s.href ?? `/luong-tai-xe?tab=${s.tab}`} className="text-primary hover:underline">
                            {s.title}
                          </Link>
                        ) : (
                          s.title
                        )}
                      </div>
                      <p className="text-sm">{s.body}</p>
                      <p className="text-xs text-muted-foreground">Ví dụ: {s.example}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <div className="space-y-4">
            {settings ? <PayrollSettingsCard initial={settings} /> : null}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">App tính lương thế nào</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Chuyến được tính lương khi đã hoàn thành, vào tháng của ngày hoàn thành. Chuyến chiều về = đơn giá × % chiều về.</p>
                <p>Ngày công (tính tiền ăn mỗi ngày...) = số ngày Đi làm trên bảng Chấm công tài xế.</p>
                <p>Nếu bật trừ lương cơ bản: Lương cơ bản × (ngày công chuẩn − ngày nghỉ không lương − ngày nghỉ không báo) ÷ ngày công chuẩn.</p>
                <p>Tổng được nhận = các khoản cộng − các khoản trừ + thưởng − khấu trừ + hoàn chi phí tài xế tự trả đã duyệt.</p>
                <p>Thực nhận = Tổng được nhận − tiền ứng còn dư (nếu bật trừ tiền ứng).</p>
                <p className="text-muted-foreground">Tài xế chưa có mức lương theo khoản nào vẫn được tính như cũ theo các ô lương (cũ) trong hồ sơ tài xế.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <>
          {HINTS[active] ? <p className="mb-3 text-sm text-muted-foreground">{HINTS[active]}</p> : null}
          {active === "trip_pay_rates" ? (
            <div className="mb-3">
              <Link href="/dieu-phoi/tuyen-chua-gia" className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-primary hover:bg-muted">
                Lấy tuyến từ các chuyến (điền giá cho tuyến chưa có giá)
              </Link>
            </div>
          ) : null}
          <EntityListSection key={active} entityKey={active} searchParams={sp} revalidate="/luong-tai-xe" />
        </>
      )}
    </>
  );
}
