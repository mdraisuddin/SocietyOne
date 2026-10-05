import { Router } from 'express';
import { many, one, pool, tx, type Db } from '../db/pool.js';
import { ctx, requireAuth, requirePermission } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { badRequest, conflict, notFound } from '../core/errors.js';
import { saveImage } from '../core/storage.js';
import { indianMobile, likePattern, optionalText, pageClause, pagination, text, z } from '../core/validate.js';
import { photoUrl, upload } from './profile.js';

export const societyRouter = Router();
societyRouter.use(requireAuth);

const DEFAULT_SETTINGS = { deliveryRequiresApproval: false, approvalTimeoutMinutes: 15, allowRecurringVisitors: true };

// Basic society info visible to every member (residents need name/logo, guards need gates).
societyRouter.get('/', async (req, res) => {
  const a = ctx(req);
  const s = await one(
    `SELECT id, name, code, address_line1, address_line2, city, state, pin_code, contact_phone, contact_email, logo_key, timezone, complaint_prefix, settings
       FROM societies WHERE id = $1`,
    [a.societyId],
  );
  const counts = await one(
    `SELECT (SELECT count(*) FROM towers WHERE society_id = $1)::int AS towers,
            (SELECT count(*) FROM flats WHERE society_id = $1)::int AS flats,
            (SELECT count(*) FROM gates WHERE society_id = $1)::int AS gates`,
    [a.societyId],
  );
  res.json({ ...s, logo_url: photoUrl(s.logo_key), settings: { ...DEFAULT_SETTINGS, ...s.settings }, counts });
});

societyRouter.patch('/', requirePermission('society:configure'), async (req, res) => {
  const a = ctx(req);
  const b = z
    .object({
      name: text(120).optional(),
      addressLine1: optionalText(200),
      addressLine2: optionalText(200),
      city: text(80).optional(),
      state: text(80).optional(),
      pinCode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code').optional(),
      contactPhone: indianMobile.optional().nullable(),
      contactEmail: z.string().trim().email('Enter a valid email').optional().nullable(),
      settings: z
        .object({
          deliveryRequiresApproval: z.boolean().optional(),
          approvalTimeoutMinutes: z.number().int().min(2).max(60).optional(),
          allowRecurringVisitors: z.boolean().optional(),
        })
        .optional(),
    })
    .parse(req.body);
  const before = await one(`SELECT name, address_line1, address_line2, city, state, pin_code, contact_phone, contact_email, settings FROM societies WHERE id = $1`, [a.societyId]);
  await pool.query(
    `UPDATE societies SET
       name = COALESCE($1, name),
       address_line1 = CASE WHEN $2::boolean THEN $3 ELSE address_line1 END,
       address_line2 = CASE WHEN $4::boolean THEN $5 ELSE address_line2 END,
       city = COALESCE($6, city), state = COALESCE($7, state), pin_code = COALESCE($8, pin_code),
       contact_phone = CASE WHEN $9::boolean THEN $10 ELSE contact_phone END,
       contact_email = CASE WHEN $11::boolean THEN $12 ELSE contact_email END,
       settings = settings || $13::jsonb
     WHERE id = $14`,
    [
      b.name ?? null,
      'addressLine1' in req.body, b.addressLine1 ?? null,
      'addressLine2' in req.body, b.addressLine2 ?? null,
      b.city ?? null, b.state ?? null, b.pinCode ?? null,
      'contactPhone' in req.body, b.contactPhone ?? null,
      'contactEmail' in req.body, b.contactEmail ?? null,
      JSON.stringify(b.settings ?? {}),
      a.societyId,
    ],
  );
  await audit(req, { action: 'society.updated', entityType: 'society', entityId: a.societyId, oldValues: before, newValues: b });
  res.json({ ok: true });
});

societyRouter.post('/logo', requirePermission('society:configure'), upload.single('logo'), async (req, res) => {
  const a = ctx(req);
  if (!req.file) throw badRequest('Choose an image');
  const saved = await saveImage(a.societyId, 'branding', req.file.buffer);
  await pool.query(`UPDATE societies SET logo_key = $1 WHERE id = $2`, [saved.key, a.societyId]);
  await audit(req, { action: 'society.logo_updated', entityType: 'society', entityId: a.societyId });
  res.json({ logoUrl: photoUrl(saved.key) });
});

