import { Router } from 'express';
import { config } from '../config.js';
import { many, one, pool, tx } from '../db/pool.js';
import { requirePermission } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { randomToken, sha256 } from '../core/crypto.js';
import { notFound } from '../core/errors.js';
import { indianMobile, optionalText, text, z } from '../core/validate.js';

/**
 * SocietyOne platform (Super Admin) API.
 * Privacy by design: these endpoints return society-level aggregates only. No resident names,
 * mobiles, visitor details or complaint contents are exposed to platform staff.
 */
export const platformRouter = Router();
platformRouter.use(requirePermission('platform:manage'));

platformRouter.get('/stats', async (_req, res) => {
  const s = await one(`
    SELECT
      (SELECT count(*) FROM societies)::int AS societies,
      (SELECT count(*) FROM societies WHERE status = 'active')::int AS active_societies,
      (SELECT count(*) FROM flats WHERE is_active)::int AS flats,
      (SELECT count(*) FROM residents WHERE status = 'active')::int AS residents,
      (SELECT count(*) FROM security_guards WHERE status = 'active')::int AS guards,
      (SELECT count(*) FROM visitor_entries WHERE checked_in_at > now() - interval '30 days')::int AS visitors_30d,
      (SELECT count(*) FROM complaints WHERE status NOT IN ('resolved','closed'))::int AS open_complaints,
      (SELECT count(*) FROM facility_bookings WHERE created_at > now() - interval '30 days')::int AS bookings_30d`);
  res.json(s);
});

platformRouter.get('/societies', async (req, res) => {
  const q = z.object({ q: z.string().trim().max(80).optional(), status: z.enum(['active', 'inactive', 'suspended']).optional() }).parse(req.query);
  const rows = await many(
    `SELECT s.id, s.name, s.code, s.city, s.state, s.status, s.created_at, s.contact_email, s.contact_phone,
            sub.plan, sub.status AS subscription_status, sub.ends_on,
            (SELECT count(*) FROM towers t WHERE t.society_id = s.id)::int AS towers,
            (SELECT count(*) FROM flats f WHERE f.society_id = s.id)::int AS flats,
            (SELECT count(*) FROM residents r WHERE r.society_id = s.id AND r.status = 'active')::int AS residents,
            (SELECT count(*) FROM society_users su WHERE su.society_id = s.id AND su.role IN ('admin','facility_manager'))::int AS admins
       FROM societies s
       LEFT JOIN LATERAL (SELECT * FROM society_subscriptions x WHERE x.society_id = s.id ORDER BY created_at DESC LIMIT 1) sub ON true
      WHERE ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR s.city ILIKE '%' || $1 || '%' OR s.code ILIKE $1)
        AND ($2::text IS NULL OR s.status = $2)
      ORDER BY s.created_at DESC`,
    [q.q || null, q.status ?? null],
  );
  res.json({ societies: rows });
});

const societyInput = z.object({
  name: text(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/, 'Code must be 2–12 letters/numbers'),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: text(80),
  state: text(80),
  pinCode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
  contactPhone: indianMobile.optional().nullable(),
  contactEmail: z.string().trim().email().optional().nullable().or(z.literal('').transform(() => null)),
  complaintPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,8}$/).optional(),
  plan: z.enum(['trial', 'standard', 'premium']).default('trial'),
  admin: z.object({ fullName: text(120), email: z.string().trim().email('Enter the admin email'), mobile: indianMobile }),
});

