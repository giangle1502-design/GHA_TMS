"use server";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, toUserMessage, type ActionResult } from "@/lib/auth/action";
import { addDaysYMD, startOfDayVN, todayVN } from "@/lib/format";
import { compactUpper, moduleCustomFields, splitCustom, validateRecord } from "@/lib/entities/record";
import { loadCustomFields, visibleCustomRows } from "@/lib/entities/server";
import type { FieldDef } from "@/lib/entities/types";
import {
  CORE_COLUMNS,
  UNIT_LABELS,
  cellToRaw,
  groupKey,
  isBlankRow,
  looseKey,
  mapHeaders,
  normalizePlate,
  parseDateVN,
  parseNum,
  parseStatus,
  parseUnit,
  str,
  type ImportColumn,
  type ImportRaw,
  type ImportStatus,
} from "@/lib/import-trips";

const MAX_ROWS = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SHEET = "Nhập chuyến";

type Supa = Awaited<ReturnType<typeof createClient>>;
type Named = { id: string; code: string | null; name: string };
type Vehicle = { id: string; plate_number: string; vehicle_type_id: string | null; assigned_driver_id: string | null; ownership_type: string | null; status: string; archived_at: string | null };
type Driver = { id: string; code: string | null; full_name: string; phone: string | null; status: string; archived_at: string | null };
type FeeCol = { id: string; name: string; groupName: string | null; declaration: boolean };

type Ctx = {
  customers: (Named & { status: string })[];
  locations: (Named & { status: string })[];
  vehicleTypes: Named[];
  vehicles: Vehicle[];
  drivers: Driver[];
  fees: FeeCol[];
  declarations: Named[] | null;
  customFields: FieldDef[];
  columns: ImportColumn[];
};

/** Danh mục cần tra cứu + cột của file mẫu (cột phí theo loại phí đang dùng, xếp theo nhóm phí nếu có) */
async function loadContext(supabase: Supa, perms: Set<string>): Promise<Ctx> {
  const [cus, loc, vt, veh, drv, ft, fg, dt, cf] = await Promise.all([
    supabase.from("customers").select("id, code, name, status").limit(10000),
    supabase.from("locations").select("id, code, name, status").limit(10000),
    supabase.from("vehicle_types").select("id, code, name").limit(1000),
    supabase.from("vehicles").select("id, plate_number, vehicle_type_id, assigned_driver_id, ownership_type, status, archived_at").limit(5000),
    supabase.from("drivers").select("id, code, full_name, phone, status, archived_at").limit(5000),
    supabase.from("fee_types").select("*").eq("is_active", true).order("sort_order").order("name"),
    // Nhóm phí và loại tờ khai có từ bản nâng cấp "Nhóm phí"; chưa có thì bỏ qua
    supabase.from("fee_groups").select("id, name, report_role, sort_order").eq("is_active", true),
    supabase.from("declaration_types").select("id, code, name").eq("is_active", true).order("sort_order"),
    loadCustomFields(supabase, "shipments"),
  ]);
  for (const r of [cus, loc, vt, veh, drv, ft]) if (r.error) throw r.error;
  const groups = new Map((fg.error ? [] : (fg.data ?? [])).map((g) => [g.id as string, g as { id: string; name: string; report_role: string; sort_order: number }]));
  const fees: FeeCol[] = ((ft.data ?? []) as { id: string; name: string; sort_order: number; fee_group_id?: string | null }[])
    .map((f, i) => ({ f, i, g: f.fee_group_id ? groups.get(f.fee_group_id) : undefined }))
    .sort((a, b) => (a.g?.sort_order ?? 9999) - (b.g?.sort_order ?? 9999) || a.i - b.i)
    .map(({ f, g }) => ({ id: f.id, name: f.name, groupName: g?.name ?? null, declaration: g?.report_role === "declaration" }));
  const declarations = dt.error ? null : ((dt.data ?? []) as Named[]);

  const customFields = moduleCustomFields("shipments", visibleCustomRows(cf, perms), perms).filter(
    (f) => !f.readOnly && !f.hideInForm && !["formula", "file", "reference"].includes(f.type),
  );
  const taken = new Set(CORE_COLUMNS.map((c) => c.header.toLowerCase()));
  const columns: ImportColumn[] = [
    ...CORE_COLUMNS.map((c) => ({ ...c, kind: "core" as const })),
    ...customFields.map((f) => {
      const header = taken.has(f.label.toLowerCase()) ? `${f.label} (trường bổ sung)` : f.label;
      taken.add(header.toLowerCase());
      const opts = f.options?.map((o) => o.label).filter(Boolean);
      return {
        key: `cf:${f.key}`,
        header,
        required: f.required,
        hint: [f.help, opts?.length ? `Chọn: ${opts.join(", ")}` : "", f.type === "date" ? "dd/mm/yyyy" : "", f.type === "boolean" ? "x = có" : ""].filter(Boolean).join(". ") || "Trường bổ sung của chuyến.",
        example: "",
        width: 16,
        list: f.type === "select" && opts && opts.join(",").length < 250 ? opts : undefined,
        money: f.type === "currency",
        kind: "custom" as const,
      };
    }),
    ...(declarations?.length && fees.some((f) => f.declaration)
      ? [{ key: "loai_to_khai", header: "Loại tờ khai", hint: `Cho phí tờ khai: ${declarations.map((d) => d.name).join(", ")}`, example: "", width: 12, list: declarations.map((d) => d.name), kind: "fee" as const }]
      : []),
    ...fees.map((f) => ({
      key: `fee:${f.id}`,
      header: `${f.groupName ?? "Phí"} - ${f.name}`,
      hint: `Số tiền phí "${f.name}"${f.groupName ? ` (nhóm ${f.groupName})` : ""}. Để trống = không có.`,
      example: "",
      width: 14,
      money: true,
      kind: "fee" as const,
      aliases: [f.name],
    })),
  ];
  return {
    customers: (cus.data ?? []) as Ctx["customers"],
    locations: (loc.data ?? []) as Ctx["locations"],
    vehicleTypes: (vt.data ?? []) as Named[],
    vehicles: (veh.data ?? []) as Vehicle[],
    drivers: (drv.data ?? []) as Driver[],
    fees,
    declarations,
    customFields,
    columns,
  };
}

