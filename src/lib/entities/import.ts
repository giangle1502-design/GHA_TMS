// Tiện ích nhập dữ liệu từ Excel/CSV (không phụ thuộc máy chủ để kiểm thử được).
import type { FieldDef } from "./types";

/** Bỏ dấu tiếng Việt, chữ thường, gộp khoảng trắng: "Biển số *" -> "bien so" */
export function normalizeHeader(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9_ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ghép tiêu đề cột với trường theo nhãn hoặc mã trường */
export function matchHeaders(fields: FieldDef[], headers: string[]) {
  const byNorm = new Map<string, FieldDef>();
  for (const f of fields) {
    byNorm.set(normalizeHeader(f.label), f);
    byNorm.set(f.key.toLowerCase(), f);
  }
  const mapping: (FieldDef | null)[] = headers.map((h) => byNorm.get(normalizeHeader(String(h ?? ""))) ?? byNorm.get(String(h ?? "").trim().toLowerCase()) ?? null);
  const unknown = headers.filter((h, i) => String(h ?? "").trim() && !mapping[i]);
  const used = new Set(mapping.filter(Boolean).map((f) => f!.key));
  const missingRequired = fields.filter((f) => f.required && !used.has(f.key)).map((f) => f.label);
  return { mapping, unknown, missingRequired };
}

/** Đọc CSV (hỗ trợ dấu ngoặc kép, dấu phân cách , hoặc ;) */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Các trường cho phép nhập (bỏ trường chỉ đọc, công thức, tệp) */
export function importableFields(fields: FieldDef[]): FieldDef[] {
  return fields.filter((f) => !f.readOnly && f.type !== "formula" && f.type !== "file" && !f.hideInForm);
}

/** Mô tả kiểu dữ liệu cho sheet hướng dẫn */
export function describeField(f: FieldDef): string {
  switch (f.type) {
    case "currency":
      return "Số tiền (VD: 3500000 hoặc 3,500,000)";
    case "number":
      return f.integer ? "Số nguyên" : "Số (VD: 2,5)";
    case "percent":
      return "Tỷ lệ % (VD: 39)";
    case "date":
      return "Ngày dd/mm/yyyy";
    case "datetime":
      return "Ngày giờ dd/mm/yyyy hh:mm";
    case "boolean":
      return "Có / Không";
    case "select":
      return `Một trong: ${(f.options ?? []).map((o) => `${o.value} (${o.label})`).join("; ")}`;
    case "multiselect":
      return `Nhiều giá trị cách nhau dấu phẩy: ${(f.options ?? []).map((o) => o.value).join(", ")}`;
    case "reference":
      return "Mã hoặc tên của bản ghi đã có trong danh mục";
    case "email":
      return "Email";
    case "phone":
      return "Số điện thoại";
    case "url":
      return "Đường dẫn bắt đầu bằng https://";
    default:
      return f.maxLength ? `Chữ, tối đa ${f.maxLength} ký tự` : "Chữ";
  }
}
