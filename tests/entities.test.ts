import { describe, expect, it } from "vitest";
import { ENTITIES } from "@/lib/entities/definitions";
import { entityAccess } from "@/lib/entities/access";
import { effectiveFields, flattenRow, formatValue, parseNumberVN, toFormValues, validateRecord } from "@/lib/entities/record";
import { matchHeaders, normalizeHeader, parseCsv } from "@/lib/entities/import";
import { slugifyKey } from "@/lib/entities/field-types";
import { MODULE_ACTIONS } from "@/lib/permissions";
import type { CustomFieldRow } from "@/lib/entities/types";

describe("Định nghĩa danh mục", () => {
  it("tham chiếu, quyền và trường tạo nhanh hợp lệ", () => {
    for (const e of Object.values(ENTITIES)) {
      expect(MODULE_ACTIONS[e.perm], e.key).toBeDefined();
      const keys = e.fields.map((f) => f.key);
      expect(new Set(keys).size, `${e.key} trùng khóa`).toBe(keys.length);
      for (const f of e.fields) if (f.type === "reference") expect(ENTITIES[f.ref!], `${e.key}.${f.key}`).toBeDefined();
      for (const q of e.quickFields ?? []) expect(keys, `${e.key} quick ${q}`).toContain(q);
      for (const c of e.labelCols) expect(keys.includes(c) || c === e.pk, `${e.key} labelCol ${c}`).toBe(true);
      if (e.hasExport) expect(MODULE_ACTIONS[e.perm] as readonly string[]).toContain("export");
    }
  });
});

describe("Đọc số: dấu phẩy hàng nghìn, dấu chấm thập phân", () => {
  it("tiền và số thập phân", () => {
    expect(parseNumberVN("3.500.000", true)).toBe(3500000);
    expect(parseNumberVN("3,500,000", true)).toBe(3500000);
    expect(parseNumberVN("39,5")).toBe(39.5);
    expect(parseNumberVN("39.5")).toBe(39.5);
    expect(parseNumberVN("1.234.567,5")).toBe(1234567.5);
    expect(parseNumberVN("1,234.5")).toBe(1234.5);
    expect(parseNumberVN("1,500")).toBe(1500);
    expect(parseNumberVN("1.500")).toBe(1.5);
    expect(parseNumberVN("1,500.75", true)).toBe(1501);
    expect(parseNumberVN("500.000", true)).toBe(500000);
    expect(parseNumberVN("-2,5")).toBe(-2.5);
    expect(parseNumberVN("")).toBeNull();
    expect(parseNumberVN("abc")).toBeNaN();
  });
});

