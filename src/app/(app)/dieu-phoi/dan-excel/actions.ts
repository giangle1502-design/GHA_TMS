"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, toUserMessage, type ActionResult } from "@/lib/auth/action";
import { matchKey } from "@/lib/paste-orders";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type AliasKind = "location" | "customer" | "product";
export type CatalogItem = { id: string; code: string | null; name: string; unit?: string | null };
export type SavedAlias = { id: string; kind: AliasKind; alias: string; target_id: string };
export type PasteCatalog = {
  customers: CatalogItem[];
  locations: CatalogItem[];
  products: CatalogItem[];
  aliases: SavedAlias[];
  /** false = chưa chạy bản nâng cấp 9010 (chưa có bảng tên gọi khác): vẫn dán được, chỉ chưa ghi nhớ */
  aliasesReady: boolean;
};

async function loadAliases(supabase: Supa): Promise<{ aliases: SavedAlias[]; ready: boolean }> {
  const r = await supabase.from("name_aliases").select("id, kind, alias, target_id").order("alias").limit(10000);
  if (r.error) return { aliases: [], ready: false };
  return { aliases: (r.data ?? []) as SavedAlias[], ready: true };
}

/** Danh mục để ghép tên (chỉ bản ghi đang hoạt động) + tên gọi khác đã ghi nhớ */
export async function loadPasteCatalog(): Promise<ActionResult<PasteCatalog>> {
  return runAction(async () => {
    await requirePermission("dispatch.create");
    const supabase = await createClient();
    const [cus, loc, pro, al] = await Promise.all([
      supabase.from("customers").select("id, code, name").eq("status", "active").order("name").limit(10000),
      supabase.from("locations").select("id, code, name").eq("status", "active").order("name").limit(10000),
      supabase.from("products").select("id, code, name, unit").eq("status", "active").order("code").limit(10000),
      loadAliases(supabase),
    ]);
    for (const r of [cus, loc]) if (r.error) throw r.error;
    return {
      customers: (cus.data ?? []) as CatalogItem[],
      locations: (loc.data ?? []) as CatalogItem[],
      products: pro.error ? [] : ((pro.data ?? []) as CatalogItem[]),
      aliases: al.aliases,
      aliasesReady: al.ready,
    };
  });
}

/** Số cont đã có chuyến (chưa hủy) trong phần mềm: để cảnh báo dán trùng */
export async function findExistingContainers(containers: string[]): Promise<ActionResult<{ container: string; code: string; pickupAt: string }[]>> {
  return runAction(async () => {
    await requirePermission("dispatch.create");
    const list = [...new Set(containers.filter((c) => typeof c === "string" && /^[A-Z0-9]{4,30}$/.test(c)))].slice(0, 1000);
    if (!list.length) return [];
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("shipments")
      .select("shipment_code, container_no, pickup_at")
      .in("container_no", list)
      .neq("status", "cancelled")
      .limit(5000);
    if (error) throw error;
    return (data ?? []).map((s) => ({ container: s.container_no as string, code: s.shipment_code as string, pickupAt: s.pickup_at as string }));
  });
}

const uuid = z.uuid("Giá trị không hợp lệ");
const aliasInput = z.object({
  kind: z.enum(["location", "customer", "product"]),
  alias: z.string().trim().min(1).max(300),
  targetId: uuid,
});

async function upsertAliases(supabase: Supa, list: z.infer<typeof aliasInput>[]): Promise<string | null> {
  const rows = new Map<string, { kind: string; alias: string; alias_key: string; target_id: string }>();
  for (const a of list) {
    const key = matchKey(a.alias).slice(0, 300);
    if (key) rows.set(`${a.kind}|${key}`, { kind: a.kind, alias: a.alias, alias_key: key, target_id: a.targetId });
  }
  if (!rows.size) return null;
  const { error } = await supabase.from("name_aliases").upsert([...rows.values()], { onConflict: "kind,alias_key" });
  return error ? toUserMessage(error) : null;
}

/** Ghi nhớ / đổi tên gọi khác (không thêm gì vào danh mục chuẩn) */
export async function saveAliases(input: z.input<typeof aliasInput>[]): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requirePermission("dispatch.create");
    const list = z.array(aliasInput).max(500).parse(input);
    const err = await upsertAliases(await createClient(), list);
    if (err) throw new ActionError(`Chưa ghi nhớ được tên gọi khác: ${err}`);
    return list.length;
  });
}

export async function deleteAlias(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.create");
    const supabase = await createClient();
    const { error } = await supabase.from("name_aliases").delete().eq("id", uuid.parse(id));
    if (error) throw error;
  });
}

const tripInput = z.object({
  rowNo: z.number().int().min(1).max(5000),
  pickupLocationId: uuid,
  deliveryLocationId: uuid,
  containerNo: z.string().max(30).regex(/^[A-Z0-9]*$/, "Số cont chỉ gồm chữ và số"),
  productCode: z.string().max(100),
  productName: z.string().max(300),
  quantity: z.number().min(0).max(1_000_000_000).nullable(),
  note: z.string().max(1000),
});
const orderInput = z.object({
  customerId: uuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày giao không hợp lệ"),
  refNo: z.string().max(100),
  voucherNo: z.string().max(100),
  trips: z.array(tripInput).min(1).max(100),
});
const commitInput = z.object({ orders: z.array(orderInput).min(1).max(500), aliases: z.array(aliasInput).max(500) });

