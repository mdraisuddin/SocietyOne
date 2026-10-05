import { Router, type Request } from 'express';
import QRCode from 'qrcode';
import type pg from 'pg';
import { many, one, pool, tx, type Db } from '../db/pool.js';
import { assertFlatAccess, ctx, requireAuth, requirePermission } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { hmac, randomDigits, safeEqual } from '../core/crypto.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../core/errors.js';
import { flatResidentUserIds, notify } from '../core/notifications.js';
import { addDays, dayOfWeek, fromMinutes, localDate, localTime, toMinutes } from '../core/time.js';
import { indianMobile, isoDate, hhmm, likePattern, optionalText, pageClause, pagination, text, vehicleNumber, z } from '../core/validate.js';
import { idempotent } from '../core/idempotency.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
export async function societyTz(societyId: string, db: Db = pool): Promise<string> {
  return (await one(`SELECT timezone FROM societies WHERE id = $1`, [societyId], db))?.timezone ?? 'Asia/Kolkata';
}

export async function findOrCreateVisitor(c: Db, societyId: string, name: string, mobile: string | null, createdBy: string) {
  if (mobile) {
    const v = (await c.query(`SELECT id, full_name FROM visitors WHERE society_id = $1 AND mobile = $2 ORDER BY created_at LIMIT 1`, [societyId, mobile])).rows[0];
    if (v) {
      if (v.full_name !== name) await c.query(`UPDATE visitors SET full_name = $1 WHERE id = $2`, [name, v.id]);
      return v.id as string;
    }
  }
  const r = await c.query(`INSERT INTO visitors (society_id, full_name, mobile, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [societyId, name, mobile, createdBy]);
  return r.rows[0].id as string;
}

const qrSignature = (inviteId: string, societyId: string) => hmac(`qr:${societyId}:${inviteId}`).slice(0, 22);
export const qrToken = (inviteId: string, societyId: string) => `SO1.${inviteId}.${qrSignature(inviteId, societyId)}`;

function parseQr(token: string, societyId: string): string | null {
  const m = /^SO1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})$/.exec(token.trim());
  if (!m) return null;
  return safeEqual(m[2], qrSignature(m[1], societyId)) ? m[1] : null;
}

/** Display name minimised for gate staff: "Priya Sharma" -> "Priya S." */
export const shortName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};

const INVITE_SELECT = `
  SELECT vi.*, v.full_name AS visitor_name, v.mobile AS visitor_mobile, f.number AS flat_number, t.name AS tower_name, s.name AS society_name, s.timezone,
         u.full_name AS invited_by_name,
         (SELECT ve.id FROM visitor_entries ve WHERE ve.invite_id = vi.id AND ve.status = 'inside' ORDER BY ve.checked_in_at DESC LIMIT 1) AS active_entry_id
    FROM visitor_invites vi
    JOIN visitors v ON v.id = vi.visitor_id
    JOIN flats f ON f.id = vi.flat_id
    JOIN towers t ON t.id = f.tower_id
    JOIN societies s ON s.id = vi.society_id
    JOIN users u ON u.id = vi.invited_by`;

export function inviteValidity(inv: any, now = new Date()): { valid: boolean; reason?: string; canCheckOut?: boolean } {
  const tz = inv.timezone ?? 'Asia/Kolkata';
  const today = localDate(now, tz);
  const nowMin = toMinutes(localTime(now, tz));
  if (inv.status === 'cancelled') return { valid: false, reason: 'This pass was cancelled by the resident' };
  if (inv.status === 'completed') return { valid: false, reason: 'This pass has already been used' };
  if (inv.status === 'expired') return { valid: false, reason: 'This pass has expired' };
  if (inv.active_entry_id) return { valid: false, reason: 'Visitor is already inside', canCheckOut: true };
  if (today < inv.valid_from) return { valid: false, reason: `Pass is valid from ${inv.valid_from}` };
  if (today > inv.valid_until) return { valid: false, reason: 'This pass has expired' };
  if (inv.visit_type === 'recurring' && inv.recurrence_days?.length && !inv.recurrence_days.includes(dayOfWeek(today))) {
    return { valid: false, reason: 'Pass is not valid on this day of the week' };
  }
  const start = toMinutes(inv.window_start.slice(0, 5));
  const end = toMinutes(inv.window_end.slice(0, 5));
  if (nowMin < start || nowMin > end) {
    return { valid: false, reason: `Pass is valid between ${inv.window_start.slice(0, 5)} and ${inv.window_end.slice(0, 5)}` };
  }
  return { valid: true };
}

async function passView(inv: any) {
  const token = qrToken(inv.id, inv.society_id);
  const qrSvg = await QRCode.toString(token, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', width: 240 });
  return {
    id: inv.id,
    passCode: inv.pass_code,
    otp: inv.otp_code,
    qrToken: token,
    qrSvg,
    visitorName: inv.visitor_name,
    visitorMobile: inv.visitor_mobile,
    flatId: inv.flat_id,
    flatNumber: inv.flat_number,
    towerName: inv.tower_name,
    societyName: inv.society_name,
    visitType: inv.visit_type,
    validFrom: inv.valid_from,
    validUntil: inv.valid_until,
    windowStart: inv.window_start.slice(0, 5),
    windowEnd: inv.window_end.slice(0, 5),
    expectedArrival: inv.expected_arrival?.slice(0, 5) ?? null,
    recurrenceDays: inv.recurrence_days,
    purpose: inv.purpose,
    guestCount: inv.guest_count,
    vehicleNumber: inv.vehicle_number,
    notes: inv.notes,
    status: inv.status,
    insideNow: !!inv.active_entry_id,
    createdAt: inv.created_at,
  };
}

async function resolveGate(req: Request, gateId: string | null | undefined, db: Db = pool) {
  const a = ctx(req);
  const id = gateId ?? a.defaultGateId;
  if (id) {
    const g = await one(`SELECT id, name FROM gates WHERE id = $1 AND society_id = $2 AND is_active`, [id, a.societyId], db);
    if (!g) throw badRequest('Unknown gate');
    return g as { id: string; name: string };
  }
  const g = await one(`SELECT id, name FROM gates WHERE society_id = $1 AND is_active ORDER BY name LIMIT 1`, [a.societyId], db);
  if (!g) throw badRequest('No gate configured for this society');
  return g as { id: string; name: string };
}

// ============================================================================
// Resident-facing visitor API
// ============================================================================
export const visitorsRouter = Router();
visitorsRouter.use(requireAuth);

const inviteInput = z
  .object({
    flatId: z.string().uuid().optional(),
    visitorName: text(80),
    mobile: indianMobile.optional().nullable().or(z.literal('').transform(() => null)),
    visitDate: isoDate,
    expectedArrival: hhmm,
    windowStart: hhmm.optional(),
    windowEnd: hhmm.optional(),
    purpose: text(120),
    guestCount: z.coerce.number().int().min(1).max(50).default(1),
    vehicleNumber,
    notes: optionalText(300),
    visitType: z.enum(['one_time', 'recurring']).default('one_time'),
    validUntil: isoDate.optional(),
    recurrenceDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .strict();

visitorsRouter.post('/invites', requirePermission('visitors:invite'), async (req, res) => {
  const a = ctx(req);
  const b = inviteInput.parse(req.body);
  const flatId = b.flatId ?? a.flatIds[0];
  if (!flatId) throw badRequest('You are not linked to a flat yet. Please contact your society office.');
  assertFlatAccess(req, flatId);
  const tz = await societyTz(a.societyId);
  const today = localDate(new Date(), tz);
  if (b.visitDate < today) throw badRequest('Visit date cannot be in the past');
  if (b.visitDate > addDays(today, 90)) throw badRequest('Visits can be scheduled up to 90 days ahead');
  const arrival = toMinutes(b.expectedArrival);
  const windowStart = b.windowStart ?? fromMinutes(Math.max(0, arrival - 60));
  const windowEnd = b.windowEnd ?? fromMinutes(Math.min(23 * 60 + 59, arrival + 180));
  if (toMinutes(windowEnd) <= toMinutes(windowStart)) throw badRequest('End time must be after start time');
  let validUntil = b.visitDate;
  if (b.visitType === 'recurring') {
    validUntil = b.validUntil ?? addDays(b.visitDate, 30);
    if (validUntil < b.visitDate) throw badRequest('“Valid until” must be on or after the first visit date');
    if (validUntil > addDays(b.visitDate, 90)) throw badRequest('Recurring passes can be valid for up to 90 days');
  }
  const created = await tx(async (c) => {
    const visitorId = await findOrCreateVisitor(c, a.societyId, b.visitorName, b.mobile ?? null, a.userId);
    for (let attempt = 0; attempt < 8; attempt++) {
      const passCode = `VIS-${randomDigits(6)}`;
      const otp = randomDigits(6);
      try {
        await c.query('SAVEPOINT ins');
        const r = await c.query(
          `INSERT INTO visitor_invites (society_id, flat_id, visitor_id, invited_by, pass_code, otp_code, visit_type, purpose, guest_count, vehicle_number, notes,
                                        valid_from, valid_until, window_start, window_end, expected_arrival, recurrence_days)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [a.societyId, flatId, visitorId, a.userId, passCode, otp, b.visitType, b.purpose, b.guestCount, b.vehicleNumber, b.notes, b.visitDate, validUntil,
            windowStart, windowEnd, b.expectedArrival, b.visitType === 'recurring' && b.recurrenceDays?.length ? b.recurrenceDays : null],
        );
        await c.query('RELEASE SAVEPOINT ins');
        await audit(req, { action: 'visitor.invited', entityType: 'visitor_invite', entityId: r.rows[0].id, newValues: { visitor: b.visitorName, date: b.visitDate, type: b.visitType } }, c);
        return r.rows[0].id as string;
      } catch (e: any) {
        await c.query('ROLLBACK TO SAVEPOINT ins');
        if (e.code !== '23505') throw e;
      }
    }
    throw new AppError(503, 'busy', 'Could not generate a unique pass. Please try again.');
  });
  const inv = await one(`${INVITE_SELECT} WHERE vi.id = $1`, [created]);
  res.status(201).json({ pass: await passView(inv) });
});

