"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="vi">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 16 }}>
          <h1 style={{ fontSize: 18 }}>Hệ thống đang gặp sự cố</h1>
          <p style={{ color: "#666", fontSize: 14 }}>Vui lòng thử lại sau ít phút. Dữ liệu của bạn chưa bị thay đổi.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px" }}>
            Thử lại
          </button>
        </div>
      </body>
    </html>
  );
}
