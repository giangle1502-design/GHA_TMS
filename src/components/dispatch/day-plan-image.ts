import { C20_INDEX, DAY_PLAN_COLUMNS, dayPlanTotals, type DayPlan, type DayPlanRow } from "@/lib/day-plan";

export const cellText = (r: DayPlanRow, k: keyof DayPlanRow) => (r[k] === null || r[k] === undefined ? "" : String(r[k]));

/** Vẽ bảng kế hoạch lên canvas (giống mẫu Excel) để chép thành ảnh */
export function drawPlan(plan: DayPlan, address: string, title: string, dateLabel: string): HTMLCanvasElement {
  const scale = 2;
  const font = "Arial, Helvetica, sans-serif";
  const pad = 8;
  const lineH = 18;
  const cols = DAY_PLAN_COLUMNS;
  const width = cols.reduce((a, c) => a + c.px, 0);
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `14px ${font}`;
  const wrap = (text: string, w: number): string[] => {
    if (!text) return [""];
    const out: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (measure.measureText(next).width <= w - pad * 2 || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
    return out;
  };
  const bodyLines = plan.rows.map((r) => cols.map((c) => wrap(cellText(r, c.key), c.px)));
  const rowH = bodyLines.map((ls) => Math.max(...ls.map((l) => l.length)) * lineH + 14);
  const top = 112;
  const hdr1 = 36;
  const hdr2 = 44;
  const footH = 34;
  const height = top + hdr1 + hdr2 + rowH.reduce((a, b) => a + b, 0) + footH * 2 + 16;

  const cv = document.createElement("canvas");
  cv.width = (width + 2) * scale;
  cv.height = height * scale;
  const g = cv.getContext("2d")!;
  g.scale(scale, scale);
  g.translate(1, 0);
  g.fillStyle = "#fff";
  g.fillRect(-1, 0, width + 2, height);
  g.fillStyle = "#000";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `bold 15px ${font}`;
  g.fillText(address, width / 2, 18, width - 16);
  g.font = `bold 22px ${font}`;
  g.fillText(title, width / 2, 54, width - 16);
  g.font = `italic 14px ${font}`;
  g.fillText(dateLabel, width / 2, 86);

  g.strokeStyle = "#000";
  g.lineWidth = 1;
  const box = (x: number, y: number, w: number, h: number, fill?: string) => {
    if (fill) {
      g.fillStyle = fill;
      g.fillRect(x, y, w, h);
      g.fillStyle = "#000";
    }
    g.strokeRect(x + 0.5, y + 0.5, w, h);
  };
  const text = (lines: string[], x: number, y: number, w: number, h: number) => {
    const start = y + h / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => g.fillText(l, x + w / 2, start + i * lineH, w - 4));
  };
  // Tiêu đề 2 tầng
  const head = "#95B3D7";
  g.font = `bold 14px ${font}`;
  let x = 0;
  cols.forEach((c, i) => {
    if (!c.group) {
      box(x, top, c.px, hdr1 + hdr2, head);
      text(wrap(c.label, c.px), x, top, c.px, hdr1 + hdr2);
    } else {
      box(x, top + hdr1, c.px, hdr2, head);
      text([c.label], x, top + hdr1, c.px, hdr2);
      if (cols[i - 1]?.group !== c.group) {
        let w = 0;
        for (let j = i; j < cols.length && cols[j].group === c.group; j++) w += cols[j].px;
        box(x, top, w, hdr1, head);
        text([c.group], x, top, w, hdr1);
      }
    }
    x += c.px;
  });
  // Dữ liệu
  g.font = `14px ${font}`;
  let y = top + hdr1 + hdr2;
  bodyLines.forEach((ls, ri) => {
    x = 0;
    cols.forEach((c, ci) => {
      box(x, y, c.px, rowH[ri]);
      text(ls[ci], x, y, c.px, rowH[ri]);
      x += c.px;
    });
    y += rowH[ri];
  });
  // Dòng tổng: "Tổng" từng loại cont, rồi "TOTAL" = cont 20 + cont 40 (gộp ô dưới hai cột)
  const sum = dayPlanTotals(plan.rows);
  const left = cols.slice(0, C20_INDEX).reduce((a, c) => a + c.px, 0);
  const w20 = cols[C20_INDEX].px;
  const w40 = cols[C20_INDEX + 1].px;
  const rest = width - left - w20 - w40;
  const foot = "#DCE6F1";
  g.font = `bold 14px ${font}`;
  for (const [label, cells] of [
    ["Tổng", [[w20, String(sum.c20)], [w40, String(sum.c40)]]],
    ["TOTAL", [[w20 + w40, String(sum.total)]]],
  ] as [string, [number, string][]][]) {
    box(0, y, left, footH, foot);
    text([label], 0, y, left, footH);
    x = left;
    for (const [w, v] of cells) {
      box(x, y, w, footH, foot);
      text([v], x, y, w, footH);
      x += w;
    }
    if (rest > 0) box(x, y, rest, footH, foot);
    y += footH;
  }
  return cv;
}