// --- Gates ------------------------------------------------------------------
societyRouter.get('/gates', async (req, res) => {
  const a = ctx(req);
  res.json({ gates: await many(`SELECT id, name, is_active FROM gates WHERE society_id = $1 ORDER BY name`, [a.societyId]) });
});
societyRouter.post('/gates', requirePermission('structure:manage'), async (req, res) => {
  const a = ctx(req);
  const b = z.object({ name: text(60) }).parse(req.body);
  const g = await one(`INSERT INTO gates (society_id, name, created_by) VALUES ($1,$2,$3) RETURNING id, name, is_active`, [a.societyId, b.name, a.userId]);
  await audit(req, { action: 'gate.created', entityType: 'gate', entityId: g.id, newValues: b });
  res.status(201).json(g);
});
societyRouter.patch('/gates/:id', requirePermission('structure:manage'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = z.object({ name: text(60).optional(), isActive: z.boolean().optional() }).parse(req.body);
  const r = await pool.query(`UPDATE gates SET name = COALESCE($1,name), is_active = COALESCE($2,is_active) WHERE id = $3 AND society_id = $4`, [b.name ?? null, b.isActive ?? null, id, a.societyId]);
  if (!r.rowCount) throw notFound('Gate');
  await audit(req, { action: 'gate.updated', entityType: 'gate', entityId: id, newValues: b });
  res.json({ ok: true });
});