visitorsRouter.get('/invites', requirePermission('visitors:invite'), async (req, res) => {
  const a = ctx(req);
  const q = z.object({ scope: z.enum(['upcoming', 'past', 'all']).default('upcoming') }).parse(req.query);
  const tz = await societyTz(a.societyId);
  const today = localDate(new Date(), tz);
  const cond =
    q.scope === 'upcoming' ? `AND vi.valid_until >= $2 AND vi.status IN ('active','checked_in')` : q.scope === 'past' ? `AND (vi.valid_until < $2 OR vi.status NOT IN ('active','checked_in'))` : `AND $2::date IS NOT NULL`;
  const rows = await many(
    `${INVITE_SELECT} WHERE vi.society_id = $1 AND vi.flat_id = ANY($3) ${cond}
      ORDER BY ${q.scope === 'upcoming' ? 'vi.valid_from, vi.expected_arrival' : 'vi.valid_from DESC, vi.created_at DESC'} LIMIT 100`,
    [a.societyId, today, a.flatIds],
  );
  res.json({
    invites: rows.map((r) => ({
      id: r.id, passCode: r.pass_code, visitorName: r.visitor_name, visitorMobile: r.visitor_mobile, flatNumber: r.flat_number, visitType: r.visit_type,
      validFrom: r.valid_from, validUntil: r.valid_until, expectedArrival: r.expected_arrival?.slice(0, 5), windowStart: r.window_start.slice(0, 5),
      windowEnd: r.window_end.slice(0, 5), purpose: r.purpose, guestCount: r.guest_count, status: r.status, insideNow: !!r.active_entry_id, invitedBy: r.invited_by_name,
    })),
  });
});

