import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CalendarClock, CheckCircle2, ClipboardList, Container } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EntityListSection } from "@/components/entities/entity-list-section";
import { formatNumber, todayVN } from "@/lib/format";
import { toneVar, type Tone } from "@/lib/tones";

export const metadata: Metadata = { title: "Lập kế hoạch" };

type Sum = { status: string; container_qty: number; delivery_date: string | null; ordered_at: string | null };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("dispatch.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const today = todayVN();
  const { data, error } = await supabase
    .from("transport_plans")
    .select("status, container_qty, delivery_date, ordered_at")
    .or(`status.eq.planned,ordered_at.gte.${today}T00:00:00+07:00`)
    .limit(5000);
  if (error) throw error;
  const rows = (data ?? []) as Sum[];
  const planned = rows.filter((r) => r.status === "planned");
  const dueToday = planned.filter((r) => r.delivery_date && r.delivery_date <= today);
  const orderedToday = rows.filter((r) => r.status === "ordered");
  const conts = (xs: Sum[]) => xs.reduce((a, r) => a + Number(r.container_qty ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Lập kế hoạch"
        description="Nhận thông tin từ khách rồi nhập thành kế hoạch. Tích ô ở cột đầu tiên để tạo đơn trong Điều phối: số lượng cont bao nhiêu thì tạo bấy nhiêu đơn, kế hoạch rời khỏi danh sách. Hủy đơn ở Điều phối thì cont trở về đây; muốn bỏ hẳn thì xóa ở đây. Thứ tự chuyến bắt buộc tài xế nhận đúng thứ tự."
        actions={
          <Link href="/dieu-phoi" className="text-sm text-primary hover:underline">
            Mở Điều phối →
          </Link>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 [&>*]:min-w-0">
        <Kpi icon={ClipboardList} tone="amber" label="Kế hoạch chưa tạo đơn" value={planned.length} note={`${formatNumber(conts(planned))} cont`} />
        <Kpi icon={CalendarClock} tone="red" label="Đến ngày giao, chưa tạo đơn" value={dueToday.length} note={`${formatNumber(conts(dueToday))} cont, giao hôm nay hoặc trễ`} />
        <Kpi icon={CheckCircle2} tone="green" label="Đã tạo đơn hôm nay" value={orderedToday.length} note={`${formatNumber(conts(orderedToday))} đơn trong Điều phối`} />
        <Kpi icon={Container} tone="blue" label="Tổng cont chờ" value={conts(planned)} note="Cộng số lượng cont các kế hoạch chưa tạo đơn" />
      </div>
      <EntityListSection entityKey="transport_plans" searchParams={sp} revalidate="/ke-hoach" />
    </>
  );
}

function Kpi({ icon: Icon, tone, label, value, note }: { icon: LucideIcon; tone: Tone; label: string; value: number; note: string }) {
  return (
    <Card className="h-full">
      <CardContent>
        <div className="flex items-start justify-between gap-2">
          <div className="pt-0.5 text-sm text-muted-foreground">{label}</div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm sm:size-10" style={{ background: toneVar(tone) }}>
            <Icon className="size-5" />
          </div>
        </div>
        <div className="-mt-1 text-xl font-bold tabular-nums sm:text-2xl">{formatNumber(value)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{note}</div>
      </CardContent>
    </Card>
  );
}
