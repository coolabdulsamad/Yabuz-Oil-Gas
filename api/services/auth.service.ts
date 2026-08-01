import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { rolePermissions, sessions, settings, userPermissions, users } from "@db/schema";
import { PERMISSION_KEYS } from "@contracts/permissions";
import type { UserRole } from "@contracts/roles";

/**
 * YABUZ OIL & GAS — Auth service
 * Staff username + password login (bcrypt), DB-backed sessions,
 * effective-permission resolution (role matrix + per-user overrides).
 */

export const SESSION_COOKIE = "yog_session";

/* ------------------------------------------------------------------ */
/* Tokens & sessions                                                   */
/* ------------------------------------------------------------------ */

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function sessionLifetimeHours(): Promise<number> {
  const db = getDb();
  const row = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "system.session_hours"))
    .limit(1);
  const hours = row[0] ? Number(JSON.parse(row[0].value)) : 12;
  return Number.isFinite(hours) && hours > 0 ? hours : 12;
}

export interface SessionUser {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: "ACTIVE" | "SUSPENDED";
  avatarUrl: string | null;
  staffCode: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/* ------------------------------------------------------------------ */
/* Login brute-force protection (in-memory, per username)              */
/* ------------------------------------------------------------------ */

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const failedLogins = new Map<string, { count: number; lockedUntil: number }>();

function recordLoginFailure(username: string): void {
  const now = Date.now();
  const entry = failedLogins.get(username);
  if (!entry || (entry.lockedUntil > 0 && entry.lockedUntil <= now)) {
    failedLogins.set(username, { count: 1, lockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = now + LOCK_MINUTES * 60 * 1000;
    entry.count = 0;
  }
}

function loginLockRemaining(username: string): number {
  const entry = failedLogins.get(username);
  if (!entry || entry.lockedUntil <= 0) return 0;
  return Math.max(0, entry.lockedUntil - Date.now());
}

function clearLoginFailures(username: string): void {
  failedLogins.delete(username);
}

/* ------------------------------------------------------------------ */
/* Login / session lifecycle                                           */
/* ------------------------------------------------------------------ */

export interface AuthResult {
  user: SessionUser;
  permissions: string[];
  sessionToken: string;
  expiresAt: Date;
}

/** Verify credentials and open a new session. Throws on failure. */
export async function login(username: string, password: string): Promise<AuthResult> {
  const db = getDb();
  const uname = username.trim();

  const lock = loginLockRemaining(uname);
  if (lock > 0) {
    throw new Error(`Too many failed attempts. Try again in ${Math.ceil(lock / 60000)} minute(s).`);
  }

  const found = await db.select().from(users).where(eq(users.username, uname)).limit(1);
  const user = found[0];
  if (!user) {
    recordLoginFailure(uname);
    throw new Error("Invalid username or password.");
  }

  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) {
    recordLoginFailure(uname);
    throw new Error("Invalid username or password.");
  }
  clearLoginFailures(uname);
  if (user.status !== "ACTIVE") throw new Error("This account is suspended. Contact the administrator.");

  const hours = await sessionLifetimeHours();
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const sessionToken = randomBytes(32).toString("hex");

  await db.insert(sessions).values({
    id: sessionToken,
    userId: user.id,
    tokenHash: hashToken(sessionToken),
    expiresAt,
  });

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const permissions = await getEffectivePermissions(user.id, user.role as UserRole);

  return { user: toSessionUser(user), permissions, sessionToken, expiresAt };
}

/** Resolve the session token → user + permissions. Null when invalid/expired. */
export async function resolveSession(
  token: string,
): Promise<{ user: SessionUser; permissions: string[]; sessionId: string } | null> {
  if (!token) return null;
  const db = getDb();

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.session.tokenHash !== hashToken(token)) return null;
  if (row.user.status !== "ACTIVE") return null;

  const permissions = await getEffectivePermissions(row.user.id, row.user.role as UserRole);
  return { user: toSessionUser(row.user), permissions, sessionId: row.session.id };
}

/** Close a session (logout). */
export async function logout(token: string): Promise<void> {
  if (!token) return;
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, token));
}

/** Change a user's password after verifying the current one. */
export async function changePassword(userId: number, current: string, next: string): Promise<void> {
  const db = getDb();
  const found = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = found[0];
  if (!user) throw new Error("Account not found.");
  if (!bcrypt.compareSync(current, user.passwordHash)) throw new Error("Current password is incorrect.");
  if (next.length < 8) throw new Error("New password must be at least 8 characters.");

  await db.update(users).set({ passwordHash: bcrypt.hashSync(next, 10) }).where(eq(users.id, userId));
  // Kill all sessions so the old password can't keep working anywhere.
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/* ------------------------------------------------------------------ */
/* Effective permissions                                               */
/* ------------------------------------------------------------------ */

/**
 * Effective permission set for a user:
 *   SUPER_ADMIN → everything.
 *   otherwise   → role matrix (allowed=true), then per-user overrides on top
 *                 (allowed=true grants a key the role lacks; false revokes one it has).
 */
export async function getEffectivePermissions(userId: number, role: UserRole): Promise<string[]> {
  if (role === "SUPER_ADMIN") return [...PERMISSION_KEYS];

  const db = getDb();
  const roleRows = await db
    .select()
    .from(rolePermissions)
    .where(and(eq(rolePermissions.role, role), eq(rolePermissions.allowed, true)));

  const set = new Set(roleRows.map((r) => r.permissionKey));

  const overrides = await db.select().from(userPermissions).where(eq(userPermissions.userId, userId));
  for (const o of overrides) {
    if (o.allowed) set.add(o.permissionKey);
    else set.delete(o.permissionKey);
  }

  return [...set];
}

/* ------------------------------------------------------------------ */
/* Cookie helpers (fetch adapter: cookies via resHeaders)              */
/* ------------------------------------------------------------------ */

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookieHeader(token: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ------------------------------------------------------------------ */

function toSessionUser(u: typeof users.$inferSelect): SessionUser {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    role: u.role as UserRole,
    status: u.status,
    avatarUrl: u.avatarUrl,
    staffCode: u.staffCode,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}