visitorsRouter.get('/invites/:id', requirePermission('visitors:invite'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const inv = await one(`${INVITE_SELECT} WHERE vi.id = $1 AND vi.society_id = $2`, [id, a.societyId]);
  if (!inv) throw notFound('Visitor pass');
  assertFlatAccess(req, inv.flat_id);
  res.json({ pass: await passView(inv) });
});

visitorsRouter.post('/invites/:id/cancel', requirePermission('visitors:invite'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const inv = await one(`SELECT id, flat_id, status FROM visitor_invites WHERE id = $1 AND society_id = $2`, [id, a.societyId]);
  if (!inv) throw notFound('Visitor pass');
  assertFlatAccess(req, inv.flat_id);
  if (inv.status !== 'active') throw conflict('Only active passes can be cancelled');
  await pool.query(`UPDATE visitor_invites SET status = 'cancelled' WHERE id = $1`, [id]);
  await audit(req, { action: 'visitor.invite_cancelled', entityType: 'visitor_invite', entityId: id, oldValues: { status: inv.status }, newValues: { status: 'cancelled' } });
  res.json({ ok: true });
});

// Approvals for unexpected visitors -------------------------------------------
const APPROVAL_SELECT = `
  SELECT va.*, v.full_name AS visitor_name, v.mobile AS visitor_mobile, f.number AS flat_number, g.name AS gate_name,
         ru.full_name AS responded_by_name
    FROM visitor_approvals va
    JOIN visitors v ON v.id = va.visitor_id
    JOIN flats f ON f.id = va.flat_id
    LEFT JOIN gates g ON g.id = va.gate_id
    LEFT JOIN users ru ON ru.id = va.responded_by`;

async function expireApprovals(societyId: string, db: Db = pool) {
  await db.query(`UPDATE visitor_approvals SET status = 'expired' WHERE society_id = $1 AND status = 'pending' AND expires_at < now()`, [societyId]);
}

const approvalView = (r: any) => ({
  id: r.id, visitorName: r.visitor_name, visitorMobile: r.visitor_mobile, flatId: r.flat_id, flatNumber: r.flat_number, gateName: r.gate_name,
  category: r.category, provider: r.provider, purpose: r.purpose, guestCount: r.guest_count, vehicleNumber: r.vehicle_number, status: r.status,
  respondedBy: r.responded_by_name ? shortName(r.responded_by_name) : null, respondedAt: r.responded_at, expiresAt: r.expires_at, createdAt: r.created_at,
});

visitorsRouter.get('/approvals', requirePermission('visitors:respond'), async (req, res) => {
  const a = ctx(req);
  await expireApprovals(a.societyId);
  const rows = await many(`${APPROVAL_SELECT} WHERE va.society_id = $1 AND va.flat_id = ANY($2) AND (va.status = 'pending' OR va.created_at > now() - interval '24 hours') ORDER BY va.status = 'pending' DESC, va.created_at DESC LIMIT 20`, [a.societyId, a.flatIds]);
  res.json({ approvals: rows.map(approvalView) });
});

visitorsRouter.post('/approvals/:id/respond', requirePermission('visitors:respond'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { decision } = z.object({ decision: z.enum(['approve', 'reject']) }).parse(req.body);
  await expireApprovals(a.societyId);
  const result = await tx(async (c) => {
    const ap = (await c.query(`${APPROVAL_SELECT} WHERE va.id = $1 AND va.society_id = $2 FOR UPDATE OF va`, [id, a.societyId])).rows[0];
    if (!ap) throw notFound('Approval request');
    assertFlatAccess(req, ap.flat_id);
    if (ap.status !== 'pending') throw conflict(ap.status === 'expired' ? 'This request has expired' : `This request was already ${ap.status}`);
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await c.query(`UPDATE visitor_approvals SET status = $1, responded_by = $2, responded_at = now() WHERE id = $3`, [status, a.userId, id]);
    await audit(req, { action: `visitor.${status}`, entityType: 'visitor_approval', entityId: id, oldValues: { status: 'pending' }, newValues: { status, visitor: ap.visitor_name } }, c);
    await notify(
      {
        societyId: a.societyId,
        userIds: [ap.requested_by],
        type: 'visitor_approval_responded',
        title: status === 'approved' ? `Approved: ${ap.visitor_name}` : `Rejected: ${ap.visitor_name}`,
        body: `${ap.flat_number} has ${status} ${ap.visitor_name}${status === 'approved' ? '. You may check them in.' : '. Do not allow entry.'}`,
        priority: 'important',
        entityType: 'visitor_approval',
        entityId: id,
        url: `/guard/approvals/${id}`,
      },
      c,
    );
    return status;
  });
  res.json({ status: result });
});

