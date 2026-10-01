import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: path.resolve(__dirname) },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" },
    ] }, {
      // The private archive PDF has a same-origin source preview. Keep every
      // other Hub response protected by DENY; the proxy still authorizes reads.
      source: "/api/hub/v1/admin/ads/archive/:documentId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/file",
      headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
    }];
  },
};

export default nextConfig;
