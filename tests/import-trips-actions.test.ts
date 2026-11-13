import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => ({ id: "u1", status: "active", permissions: new Set(["dispatch.create"]) }),
}));

const T: Record<string, Record<string, unknown>[]> = {
  customers: [{ id: "c1", code: "KH001", name: "Công ty A", status: "active" }],
  locations: [
    { id: "l1", code: "DD001", name: "Cảng Cát Lái", status: "active" },
    { id: "l2", code: "DD002", name: "KCN Sóng Thần", status: "active" },
  ],
  vehicle_types: [{ id: "vt1", code: "XE8T", name: "Xe 8 tấn" }],
  vehicles: [{ id: "v1", plate_number: "61K-312.95", vehicle_type_id: "vt1", assigned_driver_id: "d1", ownership_type: "owned", status: "active", archived_at: null }],
  drivers: [{ id: "d1", code: "TX01", full_name: "Nguyễn Văn A", phone: "0901234567", status: "active", archived_at: null }],
  fee_types: [
    { id: "f1", name: "Phí nâng", fee_group_id: "g1", sort_order: 1 },
    { id: "f2", name: "Phí tờ khai theo cont", fee_group_id: "g2", sort_order: 2 },
  ],
  fee_groups: [
    { id: "g1", name: "Phí chi hộ", report_role: "pass_through", sort_order: 20 },
    { id: "g2", name: "Phí tờ khai", report_role: "declaration", sort_order: 30 },
  ],
  declaration_types: [{ id: "dt1", code: "XANH", name: "Xanh" }],
  field_definitions: [],
  form_layouts: [],
  shipment_list: [],
};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const inserted: Record<string, unknown>[] = [];
function q(table: string) {
  const api: Record<string, unknown> = {};
  const chain = () => api;
  for (const m of ["select", "eq", "neq", "order", "limit", "gte", "lt", "in", "maybeSingle"]) api[m] = chain;
  api.insert = (rows: Record<string, unknown>[]) => {
    inserted.push(...rows);
    return { select: () => Promise.resolve({ data: rows.map((r, i) => ({ id: `new${i}`, name: r.name })), error: null }) };
  };
  api.then = (res: (v: unknown) => void) => res({ data: T[table] ?? [], error: null });
  return api;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: q,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: { order_id: "o1", order_code: "ORD1", shipments: (args.p_shipments as unknown[]).map(() => ({ status: "driver_completed", dispatch_approval: "not_required" })) }, error: null };
    },
  }),
}));

const { downloadImportTemplate, previewImport, commitImport } = await import("@/app/(app)/dieu-phoi/nhap-excel/actions");

describe("nhập chuyến: file mẫu → kiểm tra → ghi", () => {
  it("chạy trọn luồng", async () => {
    const t = await downloadImportTemplate();
    expect(t.ok).toBe(true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(t.ok ? t.data!.base64 : "", "base64") as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Nhập chuyến")!;
    const headers = (ws.getRow(1).values as string[]).slice(1);
    expect(headers).toContain("Phí chi hộ - Phí nâng");
    expect(headers).toContain("Loại tờ khai");
    const col = (h: string) => headers.findIndex((x) => x.replace(" *", "") === h) + 1;
    const put = (r: number, vals: Record<string, unknown>) => Object.entries(vals).forEach(([h, v]) => (ws.getRow(r).getCell(col(h)).value = v as ExcelJS.CellValue));
    put(2, { "Gộp đơn": "A", "Mã khách hàng": "KH001", "Ngày nhận hàng": new Date(Date.UTC(2026, 9, 20)), "Điểm nhận": "cảng cát lái", "Điểm giao": "DD002", "Biển số xe": "61k31295", "Trạng thái": "Đã hoàn thành", "Đơn giá": 2500000, "Phí chi hộ - Phí nâng": "350,000", "Phí tờ khai - Phí tờ khai theo cont": 100000, "Loại tờ khai": "Xanh" });
    put(3, { "Gộp đơn": "A", "Mã khách hàng": "KH001", "Ngày nhận hàng": "21/10/2026", "Điểm nhận": "Cảng Cát Lái", "Điểm giao": "Kho Mới", "Tài xế": "TX01", "Trạng thái": "Đã phân công" });
    put(4, { "Mã khách hàng": "KH999", "Ngày nhận hàng": "32/10/2026", "Điểm nhận": "Cảng Cát Lái", "Điểm giao": "Cảng Cát Lái", "Biển số xe": "99X99999", "Đơn giá": "abc" });
    const buf = await wb.xlsx.writeBuffer();
    const fd = new FormData();
    fd.set("file", new File([buf as ArrayBuffer], "chuyen.xlsx"));
    const p = await previewImport(fd);
    if (!p.ok) throw new Error(p.error);
    const [r2, r3, r4] = p.data!.rows;
    expect(r2.errors).toEqual([]);
    expect(r2.warnings).toContain("Lấy tài xế phụ trách xe: Nguyễn Văn A");
    expect(r2.status).toBe("completed");
    expect(r3.errors.join()).toContain('Chưa có địa điểm "Kho Mới"');
    expect(r4.errors.length).toBeGreaterThanOrEqual(5);

    const c = await commitImport({ source: p.data!.source, createLocations: true, skipRows: [4] });
    if (!c.ok) throw new Error(c.error);
    expect(inserted).toEqual([{ code: "", name: "Kho Mới", full_address: "Kho Mới" }]);
    expect(rpcCalls).toHaveLength(1);
    const [s1, s2] = rpcCalls[0].args.p_shipments as Record<string, unknown>[];
    expect(rpcCalls[0].args.p_order).toMatchObject({ customer_id: "c1", order_date: "2026-10-20" });
    expect(s1).toMatchObject({ pickup_at: "2026-10-20T00:00:00+07:00", pickup_location_id: "l1", delivery_location_id: "l2", vehicle_id: "v1", driver_id: "d1", unit_price: 2500000, import_status: "completed", completed_at: "2026-10-20T00:00:00+07:00" });
    expect(s1.fees).toEqual([{ fee_type_id: "f1", amount: 350000, note: "" }, { fee_type_id: "f2", amount: 100000, note: "", declaration_type_id: "dt1" }]);
    expect(s2).toMatchObject({ delivery_location_id: "new0", driver_id: "d1", import_status: "assigned", unit_price: "" });
    expect(c.data!.orders[0]).toMatchObject({ orderCode: "ORD1", trips: 2, rows: [2, 3] });
  });
});
