"use server";
import ExcelJS from "exceljs";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { addDaysYMD, formatDate, startOfDayVN } from "@/lib/format";
import { dispatchExtraColumns } from "@/lib/dispatch-columns";
import type { ShipmentListRow } from "@/lib/shipments";
import {
  CONTAINER_FIELD_RE,
  CONTAINER_NO_RE,
  DAY_PLAN_ADDRESS,
  DAY_PLAN_COLUMNS,
  DAY_PLAN_TITLE,
  DROPOFF_FIELD_RE,
  PICKUP_FIELD_RE,
  STUFFING_FIELD_RE,
  C20_INDEX,
  contSize,
  dayPlanTotals,
  type DayPlan,
  type DayPlanRow,
} from "@/lib/day-plan";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function buildPlan(date: string): Promise<DayPlan> {
  const me = await requirePermission("dispatch.view");
  const d = dateSchema.parse(date);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipment_list")
    .select("*")
    .gte("pickup_at", startOfDayVN(d))
    .lt("pickup_at", startOfDayVN(addDaysYMD(d, 1)))
    .neq("status", "cancelled")
    .order("pickup_at")
    .order("shipment_code")
    .limit(1000);
  if (error) throw error;
  const list = (data ?? []) as ShipmentListRow[];
  const extras = await dispatchExtraColumns(supabase, me.permissions, list);
  const col = (re: RegExp) => extras.columns.find((c) => re.test(c.label.replace(/\s*\(đơn\)$/, "")))?.key;
  const kindKey = extras.columns.find((c) => c.serviceKind)?.key;
  const contKey = col(CONTAINER_FIELD_RE);
  const pickKey = col(PICKUP_FIELD_RE);
  const stuffKey = col(STUFFING_FIELD_RE);
  const dropKey = col(DROPOFF_FIELD_RE);

  // Số cont nằm trong hàng hóa của chuyến (mã/tên hàng) khi không có trường "Số cont"
  const itemConts: Record<string, string[]> = {};
  if (!contKey && list.length) {
    const { data: items } = await supabase
      .from("shipment_items")
      .select("shipment_id, item_code, item_name, note")
      .in("shipment_id", list.map((r) => r.id))
      .order("line_no");
    for (const it of items ?? []) {
      const found = [it.item_code, it.item_name, it.note].join(" ").toUpperCase().match(CONTAINER_NO_RE) ?? [];
      if (found.length) (itemConts[it.shipment_id] ??= []).push(...found.map((s: string) => s.replace(/\s/g, "")));
    }
  }

  const val = (r: ShipmentListRow, key?: string) => (key ? (extras.values[r.id]?.[key]?.[0] ?? "").trim() : "");
  const sorted = [...list].sort(
    (a, b) =>
      (a.customer_code ?? a.customer_name ?? "").localeCompare(b.customer_code ?? b.customer_name ?? "", "vi") ||
      (a.plate_number ?? "￿").localeCompare(b.plate_number ?? "￿") ||
      (a.vehicle_day_order ?? a.trip_order ?? 99) - (b.vehicle_day_order ?? b.trip_order ?? 99) ||
      a.shipment_code.localeCompare(b.shipment_code),
  );
  const rows: DayPlanRow[] = sorted.map((r, i) => {
    const size = contSize(r.vehicle_type_name);
    const fromNotes = (r.notes ?? "").toUpperCase().match(CONTAINER_NO_RE)?.map((s) => s.replace(/\s/g, "")) ?? [];
    return {
      stt: i + 1,
      date: formatDate(r.pickup_at),
      customer: r.customer_code || r.customer_name || "",
      driver: r.driver_name ?? "",
      plate: r.plate_number ?? "",
      pickup: val(r, pickKey) || r.pickup_name || "",
      stuffing: val(r, stuffKey) || r.delivery_name || "",
      dropoff: val(r, dropKey) || r.empty_return_name || r.offroute_return_name || "",
      c20: size ? (size === 20 ? 1 : 0) : null,
      c40: size ? (size === 40 ? 1 : 0) : null,
      kind: val(r, kindKey).toUpperCase(),
      containerNo: val(r, contKey) || (itemConts[r.id] ?? fromNotes).join(", "),
    };
  });
  return { date: d, rows };
}

/** Dữ liệu kế hoạch xe một ngày (để xem trước và vẽ ảnh) */
export async function loadDayPlan(date: string): Promise<ActionResult<DayPlan>> {
  return runAction(() => buildPlan(date));
}

