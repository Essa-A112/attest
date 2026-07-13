import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Policy uploads (PDF/docx) go through a server action.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
