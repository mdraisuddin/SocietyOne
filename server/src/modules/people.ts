import { Router } from 'express';
import { many, one, pool, tx } from '../db/pool.js';
import { ctx, requireAuth, requirePermission } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { badRequest, conflict, notFound } from '../core/errors.js';
import { indianMobile, isoDate, likePattern, optionalText, pageClause, pagination, text, z } from '../core/validate.js';
import { recomputeOccupancy } from './society.js';

// ============================================================================
// Residents (admin-managed)
// ============================================================================
export const residentsRouter = Router();
residentsRouter.use(requireAuth, requirePermission('residents:manage'));

const residentSorts: Record<string, string> = {
  name: 'u.full_name',
  flat: 'f.number',
  move_in: 'rfr.move_in_date DESC NULLS LAST',
  recent: 'r.created_at DESC',
};

residentsRouter.get('/', async (req, res) => {
  const a = ctx(req);
  const q = pagination
    .extend({
      q: z.string().trim().max(60).optional(),
      towerId: z.string().uuid().optional(),
      relation: z.enum(['owner', 'tenant', 'family_member']).optional(),
      status: z.enum(['active', 'moved_out', 'inactive']).default('active'),
      sort: z.enum(['name', 'flat', 'move_in', 'recent']).default('flat'),
    })
    .parse(req.query);
  const { limit, offset } = pageClause(q);
  const where = `r.society_id = $1 AND r.status = $2 AND ($3::uuid IS NULL OR f.tower_id = $3) AND ($4::text IS NULL OR rfr.relation = $4)
     AND ($5::text IS NULL OR u.full_name ILIKE $5 OR u.mobile ILIKE $5 OR f.number ILIKE $5 OR u.email ILIKE $5)`;
  const params = [a.societyId, q.status, q.towerId ?? null, q.relation ?? null, q.q ? likePattern(q.q) : null];
  const from = `FROM residents r JOIN users u ON u.id = r.user_id
     LEFT JOIN LATERAL (SELECT * FROM resident_flat_relationships x WHERE x.resident_id = r.id AND (x.status = 'active' OR r.status <> 'active')
                         ORDER BY x.is_primary DESC, x.created_at DESC LIMIT 1) rfr ON true
     LEFT JOIN flats f ON f.id = rfr.flat_id LEFT JOIN towers t ON t.id = f.tower_id`;
  const rows = await many(
    `SELECT r.id, r.status, r.created_at, u.id AS user_id, u.full_name, u.mobile, u.email, rfr.relation, rfr.is_primary, rfr.move_in_date,
            f.id AS flat_id, f.number AS flat_number, t.name AS tower_name
     ${from} WHERE ${where} ORDER BY ${residentSorts[q.sort]} LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = await one(`SELECT count(*)::int AS n ${from} WHERE ${where}`, params);
  res.json({ residents: rows, total: total.n, page: q.page, pageSize: q.pageSize });
});

const addResident = z.object({
  fullName: text(120),
  mobile: indianMobile,
  email: z.string().trim().email('Enter a valid email').optional().nullable().or(z.literal('').transform(() => null)),
  flatId: z.string().uuid(),
  relation: z.enum(['owner', 'tenant', 'family_member']),
  isPrimary: z.boolean().default(false),
  moveInDate: isoDate.optional().nullable(),
});

/** Add / invite a resident. Creates the user if needed; they sign in with OTP on their mobile. */
residentsRouter.post('/', async (req, res) => {
  const a = ctx(req);
  const b = addResident.parse(req.body);
  const flat = await one(`SELECT id, number FROM flats WHERE id = $1 AND society_id = $2`, [b.flatId, a.societyId]);
  if (!flat) throw notFound('Flat');
  const out = await tx(async (c) => {
    let user = (await c.query(`SELECT id, full_name FROM users WHERE mobile = $1`, [b.mobile])).rows[0];
    if (!user) {
      user = (
        await c.query(`INSERT INTO users (full_name, mobile, email, created_by) VALUES ($1,$2,$3,$4) RETURNING id, full_name`, [b.fullName, b.mobile, b.email ?? null, a.userId])
      ).rows[0];
    }
    await c.query(
      `INSERT INTO society_users (society_id, user_id, role, created_by) VALUES ($1,$2,'resident',$3)
       ON CONFLICT (society_id, user_id, role) DO UPDATE SET status = 'active'`,
      [a.societyId, user.id, a.userId],
    );
    const resident = (
      await c.query(
        `INSERT INTO residents (society_id, user_id, created_by) VALUES ($1,$2,$3)
         ON CONFLICT (society_id, user_id) DO UPDATE SET status = 'active' RETURNING id`,
        [a.societyId, user.id, a.userId],
      )
    ).rows[0];
    const existing = (await c.query(`SELECT id FROM resident_flat_relationships WHERE resident_id = $1 AND flat_id = $2 AND status = 'active'`, [resident.id, flat.id])).rows[0];
    if (existing) throw conflict('This person is already registered to this flat');
    if (b.isPrimary) await c.query(`UPDATE resident_flat_relationships SET is_primary = false WHERE flat_id = $1 AND status = 'active'`, [flat.id]);
    const rel = (
      await c.query(
        `INSERT INTO resident_flat_relationships (society_id, resident_id, flat_id, relation, is_primary, move_in_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [a.societyId, resident.id, flat.id, b.relation, b.isPrimary, b.moveInDate ?? null, a.userId],
      )
    ).rows[0];
    await recomputeOccupancy(flat.id, c);
    await audit(req, { action: 'resident.added', entityType: 'resident', entityId: resident.id, newValues: { full_name: b.fullName, flat: flat.number, relation: b.relation } }, c);
    return { residentId: resident.id, relationshipId: rel.id, userId: user.id };
  });
  res.status(201).json(out);
});

