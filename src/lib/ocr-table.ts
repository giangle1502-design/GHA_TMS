/**
 * Dựng lại bảng từ kết quả OCR của ảnh chụp màn hình Excel.
 * Phần thuần (không gọi trình duyệt/OCR) để kiểm thử: tìm đường kẻ ô, xếp chữ vào ô.
 */

export type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number; conf: number };
export type OcrGrid = { rows: string[][]; /** ô có chữ đọc chưa chắc (độ tin cậy thấp) */ unsure: boolean[][] };

/** Độ tin cậy dưới mức này thì đánh dấu ô "đọc chưa chắc" */
export const UNSURE_CONF = 75;

/**
 * Tìm đường kẻ ô của Excel trong ảnh xám (0 = đen, 255 = trắng).
 * Một cột điểm ảnh là đường kẻ dọc khi ở ≥ 60% chiều cao nó tối hơn hai bên (nút lọc, chữ sát đường kẻ
 * làm đứt một phần); nét chữ không đủ dài nên không bị nhận nhầm. Đường kẻ ngang tương tự.
 */
export function findGridLines(gray: Uint8Array | Uint8ClampedArray | number[], w: number, h: number): { xs: number[]; ys: number[] } {
  const at = (x: number, y: number) => gray[y * w + x];
  const darker = (v: number, a: number, b: number) => v <= Math.min(a, b) - 10 || (v < 200 && v <= Math.min(a, b) - 6);
  const scan = (len: number, span: number, isLine: (i: number, j: number) => boolean) => {
    const hits: number[] = [];
    for (let i = 2; i < len - 2; i++) {
      let n = 0;
      for (let j = 0; j < span; j++) if (isLine(i, j)) n++;
      if (n >= span * 0.6) hits.push(i);
    }
    // gộp các điểm liền nhau (đường kẻ dày 1-3 điểm ảnh)
    const out: number[] = [];
    let start = -10;
    let prev = -10;
    for (const i of hits) {
      if (i - prev > 2) {
        if (prev >= 0) out.push(Math.round((start + prev) / 2));
        start = i;
      }
      prev = i;
    }
    if (prev >= 0) out.push(Math.round((start + prev) / 2));
    return out;
  };
  const xs = scan(w, h, (x, y) => darker(at(x, y), at(x - 2, y), at(x + 2, y)));
  const ys = scan(h, w, (y, x) => darker(at(x, y), at(x, y - 2), at(x, y + 2)));
  return { xs, ys };
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
};

/** Ký tự rác do đường kẻ, nút lọc của Excel */
const JUNK = /^[|¦!\[\]{}()_~=—–,.;:»«'"`]+$/;

/** Chia khoảng [0, size] theo đường kẻ; bỏ dải quá hẹp (hai đường kẻ sát nhau) */
function bands(lines: number[], size: number, minGap: number): [number, number][] {
  const cuts = [0, ...lines, size];
  const out: [number, number][] = [];
  for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] - cuts[i] >= minGap) out.push([cuts[i], cuts[i + 1]]);
  return out;
}

/** Không có đường kẻ: gom theo khoảng trống giữa các chữ */
function clusters(items: { lo: number; hi: number }[], gap: number): [number, number][] {
  const s = [...items].sort((a, b) => a.lo - b.lo);
  const out: [number, number][] = [];
  for (const it of s) {
    const last = out[out.length - 1];
    if (last && it.lo - last[1] <= gap) last[1] = Math.max(last[1], it.hi);
    else out.push([it.lo, it.hi]);
  }
  return out;
}

/** Xếp chữ OCR vào ô theo đường kẻ (nếu có) hoặc theo khoảng trống */
export function wordsToGrid(input: OcrWord[], lines: { xs: number[]; ys: number[] }, size: { w: number; h: number }): OcrGrid {
  const words = input.filter((w) => w.text.trim() && !JUNK.test(w.text.trim()));
  if (!words.length) return { rows: [], unsure: [] };
  const hgt = median(words.map((w) => w.y1 - w.y0)) || 10;

  const rowBands =
    lines.ys.length >= 2
      ? bands(lines.ys, size.h, hgt * 0.8)
      : clusters(
          words.map((w) => ({ lo: (w.y0 + w.y1) / 2 - hgt * 0.35, hi: (w.y0 + w.y1) / 2 + hgt * 0.35 })),
          hgt * 0.2,
        );
  const colBands =
    lines.xs.length >= 2
      ? bands(lines.xs, size.w, hgt * 0.8)
      : clusters(
          words.map((w) => ({ lo: w.x0, hi: w.x1 })),
          hgt * 1.1,
        );
  const find = (b: [number, number][], v: number) => b.findIndex(([lo, hi]) => v >= lo && v < hi);

  const cells = new Map<string, OcrWord[]>();
  for (const w of words) {
    const r = find(rowBands, (w.y0 + w.y1) / 2);
    const c = find(colBands, (w.x0 + w.x1) / 2);
    if (r < 0 || c < 0) continue;
    const k = `${r}:${c}`;
    cells.set(k, [...(cells.get(k) ?? []), w]);
  }
  const usedCols = colBands.map((_, c) => rowBands.some((_, r) => cells.has(`${r}:${c}`)));
  const rows: string[][] = [];
  const unsure: boolean[][] = [];
  rowBands.forEach((_, r) => {
    const line: string[] = [];
    const flag: boolean[] = [];
    colBands.forEach((_, c) => {
      if (!usedCols[c]) return;
      const cy = (w: OcrWord) => (w.y0 + w.y1) / 2;
      const ws = (cells.get(`${r}:${c}`) ?? []).sort((a, b) => (Math.abs(cy(a) - cy(b)) > hgt * 0.6 ? cy(a) - cy(b) : a.x0 - b.x0));
      // Tiêu đề ngắt dòng ("LUỒN" + "G KHAI"): nối liền khi dòng trên kết thúc giữa từ là việc của người xem, ở đây nối bằng dấu cách
      line.push(ws.map((w) => w.text.trim().replace(/^[|¦]+|[|¦]+$/g, "")).filter(Boolean).join(" "));
      flag.push(ws.some((w) => w.conf < UNSURE_CONF));
    });
    if (line.some((x) => x)) {
      rows.push(line);
      unsure.push(flag);
    }
  });
  return { rows, unsure };
}

/** Bảng → văn bản dạng tab (như copy từ Excel) */
export const gridToTSV = (rows: string[][]) => rows.map((r) => r.map((c) => c.replace(/[\t\n]/g, " ")).join("\t")).join("\n");
