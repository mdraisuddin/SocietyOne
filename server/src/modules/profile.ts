import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { config } from '../config.js';
import { many, one, pool } from '../db/pool.js';
import { requireAuth, ctx } from '../core/auth.js';
import { forbidden, notFound } from '../core/errors.js';
import { keySociety, resolveKey, saveImage } from '../core/storage.js';
import { audit } from '../core/audit.js';
import { optionalText, text, z } from '../core/validate.js';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploads.maxBytes, files: 5 } });

export const photoUrl = (key: string | null | undefined) => (key ? `/api/v1/files/${key}` : null);

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get('/', async (req, res) => {
  const a = req.auth!;
  const u = await one(`SELECT id, full_name, mobile, email, photo_key, created_at FROM users WHERE id = $1`, [a.userId]);
  let residency: any[] = [];
  if (a.role === 'resident') {
    residency = await many(
      `SELECT f.number AS flat_number, t.name AS tower_name, fl.floor_number, rfr.relation, rfr.move_in_date, rfr.is_primary
         FROM resident_flat_relationships rfr
         JOIN flats f ON f.id = rfr.flat_id JOIN towers t ON t.id = f.tower_id JOIN floors fl ON fl.id = f.floor_id
        WHERE rfr.resident_id = $1 AND rfr.status = 'active' ORDER BY rfr.is_primary DESC`,
      [a.residentId],
    );
  }
  const society = a.societyId ? await one(`SELECT name FROM societies WHERE id = $1`, [a.societyId]) : null;
  res.json({
    id: u.id,
    fullName: u.full_name,
    mobile: u.mobile,
    email: u.email,
    photoUrl: photoUrl(u.photo_key),
    role: a.role,
    societyName: society?.name ?? null,
    residency,
  });
});

// Residents may edit limited personal information only. Flat/tower/society links are admin-only.
profileRouter.patch('/', async (req, res) => {
  const body = z
    .object({ fullName: text(120).optional(), email: z.string().trim().email('Enter a valid email').max(160).optional().nullable().or(z.literal('')) })
    .strict()
    .parse(req.body);
  const before = await one(`SELECT full_name, email FROM users WHERE id = $1`, [req.auth!.userId]);
  const email = body.email === '' ? null : body.email;
  await pool.query(`UPDATE users SET full_name = COALESCE($1, full_name), email = CASE WHEN $3 THEN $2 ELSE email END WHERE id = $4`, [
    body.fullName ?? null,
    email ?? null,
    body.email !== undefined,
    req.auth!.userId,
  ]);
  await audit(req, {
    action: 'profile.updated',
    entityType: 'user',
    entityId: req.auth!.userId,
    oldValues: before,
    newValues: { full_name: body.fullName ?? before.full_name, email: body.email !== undefined ? email : before.email },
  });
  res.json({ ok: true });
});

profileRouter.post('/photo', upload.single('photo'), async (req, res) => {
  const a = ctx(req);
  if (!req.file) throw notFound('Photo');
  const saved = await saveImage(a.societyId, 'profile', req.file.buffer);
  await pool.query(`UPDATE users SET photo_key = $1 WHERE id = $2`, [saved.key, a.userId]);
  res.json({ photoUrl: photoUrl(saved.key) });
});

// Notification preferences
const CATEGORIES = ['visitors', 'complaints', 'bookings', 'announcements'] as const;
profileRouter.get('/notification-preferences', async (req, res) => {
  const a = ctx(req);
  const rows = await many(`SELECT category, in_app, push FROM notification_preferences WHERE user_id = $1 AND society_id = $2`, [a.userId, a.societyId]);
  const map = new Map(rows.map((r) => [r.category, r]));
  res.json({ preferences: CATEGORIES.map((c) => ({ category: c, inApp: map.get(c)?.in_app ?? true, push: map.get(c)?.push ?? true })) });
});

profileRouter.put('/notification-preferences', async (req, res) => {
  const a = ctx(req);
  const body = z.object({ preferences: z.array(z.object({ category: z.enum(CATEGORIES), inApp: z.boolean(), push: z.boolean() })).max(10) }).parse(req.body);
  for (const p of body.preferences) {
    await pool.query(
      `INSERT INTO notification_preferences (user_id, society_id, category, in_app, push) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, society_id, category) DO UPDATE SET in_app = EXCLUDED.in_app, push = EXCLUDED.push, updated_at = now()`,
      [a.userId, a.societyId, p.category, p.inApp, p.push],
    );
  }
  res.json({ ok: true });
});

// Web Push subscription registration
profileRouter.post('/push-subscriptions', async (req, res) => {
  const body = z
    .object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) })
    .parse(req.body);
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [req.auth!.userId, body.endpoint, body.keys.p256dh, body.keys.auth, req.get('user-agent')?.slice(0, 300) ?? null],
  );
  res.json({ ok: true, publicKey: config.vapid.publicKey || null });
});

profileRouter.get('/push-config', (_req, res) => {
  res.json({ publicKey: config.vapid.publicKey || null });
});

// --- Files: served only to members of the owning society ------------------------
export const filesRouter = Router();
filesRouter.get('/:society/:folder/:name', requireAuth, async (req, res) => {
  const key = `${req.params.society}/${req.params.folder}/${req.params.name}`;
  const full = resolveKey(key);
  const a = req.auth!;
  if (a.role === 'super_admin' || a.societyId !== keySociety(key)) throw forbidden();
  // Residents may only see complaint photos for their own flats' complaints.
  if (req.params.folder === 'complaints' && a.role === 'resident') {
    const ok = await one(
      `SELECT 1 FROM complaint_attachments ca JOIN complaints c ON c.id = ca.complaint_id
        WHERE ca.file_key = $1 AND (c.raised_by = $2 OR c.flat_id = ANY($3))`,
      [key, a.userId, a.flatIds],
    );
    if (!ok) throw forbidden();
  }
  if (req.params.folder === 'complaints' && a.role === 'guard') throw forbidden();
  if (!fs.existsSync(full)) throw notFound('File');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(full);
});
