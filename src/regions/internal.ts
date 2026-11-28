import { Hono } from "hono";
import { jsonError } from "../http";
import { checkRateLimit } from "../ratelimit";
import type { AppEnv } from "../types";
import { ledgerStub } from "./demand";
import { parseCell } from "./grid";

/**
 * The builder's four calls, on /internal/v1/regions. Disabled (404) while the
 * BUILDER_TOKEN secret is unset. Not part of the public OpenAPI file.
 */

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
}

/** Constant-time comparison of two secrets, through their hashes. */
export async function tokenMatches(
  given: string,
  expected: string,
): Promise<boolean> {
  const a = await digest(given);
  const b = await digest(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

const isStr = (v: unknown, max = 300): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

export const internal = new Hono<AppEnv>();

internal.use("*", async (c, next) => {
  const token = c.env.BUILDER_TOKEN;
  if (!token || !c.env.DEMAND) return jsonError(404, "not_found");
  const limited = await checkRateLimit(c);
  if (limited) return limited;
  const given = /^Bearer (.+)$/.exec(c.req.header("Authorization") ?? "")?.[1];
  if (!given || !(await tokenMatches(given, token))) {
    return jsonError(401, "unauthorized");
  }
  await next();
});

async function body(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown> | null> {
  try {
    const v = await c.req.json();
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

internal.post("/claim", async (c) => {
  const b = await body(c);
  if (!b) return jsonError(400, "invalid_body");
  const seconds = typeof b.lease_seconds === "number" ? b.lease_seconds : 3600;
  const claim = await ledgerStub(c.env).claim(seconds);
  if (!claim) return new Response(null, { status: 204 });
  return c.json(claim, 200, { "Cache-Control": "no-store" });
});

internal.post("/complete", async (c) => {
  const b = await body(c);
  if (!b || !isStr(b.lease, 64) || !isStr(b.cell, 16) || !isStr(b.key, 120)) {
    return jsonError(400, "invalid_body");
  }
  if (!parseCell(b.cell)) return jsonError(400, "invalid_cell");
  const result = await ledgerStub(c.env).complete({
    lease: b.lease,
    cell: b.cell,
    key: b.key,
    build: isStr(b.build, 16) ? b.build : "",
    upstream_url: isStr(b.upstream_url, 300) ? b.upstream_url : undefined,
  });
  if (!result.ok) {
    const status = result.error === "manifest_conflict" ? 409 : 422;
    return jsonError(status, result.error);
  }
  return c.json(result, 200, { "Cache-Control": "no-store" });
});

internal.post("/fail", async (c) => {
  const b = await body(c);
  if (!b || !isStr(b.lease, 64) || !isStr(b.cell, 16)) {
    return jsonError(400, "invalid_body");
  }
  const result = await ledgerStub(c.env).fail({
    lease: b.lease,
    cell: b.cell,
    error: isStr(b.error) ? b.error : "unspecified",
    permanent: b.permanent === true,
  });
  return result.ok ? c.json(result) : jsonError(409, "lease_mismatch");
});

internal.post("/rearm", async (c) => {
  const b = await body(c);
  if (!b || !isStr(b.cell, 16) || !parseCell(b.cell)) {
    return jsonError(400, "invalid_body");
  }
  return (await ledgerStub(c.env).rearm(b.cell))
    ? c.json({ ok: true })
    : jsonError(409, "not_dead");
});

internal.get("/state", async (c) =>
  c.json(await ledgerStub(c.env).state(), 200, { "Cache-Control": "no-store" }),
);
