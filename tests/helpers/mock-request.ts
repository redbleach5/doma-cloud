/**
 * Helpers for building NextRequest objects in tests.
 *
 * Next.js API route handlers receive a `NextRequest` (extends `Request`)
 * and (for dynamic routes) a `params` Promise. In tests we construct these
 * manually so we can invoke the handler directly without spinning up a
 * server.
 *
 * Key points:
 *   - `req.json()` must work → set body + Content-Type: application/json
 *   - `req.formData()` must work for upload tests → we pass a real FormData
 *   - `req.headers` is a Headers object
 *   - `req.url` must be a valid URL (used by `new URL(req.url)`)
 *   - `req.searchParams` is derived from the URL
 *   - `req.cookies.get(name)` works (NextRequest extension)
 */

import { NextRequest } from "next/server";
import { setMockCookies } from "./mock-cookies";

export interface BuildRequestOptions {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Raw body as a string (overrides `body` if both set). */
  rawBody?: string;
  /** For non-JSON bodies: explicit content type. */
  contentType?: string;
  /** Cookies to attach to the request (set on the NextRequest.cookies store AND synced to the mock cookie store that `cookies()` reads from). */
  cookies?: Record<string, string>;
  /** A pre-built FormData instance (sets multipart Content-Type automatically). */
  formData?: FormData;
  /** A ReadableStream body (for chunked upload tests). */
  stream?: ReadableStream<Uint8Array>;
}

/** Build a NextRequest suitable for passing to a route handler. */
export function buildRequest(opts: BuildRequestOptions = {}): NextRequest {
  const method = opts.method ?? "GET";
  const url = opts.url ?? "http://localhost:3000/api/test";

  const headers = new Headers(opts.headers ?? {});

  let body: BodyInit | null = null;

  if (opts.stream) {
    body = opts.stream;
    // Caller is responsible for setting Content-Type via opts.headers.
  } else if (opts.formData) {
    body = opts.formData;
    // Let fetch set the multipart boundary automatically.
  } else if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", opts.contentType ?? "text/plain");
    }
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  const req = new NextRequest(url, {
    method,
    headers,
    body: body as BodyInit | null | undefined,
  });

  // Attach cookies — NextRequest exposes a `cookies` store separately from
  // the Cookie header. We set both so routes that read either one work.
  // We ALSO sync to the mock cookie store so `cookies()` from `next/headers`
  // (used by getSession) sees them.
  if (opts.cookies) {
    for (const [name, value] of Object.entries(opts.cookies)) {
      req.cookies.set(name, value);
    }
    // Also set the Cookie header for code that reads it directly.
    const cookieHeader = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    req.headers.set("Cookie", cookieHeader);
    // Sync to the mock cookie store (read by `cookies()` in route handlers).
    setMockCookies(opts.cookies);
  }

  return req;
}

/**
 * Invoke a route handler and return the parsed JSON body (or null for 204).
 * Throws if the response is not ok and `throwOnError` is true (default false).
 */
export async function callRoute<T = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (req: NextRequest, ctx?: any) => Promise<Response>,
  opts: BuildRequestOptions & { params?: Record<string, string> } = {}
): Promise<{ response: Response; data: T | null }> {
  const req = buildRequest(opts);
  const ctx = opts.params
    ? { params: Promise.resolve(opts.params) }
    : undefined;
  const response = await handler(req, ctx);
  let data: T | null = null;
  if (response.status !== 204) {
    try {
      data = (await response.json()) as T;
    } catch {
      data = null;
    }
  }
  return { response, data };
}

/** Helper: extract a JSON body from a Response, returning null on failure. */
export async function readJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