residentsRouter.get('/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const r = await one(
    `SELECT r.id, r.status, r.created_at, u.id AS user_id, u.full_name, u.mobile, u.email, u.last_login_at
       FROM residents r JOIN users u ON u.id = r.user_id WHERE r.id = $1 AND r.society_id = $2`,
    [id, a.societyId],
  );
  if (!r) throw notFound('Resident');
  const flats = await many(
    `SELECT rfr.id AS relationship_id, rfr.relation, rfr.is_primary, rfr.move_in_date, rfr.move_out_date, rfr.status, f.id AS flat_id, f.number, t.name AS tower_name
       FROM resident_flat_relationships rfr JOIN flats f ON f.id = rfr.flat_id JOIN towers t ON t.id = f.tower_id
      WHERE rfr.resident_id = $1 ORDER BY rfr.status, rfr.created_at DESC`,
    [id],
  );
  res.json({ resident: r, flats });
});

residentsRouter.patch('/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = z.object({ fullName: text(120).optional(), email: z.string().trim().email().optional().nullable() }).parse(req.body);
  const r = await one(`SELECT r.user_id, u.full_name, u.email FROM residents r JOIN users u ON u.id = r.user_id WHERE r.id = $1 AND r.society_id = $2`, [id, a.societyId]);
  if (!r) throw notFound('Resident');
  await pool.query(`UPDATE users SET full_name = COALESCE($1, full_name), email = CASE WHEN $2 THEN $3 ELSE email END WHERE id = $4`, [
    b.fullName ?? null, 'email' in req.body, b.email ?? null, r.user_id,
  ]);
  await audit(req, { action: 'resident.updated', entityType: 'resident', entityId: id, oldValues: { full_name: r.full_name, email: r.email }, newValues: b });
  res.json({ ok: true });
});

