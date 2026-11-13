import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

/** Màn hình chưa triển khai: ghi rõ trạng thái, không giả lập dữ liệu. */
export function ComingSoon({ title, phase, items }: { title: string; phase: number; items: string[] }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning/15 text-[oklch(0.5_0.12_70)]">
            <Construction className="size-6" />
          </div>
          <div>
            <p className="font-medium">Chưa triển khai – sẽ hoàn thiện ở Giai đoạn {phase}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cấu trúc dữ liệu và phân quyền cho chức năng này đã có trong cơ sở dữ liệu. Màn hình sẽ gồm:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