export type FileResult = { filename: string; base64: string };

/** File Excel mẫu: sheet nhập liệu (danh sách chọn), hướng dẫn, danh mục tra cứu */
export async function downloadImportTemplate(): Promise<ActionResult<FileResult>> {
  return runAction(async () => {
    const me = await requirePermission("dispatch.create");
    const supabase = await createClient();
    const ctx = await loadContext(supabase, me.permissions);
    const wb = new ExcelJS.Workbook();
    wb.creator = "KHÁNH HÀ TMS";
    const ws = wb.addWorksheet(SHEET);
    const guide = wb.addWorksheet("Hướng dẫn");
    const lists = wb.addWorksheet("Danh mục");

    ws.columns = ctx.columns.map((c) => ({ header: `${c.header}${c.required ? " *" : ""}`, key: c.key, width: c.width }));
    const fill: Record<string, string> = { core: "FF1E3A5F", custom: "FF4B5563", fee: "FF0F766E" };
    ctx.columns.forEach((c, i) => {
      const cell = ws.getRow(1).getCell(i + 1);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? "FFB45309" : fill[c.kind ?? "core"] } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.note = c.hint;
      const col = ws.getColumn(i + 1);
      if (c.money) col.numFmt = "#,##0";
      if (["ngay_don", "ngay_nhan", "ngay_giao", "ngay_hoan_thanh"].includes(c.key)) col.numFmt = "dd/mm/yyyy";
    });
    ws.getRow(1).height = 32;
    ws.views = [{ state: "frozen", ySplit: 1 }];

    // Sheet danh mục: để chọn nhanh trong ô (vẫn gõ tự do được)
    const catalog: { title: string; key: string; values: string[] }[] = [
      { title: "Mã khách hàng", key: "ma_kh", values: ctx.customers.filter((c) => c.status === "active").map((c) => c.code || c.name) },
      { title: "Tên khách hàng", key: "", values: ctx.customers.filter((c) => c.status === "active").map((c) => c.name) },
      { title: "Địa điểm", key: "diem", values: ctx.locations.filter((l) => l.status === "active").map((l) => l.name) },
      { title: "Mã địa điểm", key: "", values: ctx.locations.filter((l) => l.status === "active").map((l) => l.code ?? "") },
      { title: "Biển số xe", key: "bien_so", values: ctx.vehicles.filter((v) => !v.archived_at).map((v) => compactUpper(v.plate_number)) },
      { title: "Tài xế", key: "tai_xe", values: ctx.drivers.filter((d) => !d.archived_at).map((d) => d.full_name) },
      { title: "Mã tài xế", key: "", values: ctx.drivers.filter((d) => !d.archived_at).map((d) => d.code ?? "") },
      { title: "Loại xe", key: "loai_xe", values: ctx.vehicleTypes.map((t) => t.name) },
    ];
    lists.columns = catalog.map((c) => ({ header: c.title, width: 24 }));
    catalog.forEach((c, i) => c.values.forEach((v, j) => (lists.getRow(j + 2).getCell(i + 1).value = v)));
    lists.getRow(1).font = { bold: true };
    lists.views = [{ state: "frozen", ySplit: 1 }];

    const letter = (n: number) => ws.getColumn(n).letter;
    // exceljs có dataValidations theo vùng nhưng bộ khai báo kiểu chưa có
    const dv = (ws as unknown as { dataValidations: { add: (range: string, v: ExcelJS.DataValidation) => void } }).dataValidations;
    const LAST = MAX_ROWS + 1;
    ctx.columns.forEach((c, i) => {
      const range = `${letter(i + 1)}2:${letter(i + 1)}${LAST}`;
      if (c.list?.length) {
        dv.add(range, { type: "list", allowBlank: true, formulae: [`"${c.list.join(",")}"`], showErrorMessage: true, errorStyle: "warning", error: "Giá trị không có trong danh sách" });
        return;
      }
      const src = catalog.findIndex((x) => x.key && (x.key === c.key || (x.key === "diem" && ["diem_nhan", "diem_giao"].includes(c.key)) || (x.key === "ma_kh" && c.key === "ma_kh_tt")));
      if (src >= 0 && catalog[src].values.length) {
        const L = lists.getColumn(src + 1).letter;
        dv.add(range, { type: "list", allowBlank: true, formulae: [`'Danh mục'!$${L}$2:$${L}$${catalog[src].values.length + 1}`], showErrorMessage: false });
      }
    });

    guide.columns = [
      { header: "Cột", key: "h", width: 30 },
      { header: "Bắt buộc", key: "r", width: 10 },
      { header: "Cách nhập", key: "d", width: 90 },
      { header: "Ví dụ", key: "e", width: 18 },
    ];
    guide.addRow({ h: "MỖI DÒNG = MỘT CHUYẾN", d: "Nhập ở sheet \"Nhập chuyến\" từ dòng 2. Không đổi tên tiêu đề cột. Muốn một đơn nhiều chuyến: ghi cùng giá trị ở cột Gộp đơn." });
    guide.addRow({ h: "Chuyến cũ đã chạy xong", d: "Chọn Trạng thái = Đã hoàn thành: không gửi Giám đốc duyệt, không báo tài xế, chứng từ để \"Thiếu\" để bổ sung sau." });
    guide.addRow({ h: "Chuyến sắp chạy", d: "Đã phân công: chuyến chờ Giám đốc duyệt như khi tạo tay. Chờ phân công: chưa giao xe/tài xế." });
    guide.addRow({ h: "Số tiền", d: "Dấu phẩy là phân cách hàng nghìn (1,200,000), dấu chấm là số lẻ. Ô định dạng số trong Excel cũng được." });
    guide.addRow({});
    for (const c of ctx.columns) guide.addRow({ h: c.header, r: c.required ? "Có" : "", d: c.hint, e: c.example });
    guide.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    guide.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    guide.getColumn(3).alignment = { wrapText: true, vertical: "top" };

    const buf = await wb.xlsx.writeBuffer();
    return { filename: `mau-nhap-chuyen-${todayVN()}.xlsx`, base64: Buffer.from(buf as ArrayBuffer).toString("base64") };
  });
}

