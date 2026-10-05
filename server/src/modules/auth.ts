import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { many, one, pool } from '../db/pool.js';
import { createSession, requireAuth, ctx } from '../core/auth.js';
import { hashOtp, randomDigits, randomToken, safeEqual, sha256 } from '../core/crypto.js';
import { AppError, badRequest, forbidden, notFound, tooMany, unauthorized } from '../core/errors.js';
import { homeFor, type Role } from '../core/rbac.js';
import { audit, clientIp } from '../core/audit.js';
import { indianMobile, z } from '../core/validate.js';
import { photoUrl } from './profile.js';

export const authRouter = Router();

const limiterMax = (n: number) => (config.isTest ? 10_000 : n);
const otpIpLimiter = rateLimit({ windowMs: 15 * 60_000, limit: limiterMax(30), standardHeaders: 'draft-7', legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: limiterMax(10), standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `${clientIp(req)}:${String(req.body?.email ?? '').toLowerCase()}`,
  message: { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Please wait 15 minutes.' } } });

const DUMMY_HASH = bcrypt.hashSync('societyone-timing-equaliser', 12);

const ROLE_PRIORITY: Role[] = ['admin', 'facility_manager', 'guard', 'resident'];

async function membershipsFor(userId: string) {
  const rows = await many(
    `SELECT su.society_id, su.role, s.name AS society_name, s.status AS society_status
       FROM society_users su JOIN societies s ON s.id = su.society_id
      WHERE su.user_id = $1 AND su.status = 'active'
      ORDER BY s.name`,
    [userId],
  );
  return rows
    .filter((r) => r.society_status === 'active')
    .sort((a, b) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));
}

async function pickRole(userId: string, platformRole: string | null, prefer?: { societyId?: string; role?: Role }) {
  const memberships = await membershipsFor(userId);
  if (prefer?.societyId || prefer?.role) {
    const m = memberships.find((x) => (!prefer.societyId || x.society_id === prefer.societyId) && (!prefer.role || x.role === prefer.role));
    if (m) return { role: m.role as Role, societyId: m.society_id as string };
    if (prefer.role === 'super_admin' && platformRole === 'super_admin') return { role: 'super_admin' as Role, societyId: null };
  }
  if (platformRole === 'super_admin') return { role: 'super_admin' as Role, societyId: null };
  if (memberships.length) return { role: memberships[0].role as Role, societyId: memberships[0].society_id as string };
  return null;
}

// --- OTP ---------------------------------------------------------------------
authRouter.post('/otp/request', otpIpLimiter, async (req, res) => {
  const { mobile } = z.object({ mobile: indianMobile }).parse(req.body);
  const recent = await many(
    `SELECT created_at FROM otp_codes WHERE mobile = $1 AND created_at > now() - interval '1 hour' ORDER BY created_at DESC`,
    [mobile],
  );
  if (recent.length) {
    const since = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
    if (since < config.otp.resendCooldownSeconds) {
      const wait = Math.ceil(config.otp.resendCooldownSeconds - since);
      throw tooMany(`Please wait ${wait} seconds before requesting another code`, wait);
    }
  }
  if (recent.length >= config.otp.maxPerHour) throw tooMany('Too many codes requested. Please try again in an hour.', 3600);

  const user = await one(`SELECT id, is_active FROM users WHERE mobile = $1`, [mobile]);
  const code = randomDigits(6);
  // Always record the request (so rate limits apply equally) but only deliver to registered users.
  await pool.query(`INSERT INTO otp_codes (mobile, code_hash, expires_at, ip) VALUES ($1,$2, now() + make_interval(secs => $3), $4)`, [
    mobile,
    user?.is_active ? hashOtp(mobile, code) : 'unregistered',
    config.otp.ttlSeconds,
    clientIp(req),
  ]);
  if (user?.is_active) {
    // SMS gateway integration point (MSG91 / Gupshup / AWS SNS with DLT-registered template).
    if (!config.isTest && !config.isProd) console.log(`[sms] OTP for ${mobile}: ${code}`);
  }
  // Identical response whether or not the number is registered (prevents account enumeration).
  res.json({
    ok: true,
    expiresInSeconds: config.otp.ttlSeconds,
    resendInSeconds: config.otp.resendCooldownSeconds,
    ...(config.demoMode && user?.is_active ? { demoCode: code } : {}),
  });
});

authRouter.post('/otp/verify', otpIpLimiter, async (req, res) => {
  const body = z.object({ mobile: indianMobile, code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }).parse(req.body);
  const otp = await one(
    `SELECT id, code_hash, attempts FROM otp_codes
      WHERE mobile = $1 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [body.mobile],
  );
  if (!otp) throw new AppError(400, 'otp_expired', 'This code has expired. Please request a new one.');
  if (otp.attempts >= config.otp.maxAttempts) throw tooMany('Too many incorrect attempts. Please request a new code.');
  if (!safeEqual(otp.code_hash, hashOtp(body.mobile, body.code))) {
    await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    const left = config.otp.maxAttempts - otp.attempts - 1;
    throw new AppError(400, 'otp_invalid', left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Please request a new one.');
  }
  await pool.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
  const user = await one(`SELECT id, platform_role FROM users WHERE mobile = $1 AND is_active`, [body.mobile]);
  if (!user) throw unauthorized('This mobile number is not registered with any society');
  const picked = await pickRole(user.id, user.platform_role);
  if (!picked) throw forbidden('Your account is not linked to an active society. Please contact your society office.');
  const session = await createSession(req, res, { userId: user.id, ...picked, method: 'otp' });
  req.auth = { sessionId: '', userId: user.id, fullName: '', role: picked.role, societyId: picked.societyId, flatIds: [] };
  await audit(req, { action: 'auth.login', entityType: 'user', entityId: user.id, summary: 'Signed in with OTP' });
  res.json({ ...session, role: picked.role, home: homeFor[picked.role] });
});

// --- Email / password (administrators) --------------------------------------
authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = z.object({ email: z.string().trim().email('Enter a valid email'), password: z.string().min(1).max(200) }).parse(req.body);
  const user = await one(`SELECT id, password_hash, platform_role, is_active FROM users WHERE email = $1`, [body.email]);
  // Constant-ish time: compare against a dummy hash if user missing.
  const hash = user?.password_hash ?? DUMMY_HASH;
  const ok = await bcrypt.compare(body.password, hash);
  if (!user || !ok || !user.is_active || !user.password_hash) throw unauthorized('Incorrect email or password');
  // Password login is reserved for administrators; residents and guards use mobile OTP.
  let picked = await pickRole(user.id, user.platform_role);
  if (picked && (picked.role === 'resident' || picked.role === 'guard')) {
    const adminM = (await membershipsFor(user.id)).find((m) => m.role === 'admin' || m.role === 'facility_manager');
    picked = adminM ? { role: adminM.role as Role, societyId: adminM.society_id } : null;
  }
  if (!picked) throw forbidden('Please sign in with your mobile number and OTP');
  const session = await createSession(req, res, { userId: user.id, ...picked, method: 'password' });
  req.auth = { sessionId: '', userId: user.id, fullName: '', role: picked.role, societyId: picked.societyId, flatIds: [] };
  await audit(req, { action: 'auth.login', entityType: 'user', entityId: user.id, summary: 'Signed in with password' });
  res.json({ ...session, role: picked.role, home: homeFor[picked.role] });
});

authRouter.post('/password/forgot', loginLimiter, async (req, res) => {
  const { email } = z.object({ email: z.string().trim().email('Enter a valid email') }).parse(req.body);
  const user = await one(`SELECT id FROM users WHERE email = $1 AND is_active AND password_hash IS NOT NULL`, [email]);
  let demoToken: string | undefined;
  if (user) {
    const token = randomToken(32);
    await pool.query(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
    await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '30 minutes')`, [user.id, sha256(token)]);
    // Email provider integration point (SES / SendGrid). Link: /reset-password?token=...
    if (!config.isTest && !config.isProd) console.log(`[email] reset link for ${email}: /reset-password?token=${token}`);
    if (config.demoMode) demoToken = token;
  }
  res.json({ ok: true, message: 'If an administrator account exists for this email, a reset link has been sent.', ...(demoToken ? { demoToken } : {}) });
});

const strongPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use a mix of letters and numbers');

authRouter.post('/password/reset', loginLimiter, async (req, res) => {
  const body = z.object({ token: z.string().min(20).max(200), password: strongPassword }).parse(req.body);
  const t = await one(`SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [sha256(body.token)]);
  if (!t) throw badRequest('This reset link is invalid or has expired');
  const hash = await bcrypt.hash(body.password, 12);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, t.user_id]);
  await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [t.id]);
  // Revoke all existing sessions after a password reset.
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [t.user_id]);
  await audit(null, { action: 'auth.password_reset', entityType: 'user', entityId: t.user_id, societyId: null });
  res.json({ ok: true });
});

// --- Session -----------------------------------------------------------------
authRouter.post('/logout', async (req, res) => {
  if (req.auth) await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.auth.sessionId]);
  res.clearCookie(config.session.cookieName, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const a = req.auth!;
  const user = await one(`SELECT id, full_name, mobile, email, photo_key, platform_role FROM users WHERE id = $1`, [a.userId]);
  const memberships = await membershipsFor(a.userId);
  let society = null;
  let flats: any[] = [];
  if (a.societyId) {
    society = await one(`SELECT id, name, code, city, state, logo_key, timezone, settings FROM societies WHERE id = $1`, [a.societyId]);
  }
  if (a.role === 'resident') {
    flats = await many(
      `SELECT f.id, f.number, f.unit_code, t.name AS tower_name, rfr.relation, rfr.is_primary, rfr.move_in_date
         FROM resident_flat_relationships rfr
         JOIN flats f ON f.id = rfr.flat_id JOIN towers t ON t.id = f.tower_id
        WHERE rfr.resident_id = $1 AND rfr.status = 'active'
        ORDER BY rfr.is_primary DESC, f.number`,
      [a.residentId],
    );
  }
  let gates: any[] = [];
  if (a.role === 'guard') gates = await many(`SELECT id, name FROM gates WHERE society_id = $1 AND is_active ORDER BY name`, [a.societyId]);
  res.json({
    user: { id: user.id, fullName: user.full_name, mobile: user.mobile, email: user.email, photoUrl: photoUrl(user.photo_key) },
    role: a.role,
    home: homeFor[a.role],
    society: society && { id: society.id, name: society.name, code: society.code, city: society.city, state: society.state, timezone: society.timezone, hasLogo: !!society.logo_key },
    flats,
    gates,
    defaultGateId: a.defaultGateId ?? null,
    memberships: [
      ...(user.platform_role === 'super_admin' ? [{ societyId: null, societyName: 'SocietyOne Platform', role: 'super_admin' }] : []),
      ...memberships.map((m) => ({ societyId: m.society_id, societyName: m.society_name, role: m.role })),
    ],
  });
});

authRouter.post('/switch', requireAuth, async (req, res) => {
  const body = z.object({ societyId: z.string().uuid().nullable(), role: z.enum(['super_admin', 'admin', 'facility_manager', 'resident', 'guard']) }).parse(req.body);
  const user = await one(`SELECT platform_role FROM users WHERE id = $1`, [req.auth!.userId]);
  const picked = await pickRole(req.auth!.userId, user.platform_role, { societyId: body.societyId ?? undefined, role: body.role });
  if (!picked || picked.role !== body.role) throw forbidden('You do not have that role');
  await pool.query('UPDATE sessions SET society_id = $1, role = $2 WHERE id = $3', [picked.societyId, picked.role, req.auth!.sessionId]);
  res.json({ role: picked.role, home: homeFor[picked.role] });
});

authRouter.get('/sessions', requireAuth, async (req, res) => {
  const rows = await many(
    `SELECT id, auth_method, ip, user_agent, created_at, last_seen_at FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`,
    [req.auth!.userId],
  );
  res.json({ sessions: rows.map((r) => ({ ...r, current: r.id === req.auth!.sessionId })) });
});

authRouter.delete('/sessions/:id', requireAuth, async (req, res) => {
  const r = await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [req.params.id, req.auth!.userId]);
  if (!r.rowCount) throw notFound('Session');
  res.json({ ok: true });
});

export { strongPassword, ctx };
