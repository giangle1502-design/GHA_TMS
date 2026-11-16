"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { sanitizeSearch } from "@/lib/entities/server";

const schema = z.object({
  direction: z.enum(["sale", "purchase"]),
  taxCode: z.string().max(20).nullable(),
  name: z.string().max(300).nullable(),
  isFuel: z.boolean(),
  hasCategory: z.boolean(),
});

export type InvoiceMatch = {
  customer_id?: string;
  supplier_id?: string;
  /** Tên khớp trong danh mục (để báo cho người dùng) */
  matched?: string;
  category_id?: string;
};

/**
 * Sau khi đọc ảnh hóa đơn: tìm khách hàng (bán ra) / nhà cung cấp (mua vào) trong danh mục theo MST, rồi theo tên;
 * gợi ý hạng mục khi còn trống (xăng dầu; nhà xe 3PL đã chạy cho GHA: Thuê xe ngoài 3PL; bán ra: hạng mục đầu tiên, thường là Cước vận chuyển). Không tạo mới gì.
 */
export async function matchInvoicePartner(input: z.input<typeof schema>): Promise<ActionResult<InvoiceMatch>> {
  return runAction(async () => {
    await requirePermission("overhead.create", "overhead.update");
    const d = schema.parse(input);
    const supabase = await createClient();
    const out: InvoiceMatch = {};
    const table = d.direction === "sale" ? "customers" : "suppliers";
    let hit: { id: string; name: string } | null = null;
    const tax = d.taxCode?.replace(/\s/g, "") ?? "";
    if (tax) {
      const { data } = await supabase.from(table).select("id, name").eq("tax_code", tax).limit(1);
      hit = (data?.[0] as { id: string; name: string } | undefined) ?? null;
    }
    const term = sanitizeSearch(d.name ?? "");
    if (!hit && term.length >= 4) {
      const { data } = await supabase.from(table).select("id, name").ilike("name", term).limit(2);
      if (data?.length === 1) hit = data[0] as { id: string; name: string };
    }
    if (hit) {
      if (d.direction === "sale") out.customer_id = hit.id;
      else out.supplier_id = hit.id;
      out.matched = hit.name;
    }
    if (!d.hasCategory) {
      let q = supabase.from("tax_invoice_categories").select("id, name").eq("direction", d.direction).eq("is_active", true);
      if (d.direction === "purchase") {
        if (d.isFuel) q = q.ilike("name", "%xăng%");
        else if (hit && (await isCarrier(supabase, hit.id))) q = q.ilike("name", "%3PL%");
        else return out;
      }
      const { data } = await q.order("sort_order").limit(1);
      if (data?.[0]) out.category_id = (data[0] as { id: string }).id;
    }
    return out;
  });
}

/** Nhà cung cấp đã từng chạy xe thuê ngoài 3PL cho GHA */
async function isCarrier(supabase: Awaited<ReturnType<typeof createClient>>, supplierId: string): Promise<boolean> {
  const { data } = await supabase.from("shipments").select("id").eq("carrier_supplier_id", supplierId).limit(1);
  return Boolean(data?.length);
}