// --- Staff (admins / facility managers) ---------------------------------------
societyRouter.get('/staff', requirePermission('society:view'), async (req, res) => {
  const a = ctx(req);
  const rows = await many(
    `SELECT su.id, su.role, su.status, u.id AS user_id, u.full_name, u.email, u.mobile
       FROM society_users su JOIN users u ON u.id = su.user_id
      WHERE su.society_id = $1 AND su.role IN ('admin','facility_manager') ORDER BY u.full_name`,
    [a.societyId],
  );
  res.json({ staff: rows });
});
societyRouter.post('/staff', requirePermission('society:configure'), async (req, res) => {
  const a = ctx(req);
  const b = z.object({ fullName: text(120), mobile: indianMobile, email: z.string().trim().email().optional().nullable(), role: z.enum(['admin', 'facility_manager']) }).parse(req.body);
  const out = await tx(async (c) => {
    let u = (await c.query(`SELECT id FROM users WHERE mobile = $1`, [b.mobile])).rows[0];
    if (!u) u = (await c.query(`INSERT INTO users (full_name, mobile, email, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [b.fullName, b.mobile, b.email ?? null, a.userId])).rows[0];
    const m = (
      await c.query(`INSERT INTO society_users (society_id, user_id, role, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (society_id, user_id, role) DO UPDATE SET status = 'active' RETURNING id`, [
        a.societyId, u.id, b.role, a.userId,
      ])
    ).rows[0];
    await audit(req, { action: 'staff.added', entityType: 'user', entityId: u.id, newValues: { role: b.role, full_name: b.fullName } }, c);
    return m;
  });
  res.status(201).json(out);
});
societyRouter.delete('/staff/:id', requirePermission('society:configure'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const m = await one(`SELECT user_id, role FROM society_users WHERE id = $1 AND society_id = $2 AND role IN ('admin','facility_manager')`, [id, a.societyId]);
  if (!m) throw notFound('Staff member');
  if (m.user_id === a.userId) throw badRequest('You cannot remove your own access');
  await pool.query(`UPDATE society_users SET status = 'disabled' WHERE id = $1`, [id]);
  await pool.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND society_id = $2 AND role = $3 AND revoked_at IS NULL`, [m.user_id, a.societyId, m.role]);
  await audit(req, { action: 'staff.removed', entityType: 'user', entityId: m.user_id, oldValues: { role: m.role } });
  res.json({ ok: true });
});

// --- Towers / floors / flats --------------------------------------------------
export const structureRouter = Router();
structureRouter.use(requireAuth, requirePermission('structure:manage'));

structureRouter.get('/towers', async (req, res) => {
  const a = ctx(req);
  const rows = await many(
    `SELECT t.id, t.name, t.code, t.sort_order,
            (SELECT count(*) FROM floors f WHERE f.tower_id = t.id)::int AS floors,
            (SELECT min(floor_number) FROM floors f WHERE f.tower_id = t.id) AS floor_min,
            (SELECT max(floor_number) FROM floors f WHERE f.tower_id = t.id) AS floor_max,
            (SELECT count(*) FROM flats f WHERE f.tower_id = t.id)::int AS flats,
            (SELECT count(*) FROM flats f WHERE f.tower_id = t.id AND f.occupancy_status <> 'vacant')::int AS occupied
       FROM towers t WHERE t.society_id = $1 ORDER BY t.sort_order, t.name`,
    [a.societyId],
  );
  res.json({ towers: rows });
});

const towerInput = z.object({
  name: text(60),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, 'Code: 1–8 letters/numbers'),
  floorFrom: z.number().int().min(-5).max(200).default(1),
  floorTo: z.number().int().min(-5).max(200),
});

structureRouter.post('/towers', async (req, res) => {
  const a = ctx(req);
  const b = towerInput.parse(req.body);
  if (b.floorTo < b.floorFrom) throw badRequest('Last floor must be after the first floor');
  const t = await tx(async (c) => {
    const order = (await c.query(`SELECT COALESCE(max(sort_order),0)+1 AS n FROM towers WHERE society_id = $1`, [a.societyId])).rows[0].n;
    const tower = (await c.query(`INSERT INTO towers (society_id, name, code, sort_order, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, code`, [a.societyId, b.name, b.code, order, a.userId])).rows[0];
    await c.query(
      `INSERT INTO floors (society_id, tower_id, floor_number, label)
       SELECT $1, $2, n, CASE WHEN n = 0 THEN 'Ground' ELSE 'Floor ' || n END FROM generate_series($3::int, $4::int) n`,
      [a.societyId, tower.id, b.floorFrom, b.floorTo],
    );
    await audit(req, { action: 'tower.created', entityType: 'tower', entityId: tower.id, newValues: b }, c);
    return tower;
  });
  res.status(201).json(t);
});

structureRouter.patch('/towers/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = z.object({ name: text(60).optional(), floorTo: z.number().int().min(0).max(200).optional() }).parse(req.body);
  const t = await one(`SELECT id, name FROM towers WHERE id = $1 AND society_id = $2`, [id, a.societyId]);
  if (!t) throw notFound('Tower');
  await tx(async (c) => {
    if (b.name) await c.query(`UPDATE towers SET name = $1 WHERE id = $2`, [b.name, id]);
    if (b.floorTo !== undefined) {
      await c.query(
        `INSERT INTO floors (society_id, tower_id, floor_number, label)
         SELECT $1, $2, n, 'Floor ' || n FROM generate_series(1, $3::int) n ON CONFLICT (tower_id, floor_number) DO NOTHING`,
        [a.societyId, id, b.floorTo],
      );
    }
    await audit(req, { action: 'tower.updated', entityType: 'tower', entityId: id, oldValues: { name: t.name }, newValues: b }, c);
  });
  res.json({ ok: true });
});

structureRouter.delete('/towers/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const used = await one(
    `SELECT count(*)::int AS n FROM resident_flat_relationships rfr JOIN flats f ON f.id = rfr.flat_id WHERE f.tower_id = $1 AND rfr.status = 'active'`,
    [id],
  );
  if (used.n > 0) throw conflict('This tower has residents. Move them out before deleting the tower.');
  const r = await pool.query(`DELETE FROM towers WHERE id = $1 AND society_id = $2`, [id, a.societyId]).catch((e) => {
    if (e.code === '23503') throw conflict('This tower has history (visitors, complaints or bookings) and cannot be deleted.');
    throw e;
  });
  if (!r.rowCount) throw notFound('Tower');
  await audit(req, { action: 'tower.deleted', entityType: 'tower', entityId: id });
  res.json({ ok: true });
});

const bulkFlats = z.object({
  towerId: z.string().uuid(),
  floorFrom: z.number().int().min(-5).max(200),
  floorTo: z.number().int().min(-5).max(200),
  flatsPerFloor: z.number().int().min(1).max(40),
  flatType: optionalText(20),
  areaSqft: z.number().int().min(100).max(20000).optional().nullable(),
});

