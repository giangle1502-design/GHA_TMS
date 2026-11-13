// Tìm kiếm nâng cao dùng chung cho các bảng: người dùng tự thêm điều kiện theo trường.
// Điều kiện nằm trên URL dạng ?a=truong.toan_tu.gia_tri (lặp lại cho nhiều điều kiện, nối bằng VÀ).

export type AdvFieldKind = "text" | "number" | "date" | "select" | "reference" | "boolean";

export type AdvField = {
  key: string;
  label: string;
  kind: AdvFieldKind;
  options?: { value: string; label: string }[];
  /** Thực thể tham chiếu (kind = reference) */
  ref?: string;
};

export type AdvOp = "contains" | "eq" | "neq" | "starts" | "gt" | "gte" | "lt" | "lte" | "empty" | "notempty";

export type AdvCondition = { field: string; op: AdvOp; value: string };

export const ADV_OP_LABEL: Record<AdvOp, string> = {
  contains: "có chứa",
  eq: "bằng",
  neq: "khác",
  starts: "bắt đầu bằng",
  gt: "lớn hơn",
  gte: "từ (≥)",
  lt: "nhỏ hơn",
  lte: "đến (≤)",
  empty: "để trống",
  notempty: "có giá trị",
};

export const ADV_OPS: Record<AdvFieldKind, AdvOp[]> = {
  text: ["contains", "eq", "neq", "starts", "empty", "notempty"],
  number: ["eq", "neq", "gte", "lte", "gt", "lt", "empty", "notempty"],
  date: ["eq", "gte", "lte", "gt", "lt", "empty", "notempty"],
  select: ["eq", "neq", "empty", "notempty"],
  reference: ["eq", "neq", "empty", "notempty"],
  boolean: ["eq"],
};

export const opNeedsValue = (op: AdvOp) => op !== "empty" && op !== "notempty";

const KEY = /^[a-z][a-z0-9_]{0,62}$/;
const OPS = new Set<AdvOp>(Object.keys(ADV_OP_LABEL) as AdvOp[]);

export function encodeCondition(c: AdvCondition) {
  return `${c.field}.${c.op}.${opNeedsValue(c.op) ? c.value : ""}`;
}

/** Đọc điều kiện từ tham số URL; bỏ trường không có trong danh sách cho phép */
export function parseConditions(raw: string | string[] | undefined, fields: AdvField[]): AdvCondition[] {
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const out: AdvCondition[] = [];
  for (const s of list.slice(0, 20)) {
    const i = s.indexOf(".");
    const j = s.indexOf(".", i + 1);
    if (i < 1 || j < 0) continue;
    const field = s.slice(0, i);
    const op = s.slice(i + 1, j) as AdvOp;
    const value = s.slice(j + 1).slice(0, 100);
    const f = fields.find((x) => x.key === field);
    if (!KEY.test(field) || !f || !OPS.has(op) || !ADV_OPS[f.kind].includes(op)) continue;
    if (opNeedsValue(op) && value.trim() === "") continue;
    out.push({ field, op, value: value.trim() });
  }
  return out;
}

/** Bỏ ký tự đặc biệt của bộ lọc PostgREST */
const clean = (v: string) => v.replace(/[%,()*\\:"']/g, " ").replace(/\s+/g, " ").trim();

/**
 * Áp các điều kiện lên truy vấn PostgREST.
 * column: tên cột thực (ví dụ trường động custom_fields->>ma); dateToTs: chuyển ngày YYYY-MM-DD thành mốc giờ VN.
 */
export function applyConditions<Q>(
  query: Q,
  conds: AdvCondition[],
  fields: AdvField[],
  opts: { column?: (key: string) => string; dayStart?: (ymd: string) => string; nextDayStart?: (ymd: string) => string; dateTime?: (key: string) => boolean } = {},
): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  for (const c of conds) {
    const f = fields.find((x) => x.key === c.field);
    if (!f) continue;
    const col = opts.column ? opts.column(f.key) : f.key;
    if (c.op === "empty") {
      q = f.kind === "text" ? q.or(`${col}.is.null,${col}.eq.`) : q.is(col, null);
      continue;
    }
    if (c.op === "notempty") {
      q = q.not(col, "is", null);
      if (f.kind === "text") q = q.neq(col, "");
      continue;
    }
    let v: string | number | boolean = c.value;
    if (f.kind === "number") {
      const n = Number(c.value.replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(n)) continue;
      v = n;
    } else if (f.kind === "boolean") {
      v = c.value === "true";
    } else if (f.kind === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.value)) continue;
      const isTs = opts.dateTime?.(f.key) && opts.dayStart && opts.nextDayStart;
      if (isTs) {
        const start = opts.dayStart!(c.value);
        const next = opts.nextDayStart!(c.value);
        if (c.op === "eq") q = q.gte(col, start).lt(col, next);
        else if (c.op === "gte") q = q.gte(col, start);
        else if (c.op === "gt") q = q.gte(col, next);
        else if (c.op === "lte") q = q.lt(col, next);
        else if (c.op === "lt") q = q.lt(col, start);
        continue;
      }
    } else if (f.kind === "text") {
      v = clean(c.value);
      if (!v) continue;
    }
    switch (c.op) {
      case "contains":
        q = q.ilike(col, `%${v}%`);
        break;
      case "starts":
        q = q.ilike(col, `${v}%`);
        break;
      case "eq":
        q = f.kind === "text" ? q.ilike(col, String(v)) : q.eq(col, v);
        break;
      case "neq":
        q = f.kind === "text" ? q.not(col, "ilike", String(v)) : q.or(`${col}.neq.${v},${col}.is.null`);
        break;
      case "gt":
        q = q.gt(col, v);
        break;
      case "gte":
        q = q.gte(col, v);
        break;
      case "lt":
        q = q.lt(col, v);
        break;
      case "lte":
        q = q.lte(col, v);
        break;
    }
  }
  return q as Q;
}

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();

/** Kiểm tra một giá trị theo điều kiện, dùng cho bảng lọc ngay trên trình duyệt (báo cáo tính sẵn). */
export function matchCondition(value: unknown, kind: AdvFieldKind, op: AdvOp, cond: string): boolean {
  const isEmpty = value === null || value === undefined || value === "";
  if (op === "empty") return isEmpty;
  if (op === "notempty") return !isEmpty;
  if (kind === "number") {
    const n = Number(cond.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n)) return true;
    if (isEmpty) return op === "neq";
    const x = Number(value);
    return op === "eq" ? x === n : op === "neq" ? x !== n : op === "gt" ? x > n : op === "gte" ? x >= n : op === "lt" ? x < n : op === "lte" ? x <= n : true;
  }
  if (kind === "date") {
    if (isEmpty) return op === "neq";
    const d = String(value).slice(0, 10);
    return op === "eq" ? d === cond : op === "gt" ? d > cond : op === "gte" ? d >= cond : op === "lt" ? d < cond : op === "lte" ? d <= cond : true;
  }
  const v = fold(isEmpty ? "" : String(value));
  const c = fold(cond);
  if (kind === "boolean") return String(Boolean(value)) === cond;
  switch (op) {
    case "contains":
      return v.includes(c);
    case "starts":
      return v.startsWith(c);
    case "eq":
      return v === c;
    case "neq":
      return v !== c;
    default:
      return true;
  }
}