// History -------------------------------------------------------------------
visitorsRouter.get('/history', requirePermission('visitors:invite'), async (req, res) => {
  const a = ctx(req);
  const q = pagination.extend({ q: z.string().trim().max(60).optional(), category: z.string().max(20).optional() }).parse(req.query);
  const { limit, offset } = pageClause(q);
  const rows = await many(
    `SELECT ve.id, ve.category, ve.provider, ve.visitor_name, ve.vehicle_number, ve.guest_count, ve.status, ve.checked_in_at, ve.checked_out_at,
            f.number AS flat_number, g.name AS gate_name, vi.purpose
       FROM visitor_entries ve JOIN flats f ON f.id = ve.flat_id LEFT JOIN gates g ON g.id = ve.gate_id LEFT JOIN visitor_invites vi ON vi.id = ve.invite_id
      WHERE ve.society_id = $1 AND ve.flat_id = ANY($2) AND ($3::text IS NULL OR ve.visitor_name ILIKE $3 OR ve.provider ILIKE $3)
        AND ($4::text IS NULL OR ve.category = $4)
      ORDER BY ve.checked_in_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [a.societyId, a.flatIds, q.q ? likePattern(q.q) : null, q.category ?? null],
  );
  res.json({ entries: rows, page: q.page });
});

// Admin view ------------------------------------------------------------------
visitorsRouter.get('/admin/entries', requirePermission('visitors:view_all'), async (req, res) => {
  const a = ctx(req);
  const q = pagination
    .extend({
      q: z.string().trim().max(60).optional(),
      category: z.string().max(20).optional(),
      status: z.enum(['inside', 'checked_out', 'left_at_gate']).optional(),
      towerId: z.string().uuid().optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
    })
    .parse(req.query);
  const { limit, offset } = pageClause(q);
  const tz = await societyTz(a.societyId);
  const where = `ve.society_id = $1 AND ($2::text IS NULL OR ve.visitor_name ILIKE $2 OR ve.visitor_mobile ILIKE $2 OR f.number ILIKE $2 OR ve.provider ILIKE $2 OR ve.vehicle_number ILIKE $2)
      AND ($3::text IS NULL OR ve.category = $3) AND ($4::text IS NULL OR ve.status = $4) AND ($5::uuid IS NULL OR f.tower_id = $5)
      AND ($6::date IS NULL OR (ve.checked_in_at AT TIME ZONE $8)::date >= $6) AND ($7::date IS NULL OR (ve.checked_in_at AT TIME ZONE $8)::date <= $7)`;
  const params = [a.societyId, q.q ? likePattern(q.q) : null, q.category ?? null, q.status ?? null, q.towerId ?? null, q.from ?? null, q.to ?? null, tz];
  const rows = await many(
    `SELECT ve.id, ve.category, ve.provider, ve.visitor_name, ve.visitor_mobile, ve.vehicle_number, ve.guest_count, ve.status, ve.checked_in_at, ve.checked_out_at,
            f.number AS flat_number, g.name AS gate_name, gu.full_name AS guard_name,
            CASE WHEN ve.invite_id IS NOT NULL THEN 'pre_approved' WHEN ve.approval_id IS NOT NULL THEN 'approved_at_gate' ELSE 'walk_in' END AS entry_type
       FROM visitor_entries ve LEFT JOIN flats f ON f.id = ve.flat_id LEFT JOIN gates g ON g.id = ve.gate_id LEFT JOIN users gu ON gu.id = ve.checked_in_by
      WHERE ${where} ORDER BY ve.checked_in_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = await one(`SELECT count(*)::int AS n FROM visitor_entries ve LEFT JOIN flats f ON f.id = ve.flat_id WHERE ${where}`, params);
  res.json({ entries: rows, total: total.n, page: q.page, pageSize: q.pageSize });
});

// ============================================================================
// Security / gate API
// ============================================================================
export const gateRouter = Router();
gateRouter.use(requireAuth, requirePermission('gate:operate'));

/** Today's expected visitors — cached on the guard device for offline verification. */
gateRouter.get('/expected', async (req, res) => {
  const a = ctx(req);
  const tz = await societyTz(a.societyId);
  const today = localDate(new Date(), tz);
  const rows = await many(`${INVITE_SELECT} WHERE vi.society_id = $1 AND vi.status IN ('active','checked_in') AND $2::date BETWEEN vi.valid_from AND vi.valid_until ORDER BY vi.expected_arrival`, [
    a.societyId,
    today,
  ]);
  res.json({
    date: today,
    generatedAt: new Date().toISOString(),
    invites: rows
      .filter((r) => r.visit_type === 'one_time' || !r.recurrence_days?.length || r.recurrence_days.includes(dayOfWeek(today)))
      .map((r) => ({
        id: r.id, passCode: r.pass_code, otp: r.otp_code, visitorName: r.visitor_name, flatNumber: r.flat_number, towerName: r.tower_name,
        expectedArrival: r.expected_arrival?.slice(0, 5), windowStart: r.window_start.slice(0, 5), windowEnd: r.window_end.slice(0, 5),
        guestCount: r.guest_count, vehicleNumber: r.vehicle_number, purpose: r.purpose, status: r.status, insideNow: !!r.active_entry_id, activeEntryId: r.active_entry_id,
      })),
  });
});

const guardInviteView = (inv: any) => ({
  id: inv.id,
  passCode: inv.pass_code,
  visitorName: inv.visitor_name,
  visitorMobileMasked: inv.visitor_mobile ? `•••••${inv.visitor_mobile.slice(-4)}` : null,
  flatNumber: inv.flat_number,
  towerName: inv.tower_name,
  expectedArrival: inv.expected_arrival?.slice(0, 5) ?? null,
  windowStart: inv.window_start.slice(0, 5),
  windowEnd: inv.window_end.slice(0, 5),
  validFrom: inv.valid_from,
  validUntil: inv.valid_until,
  visitType: inv.visit_type,
  purpose: inv.purpose,
  guestCount: inv.guest_count,
  vehicleNumber: inv.vehicle_number,
  status: inv.status,
  activeEntryId: inv.active_entry_id,
  validity: inviteValidity(inv),
});

gateRouter.post('/verify', async (req, res) => {
  const a = ctx(req);
  const b = z.object({ otp: z.string().trim().regex(/^\d{6}$/).optional(), qr: z.string().max(200).optional(), passCode: z.string().trim().toUpperCase().max(12).optional() }).parse(req.body);
  let inv: any = null;
  if (b.qr) {
    const id = parseQr(b.qr, a.societyId);
    if (!id) throw new AppError(404, 'invalid_pass', 'This QR code is not a valid pass for this society');
    inv = await one(`${INVITE_SELECT} WHERE vi.id = $1 AND vi.society_id = $2`, [id, a.societyId]);
  } else if (b.otp) {
    inv = await one(`${INVITE_SELECT} WHERE vi.society_id = $1 AND vi.otp_code = $2 AND vi.status IN ('active','checked_in')`, [a.societyId, b.otp]);
  } else if (b.passCode) {
    const code = b.passCode.startsWith('VIS-') ? b.passCode : `VIS-${b.passCode}`;
    inv = await one(`${INVITE_SELECT} WHERE vi.society_id = $1 AND vi.pass_code = $2`, [a.societyId, code]);
  } else throw badRequest('Scan a QR code or enter the passcode');
  if (!inv) throw new AppError(404, 'invalid_pass', 'No matching visitor pass found');
  await audit(req, { action: 'gate.pass_verified', entityType: 'visitor_invite', entityId: inv.id, summary: b.qr ? 'qr' : b.otp ? 'otp' : 'pass_code' });
  res.json({ invite: guardInviteView(inv) });
});

/** Fast partial-match search for gate staff. Returns minimum necessary information. */
gateRouter.get('/search', async (req, res) => {
  const a = ctx(req);
  const { q } = z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(60) }).parse(req.query);
  const tz = await societyTz(a.societyId);
  const today = localDate(new Date(), tz);
  const pat = likePattern(q);
  const digits = q.replace(/\D/g, '');
  const invites = await many(
    `${INVITE_SELECT} WHERE vi.society_id = $1 AND vi.status IN ('active','checked_in') AND vi.valid_until >= $2::date AND vi.valid_from <= $2::date + 1
        AND (v.full_name ILIKE $3 OR f.number ILIKE $3 OR vi.pass_code ILIKE $3 OR ($4 <> '' AND v.mobile LIKE '%' || $4 || '%'))
      ORDER BY vi.valid_from, vi.expected_arrival LIMIT 15`,
    [a.societyId, today, pat, digits.length >= 4 ? digits : ''],
  );
  const flats = await many(
    `SELECT f.id, f.number, t.name AS tower_name,
            array_remove(array_agg(DISTINCT u.full_name), NULL) AS resident_names
       FROM flats f JOIN towers t ON t.id = f.tower_id
       LEFT JOIN resident_flat_relationships rfr ON rfr.flat_id = f.id AND rfr.status = 'active'
       LEFT JOIN residents r ON r.id = rfr.resident_id AND r.status = 'active'
       LEFT JOIN users u ON u.id = r.user_id
      WHERE f.society_id = $1 AND f.is_active AND (f.number ILIKE $2 OR f.unit_code ILIKE $2 OR u.full_name ILIKE $2)
      GROUP BY f.id, t.name, t.sort_order ORDER BY t.sort_order, f.number LIMIT 15`,
    [a.societyId, pat],
  );
  const inside = await many(
    `SELECT ve.id, ve.visitor_name, ve.category, ve.provider, ve.checked_in_at, f.number AS flat_number
       FROM visitor_entries ve LEFT JOIN flats f ON f.id = ve.flat_id
      WHERE ve.society_id = $1 AND ve.status = 'inside' AND (ve.visitor_name ILIKE $2 OR f.number ILIKE $2 OR ve.vehicle_number ILIKE $2 OR ($3 <> '' AND ve.visitor_mobile LIKE '%' || $3 || '%'))
      ORDER BY ve.checked_in_at DESC LIMIT 10`,
    [a.societyId, pat, digits.length >= 4 ? digits : ''],
  );
  res.json({
    invites: invites.map(guardInviteView),
    flats: flats.map((f) => ({ id: f.id, number: f.number, towerName: f.tower_name, residents: f.resident_names.map(shortName), occupied: f.resident_names.length > 0 })),
    inside,
  });
});