/** Bulk-create flats: Tower A, floors 1–20, flats 01–08 -> A-101 … A-2008 */
structureRouter.post('/flats/bulk', async (req, res) => {
  const a = ctx(req);
  const b = bulkFlats.parse(req.body);
  if (b.floorTo < b.floorFrom) throw badRequest('Last floor must be after the first floor');
  if ((b.floorTo - b.floorFrom + 1) * b.flatsPerFloor > 2000) throw badRequest('At most 2,000 flats can be created at once');
  const tower = await one(`SELECT id, code FROM towers WHERE id = $1 AND society_id = $2`, [b.towerId, a.societyId]);
  if (!tower) throw notFound('Tower');
  const created = await tx(async (c) => {
    await c.query(
      `INSERT INTO floors (society_id, tower_id, floor_number, label)
       SELECT $1, $2, n, CASE WHEN n = 0 THEN 'Ground' ELSE 'Floor ' || n END FROM generate_series($3::int, $4::int) n
       ON CONFLICT (tower_id, floor_number) DO NOTHING`,
      [a.societyId, tower.id, b.floorFrom, b.floorTo],
    );
    const r = await c.query(
      `INSERT INTO flats (society_id, tower_id, floor_id, number, unit_code, flat_type, area_sqft, created_by)
       SELECT $1, $2, fl.id,
              $3 || '-' || (CASE WHEN fl.floor_number = 0 THEN 'G' ELSE fl.floor_number::text END) || lpad(u::text, 2, '0'),
              (CASE WHEN fl.floor_number = 0 THEN 'G' ELSE fl.floor_number::text END) || lpad(u::text, 2, '0'),
              $4, $5, $6
         FROM floors fl CROSS JOIN generate_series(1, $7::int) u
        WHERE fl.tower_id = $2 AND fl.floor_number BETWEEN $8 AND $9
       ON CONFLICT (society_id, number) DO NOTHING`,
      [a.societyId, tower.id, tower.code, b.flatType, b.areaSqft ?? null, a.userId, b.flatsPerFloor, b.floorFrom, b.floorTo],
    );
    await audit(req, { action: 'flats.bulk_created', entityType: 'tower', entityId: tower.id, newValues: { ...b, created: r.rowCount } }, c);
    return r.rowCount ?? 0;
  });
  res.status(201).json({ created });
});

structureRouter.post('/flats', async (req, res) => {
  const a = ctx(req);
  const b = z.object({ towerId: z.string().uuid(), floorNumber: z.number().int().min(-5).max(200), unitCode: z.string().trim().regex(/^[A-Z0-9]{1,8}$/i), flatType: optionalText(20), areaSqft: z.number().int().optional().nullable() }).parse(req.body);
  const tower = await one(`SELECT id, code FROM towers WHERE id = $1 AND society_id = $2`, [b.towerId, a.societyId]);
  if (!tower) throw notFound('Tower');
  const flat = await tx(async (c) => {
    const floor = (
      await c.query(
        `INSERT INTO floors (society_id, tower_id, floor_number, label) VALUES ($1,$2,$3,'Floor ' || $3)
         ON CONFLICT (tower_id, floor_number) DO UPDATE SET label = floors.label RETURNING id`,
        [a.societyId, tower.id, b.floorNumber],
      )
    ).rows[0];
    const f = (
      await c.query(
        `INSERT INTO flats (society_id, tower_id, floor_id, number, unit_code, flat_type, area_sqft, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, number`,
        [a.societyId, tower.id, floor.id, `${tower.code}-${b.unitCode.toUpperCase()}`, b.unitCode.toUpperCase(), b.flatType, b.areaSqft ?? null, a.userId],
      )
    ).rows[0];
    await audit(req, { action: 'flat.created', entityType: 'flat', entityId: f.id, newValues: { number: f.number } }, c);
    return f;
  });
  res.status(201).json(flat);
});

const flatSorts: Record<string, string> = { number: 'f.number', tower: 't.sort_order, f.number', occupancy: 'f.occupancy_status, f.number', residents: 'residents DESC, f.number' };

