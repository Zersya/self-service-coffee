import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { getAdminEmail, getAdminPassword } from './config';
import { timingSafeStringEqual } from './clients';

export const ADMIN_SESSION_COOKIE = 'kopi_oauth_admin';
const SESSION_TTL_MS = 30 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

interface AdminSession {
  email: string;
  expiresAt: number;
}

export interface PendingAuthorization {
  id: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  codeChallenge: string;
  csrfToken: string;
  expiresAt: number;
}

const sessions = new Map<string, AdminSession>();
const pending = new Map<string, PendingAuthorization>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function purge<T extends { expiresAt: number }>(map: Map<string, T>): void {
  const now = Date.now();
  for (const [key, value] of map.entries()) {
    if (value.expiresAt <= now) map.delete(key);
  }
}

export function verifyAdminCredentials(email: string, password: string): boolean {
  const expectedEmail = getAdminEmail();
  const expectedPassword = getAdminPassword();
  if (!expectedEmail || !expectedPassword) return false;
  return timingSafeStringEqual(email, expectedEmail) && timingSafeStringEqual(password, expectedPassword);
}

export function isLoginRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= 5;
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

export function createAdminSession(email: string): string {
  purge(sessions);
  const id = randomBytes(32).toString('base64url');
  sessions.set(id, { email, expiresAt: Date.now() + SESSION_TTL_MS });
  return id;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getAdminSession(req: Request): AdminSession | null {
  purge(sessions);
  const id = parseCookies(req)[ADMIN_SESSION_COOKIE];
  if (!id) return null;
  return sessions.get(id) ?? null;
}

export function adminSessionCookieHeader(sessionId: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export function createPendingAuthorization(
  input: Omit<PendingAuthorization, 'id' | 'csrfToken' | 'expiresAt'>,
): PendingAuthorization {
  purge(pending);
  const record: PendingAuthorization = {
    ...input,
    id: randomBytes(24).toString('base64url'),
    csrfToken: randomBytes(24).toString('base64url'),
    expiresAt: Date.now() + PENDING_TTL_MS,
  };
  pending.set(record.id, record);
  return record;
}

export function getPendingAuthorization(id?: string): PendingAuthorization | null {
  if (!id) return null;
  purge(pending);
  return pending.get(id) ?? null;
}

export function deletePendingAuthorization(id: string): void {
  pending.delete(id);
}
