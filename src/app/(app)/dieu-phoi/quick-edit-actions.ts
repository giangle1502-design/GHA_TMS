"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { todayVN } from "@/lib/format";
import { normalizeContainerNo } from "@/lib/shipment-container";
import { vehicleTripsOnDay } from "./actions";

/*
 * Sửa nhanh ngay trên bảng Điều phối / Quản lý chuyến (không mở chi tiết chuyến):
 * - Số cont (shipments.container_no)
 * - Số xe: chọn xe nội bộ trong danh mục xe, giữ tài xế đang phân công
 */

const uuid = z.uuid("Giá trị không hợp lệ");

const containerSchema = z.object({
  shipmentId: uuid,
  containerNo: z.string().max(60),
});

/** Ghi Số cont của chuyến; để trống = xóa số cont */
export async function setShipmentContainerNo(input: z.input<typeof containerSchema>): Promise<ActionResult<{ containerNo: string | null }>> {
  return runAction(async () => {
    await requirePermission("shipments.update", "dispatch.update");
    const p = containerSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const no = normalizeContainerNo(p.data.containerNo) || null;
    if (no && no.length > 30) throw new ActionError("Số cont tối đa 30 ký tự.");
    if (no && !/^[A-Z0-9]+$/.test(no)) throw new ActionError("Số cont chỉ gồm chữ và số (VD: TCLU1234567).");
    const supabase = await createClient();
    const { data: cur, error: curErr } = await supabase.from("shipments").select("status, container_no").eq("id", p.data.shipmentId).maybeSingle();
    if (curErr) throw curErr;
    if (!cur) throw new ActionError("Không tìm thấy chuyến.");
    if (cur.status === "cancelled") throw new ActionError("Chuyến đã hủy, không sửa được số cont.");
    if ((cur.container_no ?? null) === no) return { containerNo: no };
    const { data, error } = await supabase.from("shipments").update({ container_no: no }).eq("id", p.data.shipmentId).select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Bạn không có quyền sửa chuyến này.");
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    return { containerNo: no };
  }, input.containerNo.trim() ? "Đã lưu số cont." : "Đã xóa số cont.");
}

const vehicleSchema = z.object({ shipmentId: uuid, vehicleId: uuid });

/** Trạng thái còn đổi được xe (giống hộp Phân công) */
const CHANGEABLE = ["draft", "assigned", "accepted"];

/**
 * Đổi số xe của chuyến bằng xe nội bộ trong danh mục.
 * Giữ tài xế đang phân công; chuyến chưa có tài xế thì lấy tài xế phụ trách xe (hoặc tài xế chạy xe gần nhất).
 * Xe mới đã có chuyến khác cùng ngày thì chuyến này xếp thứ tự kế tiếp (sửa lại ở cột Thứ tự xe nếu cần).
 * Chuyến chạy xe 3PL không đổi ở đây: dùng nút Đổi (hộp phân công 3PL).
 */
export type VehicleChangeResult = {
  plate: string;
  /** Tài xế được tự chọn theo xe (chuyến chưa có tài xế) */
  driverName: string | null;
  /** Chuyến chưa có tài xế và không tìm được tài xế theo xe: chuyến ở Nháp, cần Phân công */
  noDriver: boolean;
  /** Số chuyến khác của xe mới trong cùng ngày, và thứ tự đã xếp cho chuyến này */
  sameDay: number;
  order: number | null;
  unchanged?: boolean;
};

