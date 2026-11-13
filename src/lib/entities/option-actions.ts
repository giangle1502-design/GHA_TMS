"use server";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { isUuid } from "@/lib/entities/record";
import type { Option } from "@/lib/entities/types";

/**
 * Nút + cạnh ô chọn của trường bổ sung: thêm một lựa chọn vào trường rồi trả về để chọn luôn.
 * Trùng tên/mã (không phân biệt hoa thường) thì trả về lựa chọn đã có.
 */
export async function addFieldOption(fieldId: string, label: string): Promise<ActionResult<Option & { existed: boolean }>> {
  return runAction(async () => {
    if (!isUuid(fieldId)) throw new ActionError("Trường không hợp lệ");
    const name = label.replace(/\s+/g, " ").trim();
    if (!name) throw new ActionError("Nhập tên lựa chọn");
    if (name.length > 200) throw new ActionError("Tên lựa chọn tối đa 200 ký tự");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_field_option", { p_field_id: fieldId, p_label: name });
    if (!error) return data as Option & { existed: boolean };
    // CSDL chưa chạy nâng cấp 0048: người có quyền Cấu hình trường vẫn thêm được qua hàm lưu trường sẵn có
    if (error.code !== "PGRST202" && error.code !== "42883") throw error;
    await requirePermission("fields.configure").catch(() => {
      throw new ActionError("Chưa bật thêm lựa chọn cho người nhập liệu: quản trị cần chạy tệp nâng cấp nang-cap-them-lua-chon.sql trên Supabase.");
    });
    const { data: row, error: e1 } = await supabase.from("field_definitions").select("*").eq("id", fieldId).eq("status", "active").maybeSingle();
    if (e1) throw e1;
    if (!row) throw new ActionError("Không tìm thấy trường dữ liệu");
    if (row.data_type !== "single_select" && row.data_type !== "multi_select") throw new ActionError("Trường này không phải danh sách chọn");
    const options: Option[] = ((row.options ?? []) as (Option | string)[]).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    const low = name.toLowerCase();
    const found = options.find((o) => o.value.toLowerCase() === low || o.label.toLowerCase() === low);
    if (found) return { ...found, existed: true };
    const opt = { value: name, label: name };
    const { error: e2 } = await supabase.rpc("save_field_definition", {
      p_id: fieldId,
      p_values: { ...row, options: [...options, opt] },
      p_change_note: `Thêm lựa chọn "${name}" ngay tại biểu mẫu`,
    });
    if (e2) throw e2;
    return { ...opt, existed: false };
  });
}