structureRouter.get('/flats', async (req, res) => {
  const a = ctx(req);
  const q = pagination
    .extend({
      q: z.string().trim().max(60).optional(),
      towerId: z.string().uuid().optional(),
      occupancy: z.enum(['vacant', 'owner_occupied', 'tenant_occupied']).optional(),
      sort: z.enum(['number', 'tower', 'occupancy', 'residents']).default('tower'),
    })
    .parse(req.query);
  const { limit, offset } = pageClause(q);
  const where = `f.society_id = $1 AND ($2::uuid IS NULL OR f.tower_id = $2) AND ($3::text IS NULL OR f.occupancy_status = $3)
    AND ($4::text IS NULL OR f.number ILIKE $4 OR EXISTS (
      SELECT 1 FROM resident_flat_relationships x JOIN residents r ON r.id = x.resident_id JOIN users u ON u.id = r.user_id
       WHERE x.flat_id = f.id AND x.status = 'active' AND u.full_name ILIKE $4))`;
  const params = [a.societyId, q.towerId ?? null, q.occupancy ?? null, q.q ? likePattern(q.q) : null];
  const rows = await many(
    `SELECT f.id, f.number, f.unit_code, f.flat_type, f.area_sqft, f.occupancy_status, f.is_active, t.name AS tower_name, fl.floor_number,
            (SELECT count(*) FROM resident_flat_relationships x WHERE x.flat_id = f.id AND x.status = 'active')::int AS residents,
            (SELECT u.full_name FROM resident_flat_relationships x JOIN residents r ON r.id = x.resident_id JOIN users u ON u.id = r.user_id
              WHERE x.flat_id = f.id AND x.status = 'active' ORDER BY x.is_primary DESC, x.relation LIMIT 1) AS primary_resident
       FROM flats f JOIN towers t ON t.id = f.tower_id JOIN floors fl ON fl.id = f.floor_id
      WHERE ${where}
      ORDER BY ${flatSorts[q.sort]} LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = await one(`SELECT count(*)::int AS n FROM flats f WHERE ${where}`, params);
  res.json({ flats: rows, total: total.n, page: q.page, pageSize: q.pageSize });
});

structureRouter.get('/flats/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const flat = await one(
    `SELECT f.*, t.name AS tower_name, fl.floor_number FROM flats f JOIN towers t ON t.id = f.tower_id JOIN floors fl ON fl.id = f.floor_id
      WHERE f.id = $1 AND f.society_id = $2`,
    [id, a.societyId],
  );
  if (!flat) throw notFound('Flat');
  const residents = await many(
    `SELECT rfr.id AS relationship_id, r.id AS resident_id, u.full_name, u.mobile, rfr.relation, rfr.is_primary, rfr.move_in_date
       FROM resident_flat_relationships rfr JOIN residents r ON r.id = rfr.resident_id JOIN users u ON u.id = r.user_id
      WHERE rfr.flat_id = $1 AND rfr.status = 'active' ORDER BY rfr.is_primary DESC, rfr.relation`,
    [id],
  );
  res.json({ flat, residents });
});

structureRouter.patch('/flats/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = z.object({ flatType: optionalText(20), areaSqft: z.number().int().min(100).max(20000).optional().nullable(), isActive: z.boolean().optional() }).parse(req.body);
  const before = await one(`SELECT flat_type, area_sqft, is_active FROM flats WHERE id = $1 AND society_id = $2`, [id, a.societyId]);
  if (!before) throw notFound('Flat');
  await pool.query(
    `UPDATE flats SET flat_type = CASE WHEN $1 THEN $2 ELSE flat_type END, area_sqft = CASE WHEN $3 THEN $4 ELSE area_sqft END, is_active = COALESCE($5, is_active) WHERE id = $6`,
    ['flatType' in req.body, b.flatType, 'areaSqft' in req.body, b.areaSqft ?? null, b.isActive ?? null, id],
  );
  await audit(req, { action: 'flat.updated', entityType: 'flat', entityId: id, oldValues: before, newValues: b });
  res.json({ ok: true });
});

export async function recomputeOccupancy(flatId: string, db: Db = pool) {
  await db.query(
    `UPDATE flats SET occupancy_status = CASE
        WHEN EXISTS (SELECT 1 FROM resident_flat_relationships WHERE flat_id = $1 AND status = 'active' AND relation = 'tenant') THEN 'tenant_occupied'
        WHEN EXISTS (SELECT 1 FROM resident_flat_relationships WHERE flat_id = $1 AND status = 'active') THEN 'owner_occupied'
        ELSE 'vacant' END
      WHERE id = $1`,
    [flatId],
  );
}
