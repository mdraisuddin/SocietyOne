import { Router } from 'express';
import { many, one } from '../db/pool.js';
import { ctx, requireAuth, requirePermission } from '../core/auth.js';
import { forbidden } from '../core/errors.js';
import { ADMIN_ROLES } from '../core/rbac.js';
import { localDate, localTime, addDays } from '../core/time.js';
import { isoDate, likePattern, pageClause, pagination, z } from '../core/validate.js';
import { societyTz, shortName } from './visitors.js';

// ============================================================================
// Admin dashboard
// ============================================================================
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requirePermission('dashboard:view'));

dashboardRouter.get('/', async (req, res) => {
  const a = ctx(req);
  const { range } = z.object({ range: z.enum(['today', '7d', '30d']).default('7d') }).parse(req.query);
  const tz = await societyTz(a.societyId);
  const today = localDate(new Date(), tz);
  const days = range === 'today' ? 1 : range === '7d' ? 7 : 30;
  const from = addDays(today, -(days - 1));
  const p = [a.societyId, tz, from, today];

  const cards = await one(
    `SELECT
       (SELECT count(*) FROM flats WHERE society_id = $1 AND is_active)::int AS total_flats,
       (SELECT count(*) FROM flats WHERE society_id = $1 AND occupancy_status <> 'vacant')::int AS occupied_flats,
       (SELECT count(*) FROM residents WHERE society_id = $1 AND status = 'active')::int AS residents,
       (SELECT count(*) FROM visitor_entries WHERE society_id = $1 AND (checked_in_at AT TIME ZONE $2)::date = $4::date)::int AS visitors_today,
       (SELECT count(*) FROM visitor_entries WHERE society_id = $1 AND status = 'inside')::int AS visitors_inside,
       (SELECT count(*) FROM visitor_entries WHERE society_id = $1 AND (checked_in_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date)::int AS visitors_range,
       (SELECT count(*) FROM complaints WHERE society_id = $1 AND status NOT IN ('resolved','closed'))::int AS open_complaints,
       (SELECT count(*) FROM complaints WHERE society_id = $1 AND status NOT IN ('resolved','closed') AND resolution_due_at < now())::int AS overdue_complaints,
       (SELECT count(*) FROM complaints WHERE society_id = $1 AND (created_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date)::int AS complaints_range,
       (SELECT count(*) FROM facility_bookings WHERE society_id = $1 AND booking_date = $4::date AND status <> 'cancelled')::int AS bookings_today,
       (SELECT count(*) FROM visitor_approvals WHERE society_id = $1 AND status = 'pending' AND expires_at > now())::int AS pending_approvals,
       (SELECT round(avg(rating)::numeric, 1) FROM complaints WHERE society_id = $1 AND rating IS NOT NULL AND (rated_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date) AS avg_rating,
       (SELECT round(avg(extract(epoch FROM (resolved_at - created_at)) / 3600)::numeric, 1) FROM complaints
         WHERE society_id = $1 AND resolved_at IS NOT NULL AND (resolved_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date) AS avg_resolution_hours`,
    p,
  );

  // Visitor activity: hourly for today, daily otherwise
  const visitorSeries =
    range === 'today'
      ? await many(
          `SELECT h AS bucket, COALESCE(x.n, 0)::int AS count FROM generate_series(0, 23) h
             LEFT JOIN (SELECT extract(hour FROM checked_in_at AT TIME ZONE $2)::int AS hr, count(*) AS n FROM visitor_entries
                         WHERE society_id = $1 AND (checked_in_at AT TIME ZONE $2)::date = $3::date GROUP BY 1) x ON x.hr = h ORDER BY h`,
          [a.societyId, tz, today],
        )
      : await many(
          `SELECT to_char(d, 'YYYY-MM-DD') AS bucket, COALESCE(x.n, 0)::int AS count,
                  COALESCE(x.guests, 0)::int AS guests, COALESCE(x.deliveries, 0)::int AS deliveries
             FROM generate_series($3::date, $4::date, interval '1 day') d
             LEFT JOIN (SELECT (checked_in_at AT TIME ZONE $2)::date AS day, count(*) AS n,
                               count(*) FILTER (WHERE category = 'guest') AS guests,
                               count(*) FILTER (WHERE category IN ('delivery','food_delivery','courier')) AS deliveries
                          FROM visitor_entries WHERE society_id = $1 AND (checked_in_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date GROUP BY 1) x ON x.day = d::date
            ORDER BY d`,
          p,
        );
  const visitorCategories = await many(
    `SELECT category, count(*)::int AS count FROM visitor_entries WHERE society_id = $1 AND (checked_in_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date GROUP BY 1 ORDER BY 2 DESC`,
    p,
  );
  const complaintStatus = await many(`SELECT status, count(*)::int AS count FROM complaints WHERE society_id = $1 GROUP BY 1`, [a.societyId]);
  const complaintCategories = await many(
    `SELECT category, count(*)::int AS count FROM complaints WHERE society_id = $1 AND (created_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date GROUP BY 1 ORDER BY 2 DESC`,
    p,
  );
  const recentComplaints = await many(
    `SELECT c.id, c.number, c.title, c.category, c.priority, c.status, c.created_at, f.number AS flat_number,
            (c.status NOT IN ('resolved','closed') AND c.resolution_due_at < now()) AS overdue
       FROM complaints c LEFT JOIN flats f ON f.id = c.flat_id WHERE c.society_id = $1 ORDER BY c.created_at DESC LIMIT 6`,
    [a.societyId],
  );
  const recentVisitors = await many(
    `SELECT ve.id, ve.visitor_name, ve.category, ve.provider, ve.status, ve.checked_in_at, ve.checked_out_at, f.number AS flat_number, g.name AS gate_name
       FROM visitor_entries ve LEFT JOIN flats f ON f.id = ve.flat_id LEFT JOIN gates g ON g.id = ve.gate_id
      WHERE ve.society_id = $1 ORDER BY ve.checked_in_at DESC LIMIT 8`,
    [a.societyId],
  );
  const upcomingBookings = await many(
    `SELECT b.id, b.reference, b.booking_date, b.start_time, b.end_time, f.name AS facility_name, fl.number AS flat_number
       FROM facility_bookings b JOIN facilities f ON f.id = b.facility_id JOIN flats fl ON fl.id = b.flat_id
      WHERE b.society_id = $1 AND b.status = 'confirmed' AND b.ends_at > now() ORDER BY b.starts_at LIMIT 6`,
    [a.societyId],
  );
  const latestAnnouncements = await many(
    `SELECT id, title, category, priority, publish_at FROM announcements
      WHERE society_id = $1 AND status = 'published' AND publish_at <= now() AND (expires_at IS NULL OR expires_at > now()) ORDER BY publish_at DESC LIMIT 4`,
    [a.societyId],
  );
  res.json({
    range, from, to: today, cards, visitorSeries, visitorCategories, complaintStatus, complaintCategories, recentComplaints, recentVisitors,
    upcomingBookings: upcomingBookings.map((b) => ({ ...b, start_time: b.start_time.slice(0, 5), end_time: b.end_time.slice(0, 5) })),
    latestAnnouncements,
  });
});

