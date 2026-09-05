import { db } from "@/lib/db";
import { CloudApp } from "@/components/cloud/cloud-app";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const userCount = await db.user.count();
  const needsSetup = userCount === 0;

  let me: Awaited<ReturnType<typeof getMe>> = null;
  if (!needsSetup) {
    me = await getMe();
  }

  return <CloudApp needsSetup={needsSetup} initialUser={me} />;
}

async function getMe() {
  const { getSession } = await import("@/lib/auth/session");
  const session = await getSession();
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;
  // Read the cached `usedBytes` — maintained incrementally by upload/delete.
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as "admin" | "user",
    quotaBytes: user.quotaBytes.toString(),
    usedBytes: user.usedBytes.toString(),
    createdAt: user.createdAt.toISOString(),
  };
}