// ---------------------------------------------------------------------------
// Kiểm tra từng dòng
// ---------------------------------------------------------------------------

export type ImportSourceRow = { rowNo: number; raw: ImportRaw };

export type PreviewRow = {
  rowNo: number;
  group: string;
  status: ImportStatus;
  errors: string[];
  warnings: string[];
  /** Giá trị đã tra cứu để hiển thị */
  show: { customer: string; pickupDate: string; route: string; vehicle: string; driver: string; price: string; fees: string };
};

export type ImportPreview = {
  fileName: string;
  rows: PreviewRow[];
  source: ImportSourceRow[];
  unknownHeaders: string[];
  missingHeaders: string[];
  newLocations: string[];
  orderCount: number;
};

type Payload = { order: Record<string, unknown>; shipment: Record<string, unknown> };

function finder<T extends { id: string }>(list: T[], keys: (x: T) => (string | null | undefined)[]) {
  const m = new Map<string, T[]>();
  for (const x of list)
    for (const k of new Set(keys(x).filter(Boolean).map((v) => looseKey(String(v))))) {
      const arr = m.get(k) ?? [];
      arr.push(x);
      m.set(k, arr);
    }
  return (v: string) => m.get(looseKey(v)) ?? [];
}

const fmtMoney = (n: number) => n.toLocaleString("en-US");
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const vnMidnight = (ymd: string) => `${ymd}T00:00:00+07:00`;

