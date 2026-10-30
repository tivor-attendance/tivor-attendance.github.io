import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds the GitHub Pages version (no server; data stored in the browser).
const staticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  ...(staticExport ? { output: "export" as const, distDir: "out", trailingSlash: true, images: { unoptimized: true }, basePath } : {}),
  // PDF/Excel generation libraries read font & template files from disk at runtime.
  serverExternalPackages: ["pdfkit", "exceljs", "node-cron", "bcryptjs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
