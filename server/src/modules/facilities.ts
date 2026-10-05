import { Router } from 'express';
import type pg from 'pg';
import { many, one, pool, tx, type Db } from '../db/pool.js';
import { assertFlatAccess, ctx, requireAuth, requirePermission } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../core/errors.js';
import { notify, flatResidentUserIds } from '../core/notifications.js';
import { saveImage } from '../core/storage.js';
import { ADMIN_ROLES } from '../core/rbac.js';
import { randomDigits } from '../core/crypto.js';
import { addDays, dayOfWeek, fromMinutes, localDate, toMinutes, zonedToUtc } from '../core/time.js';
import { hhmm, isoDate, optionalText, pageClause, pagination, text, z } from '../core/validate.js';
import { photoUrl, upload } from './profile.js';
import { societyTz } from './visitors.js';

export const facilitiesRouter = Router();
facilitiesRouter.use(requireAuth);

const facilityView = (f: any) => ({
  id: f.id,
  name: f.name,
  description: f.description,
  location: f.location,
  openTime: f.open_time.slice(0, 5),
  closeTime: f.close_time.slice(0, 5),
  slotDurationMinutes: f.slot_duration_minutes,
  maxBookingMinutes: f.max_booking_minutes,
  capacity: f.capacity,
  maxConcurrentBookings: f.max_concurrent_bookings,
  advanceBookingDays: f.advance_booking_days,
  cancellationCutoffMinutes: f.cancellation_cutoff_minutes,
  maxBookingsPerFlatPerDay: f.max_bookings_per_flat_per_day,
  rules: f.rules,
  imageUrl: photoUrl(f.image_key),
  isActive: f.is_active,
});

/** (Re)generate slot templates from opening hours and slot duration. */
async function generateSlots(c: Db, societyId: string, facilityId: string, open: string, close: string, duration: number) {
  await c.query(`DELETE FROM facility_slots WHERE facility_id = $1`, [facilityId]);
  const start = toMinutes(open);
  const end = toMinutes(close);
  for (let m = start; m + duration <= end; m += duration) {
    await c.query(`INSERT INTO facility_slots (society_id, facility_id, start_time, end_time) VALUES ($1,$2,$3,$4)`, [societyId, facilityId, fromMinutes(m), fromMinutes(m + duration)]);
  }
}

facilitiesRouter.get('/', async (req, res) => {
  const a = ctx(req);
  const isStaff = ADMIN_ROLES.includes(a.role);
  const rows = await many(`SELECT * FROM facilities WHERE society_id = $1 ${isStaff ? '' : 'AND is_active'} ORDER BY name`, [a.societyId]);
  res.json({ facilities: rows.map(facilityView) });
});

facilitiesRouter.get('/:id', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const f = await one(`SELECT * FROM facilities WHERE id = $1 AND society_id = $2`, [id, a.societyId]);
  if (!f || (!f.is_active && !ADMIN_ROLES.includes(a.role))) throw notFound('Facility');
  const slots = await many(`SELECT id, day_of_week, start_time, end_time, is_active FROM facility_slots WHERE facility_id = $1 ORDER BY start_time`, [id]);
  res.json({ facility: facilityView(f), slots: slots.map((s) => ({ ...s, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) })) });
});

const facilityInput = z.object({
  name: text(80),
  description: optionalText(1000),
  location: optionalText(120),
  openTime: hhmm,
  closeTime: hhmm,
  slotDurationMinutes: z.coerce.number().int().min(15).max(720).default(60),
  maxBookingMinutes: z.coerce.number().int().min(15).max(1440).default(60),
  capacity: z.coerce.number().int().min(1).max(1000).default(4),
  maxConcurrentBookings: z.coerce.number().int().min(1).max(100).default(1),
  advanceBookingDays: z.coerce.number().int().min(0).max(180).default(7),
  cancellationCutoffMinutes: z.coerce.number().int().min(0).max(10080).default(60),
  maxBookingsPerFlatPerDay: z.coerce.number().int().min(1).max(20).default(2),
  rules: optionalText(2000),
  isActive: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(true),
});

