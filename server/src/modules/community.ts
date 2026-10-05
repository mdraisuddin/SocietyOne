import { Router } from 'express';
import { many, one, pool, tx, type Db } from '../db/pool.js';
import { ctx, requireAuth, requirePermission } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { badRequest, notFound } from '../core/errors.js';
import { notify } from '../core/notifications.js';
import { saveImage } from '../core/storage.js';
import { ADMIN_ROLES } from '../core/rbac.js';
import { likePattern, optionalText, pageClause, pagination, text, z } from '../core/validate.js';
import { photoUrl, upload } from './profile.js';

// ============================================================================
// Announcements
// ============================================================================
export const announcementsRouter = Router();
announcementsRouter.use(requireAuth, requirePermission('announcements:read'));

const CATEGORIES = ['general', 'maintenance', 'water', 'electricity', 'security', 'event', 'emergency'] as const;
const PRIORITIES = ['normal', 'important', 'emergency'] as const;

const view = (r: any) => ({
  id: r.id, title: r.title, body: r.body, category: r.category, priority: r.priority, audience: r.audience, towerIds: r.tower_ids,
  publishAt: r.publish_at, expiresAt: r.expires_at, status: r.status, attachmentUrl: photoUrl(r.attachment_key), createdAt: r.created_at,
  createdBy: r.created_by_name, notifiedAt: r.notified_at,
  state: r.status !== 'published' ? r.status : new Date(r.publish_at) > new Date() ? 'scheduled' : r.expires_at && new Date(r.expires_at) < new Date() ? 'expired' : 'live',
});

/** Residents only see live announcements for their audience (all, or their towers). */
const RESIDENT_SCOPE = `a.status = 'published' AND a.publish_at <= now() AND (a.expires_at IS NULL OR a.expires_at > now())
  AND (a.audience = 'all' OR a.tower_ids && (SELECT array_agg(f.tower_id) FROM flats f WHERE f.id = ANY($2::uuid[])))`;