/** Change society/tower/flat relationship — administrator only. */
residentsRouter.post('/:id/flats', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = addResident.pick({ flatId: true, relation: true, isPrimary: true, moveInDate: true }).parse(req.body);
  const r = await one(`SELECT id FROM residents WHERE id = $1 AND society_id = $2 AND status = 'active'`, [id, a.societyId]);
  if (!r) throw notFound('Resident');
  const flat = await one(`SELECT id, number FROM flats WHERE id = $1 AND society_id = $2`, [b.flatId, a.societyId]);
  if (!flat) throw notFound('Flat');
  const rel = await tx(async (c) => {
    if (b.isPrimary) await c.query(`UPDATE resident_flat_relationships SET is_primary = false WHERE flat_id = $1 AND status = 'active'`, [flat.id]);
    const x = (
      await c.query(
        `INSERT INTO resident_flat_relationships (society_id, resident_id, flat_id, relation, is_primary, move_in_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [a.societyId, id, flat.id, b.relation, b.isPrimary, b.moveInDate ?? null, a.userId],
      )
    ).rows[0];
    await recomputeOccupancy(flat.id, c);
    await audit(req, { action: 'resident.flat_linked', entityType: 'resident', entityId: id, newValues: { flat: flat.number, relation: b.relation } }, c);
    return x;
  });
  res.status(201).json({ relationshipId: rel.id });
});

residentsRouter.delete('/:id/flats/:relId', async (req, res) => {
  const a = ctx(req);
  const p = z.object({ id: z.string().uuid(), relId: z.string().uuid() }).parse(req.params);
  const rel = await one(
    `SELECT rfr.id, rfr.flat_id, rfr.relation, f.number FROM resident_flat_relationships rfr JOIN flats f ON f.id = rfr.flat_id
      WHERE rfr.id = $1 AND rfr.resident_id = $2 AND rfr.society_id = $3 AND rfr.status = 'active'`,
    [p.relId, p.id, a.societyId],
  );
  if (!rel) throw notFound('Flat link');
  await tx(async (c) => {
    await c.query(`UPDATE resident_flat_relationships SET status = 'ended', move_out_date = current_date, is_primary = false WHERE id = $1`, [rel.id]);
    await recomputeOccupancy(rel.flat_id, c);
    await audit(req, { action: 'resident.flat_unlinked', entityType: 'resident', entityId: p.id, oldValues: { flat: rel.number, relation: rel.relation } }, c);
  });
  res.json({ ok: true });
});

/** Remove a resident from the society (soft: history is retained, access revoked). */
residentsRouter.delete('/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const r = await one(`SELECT r.id, r.user_id, u.full_name FROM residents r JOIN users u ON u.id = r.user_id WHERE r.id = $1 AND r.society_id = $2 AND r.status = 'active'`, [id, a.societyId]);
  if (!r) throw notFound('Resident');
  await tx(async (c) => {
    const flats = (await c.query(`UPDATE resident_flat_relationships SET status = 'ended', move_out_date = current_date, is_primary = false WHERE resident_id = $1 AND status = 'active' RETURNING flat_id`, [id])).rows;
    await c.query(`UPDATE residents SET status = 'moved_out' WHERE id = $1`, [id]);
    await c.query(`UPDATE society_users SET status = 'disabled' WHERE society_id = $1 AND user_id = $2 AND role = 'resident'`, [a.societyId, r.user_id]);
    await c.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND society_id = $2 AND role = 'resident' AND revoked_at IS NULL`, [r.user_id, a.societyId]);
    await c.query(`UPDATE visitor_invites SET status = 'cancelled' WHERE invited_by = $1 AND society_id = $2 AND status = 'active'`, [r.user_id, a.societyId]);
    for (const f of flats) await recomputeOccupancy(f.flat_id, c);
    await audit(req, { action: 'resident.removed', entityType: 'resident', entityId: id, oldValues: { full_name: r.full_name, status: 'active' }, newValues: { status: 'moved_out' } }, c);
  });
  res.json({ ok: true });
});

// ============================================================================
// Security guards (admin-managed)
// ============================================================================
export const guardsRouter = Router();
guardsRouter.use(requireAuth, requirePermission('guards:manage'));

guardsRouter.get('/', async (req, res) => {
  const a = ctx(req);
  const q = z.object({ q: z.string().trim().max(60).optional(), status: z.enum(['active', 'inactive']).optional() }).parse(req.query);
  const rows = await many(
    `SELECT g.id, g.employee_code, g.agency_name, g.shift, g.status, g.created_at, u.full_name, u.mobile, u.last_login_at, gt.name AS default_gate, g.default_gate_id,
            (SELECT count(*) FROM visitor_entries ve WHERE ve.checked_in_by = u.id AND ve.checked_in_at > now() - interval '24 hours')::int AS entries_24h
       FROM security_guards g JOIN users u ON u.id = g.user_id LEFT JOIN gates gt ON gt.id = g.default_gate_id
      WHERE g.society_id = $1 AND ($2::text IS NULL OR u.full_name ILIKE $2 OR u.mobile ILIKE $2 OR g.employee_code ILIKE $2)
        AND ($3::text IS NULL OR g.status = $3)
      ORDER BY g.status, u.full_name`,
    [a.societyId, q.q ? likePattern(q.q) : null, q.status ?? null],
  );
  res.json({ guards: rows });
});