export async function changeShipmentVehicle(input: z.input<typeof vehicleSchema>): Promise<ActionResult<VehicleChangeResult>> {
  return runAction(async () => {
    await requirePermission("dispatch.update");
    const p = vehicleSchema.safeParse(input);
    if (!p.success) throw new ActionError("Dữ liệu không hợp lệ");
    const { shipmentId, vehicleId } = p.data;
    const supabase = await createClient();

    const { data: s, error: sErr } = await supabase
      .from("shipments")
      .select("id, status, driver_id, vehicle_id, pickup_at, carrier_supplier_id")
      .eq("id", shipmentId)
      .maybeSingle();
    if (sErr) throw sErr;
    if (!s) throw new ActionError("Không tìm thấy chuyến.");
    if (!CHANGEABLE.includes(s.status as string))
      throw new ActionError("Chỉ đổi xe được khi chuyến chưa chạy (Nháp, Chờ tài xế nhận, Tài xế đã nhận).");

    const { data: v, error: vErr } = await supabase
      .from("vehicles")
      .select("id, plate_number, assigned_driver_id, ownership_type, supplier_id")
      .eq("id", vehicleId)
      .maybeSingle();
    if (vErr) throw vErr;
    if (!v) throw new ActionError("Không tìm thấy xe.");
    if (v.ownership_type === "outsourced" || v.supplier_id) throw new ActionError("Xe 3PL: bấm Đổi ở Điều phối để giao cho nhà xe 3PL.");
    if (s.vehicle_id === vehicleId) return { plate: v.plate_number as string, driverName: null, noDriver: !s.driver_id, sameDay: 0, order: null, unchanged: true };

    // Chuyến đang chạy xe 3PL (xe 3PL đang gắn hoặc đã ghi nhà xe 3PL): sửa trong hộp phân công
    if (s.carrier_supplier_id) throw new ActionError("Chuyến đã giao cho nhà xe 3PL: bấm Đổi ở Điều phối để sửa.");
    if (s.vehicle_id) {
      const { data: old } = await supabase.from("vehicles").select("ownership_type, supplier_id").eq("id", s.vehicle_id).maybeSingle();
      if (old && (old.ownership_type === "outsourced" || old.supplier_id)) throw new ActionError("Chuyến đang chạy xe 3PL: bấm Đổi ở Điều phối để sửa.");
    }

    // Tài xế: giữ người đang phân công; chưa có thì gợi ý theo xe
    let driverId = (s.driver_id as string | null) ?? null;
    let pickedDriver = false;
    if (!driverId) {
      driverId = (v.assigned_driver_id as string | null) ?? null;
      if (!driverId) {
        const { data: last } = await supabase
          .from("shipments")
          .select("driver_id")
          .eq("vehicle_id", vehicleId)
          .not("driver_id", "is", null)
          .neq("status", "cancelled")
          .order("pickup_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        driverId = (last?.driver_id as string | null) ?? null;
      }
      if (driverId) {
        // Chỉ dùng tài xế nội bộ đang làm việc
        const { data: d } = await supabase.from("drivers").select("status, is_outsourced, archived_at").eq("id", driverId).maybeSingle();
        if (!d || d.status !== "active" || d.is_outsourced || d.archived_at) driverId = null;
      }
      pickedDriver = Boolean(driverId);
    }

    // Thứ tự của xe mới trong ngày
    const day = todayVN(new Date(s.pickup_at as string));
    const others = await vehicleTripsOnDay({ vehicleId, day, excludeShipmentId: shipmentId });
    const trips = others.ok ? (others.data ?? []) : [];
    const next = trips.length ? Math.max(trips.length, ...trips.map((t) => t.vehicle_day_order ?? 0)) + 1 : null;
    const order = next && next <= 99 ? next : null;

    const { error } = await supabase.rpc("assign_shipment", { p_shipment_id: shipmentId, p_driver_id: driverId, p_vehicle_id: vehicleId });
    if (error) throw error;
    const { error: oErr } = await supabase.rpc("set_vehicle_day_order", { p_shipment_id: shipmentId, p_order: order });
    if (oErr) throw oErr;

    let driverName: string | null = null;
    if (pickedDriver && driverId) {
      const { data: d } = await supabase.from("drivers").select("full_name").eq("id", driverId).maybeSingle();
      driverName = (d?.full_name as string | null) ?? null;
    }
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    return { plate: v.plate_number as string, driverName, noDriver: !driverId, sameDay: trips.length, order };
  });
}
