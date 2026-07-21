import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  reactCompiler: true,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