announcementsRouter.get('/', async (req, res) => {
  const a = ctx(req);
  const q = pagination.extend({ q: z.string().trim().max(60).optional(), category: z.enum(CATEGORIES).optional(), state: z.enum(['live', 'scheduled', 'expired', 'archived', 'all']).default('all') }).parse(req.query);
  const { limit, offset } = pageClause(q);
  const staff = ADMIN_ROLES.includes(a.role);
  const stateCond: Record<string, string> = {
    live: `a.status = 'published' AND a.publish_at <= now() AND (a.expires_at IS NULL OR a.expires_at > now())`,
    scheduled: `a.status = 'published' AND a.publish_at > now()`,
    expired: `a.status = 'published' AND a.expires_at <= now()`,
    archived: `a.status = 'archived'`,
    all: 'TRUE',
  };
  const scope = staff ? stateCond[q.state] : a.role === 'guard' ? `${stateCond.live} AND a.audience = 'all' AND $2::uuid[] IS NOT NULL` : RESIDENT_SCOPE;
  const rows = await many(
    `SELECT a.*, u.full_name AS created_by_name FROM announcements a LEFT JOIN users u ON u.id = a.created_by
      WHERE a.society_id = $1 AND ${scope} AND ($3::text IS NULL OR a.title ILIKE $3 OR a.body ILIKE $3) AND ($4::text IS NULL OR a.category = $4)
      ORDER BY (a.priority = 'emergency' AND (a.expires_at IS NULL OR a.expires_at > now())) DESC, a.publish_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [a.societyId, a.flatIds, q.q ? likePattern(q.q) : null, q.category ?? null],
  );
  res.json({ announcements: rows.map(view), page: q.page });
});

announcementsRouter.get('/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const staff = ADMIN_ROLES.includes(a.role);
  const r = await one(
    `SELECT a.*, u.full_name AS created_by_name FROM announcements a LEFT JOIN users u ON u.id = a.created_by WHERE a.id = $3 AND a.society_id = $1 AND ${staff ? '$2::uuid[] IS NOT NULL' : RESIDENT_SCOPE}`,
    [a.societyId, a.flatIds, id],
  );
  if (!r) throw notFound('Announcement');
  res.json({ announcement: view(r) });
});

const input = z.object({
  title: text(140, 3),
  body: text(5000, 3),
  category: z.enum(CATEGORIES).default('general'),
  priority: z.enum(PRIORITIES).default('normal'),
  audience: z.enum(['all', 'towers']).default('all'),
  towerIds: z.preprocess((v) => (typeof v === 'string' ? (v ? v.split(',') : []) : v), z.array(z.string().uuid()).max(50)).optional(),
  publishAt: z.string().datetime({ offset: true }).optional().nullable().or(z.literal('').transform(() => null)),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable().or(z.literal('').transform(() => null)),
  status: z.enum(['draft', 'published']).default('published'),
});

/** Send notifications for announcements that are live and not yet notified. Used inline and by the scheduler. */
export async function dispatchAnnouncement(id: string, db: Db = pool) {
  const r = (
    await db.query(
      `UPDATE announcements SET notified_at = now() WHERE id = $1 AND notified_at IS NULL AND status = 'published' AND publish_at <= now()
        AND (expires_at IS NULL OR expires_at > now()) RETURNING *`,
      [id],
    )
  ).rows[0];
  if (!r) return 0;
  const recipients = await many(
    `SELECT DISTINCT su.user_id FROM society_users su
      WHERE su.society_id = $1 AND su.status = 'active' AND (
        (su.role = 'resident' AND ($2 = 'all' OR EXISTS (
            SELECT 1 FROM residents re JOIN resident_flat_relationships rfr ON rfr.resident_id = re.id AND rfr.status = 'active'
              JOIN flats f ON f.id = rfr.flat_id WHERE re.user_id = su.user_id AND re.society_id = su.society_id AND f.tower_id = ANY($3::uuid[]))))
        OR (su.role = 'guard' AND $4 AND $2 = 'all'))`,
    [r.society_id, r.audience, r.tower_ids ?? [], r.priority === 'emergency' || r.category === 'security'],
    db,
  );
  const emergency = r.priority === 'emergency';
  await notify(
    {
      societyId: r.society_id,
      userIds: recipients.map((x) => x.user_id),
      type: emergency ? 'announcement_emergency' : 'announcement_new',
      title: emergency ? `EMERGENCY: ${r.title}` : r.title,
      body: r.body.length > 140 ? `${r.body.slice(0, 137)}…` : r.body,
      priority: r.priority,
      entityType: 'announcement',
      entityId: r.id,
      url: `/app/community/${r.id}`,
    },
    db,
  );
  return recipients.length;
}

announcementsRouter.post('/', requirePermission('announcements:manage'), upload.single('attachment'), async (req, res) => {
  const a = ctx(req);
  const b = input.parse(req.body);
  if (b.audience === 'towers' && !b.towerIds?.length) throw badRequest('Choose at least one tower');
  const publishAt = b.publishAt ? new Date(b.publishAt) : new Date();
  if (b.expiresAt && new Date(b.expiresAt) <= publishAt) throw badRequest('Expiry must be after the publish time');
  if (b.towerIds?.length) {
    const n = await one(`SELECT count(*)::int AS n FROM towers WHERE society_id = $1 AND id = ANY($2)`, [a.societyId, b.towerIds]);
    if (n.n !== b.towerIds.length) throw badRequest('Unknown tower');
  }
  const out = await tx(async (c) => {
    const att = req.file ? await saveImage(a.societyId, 'announcements', req.file.buffer) : null;
    const r = (
      await c.query(
        `INSERT INTO announcements (society_id, title, body, category, priority, audience, tower_ids, publish_at, expires_at, attachment_key, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [a.societyId, b.title, b.body, b.category, b.priority, b.audience, b.audience === 'towers' ? b.towerIds : null, publishAt, b.expiresAt ?? null, att?.key ?? null, b.status, a.userId],
      )
    ).rows[0];
    await audit(req, { action: 'announcement.created', entityType: 'announcement', entityId: r.id, newValues: { title: b.title, priority: b.priority, status: b.status } }, c);
    const notified = await dispatchAnnouncement(r.id, c);
    return { id: r.id, notified };
  });
  const row = await one(`SELECT a.*, NULL AS created_by_name FROM announcements a WHERE id = $1`, [out.id]);
  res.status(201).json({ announcement: view(row), recipients: out.notified });
});

