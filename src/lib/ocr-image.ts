"use client";
/**
 * Đọc ảnh chụp bảng Excel ngay trong trình duyệt (Tesseract, miễn phí, ảnh không gửi đi đâu).
 * Bộ đọc + dữ liệu tiếng Việt tải từ CDN ở lần dùng đầu (vài MB), các lần sau trình duyệt dùng lại.
 */
import { findGridLines, wordsToGrid, type OcrGrid, type OcrWord } from "@/lib/ocr-table";

type TWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
let workerP: Promise<TWorker> | null = null;
let progress: ((p: number) => void) | null = null;

async function getWorker(): Promise<TWorker> {
  workerP ??= (async () => {
    const T = await import("tesseract.js");
    const w = await T.createWorker(["vie", "eng"], T.OEM.LSTM_ONLY, {
      logger: (m) => {
        if (m.status === "recognizing text") progress?.(m.progress);
      },
    });
    await w.setParameters({ tessedit_pageseg_mode: T.PSM.SPARSE_TEXT, preserve_interword_spaces: "1", user_defined_dpi: "300" });
    return w;
  })().catch((e) => {
    workerP = null;
    throw e;
  });
  return workerP;
}

/** Phóng to ảnh chụp màn hình (chữ Excel nhỏ) để đọc chính xác hơn */
function scaleFor(w: number) {
  return Math.max(1, Math.min(3, 3200 / Math.max(1, w)));
}

export async function ocrTableImage(file: Blob, onProgress?: (p: number) => void): Promise<OcrGrid> {
  const bmp = await createImageBitmap(file);
  const s = scaleFor(bmp.width);
  const w = Math.round(bmp.width * s);
  const h = Math.round(bmp.height * s);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = Math.round(0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]);
  const lines = findGridLines(gray, w, h);

  // Xóa đường kẻ ô và làm sạch nền (ô tô màu vàng/cam) để bộ đọc không nhầm thành chữ
  const pad = Math.ceil(s) + 1;
  const white = (x: number, y: number) => (gray[y * w + x] = 255);
  for (const x of lines.xs) for (let dx = -pad; dx <= pad; dx++) if (x + dx >= 0 && x + dx < w) for (let y = 0; y < h; y++) white(x + dx, y);
  for (const y of lines.ys) for (let dy = -pad; dy <= pad; dy++) if (y + dy >= 0 && y + dy < h) for (let x = 0; x < w; x++) white(x, y + dy);
  for (let i = 0; i < w * h; i++) {
    const v = gray[i] > 170 ? 255 : gray[i];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  progress = onProgress ?? null;
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  progress = null;
  const words: OcrWord[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines) for (const wd of l.words) words.push({ text: wd.text, conf: wd.confidence, ...wd.bbox });
  return wordsToGrid(words, lines, { w, h });
}
