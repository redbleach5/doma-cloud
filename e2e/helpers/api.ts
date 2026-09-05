/**
 * API helpers for Playwright — seed users/files without relying on the UI.
 */

export const E2E_PASS = "SmokeTest1!";
export const E2E_SHARE_PASS = "SmokeSecret1!";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

type CookieJar = Map<string, string>;

function cookieHeader(jar: CookieJar): string | undefined {
  if (jar.size === 0) return undefined;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorbSetCookie(res: Response, jar: CookieJar) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const m = line.match(/^([^=]+)=([^;]*)/);
    if (m) jar.set(m[1]!, m[2]!);
  }
}

export async function apiJson<T = unknown>(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    form?: FormData;
    jar?: CookieJar;
    expect?: number;
  } = {}
): Promise<{ res: Response; data: T; jar: CookieJar }> {
  const jar = opts.jar ?? new Map<string, string>();
  const headers: Record<string, string> = {};
  const ch = cookieHeader(jar);
  if (ch) headers.Cookie = ch;

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  absorbSetCookie(res, jar);
  const text = await res.text();
  let data: T;
  try {
    data = (text ? JSON.parse(text) : null) as T;
  } catch {
    data = text as unknown as T;
  }

  if (opts.expect !== undefined && res.status !== opts.expect) {
    throw new Error(
      `${method} ${path} → ${res.status} (expected ${opts.expect}): ${text.slice(0, 300)}`
    );
  }
  return { res, data, jar };
}

export function uniqueSuffix(): string {
  // Keep usernames under typical 32-char caps: e2e + base36 time fragment.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Register or reuse a user; returns a session cookie jar after login. */
export async function ensureUser(
  username: string,
  displayName?: string
): Promise<{ username: string; displayName: string; jar: CookieJar }> {
  const name = displayName ?? username;
  let sawRegister = false;

  for (let attempt = 0; attempt < 10; attempt++) {
    const reg = await apiJson("POST", "/api/auth/register", {
      body: { username, displayName: name, password: E2E_PASS },
    });
    if (reg.res.status === 200 || reg.res.status === 409) {
      sawRegister = true;
      break;
    }
    if (reg.res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(
      `register ${username} failed: ${reg.res.status} ${JSON.stringify(reg.data)}`
    );
  }
  if (!sawRegister) {
    throw new Error(`register ${username} failed after rate-limit retries`);
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const login = await apiJson("POST", "/api/auth/login", {
      body: { username, password: E2E_PASS },
    });
    if (login.res.status === 200) {
      return { username, displayName: name, jar: login.jar };
    }
    if (login.res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(
      `login ${username} failed: ${login.res.status} ${JSON.stringify(login.data)}`
    );
  }
  throw new Error(`login ${username} failed after rate-limit retries`);
}

export async function uploadTextFile(
  jar: CookieJar,
  name: string,
  content: string,
  parentId?: string | null
): Promise<{ id: string; name: string }> {
  const form = new FormData();
  form.append("files", new File([content], name, { type: "text/plain" }));
  const qs = parentId ? `?parentId=${parentId}` : "";
  const { data } = await apiJson<{ created?: Array<{ id: string; name: string }> }>(
    "POST",
    `/api/files/upload${qs}`,
    { form, jar, expect: 200 }
  );
  const file = data.created?.[0];
  if (!file?.id) throw new Error(`upload missing id: ${JSON.stringify(data)}`);
  return file;
}

/** Upload a binary blob (e.g. JPEG) for preview e2e. */
export async function uploadBinaryFile(
  jar: CookieJar,
  name: string,
  bytes: Uint8Array,
  mimeType: string,
  parentId?: string | null
): Promise<{ id: string; name: string }> {
  const form = new FormData();
  // Copy into a fresh ArrayBuffer — File rejects SharedArrayBuffer views.
  const copy = new Uint8Array(bytes);
  form.append("files", new File([copy], name, { type: mimeType }));
  const qs = parentId ? `?parentId=${parentId}` : "";
  const { data } = await apiJson<{ created?: Array<{ id: string; name: string }> }>(
    "POST",
    `/api/files/upload${qs}`,
    { form, jar, expect: 200 }
  );
  const file = data.created?.[0];
  if (!file?.id) throw new Error(`upload missing id: ${JSON.stringify(data)}`);
  return file;
}

/** Tiny valid JPEG (2×2) for preview tests. */
export const JPEG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCKAAK2/9k=",
    "base64"
  )
);

export async function createPasswordShare(
  jar: CookieJar,
  fileId: string,
  password = E2E_SHARE_PASS
): Promise<{ token: string }> {
  const { data } = await apiJson<{ token?: string; share?: { token: string } }>(
    "POST",
    `/api/files/${fileId}/share`,
    {
      body: { label: "e2e-pw", password },
      jar,
      expect: 200,
    }
  );
  const token = data.token ?? data.share?.token;
  if (!token) throw new Error(`no share token: ${JSON.stringify(data)}`);
  return { token };
}
