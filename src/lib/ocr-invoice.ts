"use client";
/**
 * Đọc chữ trên ảnh hóa đơn ngay trong trình duyệt (Tesseract, ảnh không gửi đi đâu, không lưu).
 * Dùng bộ đọc riêng (chế độ trang tự động) với bộ đọc bảng Excel ở ocr-image.ts.
 */
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
    await w.setParameters({ tessedit_pageseg_mode: T.PSM.AUTO, preserve_interword_spaces: "1", user_defined_dpi: "300" });
    return w;
  })().catch((e) => {
    workerP = null;
    throw e;
  });
  return workerP;
}

/** Ảnh -> chữ (giữ xuống dòng). Ảnh nhỏ được phóng to, nền hoa văn mờ được làm trắng để đọc chính xác hơn. */
export async function ocrInvoiceText(file: Blob, onProgress?: (p: number) => void): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.max(1, Math.min(4, 2400 / Math.max(1, bmp.width)));
  const w = Math.round(bmp.width * s);
  const h = Math.round(bmp.height * s);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    const g = Math.round(0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]);
    const v = g > 160 ? 255 : g;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  progress = onProgress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas);
    return data.text ?? "";
  } finally {
    progress = null;
  }
}
