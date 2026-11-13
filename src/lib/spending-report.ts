/** Báo cáo tổng chi theo nhóm phí (0067, view report_spending_lines). Không đặt trong tệp "use client". */

export type SpendingSource = "trip" | "vehicle" | "carrier" | "purchase";

export const SPENDING_SOURCES: {
  value: SpendingSource;
  label: string;
  hint: string;
}[] = [
  {
    value: "trip",
    label: "Chi phí chuyến",
    hint: "Chi phí đầu ra của chuyến (dầu, cầu đường, bốc xếp…) đã duyệt",
  },
  {
    value: "vehicle",
    label: "Chi phí xe",
    hint: "Bảo trì, sửa chữa, kiểm định, bảo hiểm nhập ở Phương tiện",
  },
  {
    value: "carrier",
    label: "Trả xe thuê ngoài 3PL",
    hint: "Cước và chi phí khác trả nhà xe 3PL (không gồm chi hộ 3PL)",
  },
  {
    value: "purchase",
    label: "Đề nghị chi, mua sắm",
    hint: "Phiếu chi đã chi của Đề nghị chi",
  },
];
export const sourceLabel = (s: string) =>
  SPENDING_SOURCES.find((x) => x.value === s)?.label ?? s;

export type SpendingLine = {
  id: string;
  source: SpendingSource;
  group_name: string;
  group_sort: number;
  item_name: string;
  report_date: string;
  amount: number;
  status: string;
  is_pass_through: boolean;
  code: string | null;
  shipment_code: string | null;
  plate_number: string | null;
  driver_name: string | null;
  customer_name: string | null;
  supplier_name: string | null;
  paid_by: string | null;
  ref_no: string | null;
  note: string | null;
};

export type LineState = "counted" | "pending" | "pass_through";
/** Khoản tính vào tổng chi: đã duyệt và không phải chi hộ */
export function lineState(
  l: Pick<SpendingLine, "status" | "is_pass_through">,
): LineState {
  if (l.is_pass_through) return "pass_through";
  return l.status === "pending" ? "pending" : "counted";
}
export const LINE_STATE_LABEL: Record<LineState, string> = {
  counted: "Đã tính vào tổng",
  pending: "Chờ duyệt (chưa tính)",
  pass_through: "Chi hộ (không tính)",
};

export type GroupSummary = {
  group: string;
  sort: number;
  count: number;
  bySource: Record<SpendingSource, number>;
  total: number;
  pending: number;
  passThrough: number;
  items: {
    item: string;
    count: number;
    total: number;
    pending: number;
    passThrough: number;
  }[];
};

/**
 * Cộng theo nhóm phí rồi theo khoản chi. Thứ tự nhóm: theo Danh mục (groupOrder), rồi thứ tự nguồn, rồi tên.
 * Chỉ khoản "counted" cộng vào total; chờ duyệt và chi hộ để riêng.
 */
export function summarizeByGroup(
  lines: SpendingLine[],
  groupOrder: string[] = [],
): GroupSummary[] {
  const map = new Map<
    string,
    GroupSummary & { itemMap: Map<string, GroupSummary["items"][number]> }
  >();
  for (const l of lines) {
    let g = map.get(l.group_name);
    if (!g) {
      const idx = groupOrder.indexOf(l.group_name);
      g = {
        group: l.group_name,
        sort: idx >= 0 ? idx : 100000 + l.group_sort,
        count: 0,
        bySource: { trip: 0, vehicle: 0, carrier: 0, purchase: 0 },
        total: 0,
        pending: 0,
        passThrough: 0,
        items: [],
        itemMap: new Map(),
      };
      map.set(l.group_name, g);
    }
    let it = g.itemMap.get(l.item_name);
    if (!it) {
      it = {
        item: l.item_name,
        count: 0,
        total: 0,
        pending: 0,
        passThrough: 0,
      };
      g.itemMap.set(l.item_name, it);
      g.items.push(it);
    }
    const st = lineState(l);
    if (st === "counted") {
      g.count++;
      g.total += l.amount;
      g.bySource[l.source] = (g.bySource[l.source] ?? 0) + l.amount;
      it.count++;
      it.total += l.amount;
    } else if (st === "pending") {
      g.pending += l.amount;
      it.pending += l.amount;
    } else {
      g.passThrough += l.amount;
      it.passThrough += l.amount;
    }
  }
  return [...map.values()]
    .sort((a, b) => a.sort - b.sort || a.group.localeCompare(b.group, "vi"))
    .map(
      ({
        group,
        sort,
        count,
        bySource,
        total,
        pending,
        passThrough,
        items,
      }) => ({
        group,
        sort,
        count,
        bySource,
        total,
        pending,
        passThrough,
        items: items.sort(
          (a, b) => b.total - a.total || a.item.localeCompare(b.item, "vi"),
        ),
      }),
    );
}