describe("Kiểm tra dữ liệu bản ghi", () => {
  const vehicles = ENTITIES.vehicles;
  it("bắt buộc, kiểu, danh sách, rỗng thành null", () => {
    const { data, errors } = validateRecord(vehicles.fields, { plate_number: " 51C-1 ", model_year: "1800", status: "bay", brand: "" });
    expect(errors.model_year).toMatch(/không được nhỏ hơn/);
    expect(errors.status).toMatch(/không có trong danh sách/);
    expect(data.plate_number).toBe("51C1") // biển số được chuẩn hóa: chữ hoa liền, bỏ ký tự đặc biệt;
    expect(data.brand).toBeNull();
    expect(validateRecord(vehicles.fields, {}).errors.plate_number).toBe("Biển số là bắt buộc");
  });
  it("trường ẩn theo điều kiện không bắt buộc và bị xóa giá trị", () => {
    const fr = ENTITIES.fuel_rules.fields;
    const base = { effective_from: "2026-01-01", calculation_base: "freight_revenue", rate_percent: "39" };
    const r1 = validateRecord(fr, { ...base, scope_type: "default", customer_id: "00000000-0000-0000-0000-000000000001" });
    expect(r1.errors).toEqual({});
    expect(r1.data.customer_id).toBeNull();
    const r2 = validateRecord(fr, { ...base, scope_type: "customer" });
    expect(r2.errors.customer_id).toMatch(/bắt buộc/);
  });
  it("ngày dd/mm/yyyy, email, liên kết", () => {
    const f = ENTITIES.drivers.fields;
    const r = validateRecord(f, { full_name: "A", status: "active", date_of_birth: "05/03/1990", email: "sai", salary_rule_id: "x" });
    expect(r.data.date_of_birth).toBe("1990-03-05");
    expect(r.errors.email).toMatch(/email/);
    expect(r.errors.salary_rule_id).toMatch(/không hợp lệ/);
    expect(validateRecord(f, { full_name: "A", status: "active", start_date: "31/02/2026" }).errors.start_date).toMatch(/ngày/);
  });
  it("trường động: công thức, quyền xem/sửa", () => {
    const row = (o: Partial<CustomFieldRow>): CustomFieldRow =>
      ({ id: o.field_key, module: "vehicles", label: o.field_key, description: null, field_kind: "business", is_required: false, is_editable: true, is_visible: true, is_searchable: false, is_filterable: false, is_sortable: false, default_value: null, display_format: null, sort_order: 0, view_permission: null, edit_permission: null, validation: null, formula: null, visibility_condition: null, options: null, reference_target: null, status: "active", version: 1, data_type: "decimal", ...o }) as CustomFieldRow;
    const custom = [row({ field_key: "tan" }), row({ field_key: "kg", data_type: "formula", formula: "tan * 1000" }), row({ field_key: "bi_mat", view_permission: "vehicles.view_sensitive" }), row({ field_key: "khoa", edit_permission: "vehicles.view_sensitive" })];
    const fields = effectiveFields(vehicles, custom, new Set(["vehicles.view"]));
    expect(fields.some((f) => f.key === "bi_mat")).toBe(false);
    expect(fields.find((f) => f.key === "khoa")?.readOnly).toBe(true);
    const flat = flattenRow(fields, { plate_number: "x", custom_fields: { tan: 2.5 } });
    expect(flat.kg).toBe(2500);
    const { data } = validateRecord(fields, { plate_number: "x", status: "active", tan: "2,5", kg: "999", khoa: "1" });
    expect(data.tan).toBe(2.5);
    expect("kg" in data).toBe(false);
    expect("khoa" in data).toBe(false);
  });
  it("định dạng hiển thị và giá trị biểu mẫu", () => {
    const year = vehicles.fields.find((f) => f.key === "model_year")!;
    expect(formatValue(year, 2022)).toBe("2022");
    const price = ENTITIES.price_lists.fields.find((f) => f.key === "unit_price")!;
    expect(formatValue(price, 3500000).replace(/\s/g, " ")).toBe("3,500,000 ₫");
    expect(toFormValues([price], { unit_price: 3500000 }).unit_price).toBe("3,500,000");
  });
});

describe("Quyền theo danh mục", () => {
  it("dữ liệu nhạy cảm cần view_sensitive; bảng con dùng quyền sửa", () => {
    const fin = ENTITIES.vehicle_financials;
    expect(entityAccess(fin, new Set(["vehicles.view", "vehicles.update"])).view).toBe(false);
    const a = entityAccess(fin, new Set(["vehicles.view", "vehicles.update", "vehicles.view_sensitive"]));
    expect(a.view && a.update && a.create).toBe(true);
    expect(a.delete).toBe(false);
    const cat = entityAccess(ENTITIES.banks, new Set(["catalogs.view"]));
    expect(cat).toMatchObject({ view: true, create: false, export: true, import: false });
    expect(entityAccess(ENTITIES.vehicles, new Set(["vehicles.view"])).export).toBe(false);
  });
});

describe("Nhập Excel/CSV", () => {
  it("đọc CSV có ngoặc kép, dấu ; và BOM", () => {
    expect(parseCsv('﻿a;b\n"x;1";"he said ""hi"""\n\n')).toEqual([["a", "b"], ["x;1", 'he said "hi"']]);
    expect(parseCsv("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("ghép tiêu đề cột không phân biệt dấu, dấu * và mã trường", () => {
    expect(normalizeHeader("Biển số *")).toBe("bien so");
    const { mapping, unknown, missingRequired } = matchHeaders(ENTITIES.vehicles.fields, ["bien so", "Loại xe", "plate_number_x", "status"]);
    expect(mapping.map((f) => f?.key ?? null)).toEqual(["plate_number", "vehicle_type_id", null, "status"]);
    expect(unknown).toEqual(["plate_number_x"]);
    expect(missingRequired).toEqual([]);
    expect(matchHeaders(ENTITIES.vehicles.fields, ["Hãng xe"]).missingRequired).toContain("Biển số");
  });
  it("tạo mã trường từ tên tiếng Việt", () => {
    expect(slugifyKey("Số container")).toBe("so_container");
    expect(slugifyKey("Đơn vị (tấn)")).toBe("don_vi_tan");
    expect(slugifyKey("123 abc")).toBe("f_123_abc");
  });
});
