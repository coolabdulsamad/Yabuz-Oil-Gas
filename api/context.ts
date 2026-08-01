import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { readSessionCookie, resolveSession, type SessionUser } from "./services/auth.service";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /** Authenticated staff member (null when logged out). */
  user: SessionUser | null;
  /** Effective permission keys for the current user. */
  permissions: Set<string>;
  /** Raw session token (needed for logout). */
  sessionToken: string | null;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const token = readSessionCookie(opts.req);

  let user: SessionUser | null = null;
  let permissions = new Set<string>();

  if (token) {
    const resolved = await resolveSession(token);
    if (resolved) {
      user = resolved.user;
      permissions = new Set(resolved.permissions);
    }
  }

  return {
    req: opts.req,
    resHeaders: opts.resHeaders,
    user,
    permissions,
    sessionToken: token,
  };
}
