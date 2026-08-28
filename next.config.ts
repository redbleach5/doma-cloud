import type { NextConfig } from "next";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

/** This package directory — keeps Turbopack from climbing to ~/bun.lock. */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Current non-loopback IPv4 addresses on this machine.
 * Re-read every time `next dev` starts — DHCP changes apply on restart.
 */
function lanDevOrigins(): string[] {
  const hosts = new Set<string>(["*.local"]);

  try {
    for (const nets of Object.values(os.networkInterfaces())) {
      for (const net of nets ?? []) {
        // Node typings: `net.family` is a string in modern Node ("IPv4" /
        // "IPv6"), but historically was a number (4 / 6). Compare as strings
        // and also accept the legacy numeric value via String() to satisfy
        // both typings and runtime across Node versions.
        const fam = String(net.family);
        const v4 = fam === "IPv4" || fam === "4";
        if (!v4 || net.internal) continue;
        hosts.add(net.address);
      }
    }
  } catch {
    // Restricted environments — localhost still works.
  }

  for (const extra of (process.env.DOMA_DEV_ORIGINS ?? "").split(",")) {
    const h = extra.trim();
    if (h) hosts.add(h);
  }

  return [...hosts];
}

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Don't leak the framework in the X-Powered-By header.
  poweredByHeader: false,
  // Hide the floating "N" Next.js badge — clutters mobile LAN testing.
  // Errors still surface via the overlay when something breaks.
  devIndicators: false,
  turbopack: {
    // Pin the app root so a stray lockfile in $HOME does not become the workspace.
    root: projectRoot,
  },
  allowedDevOrigins: lanDevOrigins(),
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  serverExternalPackages: [
    "@node-rs/argon2",
    "archiver",
  ],
};

export default nextConfig;