const guardInput = z.object({
  fullName: text(120),
  mobile: indianMobile,
  employeeCode: optionalText(30),
  agencyName: optionalText(120),
  shift: z.enum(['day', 'night', 'rotational']).default('day'),
  defaultGateId: z.string().uuid().optional().nullable(),
});

guardsRouter.post('/', async (req, res) => {
  const a = ctx(req);
  const b = guardInput.parse(req.body);
  if (b.defaultGateId && !(await one(`SELECT 1 FROM gates WHERE id = $1 AND society_id = $2`, [b.defaultGateId, a.societyId]))) throw badRequest('Unknown gate');
  const out = await tx(async (c) => {
    let user = (await c.query(`SELECT id FROM users WHERE mobile = $1`, [b.mobile])).rows[0];
    if (!user) user = (await c.query(`INSERT INTO users (full_name, mobile, created_by) VALUES ($1,$2,$3) RETURNING id`, [b.fullName, b.mobile, a.userId])).rows[0];
    await c.query(`INSERT INTO society_users (society_id, user_id, role, created_by) VALUES ($1,$2,'guard',$3) ON CONFLICT (society_id, user_id, role) DO UPDATE SET status = 'active'`, [
      a.societyId, user.id, a.userId,
    ]);
    const g = (
      await c.query(
        `INSERT INTO security_guards (society_id, user_id, employee_code, agency_name, shift, default_gate_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (society_id, user_id) DO UPDATE SET status = 'active', employee_code = EXCLUDED.employee_code, agency_name = EXCLUDED.agency_name,
           shift = EXCLUDED.shift, default_gate_id = EXCLUDED.default_gate_id RETURNING id`,
        [a.societyId, user.id, b.employeeCode, b.agencyName, b.shift, b.defaultGateId ?? null, a.userId],
      )
    ).rows[0];
    await audit(req, { action: 'guard.added', entityType: 'security_guard', entityId: g.id, newValues: { full_name: b.fullName, shift: b.shift } }, c);
    return g;
  });
  res.status(201).json(out);
});

guardsRouter.patch('/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = guardInput.partial().omit({ mobile: true }).extend({ status: z.enum(['active', 'inactive']).optional() }).parse(req.body);
  const g = await one(`SELECT g.id, g.user_id, g.status, g.shift FROM security_guards g WHERE g.id = $1 AND g.society_id = $2`, [id, a.societyId]);
  if (!g) throw notFound('Guard');
  await tx(async (c) => {
    await c.query(
      `UPDATE security_guards SET employee_code = COALESCE($1, employee_code), agency_name = COALESCE($2, agency_name), shift = COALESCE($3, shift),
         default_gate_id = CASE WHEN $4 THEN $5::uuid ELSE default_gate_id END, status = COALESCE($6, status) WHERE id = $7`,
      [b.employeeCode ?? null, b.agencyName ?? null, b.shift ?? null, 'defaultGateId' in req.body, b.defaultGateId ?? null, b.status ?? null, id],
    );
    if (b.fullName) await c.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [b.fullName, g.user_id]);
    if (b.status) {
      await c.query(`UPDATE society_users SET status = $1 WHERE society_id = $2 AND user_id = $3 AND role = 'guard'`, [b.status === 'active' ? 'active' : 'disabled', a.societyId, g.user_id]);
      if (b.status === 'inactive') await c.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND society_id = $2 AND role = 'guard' AND revoked_at IS NULL`, [g.user_id, a.societyId]);
    }
    await audit(req, { action: b.status === 'inactive' ? 'guard.deactivated' : 'guard.updated', entityType: 'security_guard', entityId: id, oldValues: { status: g.status, shift: g.shift }, newValues: b }, c);
  });
  res.json({ ok: true });
});
