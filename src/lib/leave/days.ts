/** Số ngày nghỉ gợi ý từ ngày bắt đầu đến ngày kết thúc (YYYY-MM-DD), không tính Chủ nhật. */
export function countLeaveDays(start: string, end: string): number {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(start) || !re.test(end) || end < start) return 0;
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  let n = 0;
  for (let t = toUtc(start), last = toUtc(end); t <= last && n < 400; t += 86_400_000) {
    if (new Date(t).getUTCDay() !== 0) n++;
  }
  return n;
}