const checkInBody = z.object({ gateId: z.string().uuid().optional().nullable(), clientRef: z.string().max(64).optional() });

gateRouter.post('/invites/:id/check-in', idempotent, async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = checkInBody.parse(req.body ?? {});
  const gate = await resolveGate(req, b.gateId);
  const entry = await tx(async (c) => {
    const inv = (await c.query(`${INVITE_SELECT} WHERE vi.id = $1 AND vi.society_id = $2 FOR UPDATE OF vi`, [id, a.societyId])).rows[0];
    if (!inv) throw notFound('Visitor pass');
    const v = inviteValidity(inv);
    if (!v.valid) throw new AppError(409, 'pass_not_valid', v.reason ?? 'Pass is not valid now');
    const e = (
      await c.query(
        `INSERT INTO visitor_entries (society_id, flat_id, visitor_id, invite_id, category, visitor_name, visitor_mobile, vehicle_number, guest_count, gate_id, checked_in_by, client_ref)
         VALUES ($1,$2,$3,$4,'guest',$5,$6,$7,$8,$9,$10,$11) RETURNING id, checked_in_at`,
        [a.societyId, inv.flat_id, inv.visitor_id, inv.id, inv.visitor_name, inv.visitor_mobile, inv.vehicle_number, inv.guest_count, gate.id, a.userId, b.clientRef ?? null],
      )
    ).rows[0];
    if (inv.visit_type === 'one_time') await c.query(`UPDATE visitor_invites SET status = 'checked_in' WHERE id = $1`, [inv.id]);
    await audit(req, { action: 'gate.visitor_checked_in', entityType: 'visitor_entry', entityId: e.id, newValues: { visitor: inv.visitor_name, flat: inv.flat_number, gate: gate.name, via: 'invite' } }, c);
    await notify(
      {
        societyId: a.societyId,
        userIds: await flatResidentUserIds(a.societyId, inv.flat_id, c),
        type: 'visitor_checked_in',
        title: `${inv.visitor_name} has arrived`,
        body: `${inv.visitor_name} checked in at ${gate.name}.`,
        entityType: 'visitor_entry',
        entityId: e.id,
        url: '/app/visitors',
      },
      c,
    );
    return { id: e.id, checkedInAt: e.checked_in_at, visitorName: inv.visitor_name, flatNumber: inv.flat_number, gateName: gate.name };
  });
  res.status(201).json({ entry });
});