function resolveRows(ctx: Ctx, source: ImportSourceRow[], createLocations: boolean) {
  const byCustomer = finder(ctx.customers, (c) => [c.code]);
  const byCustomerName = finder(ctx.customers, (c) => [c.name]);
  const byLocation = finder(ctx.locations, (l) => [l.code, l.name]);
  const byType = finder(ctx.vehicleTypes, (t) => [t.code, t.name]);
  const byPlate = new Map(ctx.vehicles.map((v) => [compactUpper(v.plate_number), v]));
  const byDriverCode = finder(ctx.drivers, (d) => [d.code, d.phone?.replace(/\D/g, "")]);
  const byDriverName = finder(ctx.drivers.filter((d) => !d.archived_at), (d) => [d.full_name]);
  const byDecl = ctx.declarations ? finder(ctx.declarations, (d) => [d.code, d.name]) : null;
  const driverById = new Map(ctx.drivers.map((d) => [d.id, d]));
  const typeById = new Map(ctx.vehicleTypes.map((t) => [t.id, t]));
  const newLocations = new Map<string, string>();
  const rows: PreviewRow[] = [];
  const payloads = new Map<number, Payload>();

  for (const { rowNo, raw } of source) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const need = (key: string, label: string) => {
      if (!str(raw[key])) errors.push(`Thiếu ${label}`);
      return str(raw[key]);
    };

    // Khách hàng: theo mã, không có thì theo đúng tên
    const pickCustomer = (v: string, label: string) => {
      if (!v) return null;
      const hit = byCustomer(v).length ? byCustomer(v) : byCustomerName(v);
      if (!hit.length) errors.push(`Không tìm thấy ${label} "${v}" (ghi đúng mã khách hàng trong Danh mục)`);
      else if (hit.length > 1) errors.push(`Có ${hit.length} khách hàng trùng "${v}", ghi mã khách hàng`);
      else {
        if (hit[0].status !== "active") warnings.push(`${label} "${v}" đang ngừng hoạt động`);
        return hit[0];
      }
      return null;
    };
    const customer = pickCustomer(need("ma_kh", "Mã khách hàng"), "khách hàng");
    const payer = pickCustomer(str(raw.ma_kh_tt), "khách thanh toán");

    const date = (key: string, label: string, required = false) => {
      const d = parseDateVN(raw[key]);
      if (d === "invalid") errors.push(`${label} "${str(raw[key])}" không đúng dạng dd/mm/yyyy`);
      else if (!d && required) errors.push(`Thiếu ${label}`);
      return d === "invalid" ? null : d;
    };
    const pickup = date("ngay_nhan", "Ngày nhận hàng", true);
    const delivery = date("ngay_giao", "Ngày giao dự kiến");
    const orderDate = date("ngay_don", "Ngày đơn hàng");
    const doneDate = date("ngay_hoan_thanh", "Ngày hoàn thành");
    if (pickup && delivery && delivery < pickup) errors.push("Ngày giao dự kiến trước ngày nhận hàng");

    const pickLocation = (key: string, label: string) => {
      const v = need(key, label);
      if (!v) return null;
      const hit = byLocation(v);
      if (hit.length === 1) return hit[0].id;
      if (hit.length > 1) {
        errors.push(`Có ${hit.length} địa điểm trùng tên "${v}", ghi mã địa điểm`);
        return null;
      }
      if (createLocations) {
        newLocations.set(looseKey(v), v);
        warnings.push(`Sẽ tạo địa điểm mới "${v}"`);
        return `new:${looseKey(v)}`;
      }
      errors.push(`Chưa có địa điểm "${v}" trong Danh mục (bật "Tạo địa điểm mới" hoặc sửa tên cho đúng)`);
      return null;
    };
    const pickupLoc = pickLocation("diem_nhan", "Điểm nhận");
    const deliveryLoc = pickLocation("diem_giao", "Điểm giao");
    if (pickupLoc && pickupLoc === deliveryLoc) errors.push("Điểm nhận và điểm giao trùng nhau");

    let vehicleTypeId: string | null = null;
    if (str(raw.loai_xe)) {
      const hit = byType(str(raw.loai_xe));
      if (hit.length !== 1) errors.push(`Không tìm thấy loại xe "${str(raw.loai_xe)}"`);
      else vehicleTypeId = hit[0].id;
    }

    let vehicle: Vehicle | null = null;
    const plate = normalizePlate(raw.bien_so);
    if (plate) {
      vehicle = byPlate.get(plate) ?? null;
      if (!vehicle) errors.push(`Không tìm thấy xe biển số ${plate}`);
      else if (vehicle.archived_at) errors.push(`Xe ${plate} đã lưu trữ`);
      else vehicleTypeId ??= vehicle.vehicle_type_id;
    }

    let status = parseStatus(raw.trang_thai);
    if (status === "invalid") {
      errors.push(`Trạng thái "${str(raw.trang_thai)}" không hợp lệ (Chờ phân công, Đã phân công, Đã hoàn thành)`);
      status = null;
    }

    let driver: Driver | null = null;
    const dv = str(raw.tai_xe);
    if (dv) {
      const byCode = byDriverCode(dv.replace(/^\+?84/, "0").replace(/[\s.-]/g, "")).concat(byDriverCode(dv));
      const hit = [...new Map((byCode.length ? byCode : byDriverName(dv)).map((d) => [d.id, d])).values()];
      if (!hit.length) errors.push(`Không tìm thấy tài xế "${dv}" (ghi mã, số điện thoại hoặc họ tên)`);
      else if (hit.length > 1) errors.push(`Có ${hit.length} tài xế tên "${dv}", ghi mã tài xế`);
      else if (hit[0].archived_at) errors.push(`Tài xế "${dv}" đã lưu trữ`);
      else driver = hit[0];
    } else if (vehicle?.assigned_driver_id && status !== "draft") {
      driver = driverById.get(vehicle.assigned_driver_id) ?? null;
      if (driver?.archived_at) driver = null;
      if (driver) warnings.push(`Lấy tài xế phụ trách xe: ${driver.full_name}`);
    }

    const st: ImportStatus = status ?? (driver ? "assigned" : "draft");
    if (st === "draft" && driver) {
      if (dv) warnings.push("Chờ phân công: bỏ qua tài xế");
      driver = null;
    }
    if (st === "assigned") {
      if (!driver) errors.push('Trạng thái "Đã phân công" cần có tài xế');
      else if (driver.status !== "active") errors.push(`Tài xế ${driver.full_name} không ở trạng thái đang làm việc`);
      if (vehicle && !["active", "maintenance"].includes(vehicle.status)) errors.push(`Xe ${plate} đang ngừng hoạt động`);
    }
    if (st === "completed") {
      if (!driver && !vehicle) errors.push('Chuyến "Đã hoàn thành" cần có biển số xe hoặc tài xế');
      if (pickup && pickup > todayVN()) warnings.push("Đã hoàn thành nhưng ngày nhận hàng ở tương lai");
      if (doneDate && pickup && doneDate < pickup) errors.push("Ngày hoàn thành trước ngày nhận hàng");
    } else if (doneDate) warnings.push("Ngày hoàn thành chỉ dùng cho chuyến Đã hoàn thành");

    const num = (key: string, label: string, opts: { currency?: boolean; min?: number; max?: number; positive?: boolean } = {}) => {
      const n = parseNum(raw[key], opts.currency);
      if (n === "invalid") errors.push(`${label} "${str(raw[key])}" không phải số`);
      else if (n !== null && ((opts.positive && n <= 0) || (opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)))
        errors.push(`${label} ${n} nằm ngoài giới hạn`);
      else return n;
      return null;
    };
    const quantity = num("so_luong", "Số lượng", { positive: true, max: 1_000_000 });
    const unitPrice = num("don_gia", "Đơn giá", { currency: true, min: 0, max: 100_000_000_000 });
    const surcharge = num("phu_phi", "Phụ phí", { currency: true, min: 0, max: 100_000_000_000 });
    const fuelRate = num("ho_tro_dau", "Hỗ trợ dầu (%)", { min: 0, max: 100 });
    let unit = parseUnit(raw.don_vi);
    if (unit === "invalid") {
      errors.push(`Đơn vị tính "${str(raw.don_vi)}" không hợp lệ (Chuyến, Km, Tấn)`);
      unit = null;
    }
    const notes = str(raw.ghi_chu);
    if (notes.length > 1000) errors.push("Ghi chú quá 1000 ký tự");

    // Trường bổ sung: chữ hiển thị của danh sách chọn → giá trị
    const cfRaw: Record<string, unknown> = {};
    for (const f of ctx.customFields) {
      let v: unknown = raw[`cf:${f.key}`] ?? null;
      if (v !== null && f.options?.length) {
        const pick = (s: string) => f.options!.find((o) => looseKey(o.value) === looseKey(s) || looseKey(o.label) === looseKey(s))?.value ?? s;
        v = f.type === "multiselect" ? String(v).split(/[,;]/).map((x) => pick(x.trim())) : pick(String(v));
      }
      if (v !== null && f.type === "date") v = parseDateVN(v as string) ?? v;
      cfRaw[f.key] = v;
    }
    const cf = validateRecord(ctx.customFields, cfRaw);
    errors.push(...Object.values(cf.errors));
    const custom = splitCustom(ctx.customFields, cf.data).custom;

    // Phí thu khách
    let declId: string | null = null;
    if (byDecl && str(raw.loai_to_khai)) {
      const hit = byDecl(str(raw.loai_to_khai));
      if (hit.length !== 1) errors.push(`Không tìm thấy loại tờ khai "${str(raw.loai_to_khai)}"`);
      else declId = hit[0].id;
    }
    const fees: { fee_type_id: string; amount: number; note: string; declaration_type_id?: string }[] = [];
    for (const f of ctx.fees) {
      const a = num(`fee:${f.id}`, f.name, { currency: true, min: 0, max: 100_000_000_000 });
      if (a === null || a === 0) continue;
      fees.push({ fee_type_id: f.id, amount: a, note: "", ...(f.declaration && declId ? { declaration_type_id: declId } : {}) });
    }

    const group = groupKey(raw, rowNo);
    const vt = vehicleTypeId ? typeById.get(vehicleTypeId) : null;
    rows.push({
      rowNo,
      group,
      status: st,
      errors,
      warnings,
      show: {
        customer: customer ? `${customer.code ? `${customer.code} · ` : ""}${customer.name}` : str(raw.ma_kh),
        pickupDate: pickup ? dmy(pickup) : str(raw.ngay_nhan),
        route: `${str(raw.diem_nhan)} → ${str(raw.diem_giao)}`,
        vehicle: [plate, vt?.name].filter(Boolean).join(" · "),
        driver: driver?.full_name ?? "",
        price:
          unitPrice !== null
            ? `${fmtMoney(unitPrice)} × ${quantity ?? 1} ${UNIT_LABELS[unit ?? "trip"].toLowerCase()}`
            : "Theo bảng giá",
        fees: fees.map((f) => `${ctx.fees.find((x) => x.id === f.fee_type_id)?.name}: ${fmtMoney(f.amount)}`).join("; "),
      },
    });
    if (errors.length) continue;
    payloads.set(rowNo, {
      order: {
        customer_id: customer!.id,
        payer_customer_id: payer?.id ?? "",
        order_date: orderDate ?? pickup,
        notes: "Nhập từ Excel",
      },
      shipment: {
        pickup_at: vnMidnight(pickup!),
        expected_delivery_at: delivery ? vnMidnight(delivery) : "",
        pickup_location_id: pickupLoc,
        delivery_location_id: deliveryLoc,
        vehicle_type_id: vehicleTypeId ?? "",
        vehicle_id: vehicle?.id ?? "",
        driver_id: driver?.id ?? "",
        unit_price: unitPrice ?? "",
        pricing_unit: unit ?? "",
        quantity: quantity ?? "",
        surcharge_amount: surcharge ?? "",
        fuel_support_rate: fuelRate ?? "",
        notes,
        custom_fields: custom,
        fees,
        import_status: st,
        completed_at: st === "completed" ? vnMidnight(doneDate ?? delivery ?? pickup!) : "",
      },
    });
  }

  // Trùng trong file
  const seen = new Map<string, number>();
  for (const r of rows) {
    const p = payloads.get(r.rowNo)?.shipment;
    if (!p) continue;
    const k = [payloads.get(r.rowNo)!.order.customer_id, p.pickup_at, p.pickup_location_id, p.delivery_location_id, p.vehicle_id].join("|");
    if (p.vehicle_id && seen.has(k)) r.warnings.push(`Giống dòng ${seen.get(k)} (cùng khách, ngày, tuyến, xe)`);
    else seen.set(k, r.rowNo);
  }
  return { rows, payloads, newLocations: [...newLocations.values()] };
}

