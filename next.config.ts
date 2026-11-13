import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ứng dụng quản trị nội bộ: mọi trang phụ thuộc phiên đăng nhập nên luôn render động.
  poweredByHeader: false,
  // Thư viện đọc/ghi Excel chạy ở máy chủ, không đóng gói vào bundle
  serverExternalPackages: ["exceljs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
