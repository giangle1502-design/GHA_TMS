"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import {
  DEFAULT_SHARE_TEMPLATE,
  SHARE_BUILTIN_SOURCES,
  type DriverShareRow,
  type ShareLine,
  type ShareSource,
} from "@/lib/driver-share";

export type DriverShareInfo = {
  rows: DriverShareRow[];
  template: ShareLine[];
  sources: ShareSource[];
  /** Được sửa mẫu (chọn, đổi tên, sắp xếp dòng) */
  canEditTemplate: boolean;
  /** Được tạo trường bổ sung mới cho hồ sơ tài xế */
  canAddField: boolean;
  /** CSDL chưa chạy SQL nâng cấp mẫu tự cấu hình (dùng mẫu cố định 4 dòng) */
  legacy: boolean;
};

const NOT_UPGRADED = "Cơ sở dữ liệu chưa nâng cấp cho chức năng Thông tin tài xế. Vui lòng chạy SQL nâng cấp số 35 (nang-cap-thong-tin-tai-xe.sql).";
const TEMPLATE_NOT_UPGRADED = "Chưa chạy SQL nâng cấp số 45 (nang-cap-mau-thong-tin-tai-xe.sql) nên chưa lưu được mẫu tự chọn trường.";
const notUpgraded = (e: { code?: string; message?: string }) => e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? "");

type FieldDefRow = { module: string; field_key: string; label: string; data_type: string; options: unknown; view_permission: string | null };

/** Dữ liệu tài xế, xe, chuyến + mẫu dòng đang dùng để ghép văn bản gửi khách hàng */
export async function loadDriverShareInfo(shipmentIds: string[]): Promise<ActionResult<DriverShareInfo>> {
  return runAction(async () => {
    const me = await requirePermission("dispatch.view", "shipments.view");
    const ids = z.array(z.uuid()).min(1).max(500).safeParse(shipmentIds);
    if (!ids.success) throw new ActionError("Chưa chọn chuyến");
    const supabase = await createClient();
    const canEditTemplate = me.permissions.has("dispatch.update") || me.permissions.has("settings.configure");
    const canAddField = me.permissions.has("fields.configure");

    const [shareRes, tplRes, fieldRes] = await Promise.all([
      supabase.rpc("shipment_driver_share", { p_shipment_ids: ids.data }),
      supabase.from("system_settings").select("value").eq("key", "driver.share_template").maybeSingle(),
      supabase
        .from("field_definitions")
        .select("module, field_key, label, data_type, options, view_permission")
        .in("module", ["drivers", "vehicles"])
        .eq("status", "active")
        .order("sort_order"),
    ]);

    // Trường bổ sung người dùng tự thêm (bỏ trường người xem không có quyền)
    const defs = ((fieldRes.data ?? []) as FieldDefRow[]).filter((d) => !d.view_permission || me.permissions.has(d.view_permission as never));
    const allowed = { drivers: new Set<string>(), vehicles: new Set<string>() };
    const custom: ShareSource[] = defs.map((d) => {
      allowed[d.module as "drivers" | "vehicles"].add(d.field_key);
      return {
        key: `${d.module === "drivers" ? "cf" : "vcf"}.${d.field_key}`,
        label: `${d.label} (${d.module === "drivers" ? "trường thêm của tài xế" : "trường thêm của xe"})`,
        type: d.data_type,
        options: Array.isArray(d.options) ? (d.options as ShareSource["options"]) : undefined,
      };
    });
    const sources = [...SHARE_BUILTIN_SOURCES, ...custom];

    if (shareRes.error) {
      if (!notUpgraded(shareRes.error)) throw shareRes.error;
      // CSDL chưa chạy SQL mẫu tự cấu hình: dùng hàm cũ, mẫu cố định
      const { data, error } = await supabase.rpc("shipment_driver_info", { p_shipment_ids: ids.data });
      if (error) {
        if (notUpgraded(error)) throw new ActionError(NOT_UPGRADED);
        throw error;
      }
      const rows = ((data ?? []) as { shipment_id: string; shipment_code: string; driver_id: string | null; driver_name: string | null; plate_number: string | null; national_id: string | null; license_no: string | null }[]).map(
        (r): DriverShareRow => ({
          shipment_id: r.shipment_id,
          shipment_code: r.shipment_code,
          driver_id: r.driver_id,
          data: r.driver_id ? { full_name: r.driver_name, plate_number: r.plate_number, national_id: r.national_id, license_no: r.license_no } : null,
        }),
      );
      return { rows, template: DEFAULT_SHARE_TEMPLATE, sources: SHARE_BUILTIN_SOURCES, canEditTemplate: false, canAddField: false, legacy: true };
    }

    const rows = ((shareRes.data ?? []) as DriverShareRow[]).map((r) => {
      if (!r.data) return r;
      const pick = (obj: unknown, keys: Set<string>) =>
        Object.fromEntries(Object.entries((obj ?? {}) as Record<string, unknown>).filter(([k]) => keys.has(k)));
      return { ...r, data: { ...r.data, cf: pick(r.data.cf, allowed.drivers), vcf: pick(r.data.vcf, allowed.vehicles) } };
    });
    const saved = tplRes.data?.value;
    const template = Array.isArray(saved) && saved.length ? (saved as ShareLine[]) : DEFAULT_SHARE_TEMPLATE;
    return { rows, template, sources, canEditTemplate, canAddField, legacy: false };
  });
}

const lineSchema = z.object({
  label: z.string().trim().min(1, "Tên dòng không được để trống").max(60, "Tên dòng tối đa 60 ký tự"),
  source: z.string().regex(/^(v?cf\.)?[a-z][a-z0-9_]{0,62}$/, "Trường dữ liệu không hợp lệ"),
});

/** Lưu mẫu dòng (dùng chung cho mọi người) */
export async function saveDriverShareTemplate(lines: ShareLine[]): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "settings.configure");
    const p = z.array(lineSchema).min(1, "Mẫu phải có ít nhất một dòng").max(40, "Mẫu tối đa 40 dòng").safeParse(lines);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Mẫu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_driver_share_template", { p_template: p.data });
    if (error) {
      if (notUpgraded(error)) throw new ActionError(TEMPLATE_NOT_UPGRADED);
      throw error;
    }
  }, "Đã lưu mẫu thông tin tài xế cho mọi người.");
}

const fillSchema = z.object({
  driverId: z.uuid(),
  nationalId: z.string().trim().max(20, "Số CCCD tối đa 20 ký tự").optional(),
  licenseNo: z.string().trim().max(30, "Số GPLX tối đa 30 ký tự").optional(),
});

/** Điền nhanh CCCD / GPLX còn thiếu (điều phối chỉ điền ô trống) */
export async function fillDriverShareInfo(input: z.input<typeof fillSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "drivers.update");
    const p = fillSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_driver_share_info", {
      p_driver_id: p.data.driverId,
      p_national_id: p.data.nationalId || null,
      p_license_no: p.data.licenseNo || null,
    });
    if (error) {
      if (notUpgraded(error)) throw new ActionError(NOT_UPGRADED);
      throw error;
    }
    revalidatePath(`/tai-xe/${p.data.driverId}`);
  }, "Đã lưu giấy tờ tài xế.");
}