facilitiesRouter.post('/', requirePermission('facilities:manage'), upload.single('image'), async (req, res) => {
  const a = ctx(req);
  const b = facilityInput.parse(req.body);
  if (toMinutes(b.closeTime) <= toMinutes(b.openTime)) throw badRequest('Closing time must be after opening time');
  if (b.maxBookingMinutes < b.slotDurationMinutes) throw badRequest('Maximum booking duration must be at least one slot');
  const f = await tx(async (c) => {
    const image = req.file ? await saveImage(a.societyId, 'facilities', req.file.buffer) : null;
    const row = (
      await c.query(
        `INSERT INTO facilities (society_id, name, description, location, open_time, close_time, slot_duration_minutes, max_booking_minutes, capacity, max_concurrent_bookings,
                                 advance_booking_days, cancellation_cutoff_minutes, max_bookings_per_flat_per_day, rules, image_key, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [a.societyId, b.name, b.description, b.location, b.openTime, b.closeTime, b.slotDurationMinutes, b.maxBookingMinutes, b.capacity, b.maxConcurrentBookings,
          b.advanceBookingDays, b.cancellationCutoffMinutes, b.maxBookingsPerFlatPerDay, b.rules, image?.key ?? null, b.isActive, a.userId],
      )
    ).rows[0];
    await generateSlots(c, a.societyId, row.id, b.openTime, b.closeTime, b.slotDurationMinutes);
    await audit(req, { action: 'facility.created', entityType: 'facility', entityId: row.id, newValues: { name: b.name } }, c);
    return row;
  });
  res.status(201).json({ facility: facilityView(f) });
});

facilitiesRouter.patch('/:id', requirePermission('facilities:manage'), upload.single('image'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = facilityInput.partial().parse(req.body);
  const before = await one(`SELECT * FROM facilities WHERE id = $1 AND society_id = $2`, [id, a.societyId]);
  if (!before) throw notFound('Facility');
  const merged = {
    openTime: b.openTime ?? before.open_time.slice(0, 5),
    closeTime: b.closeTime ?? before.close_time.slice(0, 5),
    slot: b.slotDurationMinutes ?? before.slot_duration_minutes,
  };
  if (toMinutes(merged.closeTime) <= toMinutes(merged.openTime)) throw badRequest('Closing time must be after opening time');
  const f = await tx(async (c) => {
    const image = req.file ? await saveImage(a.societyId, 'facilities', req.file.buffer) : null;
    const cols: Record<string, unknown> = {
      name: b.name, description: 'description' in req.body ? b.description : undefined, location: 'location' in req.body ? b.location : undefined,
      open_time: b.openTime, close_time: b.closeTime, slot_duration_minutes: b.slotDurationMinutes, max_booking_minutes: b.maxBookingMinutes, capacity: b.capacity,
      max_concurrent_bookings: b.maxConcurrentBookings, advance_booking_days: b.advanceBookingDays, cancellation_cutoff_minutes: b.cancellationCutoffMinutes,
      max_bookings_per_flat_per_day: b.maxBookingsPerFlatPerDay, rules: 'rules' in req.body ? b.rules : undefined, is_active: 'isActive' in req.body ? b.isActive : undefined,
      image_key: image?.key,
    };
    const entries = Object.entries(cols).filter(([, v]) => v !== undefined);
    if (entries.length) {
      await c.query(`UPDATE facilities SET ${entries.map(([k], i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${entries.length + 1}`, [...entries.map(([, v]) => v), id]);
    }
    const scheduleChanged = merged.openTime !== before.open_time.slice(0, 5) || merged.closeTime !== before.close_time.slice(0, 5) || merged.slot !== before.slot_duration_minutes;
    if (scheduleChanged) await generateSlots(c, a.societyId, id, merged.openTime, merged.closeTime, merged.slot);
    await audit(req, { action: 'facility.updated', entityType: 'facility', entityId: id, oldValues: { name: before.name, is_active: before.is_active }, newValues: Object.fromEntries(entries) }, c);
    return (await c.query(`SELECT * FROM facilities WHERE id = $1`, [id])).rows[0];
  });
  res.json({ facility: facilityView(f) });
});

facilitiesRouter.patch('/:id/slots/:slotId', requirePermission('facilities:manage'), async (req, res) => {
  const a = ctx(req);
  const p = z.object({ id: z.string().uuid(), slotId: z.string().uuid() }).parse(req.params);
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  const r = await pool.query(`UPDATE facility_slots SET is_active = $1 WHERE id = $2 AND facility_id = $3 AND society_id = $4`, [isActive, p.slotId, p.id, a.societyId]);
  if (!r.rowCount) throw notFound('Slot');
  await audit(req, { action: 'facility.slot_toggled', entityType: 'facility', entityId: p.id, newValues: { slot: p.slotId, isActive } });
  res.json({ ok: true });
});

// --- Availability ---------------------------------------------------------------
async function computeAvailability(societyId: string, facility: any, date: string, flatIds: string[], db: Db = pool) {
  const tz = await societyTz(societyId, db);
  const dow = dayOfWeek(date);
  const slots = await many(
    `SELECT id, start_time, end_time FROM facility_slots WHERE facility_id = $1 AND is_active AND (day_of_week IS NULL OR day_of_week = $2) ORDER BY start_time`,
    [facility.id, dow],
    db,
  );
  const bookings = await many(
    `SELECT start_time, end_time, flat_id FROM facility_bookings WHERE facility_id = $1 AND booking_date = $2 AND status = 'confirmed'`,
    [facility.id, date],
    db,
  );
  const now = Date.now();
  return slots.map((s) => {
    const st = s.start_time.slice(0, 5);
    const et = s.end_time.slice(0, 5);
    const overlapping = bookings.filter((b) => toMinutes(b.start_time.slice(0, 5)) < toMinutes(et) && toMinutes(b.end_time.slice(0, 5)) > toMinutes(st));
    const mine = overlapping.some((b) => flatIds.includes(b.flat_id));
    const startsAt = zonedToUtc(date, st, tz).getTime();
    const status = mine ? 'mine' : startsAt <= now ? 'past' : overlapping.length >= facility.max_concurrent_bookings ? 'booked' : 'available';
    return { slotId: s.id, startTime: st, endTime: et, status, booked: overlapping.length, remaining: Math.max(0, facility.max_concurrent_bookings - overlapping.length) };
  });
}

facilitiesRouter.get('/:id/availability', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { date } = z.object({ date: isoDate }).parse(req.query);
  const f = await one(`SELECT * FROM facilities WHERE id = $1 AND society_id = $2 AND is_active`, [id, a.societyId]);
  if (!f) throw notFound('Facility');
  const tz = await societyTz(a.societyId);
  const today = localDate(new Date(), tz);
  const maxDate = addDays(today, f.advance_booking_days);
  if (date < today || date > maxDate) return res.json({ date, bookable: false, reason: `Bookings open up to ${f.advance_booking_days} days ahead`, slots: [], maxDate });
  res.json({ date, bookable: true, maxDate, slots: await computeAvailability(a.societyId, f, date, a.flatIds) });
});

// --- Booking engine ------------------------------------------------------------------
async function uniqueReference(c: pg.PoolClient, societyId: string) {
  for (let i = 0; i < 10; i++) {
    const ref = `BKG-${randomDigits(6)}`;
    const r = await c.query(`SELECT 1 FROM facility_bookings WHERE society_id = $1 AND reference = $2`, [societyId, ref]);
    if (!r.rowCount) return ref;
  }
  throw new AppError(503, 'busy', 'Please try again');
}

const bookingView = (b: any) => ({
  id: b.id, reference: b.reference, facilityId: b.facility_id, facilityName: b.facility_name, location: b.location, date: b.booking_date,
  startTime: b.start_time.slice(0, 5), endTime: b.end_time.slice(0, 5), startsAt: b.starts_at, endsAt: b.ends_at, status: b.status, guestCount: b.guest_count,
  flatNumber: b.flat_number, bookedBy: b.booked_by_name, cancelledAt: b.cancelled_at, cancelReason: b.cancel_reason, createdAt: b.created_at,
  cancellable: b.status === 'confirmed' && new Date(b.starts_at).getTime() - (b.cancellation_cutoff_minutes ?? 0) * 60000 > Date.now(),
});

const BOOKING_SELECT = `
  SELECT b.*, f.name AS facility_name, f.location, f.cancellation_cutoff_minutes, fl.number AS flat_number, u.full_name AS booked_by_name
    FROM facility_bookings b JOIN facilities f ON f.id = b.facility_id JOIN flats fl ON fl.id = b.flat_id JOIN users u ON u.id = b.booked_by`;

facilitiesRouter.post('/:id/bookings', requirePermission('facilities:book'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = z
    .object({ date: isoDate, startTime: hhmm, durationMinutes: z.coerce.number().int().min(15).max(1440).optional(), guestCount: z.coerce.number().int().min(1).max(500).default(1), flatId: z.string().uuid().optional() })
    .parse(req.body);
  const flatId = b.flatId ?? a.flatIds[0];
  if (!flatId) throw badRequest('You are not linked to a flat yet');
  assertFlatAccess(req, flatId);
  const tz = await societyTz(a.societyId);
  const booking = await tx(async (c) => {
    // Row lock on the facility serialises concurrent booking attempts for the same facility,
    // so two residents can never take the last place in a slot simultaneously.
    const f = (await c.query(`SELECT * FROM facilities WHERE id = $1 AND society_id = $2 FOR UPDATE`, [id, a.societyId])).rows[0];
    if (!f || !f.is_active) throw notFound('Facility');
    const today = localDate(new Date(), tz);
    if (b.date < today || b.date > addDays(today, f.advance_booking_days)) throw badRequest(`Bookings can be made up to ${f.advance_booking_days} days in advance`);
    const duration = b.durationMinutes ?? f.slot_duration_minutes;
    if (duration % f.slot_duration_minutes !== 0) throw badRequest(`Duration must be in steps of ${f.slot_duration_minutes} minutes`);
    if (duration > f.max_booking_minutes) throw badRequest(`Maximum booking duration is ${f.max_booking_minutes} minutes`);
    if (b.guestCount > f.capacity) throw badRequest(`Maximum ${f.capacity} people allowed`);
    const startMin = toMinutes(b.startTime);
    const endTime = fromMinutes(startMin + duration);
    if (startMin + duration > 24 * 60) throw badRequest('Booking must end on the same day');
    // Every slot covered by the booking must exist and be active for that day.
    const dow = dayOfWeek(b.date);
    const slots = (
      await c.query(`SELECT id, start_time FROM facility_slots WHERE facility_id = $1 AND is_active AND (day_of_week IS NULL OR day_of_week = $2) AND start_time >= $3 AND end_time <= $4 ORDER BY start_time`, [
        id, dow, b.startTime, endTime,
      ])
    ).rows;
    if (slots.length !== duration / f.slot_duration_minutes || slots[0]?.start_time.slice(0, 5) !== b.startTime) throw badRequest('This time slot is not available for booking');
    const startsAt = zonedToUtc(b.date, b.startTime, tz);
    const endsAt = zonedToUtc(b.date, endTime, tz);
    if (startsAt.getTime() <= Date.now()) throw badRequest('This time slot has already started');
    const overlap = (
      await c.query(`SELECT flat_id FROM facility_bookings WHERE facility_id = $1 AND status = 'confirmed' AND starts_at < $3 AND ends_at > $2`, [id, startsAt, endsAt])
    ).rows;
    if (overlap.some((o) => o.flat_id === flatId)) throw conflict('Your flat already has a booking at this time');
    if (overlap.length >= f.max_concurrent_bookings) throw new AppError(409, 'slot_unavailable', 'Sorry, this slot was just booked. Please choose another time.');
    const daily = (await c.query(`SELECT count(*)::int AS n FROM facility_bookings WHERE facility_id = $1 AND flat_id = $2 AND booking_date = $3 AND status = 'confirmed'`, [id, flatId, b.date])).rows[0].n;
    if (daily >= f.max_bookings_per_flat_per_day) throw conflict(`Limit reached: ${f.max_bookings_per_flat_per_day} booking(s) per flat per day for ${f.name}`);
    const ref = await uniqueReference(c, a.societyId);
    const row = (
      await c.query(
        `INSERT INTO facility_bookings (society_id, facility_id, slot_id, flat_id, booked_by, reference, booking_date, start_time, end_time, starts_at, ends_at, guest_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [a.societyId, id, slots[0].id, flatId, a.userId, ref, b.date, b.startTime, endTime, startsAt, endsAt, b.guestCount],
      )
    ).rows[0];
    await audit(req, { action: 'booking.created', entityType: 'facility_booking', entityId: row.id, newValues: { facility: f.name, date: b.date, time: `${b.startTime}-${endTime}`, reference: ref } }, c);
    await notify(
      { societyId: a.societyId, userIds: await flatResidentUserIds(a.societyId, flatId, c), type: 'booking_confirmed', title: 'Booking confirmed', body: `${f.name} • ${b.date} • ${b.startTime}–${endTime} (${ref})`, entityType: 'facility_booking', entityId: row.id, url: '/app/facilities/bookings' },
      c,
    );
    return (await c.query(`${BOOKING_SELECT} WHERE b.id = $1`, [row.id])).rows[0];
  });
  res.status(201).json({ booking: bookingView(booking) });
});

// --- Bookings ---------------------------------------------------------------------------
export const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

bookingsRouter.get('/mine', requirePermission('facilities:book'), async (req, res) => {
  const a = ctx(req);
  const { scope } = z.object({ scope: z.enum(['upcoming', 'past']).default('upcoming') }).parse(req.query);
  const rows = await many(
    `${BOOKING_SELECT} WHERE b.society_id = $1 AND b.flat_id = ANY($2) AND ${scope === 'upcoming' ? `b.ends_at > now() AND b.status = 'confirmed'` : `(b.ends_at <= now() OR b.status <> 'confirmed')`}
      ORDER BY b.starts_at ${scope === 'upcoming' ? 'ASC' : 'DESC'} LIMIT 100`,
    [a.societyId, a.flatIds],
  );
  res.json({ bookings: rows.map(bookingView) });
});

bookingsRouter.get('/', requirePermission('facilities:manage'), async (req, res) => {
  const a = ctx(req);
  const q = pagination
    .extend({ facilityId: z.string().uuid().optional(), date: isoDate.optional(), from: isoDate.optional(), to: isoDate.optional(), status: z.enum(['confirmed', 'cancelled', 'completed']).optional(), q: z.string().trim().max(60).optional() })
    .parse(req.query);
  const { limit, offset } = pageClause(q);
  const where = `b.society_id = $1 AND ($2::uuid IS NULL OR b.facility_id = $2) AND ($3::date IS NULL OR b.booking_date = $3) AND ($4::date IS NULL OR b.booking_date >= $4)
     AND ($5::date IS NULL OR b.booking_date <= $5) AND ($6::text IS NULL OR b.status = $6) AND ($7::text IS NULL OR fl.number ILIKE $7 OR b.reference ILIKE $7 OR u.full_name ILIKE $7)`;
  const params = [a.societyId, q.facilityId ?? null, q.date ?? null, q.from ?? null, q.to ?? null, q.status ?? null, q.q ? `%${q.q}%` : null];
  const rows = await many(`${BOOKING_SELECT} WHERE ${where} ORDER BY b.starts_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const total = await one(`SELECT count(*)::int AS n FROM facility_bookings b JOIN flats fl ON fl.id = b.flat_id JOIN users u ON u.id = b.booked_by WHERE ${where}`, params);
  res.json({ bookings: rows.map(bookingView), total: total.n, page: q.page, pageSize: q.pageSize });
});

bookingsRouter.post('/:id/cancel', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { reason } = z.object({ reason: optionalText(300) }).parse(req.body ?? {});
  const isStaff = ADMIN_ROLES.includes(a.role);
  if (!isStaff && a.role !== 'resident') throw forbidden();
  const out = await tx(async (c) => {
    const b = (await c.query(`${BOOKING_SELECT} WHERE b.id = $1 AND b.society_id = $2 FOR UPDATE OF b`, [id, a.societyId])).rows[0];
    if (!b) throw notFound('Booking');
    if (!isStaff) assertFlatAccess(req, b.flat_id);
    if (b.status !== 'confirmed') throw conflict('This booking is not active');
    if (new Date(b.ends_at).getTime() <= Date.now()) throw conflict('Past bookings cannot be cancelled');
    if (!isStaff && new Date(b.starts_at).getTime() - b.cancellation_cutoff_minutes * 60000 <= Date.now()) {
      throw conflict(`Bookings can be cancelled up to ${b.cancellation_cutoff_minutes} minutes before the start time`);
    }
    await c.query(`UPDATE facility_bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = $1, cancel_reason = $2 WHERE id = $3`, [a.userId, reason, id]);
    await audit(req, { action: isStaff ? 'booking.cancelled_by_admin' : 'booking.cancelled', entityType: 'facility_booking', entityId: id, oldValues: { status: 'confirmed' }, newValues: { status: 'cancelled', reason } }, c);
    await notify(
      {
        societyId: a.societyId, userIds: await flatResidentUserIds(a.societyId, b.flat_id, c), type: 'booking_cancelled', title: 'Booking cancelled',
        body: `${b.facility_name} • ${b.booking_date} • ${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}${isStaff ? ' was cancelled by management' : ''}${reason ? `: ${reason}` : ''}`,
        entityType: 'facility_booking', entityId: id, url: '/app/facilities/bookings',
      },
      c,
    );
    return (await c.query(`${BOOKING_SELECT} WHERE b.id = $1`, [id])).rows[0];
  });
  res.json({ booking: bookingView(out) });
});
