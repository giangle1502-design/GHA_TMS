/**
 * Nhận biết điểm là CẢNG theo tên (Cảng, Port, Terminal, ICD, Cát Lái, ITC, VICT, TCIT, CMIT, Gemalink, SSIT,
 * SPCT, Cái Mép...). Hàng lấy từ cảng thường có phí chi hộ (nâng cont, lưu bãi...) nên form tạo đơn nhắc tick
 * "Có chi hộ". Chỉ xét phần tên (trước " – " của nhãn ô chọn), không xét địa chỉ.
 * Giữ giống biểu thức trong file SQL tick-chi-ho-cont-lay-tu-cang-11-2026.sql (thư mục gha-tms-data).
 */
const PORT_RE =
  /(cảng|(^|[^\p{L}\p{N}])(cang|port|icd|itc|vict|tcit|cmit|ssit|spct)(?![\p{L}\p{N}])|terminal|cát lái|cat lai|gemalink|cái mép|cai mep)/iu;

export function isPortName(label: string | null | undefined): boolean {
  if (!label) return false;
  const name = label.normalize("NFC").split(" – ")[0];
  return PORT_RE.test(name);
}
