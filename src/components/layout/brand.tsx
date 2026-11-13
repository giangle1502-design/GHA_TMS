import { Truck } from "lucide-react";

export function Brand() {
  return (
    <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
      <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-tone-amber to-[oklch(0.68_0.19_45)] text-white shadow-sm">
        <Truck className="size-5" />
      </div>
      <div className="leading-tight">
        <div className="text-base font-bold tracking-wide text-white">KHÁNH HÀ TMS</div>
        <div className="text-[11px] text-sidebar-muted">Quản lý vận tải</div>
      </div>
    </div>
  );
}
