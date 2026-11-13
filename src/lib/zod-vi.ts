import { z } from "zod";

/**
 * Thông báo lỗi kiểm tra dữ liệu (zod) bằng tiếng Việt cho cả ứng dụng.
 * Các câu thường gặp viết dễ hiểu; câu còn lại dùng bản dịch tiếng Việt có sẵn của zod.
 */
const vi = z.locales.vi();
z.config({
  ...vi,
  customError: (iss) => {
    if (iss.code === "invalid_type") {
      if (iss.input === undefined || iss.input === null || iss.input === "") return "Chưa nhập hoặc chưa chọn";
      return "Giá trị không đúng kiểu";
    }
    if (iss.code === "too_big" && iss.origin === "string") return `Tối đa ${String(iss.maximum)} ký tự`;
    if (iss.code === "too_small" && iss.origin === "string") return Number(iss.minimum) <= 1 ? "Chưa nhập" : `Tối thiểu ${String(iss.minimum)} ký tự`;
    if (iss.code === "too_big" && iss.origin === "number") return `Không được lớn hơn ${String(iss.maximum)}`;
    if (iss.code === "too_small" && iss.origin === "number") return `Không được nhỏ hơn ${String(iss.minimum)}`;
    if (iss.code === "invalid_value") return "Giá trị không nằm trong danh sách cho phép";
    return undefined;
  },
});

/** Lấy lỗi đầu tiên, kèm tên trường (theo bảng nhãn) để người dùng biết sửa ô nào */
export function zodMessageVi(error: z.ZodError, labels: Record<string, string> = {}): string {
  const iss = error.issues[0];
  if (!iss) return "Dữ liệu không hợp lệ";
  const key = String(iss.path[0] ?? "");
  const label = labels[key];
  return label && !iss.message.includes(label) ? `${label}: ${iss.message}` : iss.message;
}