/** Cảnh báo chuyến có thể đã có trong phần mềm (cùng khách, ngày nhận, tuyến, xe) */
async function markExisting(supabase: Supa, rows: PreviewRow[], payloads: Map<number, Payload>) {
  const ps = [...payloads.entries()].filter(([, p]) => p.shipment.vehicle_id);
  if (!ps.length) return;
  const dates = ps.map(([, p]) => String(p.shipment.pickup_at).slice(0, 10)).sort();
  const vehicleIds = [...new Set(ps.map(([, p]) => String(p.shipment.vehicle_id)))];
  const { data } = await supabase
    .from("shipment_list")
    .select("shipment_code, customer_id, pickup_at, pickup_location_id, delivery_location_id, vehicle_id")
    .gte("pickup_at", startOfDayVN(dates[0]))
    .lt("pickup_at", startOfDayVN(addDaysYMD(dates[dates.length - 1], 1)))
    .in("vehicle_id", vehicleIds.slice(0, 300))
    .neq("status", "cancelled")
    .limit(5000);
  const ex = new Map<string, string>();
  for (const s of (data ?? []) as Record<string, string>[]) {
    const day = new Date(Date.parse(s.pickup_at) + 7 * 3600000).toISOString().slice(0, 10);
    ex.set([s.customer_id, day, s.pickup_location_id, s.delivery_location_id, s.vehicle_id].join("|"), s.shipment_code);
  }
  for (const r of rows) {
    const p = payloads.get(r.rowNo);
    if (!p?.shipment.vehicle_id) continue;
    const code = ex.get([p.order.customer_id, String(p.shipment.pickup_at).slice(0, 10), p.shipment.pickup_location_id, p.shipment.delivery_location_id, p.shipment.vehicle_id].join("|"));
    if (code) r.warnings.push(`Có thể đã nhập rồi: chuyến ${code} cùng khách, ngày, tuyến, xe`);
  }
}