gateRouter.post('/entries/:id/check-out', idempotent, async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = checkInBody.parse(req.body ?? {});
  const gate = await resolveGate(req, b.gateId);
  const out = await tx(async (c) => {
    const e = (
      await c.query(
        `SELECT ve.*, f.number AS flat_number FROM visitor_entries ve LEFT JOIN flats f ON f.id = ve.flat_id WHERE ve.id = $1 AND ve.society_id = $2 FOR UPDATE OF ve`,
        [id, a.societyId],
      )
    ).rows[0];
    if (!e) throw notFound('Entry');
    if (e.status !== 'inside') throw conflict('This visitor has already been checked out');
    const r = (await c.query(`UPDATE visitor_entries SET status = 'checked_out', checked_out_at = now(), checked_out_by = $1, checkout_gate_id = $2 WHERE id = $3 RETURNING checked_out_at`, [a.userId, gate.id, id])).rows[0];
    if (e.invite_id) await c.query(`UPDATE visitor_invites SET status = 'completed' WHERE id = $1 AND visit_type = 'one_time'`, [e.invite_id]);
    await audit(req, { action: 'gate.visitor_checked_out', entityType: 'visitor_entry', entityId: id, newValues: { visitor: e.visitor_name, gate: gate.name } }, c);
    if (e.flat_id && e.category === 'guest') {
      await notify(
        {
          societyId: a.societyId,
          userIds: await flatResidentUserIds(a.societyId, e.flat_id, c),
          type: 'visitor_checked_out',
          title: `${e.visitor_name} has left`,
          body: `${e.visitor_name} checked out at ${gate.name}.`,
          entityType: 'visitor_entry',
          entityId: id,
          url: '/app/visitors',
        },
        c,
      );
    }
    return { id, checkedOutAt: r.checked_out_at };
  });
  res.json({ entry: out });
});

const approvalInput = z.object({
  visitorName: text(80),
  mobile: indianMobile.optional().nullable().or(z.literal('').transform(() => null)),
  flatId: z.string().uuid(),
  purpose: text(120),
  guestCount: z.coerce.number().int().min(1).max(50).default(1),
  vehicleNumber,
  category: z.enum(['guest', 'delivery', 'food_delivery', 'courier', 'cab', 'service']).default('guest'),
  provider: optionalText(40),
  gateId: z.string().uuid().optional().nullable(),
});

async function createApproval(req: Request, b: z.infer<typeof approvalInput>, c: pg.PoolClient) {
  const a = ctx(req);
  const flat = (await c.query(`SELECT id, number FROM flats WHERE id = $1 AND society_id = $2`, [b.flatId, a.societyId])).rows[0];
  if (!flat) throw notFound('Flat');
  const residents = await flatResidentUserIds(a.societyId, flat.id, c);
  if (!residents.length) throw conflict('No residents are registered for this flat. Please contact the society office.');
  const gate = await resolveGate(req, b.gateId, c);
  const settings = (await c.query(`SELECT settings FROM societies WHERE id = $1`, [a.societyId])).rows[0].settings ?? {};
  const ttl = settings.approvalTimeoutMinutes ?? config.approvalTtlMinutes;
  const visitorId = await findOrCreateVisitor(c, a.societyId, b.visitorName, b.mobile ?? null, a.userId);
  const ap = (
    await c.query(
      `INSERT INTO visitor_approvals (society_id, flat_id, visitor_id, gate_id, category, provider, purpose, guest_count, vehicle_number, requested_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + make_interval(mins => $11)) RETURNING id`,
      [a.societyId, flat.id, visitorId, gate.id, b.category, b.provider, b.purpose, b.guestCount, b.vehicleNumber, a.userId, ttl],
    )
  ).rows[0];
  await audit(req, { action: 'gate.approval_requested', entityType: 'visitor_approval', entityId: ap.id, newValues: { visitor: b.visitorName, flat: flat.number, gate: gate.name } }, c);
  await notify(
    {
      societyId: a.societyId,
      userIds: residents,
      type: 'visitor_approval_requested',
      title: 'Visitor approval',
      body: `${b.visitorName} is at ${gate.name} to visit you${b.purpose ? ` (${b.purpose})` : ''}. Approve or reject.`,
      priority: 'important',
      entityType: 'visitor_approval',
      entityId: ap.id,
      url: `/app/approvals/${ap.id}`,
      data: { approvalId: ap.id },
    },
    c,
  );
  return ap.id as string;
}

