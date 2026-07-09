import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // AWS SDK should remain external — it's only loaded when STORAGE_DRIVER=s3.
  serverExternalPackages: ["@aws-sdk/client-s3", "@aws-sdk/lib-storage"],
};

export default nextConfig;
