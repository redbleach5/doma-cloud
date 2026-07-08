import { db } from "@/lib/db";
import { SharePage } from "@/components/cloud/screens/share-page";

export const dynamic = "force-dynamic";

export default async function ShareRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const share = await db.share.findUnique({
    where: { token },
    include: { file: { select: { deletedAt: true } } },
  });

  // #5 — SSR leak prevention: do NOT include file metadata (id, name, size)
  // in the server-rendered HTML. The client-side SharePage component fetches
  // metadata via POST /api/share/[token] AFTER password verification.
  //
  // This prevents metadata leakage in the page source for password-protected
  // shares — an attacker who opens the share URL without the password should
  // not see the filename or file ID.

  if (!share) {
    return <SharePage status="not_found" />;
  }
  if (share.expiresAt && share.expiresAt < new Date()) {
    return <SharePage status="expired" />;
  }
  if (share.maxViews && share.usedCount >= share.maxViews) {
    return <SharePage status="exhausted" />;
  }
  if (share.file.deletedAt) {
    return <SharePage status="not_found" />;
  }

  // Pass ONLY the token + whether a password is required.
  // The actual file metadata is fetched client-side after verification.
  return (
    <SharePage
      status="ok"
      token={share.token}
      hasPassword={!!share.passwordHash}
    />
  );
}
