/** Số container theo ISO 6346: 4 chữ cái + 7 số, số cuối là số kiểm tra. */
const VALS = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36, 37, 38];

export function normalizeContainerNo(v: string): string {
  return v.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function isValidContainerNo(v: string): boolean {
  const s = normalizeContainerNo(v);
  if (!/^[A-Z]{4}[0-9]{7}$/.test(s)) return false;
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const n = i < 4 ? VALS[s.charCodeAt(i) - 65] : Number(s[i]);
    total += n * 2 ** i;
  }
  return (total % 11) % 10 === Number(s[10]);
}

/** Hiện số cont dễ đọc: CSQU 305438 3 */
export function formatContainerNo(v: string | null | undefined): string {
  const s = normalizeContainerNo(v ?? "");
  return /^[A-Z]{4}[0-9]{7}$/.test(s) ? `${s.slice(0, 4)} ${s.slice(4, 10)} ${s.slice(10)}` : (v ?? "");
}
