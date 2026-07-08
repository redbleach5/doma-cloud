import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // AWS SDK should remain external — it's only loaded when STORAGE_DRIVER=s3.
  serverExternalPackages: ["@aws-sdk/client-s3", "@aws-sdk/lib-storage"],
  // Allow the sandbox preview domain to access the dev server.
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