gateRouter.post('/approvals', idempotent, async (req, res) => {
  const b = approvalInput.parse(req.body);
  const id = await tx((c) => createApproval(req, b, c));
  const ap = await one(`${APPROVAL_SELECT} WHERE va.id = $1`, [id]);
  res.status(201).json({ approval: approvalView(ap) });
});

gateRouter.get('/approvals', async (req, res) => {
  const a = ctx(req);
  await expireApprovals(a.societyId);
  const rows = await many(
    `${APPROVAL_SELECT} WHERE va.society_id = $1 AND va.created_at > now() - interval '12 hours'
        AND NOT EXISTS (SELECT 1 FROM visitor_entries ve WHERE ve.approval_id = va.id)
        AND va.status IN ('pending','approved','rejected')
      ORDER BY va.created_at DESC LIMIT 30`,
    [a.societyId],
  );
  res.json({ approvals: rows.map(approvalView) });
});

gateRouter.get('/approvals/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  await expireApprovals(a.societyId);
  const ap = await one(`${APPROVAL_SELECT} WHERE va.id = $1 AND va.society_id = $2`, [id, a.societyId]);
  if (!ap) throw notFound('Approval request');
  const entry = await one(`SELECT id FROM visitor_entries WHERE approval_id = $1`, [id]);
  res.json({ approval: { ...approvalView(ap), entryId: entry?.id ?? null } });
});

gateRouter.post('/approvals/:id/check-in', idempotent, async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = checkInBody.parse(req.body ?? {});
  await expireApprovals(a.societyId);
  const entry = await tx(async (c) => {
    const ap = (await c.query(`${APPROVAL_SELECT} WHERE va.id = $1 AND va.society_id = $2 FOR UPDATE OF va`, [id, a.societyId])).rows[0];
    if (!ap) throw notFound('Approval request');
    if (ap.status !== 'approved') throw new AppError(409, 'not_approved', ap.status === 'pending' ? 'Waiting for the resident to approve' : `Visitor was ${ap.status}. Entry not allowed.`);
    const already = (await c.query(`SELECT id FROM visitor_entries WHERE approval_id = $1`, [id])).rows[0];
    if (already) throw conflict('This visitor has already been checked in');
    const gate = await resolveGate(req, b.gateId ?? ap.gate_id, c);
    const e = (
      await c.query(
        `INSERT INTO visitor_entries (society_id, flat_id, visitor_id, approval_id, category, provider, visitor_name, visitor_mobile, vehicle_number, guest_count, gate_id, checked_in_by, client_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, checked_in_at`,
        [a.societyId, ap.flat_id, ap.visitor_id, ap.id, ap.category, ap.provider, ap.visitor_name, ap.visitor_mobile, ap.vehicle_number, ap.guest_count, gate.id, a.userId, b.clientRef ?? null],
      )
    ).rows[0];
    await audit(req, { action: 'gate.visitor_checked_in', entityType: 'visitor_entry', entityId: e.id, newValues: { visitor: ap.visitor_name, flat: ap.flat_number, gate: gate.name, via: 'approval' } }, c);
    await notify(
      {
        societyId: a.societyId,
        userIds: await flatResidentUserIds(a.societyId, ap.flat_id, c),
        type: 'visitor_checked_in',
        title: `${ap.visitor_name} has arrived`,
        body: `${ap.visitor_name} checked in at ${gate.name}.`,
        entityType: 'visitor_entry',
        entityId: e.id,
        url: '/app/visitors',
      },
      c,
    );
    return { id: e.id, checkedInAt: e.checked_in_at, visitorName: ap.visitor_name, flatNumber: ap.flat_number, gateName: gate.name };
  });
  res.status(201).json({ entry });
});

gateRouter.post('/approvals/:id/cancel', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const r = await pool.query(`UPDATE visitor_approvals SET status = 'cancelled' WHERE id = $1 AND society_id = $2 AND status IN ('pending','approved')`, [id, a.societyId]);
  if (!r.rowCount) throw notFound('Approval request');
  await audit(req, { action: 'gate.approval_cancelled', entityType: 'visitor_approval', entityId: id });
  res.json({ ok: true });
});