platformRouter.post('/societies', async (req, res) => {
  const b = societyInput.parse(req.body);
  const result = await tx(async (c) => {
    const s = (
      await c.query(
        `INSERT INTO societies (name, code, address_line1, address_line2, city, state, pin_code, contact_phone, contact_email, complaint_prefix, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'SOC'),$11) RETURNING id, name, code`,
        [b.name, b.code, b.addressLine1, b.addressLine2, b.city, b.state, b.pinCode, b.contactPhone ?? null, b.contactEmail ?? null, b.complaintPrefix ?? null, req.auth!.userId],
      )
    ).rows[0];
    await c.query(`INSERT INTO society_subscriptions (society_id, plan, status, created_by) VALUES ($1,$2,$3,$4)`, [
      s.id,
      b.plan,
      b.plan === 'trial' ? 'trial' : 'active',
      req.auth!.userId,
    ]);
    await c.query(`INSERT INTO gates (society_id, name, created_by) VALUES ($1,'Main Gate',$2)`, [s.id, req.auth!.userId]);
    // Reuse an existing user (same mobile/email) or create one.
    let user = (await c.query(`SELECT id FROM users WHERE mobile = $1 OR email = $2 LIMIT 1`, [b.admin.mobile, b.admin.email])).rows[0];
    if (!user) {
      user = (
        await c.query(`INSERT INTO users (full_name, mobile, email, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [
          b.admin.fullName,
          b.admin.mobile,
          b.admin.email,
          req.auth!.userId,
        ])
      ).rows[0];
    }
    await c.query(`INSERT INTO society_users (society_id, user_id, role, created_by) VALUES ($1,$2,'admin',$3) ON CONFLICT DO NOTHING`, [
      s.id,
      user.id,
      req.auth!.userId,
    ]);
    // Invitation: a 72h password-setup link (delivered by email in production).
    const token = randomToken(32);
    await c.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '72 hours')`, [user.id, sha256(token)]);
    await audit(req, { action: 'platform.society_created', entityType: 'society', entityId: s.id, societyId: s.id, newValues: { name: s.name, code: s.code, plan: b.plan } }, c);
    await audit(req, { action: 'platform.admin_invited', entityType: 'user', entityId: user.id, societyId: s.id, summary: 'Initial society administrator created' }, c);
    return { society: s, adminUserId: user.id, token };
  });
  res.status(201).json({
    society: result.society,
    adminUserId: result.adminUserId,
    message: 'Society created. The administrator can sign in with OTP on their mobile, or set a password using the invitation link.',
    ...(config.demoMode ? { demoInviteLink: `/reset-password?token=${result.token}` } : {}),
  });
});

platformRouter.patch('/societies/:id', async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = z
    .object({
      status: z.enum(['active', 'inactive', 'suspended']).optional(),
      plan: z.enum(['trial', 'standard', 'premium']).optional(),
      subscriptionStatus: z.enum(['trial', 'active', 'past_due', 'cancelled']).optional(),
      endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    })
    .parse(req.body);
  const before = await one(`SELECT id, status FROM societies WHERE id = $1`, [id]);
  if (!before) throw notFound('Society');
  await tx(async (c) => {
    if (b.status) {
      await c.query(`UPDATE societies SET status = $1 WHERE id = $2`, [b.status, id]);
      if (b.status !== 'active') await c.query(`UPDATE sessions SET revoked_at = now() WHERE society_id = $1 AND revoked_at IS NULL`, [id]);
    }
    if (b.plan || b.subscriptionStatus || b.endsOn !== undefined) {
      const sub = (await c.query(`SELECT id, plan, status, ends_on FROM society_subscriptions WHERE society_id = $1 ORDER BY created_at DESC LIMIT 1`, [id])).rows[0];
      if (sub) {
        await c.query(`UPDATE society_subscriptions SET plan = COALESCE($1, plan), status = COALESCE($2, status), ends_on = CASE WHEN $4 THEN $3::date ELSE ends_on END WHERE id = $5`, [
          b.plan ?? null,
          b.subscriptionStatus ?? null,
          b.endsOn ?? null,
          b.endsOn !== undefined,
          sub.id,
        ]);
      }
    }
    await audit(req, { action: 'platform.society_updated', entityType: 'society', entityId: id, societyId: id, oldValues: { status: before.status }, newValues: b }, c);
  });
  res.json({ ok: true });
});

platformRouter.post('/societies/:id/admins', async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = z.object({ fullName: text(120), email: z.string().trim().email(), mobile: indianMobile, role: z.enum(['admin', 'facility_manager']).default('admin') }).parse(req.body);
  const s = await one(`SELECT id FROM societies WHERE id = $1`, [id]);
  if (!s) throw notFound('Society');
  const out = await tx(async (c) => {
    let user = (await c.query(`SELECT id FROM users WHERE mobile = $1 OR email = $2 LIMIT 1`, [b.mobile, b.email])).rows[0];
    if (!user) user = (await c.query(`INSERT INTO users (full_name, mobile, email, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [b.fullName, b.mobile, b.email, req.auth!.userId])).rows[0];
    await c.query(`INSERT INTO society_users (society_id, user_id, role, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [id, user.id, b.role, req.auth!.userId]);
    const token = randomToken(32);
    await c.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '72 hours')`, [user.id, sha256(token)]);
    await audit(req, { action: 'platform.admin_invited', entityType: 'user', entityId: user.id, societyId: id, newValues: { role: b.role } }, c);
    return { userId: user.id, token };
  });
  res.status(201).json({ userId: out.userId, ...(config.demoMode ? { demoInviteLink: `/reset-password?token=${out.token}` } : {}) });
});

// Platform audit: full detail for platform-level actions, counts only for in-society activity.
platformRouter.get('/audit', async (req, res) => {
  const q = z.object({ societyId: z.string().uuid().optional() }).parse(req.query);
  const platform = await many(
    `SELECT a.id, a.action, a.entity_type, a.summary, a.actor_role, a.created_at, a.new_values, s.name AS society_name, u.full_name AS actor_name
       FROM audit_logs a LEFT JOIN societies s ON s.id = a.society_id LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.actor_role = 'super_admin' AND ($1::uuid IS NULL OR a.society_id = $1)
      ORDER BY a.created_at DESC LIMIT 200`,
    [q.societyId ?? null],
  );
  const activity = await many(
    `SELECT s.name AS society_name, a.action, count(*)::int AS count, max(a.created_at) AS last_at
       FROM audit_logs a JOIN societies s ON s.id = a.society_id
      WHERE a.actor_role IS DISTINCT FROM 'super_admin' AND a.created_at > now() - interval '30 days' AND ($1::uuid IS NULL OR a.society_id = $1)
      GROUP BY s.name, a.action ORDER BY s.name, count DESC`,
    [q.societyId ?? null],
  );
  res.json({ platform, activity });
});
