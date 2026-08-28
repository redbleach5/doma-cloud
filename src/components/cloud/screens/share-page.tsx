"use client";

import * as React from "react";
import { api } from "@/lib/cloud/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Download,
  Lock,
  Loader2,
  Clock,
  Eye,
  AlertCircle,
} from "lucide-react";
import { formatBytes, formatRelative } from "@/lib/cloud/format";
import { FilePreviewBody, type PreviewableFile } from "@/components/cloud/file-preview-body";
import { LightRays } from "@/components/cloud/decor/light-rays";
import { DomaBrand } from "@/components/cloud/doma-brand";
import { toast } from "sonner";

interface Props {
  status: "ok" | "not_found" | "expired" | "exhausted";
  token?: string;
  hasPassword?: boolean;
}

/**
 * Share page — client component.
 *
 * #5 — File metadata (name, size, id) is NEVER in the server-rendered HTML.
 * This component fetches it via POST /api/share/[token] AFTER password
 * verification (or immediately if no password). This prevents SSR metadata
 * leakage for password-protected shares.
 */
export function SharePage(props: Props) {
  if (props.status !== "ok") {
    return <ErrorState status={props.status} />;
  }

  return <ShareLoader token={props.token!} hasPassword={props.hasPassword ?? false} />;
}

/** Fetches share metadata after (optionally) verifying the password. */
function ShareLoader({ token, hasPassword }: { token: string; hasPassword: boolean }) {
  const [passwordVerified, setPasswordVerified] = React.useState(!hasPassword);
  const [fileData, setFileData] = React.useState<{
    file: PreviewableFile;
    downloadUrl: string;
    expiresAt: string | null;
    maxViews: number | null;
    usedCount: number;
    hasPassword: boolean;
  } | null>(null);
  const [loading, setLoading] = React.useState(!hasPassword);
  const [error, setError] = React.useState<string | null>(null);

  // If no password, auto-verify immediately.
  React.useEffect(() => {
    if (hasPassword) return;
    verifyShare(token, undefined).then(setFileData).catch(setError).finally(() => setLoading(false));
  }, [token, hasPassword]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Открываем файл…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!passwordVerified) {
    return (
      <PasswordGate
        token={token}
        onVerified={(data) => {
          setPasswordVerified(true);
          setFileData(data);
        }}
      />
    );
  }

  if (!fileData) {
    return null;
  }

  return (
    <PublicPreview
      file={fileData.file}
      downloadUrl={fileData.downloadUrl}
      shareToken={token}
      expiresAt={fileData.expiresAt}
      maxViews={fileData.maxViews}
      usedCount={fileData.usedCount}
    />
  );
}

async function verifyShare(token: string, password?: string) {
  const data = await api.verifyShare(token, password);
  return {
    file: data.file,
    downloadUrl: data.downloadUrl,
    expiresAt: data.share.expiresAt,
    maxViews: data.share.maxViews,
    usedCount: data.share.usedCount,
    hasPassword: data.share.hasPassword,
  };
}

function ErrorState({ status }: { status: "not_found" | "expired" | "exhausted" }) {
  const config = {
    not_found: {
      icon: <AlertCircle className="h-10 w-10" />,
      title: "Ссылка не найдена",
      text: "Возможно, ссылка была удалена или вы ввели её с опечаткой.",
    },
    expired: {
      icon: <Clock className="h-10 w-10" />,
      title: "Срок действия истёк",
      text: "Эта ссылка больше не активна. Попросите владельца создать новую.",
    },
    exhausted: {
      icon: <Eye className="h-10 w-10" />,
      title: "Лимит просмотров исчерпан",
      text: "Эта ссылка была открыта максимальное количество раз.",
    },
  }[status];

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <LightRays />
      <div className="text-center max-w-sm">
        <div className="h-16 w-16 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto mb-4 text-muted-foreground">
          {config.icon}
        </div>
        <h1 className="text-xl font-semibold mb-2">{config.title}</h1>
        <p className="text-sm text-muted-foreground">{config.text}</p>
      </div>
    </div>
  );
}

function PasswordGate({
  token,
  onVerified,
}: {
  token: string;
  onVerified: (data: Awaited<ReturnType<typeof verifyShare>>) => void;
}) {
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await verifyShare(token, password);
      onVerified(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Неверный пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <LightRays />
      <Card className="w-full max-w-md border-primary/10 shadow-lg shadow-primary/5">
        <div className="flex flex-col items-center text-center pt-8">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3 ring-4 ring-primary/5">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">Защищено паролем</h1>
          <p className="text-sm text-muted-foreground mt-1 mb-6 px-6">
            Введите пароль, чтобы открыть этот файл.
          </p>
        </div>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
                className="h-11"
                data-testid="share-page-password"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 gap-2"
              data-testid="share-page-open"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Проверяем…
                </>
              ) : (
                "Открыть"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PublicPreview({
  file,
  downloadUrl,
  shareToken,
  expiresAt,
  maxViews,
  usedCount,
}: {
  file: PreviewableFile;
  downloadUrl: string;
  shareToken: string;
  expiresAt: string | null;
  maxViews: number | null;
  usedCount: number;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <LightRays />
      <header
        className="border-b border-border/60 bg-background/85 backdrop-blur sticky top-0 z-10"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <DomaBrand />
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {expiresAt && (
              <span className="hidden sm:inline">
                действует до {formatRelative(expiresAt)}
              </span>
            )}
            {maxViews != null && (
              <span>
                {usedCount} / {maxViews} просм.
              </span>
            )}
          </div>
          <Button asChild size="sm" className="gap-1.5 shadow-sm">
            <a href={downloadUrl} download={file.name} data-testid="share-page-download">
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Скачать</span>
            </a>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <div className="px-4 py-2 border-b border-border/40 bg-muted/20">
          <div className="max-w-6xl mx-auto flex items-center gap-2">
            <div className="font-medium truncate">{file.name}</div>
            <div className="text-xs text-muted-foreground shrink-0">
              {formatBytes(file.sizeBytes)}
            </div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center bg-muted/30 p-2 sm:p-4">
          <FilePreviewBody item={file} url={downloadUrl} shareToken={shareToken} />
        </div>
      </main>
    </div>
  );
}