announcementsRouter.patch('/:id', requirePermission('announcements:manage'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = input.partial().extend({ status: z.enum(['draft', 'published', 'archived']).optional() }).parse(req.body);
  const before = await one(`SELECT * FROM announcements WHERE id = $1 AND society_id = $2`, [id, a.societyId]);
  if (!before) throw notFound('Announcement');
  const cols: Record<string, unknown> = {
    title: b.title, body: b.body, category: b.category, priority: b.priority, status: b.status,
    publish_at: b.publishAt ? new Date(b.publishAt) : undefined, expires_at: 'expiresAt' in req.body ? b.expiresAt : undefined,
  };
  const entries = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (entries.length) await pool.query(`UPDATE announcements SET ${entries.map(([k], i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${entries.length + 1}`, [...entries.map(([, v]) => v), id]);
  await audit(req, { action: 'announcement.updated', entityType: 'announcement', entityId: id, oldValues: { title: before.title, status: before.status, priority: before.priority }, newValues: Object.fromEntries(entries) });
  await dispatchAnnouncement(id);
  res.json({ ok: true });
});

announcementsRouter.delete('/:id', requirePermission('announcements:manage'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const r = await pool.query(`UPDATE announcements SET status = 'archived' WHERE id = $1 AND society_id = $2`, [id, a.societyId]);
  if (!r.rowCount) throw notFound('Announcement');
  await audit(req, { action: 'announcement.archived', entityType: 'announcement', entityId: id });
  res.json({ ok: true });
});

// ============================================================================
// Emergency contacts
// ============================================================================
export const emergencyRouter = Router();
emergencyRouter.use(requireAuth);

emergencyRouter.get('/', requirePermission('emergency:read'), async (req, res) => {
  const a = ctx(req);
  const staff = ADMIN_ROLES.includes(a.role);
  const rows = await many(
    `SELECT id, name, category, phone, description, available_24x7, sort_order, is_active FROM emergency_contacts
      WHERE society_id = $1 ${staff ? '' : 'AND is_active'} ORDER BY sort_order, name`,
    [a.societyId],
  );
  res.json({ contacts: rows });
});

const contactInput = z.object({
  name: text(80),
  category: z.enum(['society', 'medical', 'police', 'fire', 'utility', 'maintenance', 'other']).default('society'),
  phone: z.string().trim().transform((s) => s.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\+?\d{3,14}$/, 'Enter a valid phone number')),
  description: optionalText(200),
  available24x7: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

emergencyRouter.post('/', requirePermission('emergency:manage'), async (req, res) => {
  const a = ctx(req);
  const b = contactInput.parse(req.body);
  const r = await one(
    `INSERT INTO emergency_contacts (society_id, name, category, phone, description, available_24x7, sort_order, is_active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [a.societyId, b.name, b.category, b.phone, b.description, b.available24x7, b.sortOrder, b.isActive, a.userId],
  );
  await audit(req, { action: 'emergency_contact.created', entityType: 'emergency_contact', entityId: r.id, newValues: { name: b.name, phone: b.phone } });
  res.status(201).json({ id: r.id });
});

emergencyRouter.patch('/:id', requirePermission('emergency:manage'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = contactInput.partial().parse(req.body);
  const before = await one(`SELECT name, phone, is_active FROM emergency_contacts WHERE id = $1 AND society_id = $2`, [id, a.societyId]);
  if (!before) throw notFound('Contact');
  const cols: Record<string, unknown> = { name: b.name, category: b.category, phone: b.phone, description: 'description' in req.body ? b.description : undefined, available_24x7: b.available24x7, sort_order: b.sortOrder, is_active: b.isActive };
  const entries = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (entries.length) await pool.query(`UPDATE emergency_contacts SET ${entries.map(([k], i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${entries.length + 1}`, [...entries.map(([, v]) => v), id]);
  await audit(req, { action: 'emergency_contact.updated', entityType: 'emergency_contact', entityId: id, oldValues: before, newValues: Object.fromEntries(entries) });
  res.json({ ok: true });
});

emergencyRouter.delete('/:id', requirePermission('emergency:manage'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const before = await one(`SELECT name, phone FROM emergency_contacts WHERE id = $1 AND society_id = $2`, [id, a.societyId]);
  if (!before) throw notFound('Contact');
  await pool.query(`DELETE FROM emergency_contacts WHERE id = $1`, [id]);
  await audit(req, { action: 'emergency_contact.deleted', entityType: 'emergency_contact', entityId: id, oldValues: before });
  res.json({ ok: true });
});
