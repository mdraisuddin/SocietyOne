import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { one, many, pool } from '../db/pool.js';
import { sha256, randomToken } from './crypto.js';
import { forbidden, unauthorized, AppError } from './errors.js';
import { can, type Permission, type Role } from './rbac.js';
import { clientIp } from './audit.js';

export interface AuthContext {
  sessionId: string;
  userId: string;
  fullName: string;
  role: Role;
  societyId: string | null;
  residentId?: string;
  flatIds: string[];
  guardId?: string;
  defaultGateId?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function createSession(
  req: Request,
  res: Response,
  opts: { userId: string; role: Role; societyId: string | null; method: 'otp' | 'password' },
) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + config.session.ttlDays * 86400_000);
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, society_id, role, auth_method, ip, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [opts.userId, sha256(token), opts.societyId, opts.role, opts.method, clientIp(req), req.get('user-agent')?.slice(0, 300) ?? null, expires],
  );
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [opts.userId]);
  res.cookie(config.session.cookieName, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    expires,
    path: '/',
  });
  return { token, expiresAt: expires.toISOString() };
}

function extractToken(req: Request): { token: string; viaCookie: boolean } | null {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return { token: header.slice(7).trim(), viaCookie: false };
  const cookie = req.cookies?.[config.session.cookieName];
  if (cookie) return { token: cookie, viaCookie: true };
  return null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Loads the session (if any) into req.auth. Does not reject anonymous requests. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const t = extractToken(req);
  if (!t) return next();
  // CSRF defence for cookie sessions: state-changing requests must carry a custom header,
  // which browsers will not send cross-origin without a CORS preflight we do not allow.
  if (t.viaCookie && !SAFE_METHODS.has(req.method) && req.get('x-societyone-client') !== 'web') {
    return next(new AppError(403, 'csrf', 'Missing client header'));
  }
  const s = await one(
    `SELECT s.id, s.user_id, s.role, s.society_id, s.last_seen_at, u.full_name, u.is_active,
            so.status AS society_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN societies so ON so.id = s.society_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(t.token)],
  );
  if (!s || !s.is_active) return next();
  if (s.society_id && s.society_status !== 'active') {
    return next(new AppError(403, 'society_inactive', 'This society account is currently inactive. Please contact SocietyOne support.'));
  }
  const ctx: AuthContext = {
    sessionId: s.id,
    userId: s.user_id,
    fullName: s.full_name,
    role: s.role,
    societyId: s.society_id,
    flatIds: [],
  };
  // Verify the membership still exists (revocation takes effect immediately).
  if (ctx.role !== 'super_admin') {
    const m = await one(
      `SELECT 1 FROM society_users WHERE society_id = $1 AND user_id = $2 AND role = $3 AND status = 'active'`,
      [ctx.societyId, ctx.userId, ctx.role],
    );
    if (!m) return next();
  }
  if (ctx.role === 'resident') {
    const rows = await many(
      `SELECT r.id AS resident_id, rfr.flat_id
         FROM residents r
         LEFT JOIN resident_flat_relationships rfr ON rfr.resident_id = r.id AND rfr.status = 'active'
        WHERE r.society_id = $1 AND r.user_id = $2 AND r.status = 'active'
        ORDER BY rfr.is_primary DESC NULLS LAST, rfr.created_at`,
      [ctx.societyId, ctx.userId],
    );
    if (!rows.length) return next();
    ctx.residentId = rows[0].resident_id;
    ctx.flatIds = rows.map((r) => r.flat_id).filter(Boolean);
  }
  if (ctx.role === 'guard') {
    const g = await one(
      `SELECT id, default_gate_id FROM security_guards WHERE society_id = $1 AND user_id = $2 AND status = 'active'`,
      [ctx.societyId, ctx.userId],
    );
    if (!g) return next();
    ctx.guardId = g.id;
    ctx.defaultGateId = g.default_gate_id;
  }
  req.auth = ctx;
  // Touch last_seen at most once a minute to avoid write amplification.
  if (Date.now() - new Date(s.last_seen_at).getTime() > 60_000) {
    pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [s.id]).catch(() => {});
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!can(req.auth.role, permission)) return next(forbidden());
    if (req.auth.role !== 'super_admin' && !req.auth.societyId) return next(forbidden());
    next();
  };
}

/** Narrow helper for handlers that require a society-scoped session. */
export function ctx(req: Request): AuthContext & { societyId: string } {
  const a = req.auth;
  if (!a || !a.societyId) throw forbidden();
  return a as AuthContext & { societyId: string };
}

/** Ensure the resident actually belongs to the flat they are acting on. */
export function assertFlatAccess(req: Request, flatId: string) {
  const a = ctx(req);
  if (!a.flatIds.includes(flatId)) throw forbidden('You can only act on your own flat');
}