// ============================================================================
// Resident home summary (one request for the home screen — saves mobile data)
// ============================================================================
export const homeRouter = Router();
homeRouter.use(requireAuth, requirePermission('visitors:invite'));

homeRouter.get('/', async (req, res) => {
  const a = ctx(req);
  const tz = await societyTz(a.societyId);
  const today = localDate(new Date(), tz);
  const [announcement, emergency, visitor, approvals, complaints, booking, unread] = await Promise.all([
    one(
      `SELECT id, title, body, category, priority, publish_at FROM announcements a
        WHERE a.society_id = $1 AND a.status = 'published' AND a.publish_at <= now() AND (a.expires_at IS NULL OR a.expires_at > now())
          AND (a.audience = 'all' OR a.tower_ids && (SELECT array_agg(f.tower_id) FROM flats f WHERE f.id = ANY($2::uuid[])))
        ORDER BY (a.priority = 'emergency') DESC, a.publish_at DESC LIMIT 1`,
      [a.societyId, a.flatIds],
    ),
    many(
      `SELECT id, title, body, publish_at FROM announcements a WHERE a.society_id = $1 AND a.priority = 'emergency' AND a.status = 'published'
          AND a.publish_at <= now() AND (a.expires_at IS NULL OR a.expires_at > now())
          AND (a.audience = 'all' OR a.tower_ids && (SELECT array_agg(f.tower_id) FROM flats f WHERE f.id = ANY($2::uuid[])))
        ORDER BY a.publish_at DESC LIMIT 3`,
      [a.societyId, a.flatIds],
    ),
    one(
      `SELECT vi.id, v.full_name AS visitor_name, vi.valid_from, vi.expected_arrival, vi.status, vi.visit_type,
              to_char(CASE WHEN GREATEST(vi.valid_from, $3::date) = $3::date AND vi.window_end < $4::time THEN $3::date + 1 ELSE GREATEST(vi.valid_from, $3::date) END, 'YYYY-MM-DD') AS next_date,
              EXISTS (SELECT 1 FROM visitor_entries ve WHERE ve.invite_id = vi.id AND ve.status = 'inside') AS inside
         FROM visitor_invites vi JOIN visitors v ON v.id = vi.visitor_id
        WHERE vi.society_id = $1 AND vi.flat_id = ANY($2) AND vi.status IN ('active','checked_in') AND vi.valid_until >= $3::date
        ORDER BY inside DESC,
                 CASE WHEN GREATEST(vi.valid_from, $3::date) = $3::date AND vi.window_end < $4::time THEN $3::date + 1 ELSE GREATEST(vi.valid_from, $3::date) END,
                 vi.expected_arrival LIMIT 1`,
      [a.societyId, a.flatIds, today, localTime(new Date(), tz)],
    ),
    many(
      `SELECT va.id, v.full_name AS visitor_name, g.name AS gate_name, va.purpose, va.category, va.provider, va.created_at, va.expires_at
         FROM visitor_approvals va JOIN visitors v ON v.id = va.visitor_id LEFT JOIN gates g ON g.id = va.gate_id
        WHERE va.society_id = $1 AND va.flat_id = ANY($2) AND va.status = 'pending' AND va.expires_at > now() ORDER BY va.created_at DESC`,
      [a.societyId, a.flatIds],
    ),
    many(
      `SELECT id, number, title, category, status, created_at FROM complaints
        WHERE society_id = $1 AND (raised_by = $2 OR flat_id = ANY($3)) AND status NOT IN ('closed') ORDER BY updated_at DESC LIMIT 3`,
      [a.societyId, a.userId, a.flatIds],
    ),
    one(
      `SELECT b.id, b.reference, b.booking_date, b.start_time, b.end_time, f.name AS facility_name
         FROM facility_bookings b JOIN facilities f ON f.id = b.facility_id
        WHERE b.society_id = $1 AND b.flat_id = ANY($2) AND b.status = 'confirmed' AND b.ends_at > now() ORDER BY b.starts_at LIMIT 1`,
      [a.societyId, a.flatIds],
    ),
    one(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND society_id = $2 AND read_at IS NULL`, [a.userId, a.societyId]),
  ]);
  res.json({
    today,
    announcement,
    emergencies: emergency,
    nextVisitor: visitor && { ...visitor, expected_arrival: visitor.expected_arrival?.slice(0, 5) },
    pendingApprovals: approvals,
    openComplaints: complaints,
    nextBooking: booking && { ...booking, start_time: booking.start_time.slice(0, 5), end_time: booking.end_time.slice(0, 5) },
    unreadNotifications: unread.n,
  });
});

// ============================================================================
// Search (contextual per role, partial-match tolerant via pg_trgm-indexed ILIKE)
// ============================================================================
export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get('/', async (req, res) => {
  const a = ctx(req);
  const { q } = z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(60) }).parse(req.query);
  const pat = likePattern(q);
  const digits = q.replace(/\D/g, '');
  if (a.role === 'resident') {
    const [announcements, visitors, complaints, facilities] = await Promise.all([
      many(
        `SELECT id, title, category, publish_at FROM announcements a WHERE a.society_id = $1 AND a.status = 'published' AND a.publish_at <= now()
           AND (a.audience = 'all' OR a.tower_ids && (SELECT array_agg(f.tower_id) FROM flats f WHERE f.id = ANY($3::uuid[])))
           AND (a.title ILIKE $2 OR a.body ILIKE $2) ORDER BY publish_at DESC LIMIT 5`,
        [a.societyId, pat, a.flatIds],
      ),
      many(
        `SELECT id, visitor_name, category, provider, checked_in_at, status FROM visitor_entries
          WHERE society_id = $1 AND flat_id = ANY($3) AND (visitor_name ILIKE $2 OR provider ILIKE $2) ORDER BY checked_in_at DESC LIMIT 5`,
        [a.societyId, pat, a.flatIds],
      ),
      many(
        `SELECT id, number, title, status FROM complaints WHERE society_id = $1 AND (raised_by = $3 OR flat_id = ANY($4)) AND (title ILIKE $2 OR number ILIKE $2 OR description ILIKE $2)
          ORDER BY created_at DESC LIMIT 5`,
        [a.societyId, pat, a.userId, a.flatIds],
      ),
      many(`SELECT id, name, location FROM facilities WHERE society_id = $1 AND is_active AND (name ILIKE $2 OR description ILIKE $2) LIMIT 5`, [a.societyId, pat]),
    ]);
    return res.json({ announcements, visitors, complaints, facilities });
  }
  if (ADMIN_ROLES.includes(a.role)) {
    const [residents, flats, visitors, complaints, bookings] = await Promise.all([
      many(
        `SELECT r.id, u.full_name, u.mobile, (SELECT f.number FROM resident_flat_relationships x JOIN flats f ON f.id = x.flat_id WHERE x.resident_id = r.id AND x.status = 'active' LIMIT 1) AS flat_number
           FROM residents r JOIN users u ON u.id = r.user_id WHERE r.society_id = $1 AND r.status = 'active'
            AND (u.full_name ILIKE $2 OR ($3 <> '' AND u.mobile LIKE '%' || $3 || '%') OR u.email ILIKE $2) ORDER BY u.full_name LIMIT 6`,
        [a.societyId, pat, digits.length >= 3 ? digits : ''],
      ),
      many(`SELECT f.id, f.number, t.name AS tower_name, f.occupancy_status FROM flats f JOIN towers t ON t.id = f.tower_id WHERE f.society_id = $1 AND f.number ILIKE $2 ORDER BY f.number LIMIT 6`, [a.societyId, pat]),
      many(
        `SELECT ve.id, ve.visitor_name, ve.category, ve.provider, ve.checked_in_at, ve.status, f.number AS flat_number FROM visitor_entries ve LEFT JOIN flats f ON f.id = ve.flat_id
          WHERE ve.society_id = $1 AND (ve.visitor_name ILIKE $2 OR ve.provider ILIKE $2 OR ve.vehicle_number ILIKE $2 OR ($3 <> '' AND ve.visitor_mobile LIKE '%' || $3 || '%'))
          ORDER BY ve.checked_in_at DESC LIMIT 6`,
        [a.societyId, pat, digits.length >= 3 ? digits : ''],
      ),
      many(`SELECT id, number, title, status, priority FROM complaints WHERE society_id = $1 AND (title ILIKE $2 OR number ILIKE $2) ORDER BY created_at DESC LIMIT 6`, [a.societyId, pat]),
      many(
        `SELECT b.id, b.reference, b.booking_date, b.start_time, f.name AS facility_name, fl.number AS flat_number FROM facility_bookings b
           JOIN facilities f ON f.id = b.facility_id JOIN flats fl ON fl.id = b.flat_id
          WHERE b.society_id = $1 AND (b.reference ILIKE $2 OR f.name ILIKE $2 OR fl.number ILIKE $2) ORDER BY b.starts_at DESC LIMIT 6`,
        [a.societyId, pat],
      ),
    ]);
    return res.json({ residents, flats, visitors, complaints, bookings });
  }
  // Guards use /gate/search which is shaped for gate operations.
  throw forbidden();
});

// ============================================================================
// Audit log (read-only for society admins)
// ============================================================================
export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission('audit:view'));

auditRouter.get('/', async (req, res) => {
  const a = ctx(req);
  const q = pagination
    .extend({ action: z.string().max(60).optional(), entityType: z.string().max(40).optional(), actorRole: z.string().max(20).optional(), from: isoDate.optional(), to: isoDate.optional(), q: z.string().trim().max(60).optional() })
    .parse(req.query);
  const { limit, offset } = pageClause(q);
  const tz = await societyTz(a.societyId);
  const where = `l.society_id = $1 AND ($2::text IS NULL OR l.action ILIKE $2 || '%') AND ($3::text IS NULL OR l.entity_type = $3) AND ($4::text IS NULL OR l.actor_role = $4)
    AND ($5::date IS NULL OR (l.created_at AT TIME ZONE $8)::date >= $5) AND ($6::date IS NULL OR (l.created_at AT TIME ZONE $8)::date <= $6)
    AND ($7::text IS NULL OR u.full_name ILIKE $7 OR l.summary ILIKE $7 OR l.action ILIKE $7)`;
  const params = [a.societyId, q.action ?? null, q.entityType ?? null, q.actorRole ?? null, q.from ?? null, q.to ?? null, q.q ? likePattern(q.q) : null, tz];
  const rows = await many(
    `SELECT l.id, l.action, l.entity_type, l.entity_id, l.summary, l.actor_role, l.old_values, l.new_values, l.ip, l.user_agent, l.created_at, u.full_name AS actor_name
       FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id WHERE ${where} ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = await one(`SELECT count(*)::int AS n FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id WHERE ${where}`, params);
  res.json({ logs: rows, total: total.n, page: q.page, pageSize: q.pageSize });
});

export { shortName };