function countOrders(rows: PreviewRow[]) {
  return new Set(rows.filter((r) => !r.errors.length).map((r) => r.group)).size;
}

async function readSource(file: File, columns: ImportColumn[]) {
  if (!file || typeof file === "string" || file.size === 0) throw new ActionError("Vui lòng chọn tệp Excel.");
  if (file.size > MAX_FILE_BYTES) throw new ActionError("Tệp quá lớn (tối đa 2 MB). Chia nhỏ tệp rồi nhập nhiều lần.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new ActionError("Chỉ nhận tệp .xlsx (Excel). Tệp .xls cũ: mở bằng Excel rồi Lưu thành .xlsx.");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
  } catch {
    throw new ActionError("Không đọc được tệp Excel. Kiểm tra tệp không bị khóa mật khẩu và đúng định dạng .xlsx.");
  }
  const ws = wb.getWorksheet(SHEET) ?? wb.worksheets.find((w) => w.state === "visible") ?? wb.worksheets[0];
  if (!ws) throw new ActionError("Tệp Excel không có sheet nào.");
  // Dòng tiêu đề: dòng đầu tiên (trong 10 dòng) có đủ cột bắt buộc nhiều nhất
  let best = { row: 0, score: -1, map: new Map<number, string>(), unknown: [] as string[], missing: [] as string[] };
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const headers: string[] = [];
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell, col) => (headers[col - 1] = str(cellToRaw(cell.value))));
    const m = mapHeaders(headers, columns);
    if (m.map.size > best.score) best = { row: r, score: m.map.size, ...m };
  }
  if (best.score < 3) throw new ActionError(`Không thấy dòng tiêu đề. Dùng file mẫu (sheet "${SHEET}") và giữ nguyên tên cột.`);
  const source: ImportSourceRow[] = [];
  for (let r = best.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: ImportRaw = {};
    for (const [i, key] of best.map) raw[key] = cellToRaw(row.getCell(i + 1).value);
    if (isBlankRow(raw)) continue;
    if (source.length >= MAX_ROWS) throw new ActionError(`Tệp có hơn ${MAX_ROWS} dòng. Chia nhỏ tệp rồi nhập nhiều lần.`);
    source.push({ rowNo: r, raw });
  }
  if (!source.length) throw new ActionError("Tệp chưa có dòng dữ liệu nào dưới dòng tiêu đề.");
  return { source, unknown: best.unknown, missing: best.missing };
}