export const PROVIDERS = ['Swiggy', 'Zomato', 'Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'BigBasket', 'Dunzo', 'Uber', 'Ola', 'Rapido', 'Blue Dart', 'Delhivery', 'DTDC', 'India Post', 'Other'];

const quickInput = z.object({
  category: z.enum(['delivery', 'food_delivery', 'courier', 'cab', 'domestic_staff', 'service']),
  provider: optionalText(40),
  flatId: z.string().uuid().optional().nullable(),
  visitorName: optionalText(80),
  mobile: indianMobile.optional().nullable().or(z.literal('').transform(() => null)),
  vehicleNumber,
  gateId: z.string().uuid().optional().nullable(),
  leaveAtGate: z.boolean().default(false),
  notes: optionalText(200),
  clientRef: z.string().max(64).optional(),
});

const CATEGORY_LABEL: Record<string, string> = {
  delivery: 'delivery', food_delivery: 'food delivery', courier: 'courier', cab: 'cab', domestic_staff: 'staff', service: 'service visit',
};

/** Quick gate entry: deliveries, cabs, couriers, domestic staff. */
gateRouter.post('/entries/quick', idempotent, async (req, res) => {
  const a = ctx(req);
  const b = quickInput.parse(req.body);
  if (b.category !== 'cab' && !b.flatId) throw badRequest('Select the destination flat');
  if (b.category === 'domestic_staff' && !b.visitorName) throw badRequest('Enter the staff member’s name');
  const result = await tx(async (c) => {
    if (b.clientRef) {
      const dup = (await c.query(`SELECT id, checked_in_at FROM visitor_entries WHERE society_id = $1 AND client_ref = $2`, [a.societyId, b.clientRef])).rows[0];
      if (dup) return { entry: { id: dup.id, checkedInAt: dup.checked_in_at }, duplicate: true };
    }
    const flat = b.flatId ? (await c.query(`SELECT id, number FROM flats WHERE id = $1 AND society_id = $2`, [b.flatId, a.societyId])).rows[0] : null;
    if (b.flatId && !flat) throw notFound('Flat');
    const gate = await resolveGate(req, b.gateId, c);
    const settings = (await c.query(`SELECT settings FROM societies WHERE id = $1`, [a.societyId])).rows[0].settings ?? {};
    const name = b.visitorName ?? `${b.provider ?? ''} ${CATEGORY_LABEL[b.category]}`.trim().replace(/^./, (x) => x.toUpperCase());
    if (settings.deliveryRequiresApproval && ['delivery', 'food_delivery', 'courier'].includes(b.category) && !b.leaveAtGate && flat) {
      const approvalId = await createApproval(
        req,
        { visitorName: name, mobile: b.mobile ?? null, flatId: flat.id, purpose: `${b.provider ?? ''} ${CATEGORY_LABEL[b.category]}`.trim(), guestCount: 1, vehicleNumber: b.vehicleNumber, category: b.category as any, provider: b.provider, gateId: gate.id },
        c,
      );
      return { approvalId, requiresApproval: true };
    }
    const visitorId = b.mobile || b.category === 'domestic_staff' ? await findOrCreateVisitor(c, a.societyId, name, b.mobile ?? null, a.userId) : null;
    const status = b.leaveAtGate ? 'left_at_gate' : 'inside';
    const e = (
      await c.query(
        `INSERT INTO visitor_entries (society_id, flat_id, visitor_id, category, provider, visitor_name, visitor_mobile, vehicle_number, gate_id, checked_in_by, status, notes, client_ref,
                                      checked_out_at, checked_out_by, checkout_gate_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $11 = 'left_at_gate' THEN now() END, CASE WHEN $11 = 'left_at_gate' THEN $10::uuid END, CASE WHEN $11 = 'left_at_gate' THEN $9::uuid END)
         RETURNING id, checked_in_at`,
        [a.societyId, flat?.id ?? null, visitorId, b.category, b.provider, name, b.mobile ?? null, b.vehicleNumber, gate.id, a.userId, status, b.notes, b.clientRef ?? null],
      )
    ).rows[0];
    await audit(req, { action: `gate.${b.category}_recorded`, entityType: 'visitor_entry', entityId: e.id, newValues: { provider: b.provider, flat: flat?.number, gate: gate.name, status } }, c);
    if (flat) {
      const label = CATEGORY_LABEL[b.category];
      await notify(
        {
          societyId: a.societyId,
          userIds: await flatResidentUserIds(a.societyId, flat.id, c),
          type: b.category === 'domestic_staff' || b.category === 'service' ? 'visitor_checked_in' : 'delivery_arrived',
          title: b.category === 'domestic_staff' ? `${name} has arrived` : `${b.provider ? `${b.provider} ` : ''}${label} at ${gate.name}`,
          body:
            b.category === 'domestic_staff'
              ? `${name} entered through ${gate.name}.`
              : b.leaveAtGate
                ? `Your ${b.provider ? `${b.provider} ` : ''}${label} has been left at ${gate.name}. Please collect it.`
                : `Your ${b.provider ? `${b.provider} ` : ''}${label} has arrived at ${gate.name}.`,
          entityType: 'visitor_entry',
          entityId: e.id,
          url: '/app/visitors',
        },
        c,
      );
    }
    return { entry: { id: e.id, checkedInAt: e.checked_in_at, status } };
  });
  res.status(201).json(result);
});

gateRouter.get('/inside', async (req, res) => {
  const a = ctx(req);
  const rows = await many(
    `SELECT ve.id, ve.category, ve.provider, ve.visitor_name, ve.vehicle_number, ve.guest_count, ve.checked_in_at, f.number AS flat_number, g.name AS gate_name
       FROM visitor_entries ve LEFT JOIN flats f ON f.id = ve.flat_id LEFT JOIN gates g ON g.id = ve.gate_id
      WHERE ve.society_id = $1 AND ve.status = 'inside' ORDER BY ve.checked_in_at DESC LIMIT 200`,
    [a.societyId],
  );
  res.json({ inside: rows });
});

gateRouter.get('/entries/recent', async (req, res) => {
  const a = ctx(req);
  const rows = await many(
    `SELECT ve.id, ve.category, ve.provider, ve.visitor_name, ve.status, ve.checked_in_at, ve.checked_out_at, f.number AS flat_number, g.name AS gate_name
       FROM visitor_entries ve LEFT JOIN flats f ON f.id = ve.flat_id LEFT JOIN gates g ON g.id = ve.gate_id
      WHERE ve.society_id = $1 AND ve.checked_in_at > now() - interval '24 hours' ORDER BY greatest(ve.checked_in_at, coalesce(ve.checked_out_at, ve.checked_in_at)) DESC LIMIT 50`,
    [a.societyId],
  );
  res.json({ entries: rows });
});

gateRouter.get('/providers', (_req, res) => res.json({ providers: PROVIDERS }));

export { expireApprovals, guardInviteView };
