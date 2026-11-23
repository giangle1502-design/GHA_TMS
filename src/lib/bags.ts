/**
 * Số bao của một dòng hàng, giống private.item_bag_count (SQL 9039):
 *   ĐVT là bao → số lượng; mã hàng có Số KG/bao → Số lượng quy ra KG ÷ Số KG/bao (luôn luôn, bỏ qua số nhập tay);
 *   mã hàng chưa có trong danh mục mà ĐVT là KG → KG ÷ 25 (Số KG/bao mặc định);
 *   chỉ khi không tự tính được mới dùng số bao nhập tay.
 */
export const DEFAULT_KG_PER_BAG = 25;
export type BagProduct = { unit?: string | null; kg_per_unit?: number | string | null; kg_per_bag?: number | string | null };

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const unitIs = (u: string | null | undefined, re: RegExp) => re.test((u ?? "").trim());

/** Số bao tự tính; null khi không tính được (mã hàng chưa có trong danh mục, thiếu Số KG/bao...) */
export function autoBagCount(quantity: number | null, unit: string | null | undefined, product: BagProduct | null | undefined): number | null {
  if (quantity === null || Number.isNaN(quantity)) return null;
  if (unitIs(unit, /^(bao|bag|bags)$/i)) return quantity;
  if (!product) return unitIs(unit, /^kg$/i) ? Math.round((quantity / DEFAULT_KG_PER_BAG) * 100) / 100 : null;
  const per = num(product.kg_per_bag);
  if (!per || per <= 0) return null;
  const u = (unit ?? "").trim() || (product.unit ?? "");
  const factor = unitIs(u, /^kg$/i) ? 1 : num(product.kg_per_unit);
  if (!factor) return null;
  return Math.round(((quantity * factor) / per) * 100) / 100;
}

/** Số bao in trên phiếu / báo cáo: tự tính > nhập tay */
export function bagCount(quantity: number | null, unit: string | null | undefined, product: BagProduct | null | undefined, manual: number | string | null | undefined): number | null {
  return autoBagCount(quantity, unit, product) ?? num(manual);
}