/** Đọc tệp, kiểm tra từng dòng; chưa ghi gì vào CSDL */
export async function previewImport(fd: FormData): Promise<ActionResult<ImportPreview>> {
  return runAction(async () => {
    const me = await requirePermission("dispatch.create");
    const supabase = await createClient();
    const ctx = await loadContext(supabase, me.permissions);
    const file = fd.get("file") as File;
    const { source, unknown, missing } = await readSource(file, ctx.columns);
    const { rows, payloads, newLocations } = resolveRows(ctx, source, fd.get("createLocations") === "1");
    await markExisting(supabase, rows, payloads);
    return { fileName: file.name, rows, source, unknownHeaders: unknown, missingHeaders: missing, newLocations, orderCount: countOrders(rows) };
  });
}

/** Kiểm tra lại với tùy chọn mới (bật/tắt tạo địa điểm) mà không tải lại tệp */
export async function recheckImport(input: { source: ImportSourceRow[]; createLocations: boolean; fileName: string }): Promise<ActionResult<ImportPreview>> {
  return runAction(async () => {
    const me = await requirePermission("dispatch.create");
    if (!Array.isArray(input.source) || input.source.length > MAX_ROWS) throw new ActionError("Dữ liệu không hợp lệ.");
    const supabase = await createClient();
    const ctx = await loadContext(supabase, me.permissions);
    const { rows, payloads, newLocations } = resolveRows(ctx, input.source, input.createLocations);
    await markExisting(supabase, rows, payloads);
    return { fileName: input.fileName, rows, source: input.source, unknownHeaders: [], missingHeaders: [], newLocations, orderCount: countOrders(rows) };
  });
}

