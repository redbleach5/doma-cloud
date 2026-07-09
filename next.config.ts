import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Native / heavy packages must remain external — Next.js should NOT try
  // to bundle them into the standalone server output.
  //   - AWS SDK: only loaded when STORAGE_DRIVER=s3
  //   - @node-rs/argon2: native binary, used for password hashing on every login
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/lib-storage",
    "@node-rs/argon2",
  ],
};

export default nextConfig;