/** Xuất Excel đúng mẫu "Bảng phân công lịch vận chuyển" */
export async function exportDayPlan(date: string, address: string, title: string): Promise<ActionResult<{ filename: string; base64: string; count: number }>> {
  return runAction(async () => {
    const plan = await buildPlan(date);
    const addr = address.trim().slice(0, 300) || DAY_PLAN_ADDRESS;
    const head = title.trim().slice(0, 300) || DAY_PLAN_TITLE;
    const n = DAY_PLAN_COLUMNS.length;
    const wb = new ExcelJS.Workbook();
    wb.creator = "KHÁNH HÀ TMS";
    const ws = wb.addWorksheet("Kế hoạch", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    ws.columns = DAY_PLAN_COLUMNS.map((c) => ({ width: c.xl }));
    const font = { name: "Arial", size: 11 };
    const thin = { style: "thin" as const, color: { argb: "FF000000" } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    const center = { vertical: "middle" as const, horizontal: "center" as const, wrapText: true };

    ws.mergeCells(1, 1, 1, n);
    Object.assign(ws.getCell(1, 1), { value: addr, font: { ...font, bold: true }, alignment: center });
    ws.mergeCells(2, 1, 2, n);
    Object.assign(ws.getCell(2, 1), { value: head, font: { ...font, size: 16, bold: true }, alignment: center });
    ws.getRow(2).height = 28;
    ws.mergeCells(3, 1, 3, n);
    Object.assign(ws.getCell(3, 1), { value: `Ngày ${formatDate(plan.date)}`, font: { ...font, italic: true }, alignment: center });

    // Tiêu đề 2 dòng: nhóm "Tuyến vận tải", "Cont" gộp ngang; các cột khác gộp dọc
    const h1 = 5;
    const h2 = 6;
    DAY_PLAN_COLUMNS.forEach((c, i) => {
      const col = i + 1;
      if (!c.group) {
        ws.mergeCells(h1, col, h2, col);
        ws.getCell(h1, col).value = c.label;
      } else {
        ws.getCell(h2, col).value = c.label;
        if (DAY_PLAN_COLUMNS[i - 1]?.group !== c.group) {
          const span = DAY_PLAN_COLUMNS.slice(i).findIndex((x) => x.group !== c.group);
          const end = span === -1 ? n : i + span;
          ws.mergeCells(h1, col, h1, end);
          ws.getCell(h1, col).value = c.group;
        }
      }
    });
    for (const r of [h1, h2]) {
      ws.getRow(r).height = r === h1 ? 26 : 30;
      for (let c = 1; c <= n; c++) {
        const cell = ws.getCell(r, c);
        cell.font = { ...font, bold: true };
        cell.alignment = center;
        cell.border = border;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF95B3D7" } };
      }
    }
    plan.rows.forEach((row, i) => {
      const xr = ws.getRow(h2 + 1 + i);
      DAY_PLAN_COLUMNS.forEach((c, j) => {
        const cell = xr.getCell(j + 1);
        cell.value = row[c.key] ?? "";
        cell.font = font;
        cell.alignment = center;
        cell.border = border;
      });
      xr.height = 22;
    });
    // Dòng tổng: "Tổng" từng loại cont, "TOTAL" = cont 20 + cont 40 (gộp ô dưới hai cột)
    const sum = dayPlanTotals(plan.rows);
    const c20 = C20_INDEX + 1;
    const fr = h2 + 1 + plan.rows.length;
    ws.mergeCells(fr, 1, fr, c20 - 1);
    ws.mergeCells(fr + 1, 1, fr + 1, c20 - 1);
    ws.mergeCells(fr + 1, c20, fr + 1, c20 + 1);
    if (c20 + 2 <= n) {
      ws.mergeCells(fr, c20 + 2, fr, n);
      ws.mergeCells(fr + 1, c20 + 2, fr + 1, n);
    }
    ws.getCell(fr, 1).value = "Tổng";
    ws.getCell(fr, c20).value = sum.c20;
    ws.getCell(fr, c20 + 1).value = sum.c40;
    ws.getCell(fr + 1, 1).value = "TOTAL";
    ws.getCell(fr + 1, c20).value = sum.total;
    for (const r of [fr, fr + 1]) {
      ws.getRow(r).height = 22;
      for (let c = 1; c <= n; c++) {
        const cell = ws.getCell(r, c);
        cell.font = { ...font, bold: true };
        cell.alignment = center;
        cell.border = border;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F1" } };
      }
    }
    ws.views = [{ state: "frozen", ySplit: h2 }];
    const buf = await wb.xlsx.writeBuffer();
    return {
      filename: `ke-hoach-xe_${plan.date}.xlsx`,
      base64: Buffer.from(buf as ArrayBuffer).toString("base64"),
      count: plan.rows.length,
    };
  });
}
