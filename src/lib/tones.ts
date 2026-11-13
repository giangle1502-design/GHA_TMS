/** Màu nhấn dùng chung cho nhãn trạng thái, thẻ số liệu và biểu đồ */
export type Tone = "blue" | "purple" | "red" | "green" | "amber" | "teal" | "pink" | "gray";

/** Biến thể Badge tương ứng với từng màu */
export const TONE_BADGE = {
  blue: "info",
  purple: "purple",
  red: "destructive",
  green: "success",
  amber: "warning",
  teal: "teal",
  pink: "destructive",
  gray: "muted",
} as const satisfies Record<Tone, string>;

/** Biến CSS của màu (dùng cho fill/stroke SVG và nền ô biểu tượng) */
export const toneVar = (t: Tone) => `var(--tone-${t})`;

/** Thứ tự màu cho các chuỗi dữ liệu trong biểu đồ */
export const SERIES_TONES: Tone[] = ["blue", "purple", "amber", "green", "teal", "pink", "red", "gray"];