export type ImportOutcome = {
  orders: { orderId: string; orderCode: string; rows: number[]; trips: number; pendingApproval: number; completed: number }[];
  failed: { rows: number[]; error: string }[];
  createdLocations: number;
};

/** Ghi vào CSDL: mỗi đơn hàng một giao dịch; đơn lỗi không ảnh hưởng đơn khác */
export async function commitImport(input: { source: ImportSourceRow[]; createLocations: boolean; skipRows?: number[] }): Promise<ActionResult<ImportOutcome>> {
  return runAction(async () => {
    const me = await requirePermission("dispatch.create");
    if (!Array.isArray(input.source) || input.source.length > MAX_ROWS) throw new ActionError("Dữ liệu không hợp lệ.");
    const skip = new Set(input.skipRows ?? []);
    const source = input.source.filter((s) => Number.isInteger(s.rowNo) && s.raw && typeof s.raw === "object" && !skip.has(s.rowNo));
    if (!source.length) throw new ActionError("Không có dòng nào để nhập.");
    const supabase = await createClient();
    const ctx = await loadContext(supabase, me.permissions);
    const { rows, payloads, newLocations } = resolveRows(ctx, source, input.createLocations);
    const bad = rows.filter((r) => r.errors.length);
    if (bad.length) throw new ActionError(`Còn ${bad.length} dòng lỗi (dòng ${bad.slice(0, 10).map((r) => r.rowNo).join(", ")}${bad.length > 10 ? "…" : ""}). Bỏ chọn các dòng đó hoặc sửa tệp rồi kiểm tra lại.`);

    // Địa điểm mới: tên dùng làm địa chỉ, sửa chi tiết sau ở Danh mục
    const locIds = new Map<string, string>();
    if (newLocations.length) {
      const { data, error } = await supabase
        .from("locations")
        .insert(newLocations.map((name) => ({ code: "", name, full_address: name })))
        .select("id, name");
      if (error) throw new ActionError(`Không tạo được địa điểm mới: ${toUserMessage(error)}`);
      for (const l of data ?? []) locIds.set(looseKey(l.name), l.id);
    }
    const loc = (v: unknown) => (typeof v === "string" && v.startsWith("new:") ? (locIds.get(v.slice(4)) ?? "") : v);

    const groups = new Map<string, PreviewRow[]>();
    for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
    const out: ImportOutcome = { orders: [], failed: [], createdLocations: locIds.size };
    for (const list of groups.values()) {
      const nums = list.map((r) => r.rowNo);
      const first = payloads.get(list[0].rowNo)!;
      const shipments = list.map((r) => {
        const s = payloads.get(r.rowNo)!.shipment;
        return { ...s, pickup_location_id: loc(s.pickup_location_id), delivery_location_id: loc(s.delivery_location_id) };
      });
      let orderRef: Record<string, unknown> = first.order;
      for (let i = 0; i < shipments.length; i += 100) {
        const part = shipments.slice(i, i + 100);
        const partRows = nums.slice(i, i + 100);
        const { data, error } = await supabase.rpc("import_transport_order", { p_order: orderRef, p_shipments: part });
        if (error) {
          const msg = toUserMessage(error);
          const m = /^Chuyến (\d+): /.exec(msg);
          out.failed.push({ rows: partRows, error: m ? `Dòng ${partRows[Number(m[1]) - 1]}: ${msg.slice(m[0].length)}` : msg });
          continue;
        }
        const res = data as { order_id: string; order_code: string; shipments: { status: string; dispatch_approval: string }[] };
        orderRef = { id: res.order_id };
        out.orders.push({
          orderId: res.order_id,
          orderCode: res.order_code,
          rows: partRows,
          trips: res.shipments.length,
          pendingApproval: res.shipments.filter((s) => s.dispatch_approval === "pending").length,
          completed: res.shipments.filter((s) => s.status === "driver_completed").length,
        });
      }
    }
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    return out;
  });
}