export type PasteOutcome = {
  orders: { orderId: string; orderCode: string; rows: number[]; trips: number }[];
  failed: { rows: number[]; error: string }[];
  warnings: string[];
  aliasesSaved: number;
};

const vnMidnight = (ymd: string) => `${ymd}T00:00:00+07:00`;

/**
 * Tạo đơn: mỗi nhóm (cùng khách, tờ khai, điểm giao, ngày giao) = một đơn, mỗi dòng (một cont) = một chuyến
 * "Chờ phân công". Giá lấy theo bảng giá như tạo tay. Đơn lỗi không ảnh hưởng đơn khác.
 */
export async function commitPaste(input: z.input<typeof commitInput>): Promise<ActionResult<PasteOutcome>> {
  return runAction(async () => {
    await requirePermission("dispatch.create");
    const parsed = commitInput.safeParse(input);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ.");
    const { orders, aliases } = parsed.data;
    const supabase = await createClient();
    const out: PasteOutcome = { orders: [], failed: [], warnings: [], aliasesSaved: 0 };

    for (const o of orders) {
      const rows = o.trips.map((t) => t.rowNo);
      const bad = o.trips.find((t) => t.pickupLocationId === t.deliveryLocationId);
      if (bad) {
        out.failed.push({ rows, error: `Dòng ${bad.rowNo}: điểm lấy cont và điểm giao trùng nhau` });
        continue;
      }
      const at = vnMidnight(o.date);
      const { data, error } = await supabase.rpc("import_transport_order", {
        p_order: { customer_id: o.customerId, payer_customer_id: "", order_date: o.date, notes: ["Dán từ Excel", o.refNo && `Tờ khai ${o.refNo}`].filter(Boolean).join(" · ") },
        p_shipments: o.trips.map((t) => ({
          pickup_at: at,
          expected_delivery_at: at,
          pickup_location_id: t.pickupLocationId,
          delivery_location_id: t.deliveryLocationId,
          vehicle_type_id: "",
          vehicle_id: "",
          driver_id: "",
          unit_price: "",
          pricing_unit: "",
          quantity: "",
          surcharge_amount: "",
          fuel_support_rate: "",
          notes: t.note,
          custom_fields: {},
          fees: [],
          import_status: "draft",
          completed_at: "",
        })),
      });
      if (error) {
        const msg = toUserMessage(error);
        const m = /^Chuyến (\d+): /.exec(msg);
        out.failed.push({ rows, error: m ? `Dòng ${rows[Number(m[1]) - 1]}: ${msg.slice(m[0].length)}` : msg });
        continue;
      }
      const res = data as { order_id: string; order_code: string; shipments: { id: string; shipment_code: string }[] };
      out.orders.push({ orderId: res.order_id, orderCode: res.order_code, rows, trips: res.shipments.length });

      // Thông tin đơn cha: số tờ khai, PXK, ngày giao, tuyến. Lỗi ở đây không làm mất đơn, chỉ báo lại.
      const first = o.trips[0];
      const sameRoute = o.trips.every((t) => t.pickupLocationId === first.pickupLocationId && t.deliveryLocationId === first.deliveryLocationId);
      const head = await supabase
        .from("transport_orders")
        .update({
          ref_no: o.refNo || null,
          voucher_no: o.voucherNo || null,
          delivery_date: o.date,
          pickup_location_id: sameRoute ? first.pickupLocationId : null,
          delivery_location_id: sameRoute ? first.deliveryLocationId : null,
        })
        .eq("id", res.order_id);
      if (head.error) out.warnings.push(`Đơn ${res.order_code}: chưa ghi được số tờ khai / PXK (${toUserMessage(head.error)}). Sửa ở chi tiết đơn.`);

      for (const [i, t] of o.trips.entries()) {
        const s = res.shipments[i];
        if (!s) continue;
        if (t.containerNo) {
          const r = await supabase.from("shipments").update({ container_no: t.containerNo }).eq("id", s.id);
          if (r.error) out.warnings.push(`Chuyến ${s.shipment_code}: chưa ghi được số cont ${t.containerNo} (${toUserMessage(r.error)}).`);
        }
        if (t.productCode || t.quantity !== null) {
          const r = await supabase.rpc("set_shipment_items", {
            p_shipment_id: s.id,
            p_items: [{ item_code: t.productCode, item_name: t.productName, quantity: t.quantity ?? "", unit: "", note: "", custom_fields: {} }],
          });
          if (r.error) out.warnings.push(`Chuyến ${s.shipment_code}: chưa ghi được mã hàng (${toUserMessage(r.error)}). Mở chi tiết chuyến để nhập.`);
        }
      }
    }

    if (aliases.length && out.orders.length) {
      const err = await upsertAliases(supabase, aliases);
      if (err) out.warnings.push(`Chưa ghi nhớ được tên gọi khác: ${err}`);
      else out.aliasesSaved = aliases.length;
    }
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    return out;
  });
}
