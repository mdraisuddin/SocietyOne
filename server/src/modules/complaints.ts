import { Router, type Request } from 'express';
import type pg from 'pg';
import { many, one, pool, tx, type Db } from '../db/pool.js';
import { ctx, requireAuth, requirePermission, assertFlatAccess } from '../core/auth.js';
import { audit } from '../core/audit.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../core/errors.js';
import { notify, societyStaffUserIds } from '../core/notifications.js';
import { saveImage } from '../core/storage.js';
import { ADMIN_ROLES } from '../core/rbac.js';
import { likePattern, optionalText, pageClause, pagination, text, z } from '../core/validate.js';
import { photoUrl, upload } from './profile.js';

export const CATEGORIES: Record<string, string[]> = {
  plumbing: ['Leakage', 'Blocked drain', 'Tap / faucet', 'Flush / toilet', 'Low water pressure', 'Other'],
  electrical: ['Power outage', 'Switch / socket', 'Wiring', 'MCB tripping', 'Common area lighting', 'Other'],
  housekeeping: ['Corridor cleaning', 'Garbage collection', 'Staircase', 'Lobby', 'Other'],
  lift: ['Lift not working', 'Lift stuck', 'Door issue', 'Noise / jerks', 'Other'],
  security: ['Unauthorised entry', 'Guard behaviour', 'CCTV', 'Other'],
  parking: ['Wrong parking', 'Slot blocked', 'Visitor parking', 'Other'],
  water: ['No water supply', 'Water quality', 'Tank overflow', 'Other'],
  common_area: ['Gym', 'Clubhouse', 'Garden', 'Play area', 'Swimming pool', 'Other'],
  noise: ['Construction / renovation', 'Party / music', 'Pets', 'Other'],
  pest_control: ['Cockroaches', 'Mosquitoes', 'Rodents', 'Termites', 'Other'],
  other: ['General'],
};
const CATEGORY_KEYS = Object.keys(CATEGORIES) as [string, ...string[]];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed'] as const;
type Status = (typeof STATUSES)[number];

/** Target resolution hours per priority (basis for Phase 2 SLA policies). */
const RESOLUTION_HOURS: Record<string, number> = { urgent: 4, high: 24, medium: 72, low: 120 };

const ADMIN_TRANSITIONS: Record<Status, Status[]> = {
  open: ['assigned', 'in_progress', 'resolved', 'closed'],
  assigned: ['open', 'in_progress', 'resolved'],
  in_progress: ['assigned', 'resolved'],
  resolved: ['in_progress', 'closed'],
  closed: ['in_progress'],
};

export const complaintsRouter = Router();
complaintsRouter.use(requireAuth);

const isStaff = (req: Request) => ADMIN_ROLES.includes(req.auth!.role);

async function nextNumber(c: Db, societyId: string) {
  const r = await c.query(
    `INSERT INTO society_counters (society_id, key, value) VALUES ($1, 'complaint', 1001)
     ON CONFLICT (society_id, key) DO UPDATE SET value = society_counters.value + 1 RETURNING value`,
    [societyId],
  );
  const prefix = (await c.query(`SELECT complaint_prefix FROM societies WHERE id = $1`, [societyId])).rows[0].complaint_prefix;
  return `${prefix}-INC-${r.rows[0].value}`;
}

async function loadComplaint(req: Request, id: string, db: Db = pool, lock = false) {
  const a = ctx(req);
  const c = await one(
    `SELECT c.*, f.number AS flat_number, t.name AS tower_name, t.id AS tower_id, ru.full_name AS raised_by_name, au.full_name AS assigned_to_name
       FROM complaints c LEFT JOIN flats f ON f.id = c.flat_id LEFT JOIN towers t ON t.id = f.tower_id
       JOIN users ru ON ru.id = c.raised_by LEFT JOIN users au ON au.id = c.assigned_to
      WHERE c.id = $1 AND c.society_id = $2 ${lock ? 'FOR UPDATE OF c' : ''}`,
    [id, a.societyId],
    db,
  );
  if (!c) throw notFound('Complaint');
  if (!isStaff(req)) {
    if (a.role !== 'resident') throw forbidden();
    if (c.raised_by !== a.userId && !(c.flat_id && a.flatIds.includes(c.flat_id))) throw notFound('Complaint');
  }
  return c;
}

async function attachPhotos(req: Request, c: Db, complaintId: string, commentId: string | null) {
  const a = ctx(req);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const out = [];
  for (const f of files.slice(0, 5)) {
    const saved = await saveImage(a.societyId, 'complaints', f.buffer);
    const r = await c.query(
      `INSERT INTO complaint_attachments (society_id, complaint_id, comment_id, uploaded_by, file_key, mime_type, size_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [a.societyId, complaintId, commentId, a.userId, saved.key, saved.mime, saved.size],
    );
    out.push({ id: r.rows[0].id, url: photoUrl(saved.key) });
  }
  return out;
}

async function addHistory(c: Db, societyId: string, complaintId: string, from: string | null, to: string, by: string, note?: string | null) {
  await c.query(`INSERT INTO complaint_status_history (society_id, complaint_id, from_status, to_status, changed_by, note) VALUES ($1,$2,$3,$4,$5,$6)`, [
    societyId, complaintId, from, to, by, note ?? null,
  ]);
}

const STATUS_LABEL: Record<string, string> = { open: 'Open', assigned: 'Technician assigned', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };

complaintsRouter.get('/meta', async (req, res) => {
  const a = ctx(req);
  const staff = isStaff(req)
    ? await many(`SELECT u.id, u.full_name, su.role FROM society_users su JOIN users u ON u.id = su.user_id WHERE su.society_id = $1 AND su.role IN ('admin','facility_manager') AND su.status = 'active' ORDER BY u.full_name`, [a.societyId])
    : [];
  res.json({ categories: CATEGORIES, priorities: PRIORITIES, statuses: STATUSES, staff });
});

const createInput = z.object({
  category: z.enum(CATEGORY_KEYS),
  subcategory: optionalText(60),
  title: text(120, 3),
  description: text(2000, 5),
  location: optionalText(120),
  priority: z.enum(PRIORITIES).default('medium'),
  flatId: z.string().uuid().optional(),
});

complaintsRouter.post('/', requirePermission('complaints:raise'), upload.array('photos', 5), async (req, res) => {
  const a = ctx(req);
  const b = createInput.parse(req.body);
  const flatId = b.flatId ?? a.flatIds[0] ?? null;
  if (flatId) assertFlatAccess(req, flatId);
  const created = await tx(async (c) => {
    const number = await nextNumber(c, a.societyId);
    const row = (
      await c.query(
        `INSERT INTO complaints (society_id, number, flat_id, raised_by, category, subcategory, title, description, location, priority, created_by, resolution_due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$4, now() + make_interval(hours => $11)) RETURNING id, number, status, created_at`,
        [a.societyId, number, flatId, a.userId, b.category, b.subcategory, b.title, b.description, b.location, b.priority, RESOLUTION_HOURS[b.priority]],
      )
    ).rows[0];
    await addHistory(c, a.societyId, row.id, null, 'open', a.userId);
    const photos = await attachPhotos(req, c, row.id, null);
    await audit(req, { action: 'complaint.created', entityType: 'complaint', entityId: row.id, newValues: { number, category: b.category, priority: b.priority, photos: photos.length } }, c);
    await notify(
      {
        societyId: a.societyId,
        userIds: await societyStaffUserIds(a.societyId, c),
        type: 'complaint_created',
        title: `New complaint ${number}`,
        body: `${b.title} (${b.category.replace('_', ' ')}, ${b.priority})`,
        priority: b.priority === 'urgent' ? 'important' : 'normal',
        entityType: 'complaint',
        entityId: row.id,
        url: `/admin/complaints/${row.id}`,
      },
      c,
    );
    return { ...row, photos };
  });
  res.status(201).json({ complaint: created });
});

const listSorts: Record<string, string> = {
  newest: 'c.created_at DESC',
  oldest: 'c.created_at ASC',
  priority: `array_position(ARRAY['urgent','high','medium','low'], c.priority), c.created_at DESC`,
  updated: 'c.updated_at DESC',
};

complaintsRouter.get('/', async (req, res) => {
  const a = ctx(req);
  const q = pagination
    .extend({
      q: z.string().trim().max(60).optional(),
      status: z.string().max(60).optional(), // comma-separated
      category: z.enum(CATEGORY_KEYS).optional(),
      priority: z.enum(PRIORITIES).optional(),
      towerId: z.string().uuid().optional(),
      assignedTo: z.string().uuid().optional(),
      sort: z.enum(['newest', 'oldest', 'priority', 'updated']).default('newest'),
    })
    .parse(req.query);
  const statuses = q.status?.split(',').filter((s) => (STATUSES as readonly string[]).includes(s)) ?? [];
  if (!isStaff(req) && a.role !== 'resident') throw forbidden();
  const { limit, offset } = pageClause(q);
  const scope = isStaff(req) ? '($8::uuid IS NULL AND $9::uuid[] IS NULL)' : '(c.raised_by = $8 OR c.flat_id = ANY($9))';
  const where = `c.society_id = $1 AND ${scope} AND ($2::text[] IS NULL OR c.status = ANY($2)) AND ($3::text IS NULL OR c.category = $3)
     AND ($4::text IS NULL OR c.priority = $4) AND ($5::uuid IS NULL OR f.tower_id = $5) AND ($6::uuid IS NULL OR c.assigned_to = $6)
     AND ($7::text IS NULL OR c.title ILIKE $7 OR c.number ILIKE $7 OR c.description ILIKE $7 OR f.number ILIKE $7)`;
  const params: unknown[] = [a.societyId, statuses.length ? statuses : null, q.category ?? null, q.priority ?? null, q.towerId ?? null, q.assignedTo ?? null, q.q ? likePattern(q.q) : null];
  params.push(isStaff(req) ? null : a.userId, isStaff(req) ? null : a.flatIds);
  const rows = await many(
    `SELECT c.id, c.number, c.category, c.subcategory, c.title, c.priority, c.status, c.created_at, c.updated_at, c.assigned_at, c.resolved_at, c.closed_at,
            c.rating, c.assignee_name, c.resolution_due_at, f.number AS flat_number, t.name AS tower_name, au.full_name AS assigned_to_name,
            ${isStaff(req) ? 'ru.full_name AS raised_by_name,' : ''}
            (c.status NOT IN ('resolved','closed') AND c.resolution_due_at < now()) AS overdue,
            (SELECT count(*) FROM complaint_attachments ca WHERE ca.complaint_id = c.id)::int AS photos
       FROM complaints c LEFT JOIN flats f ON f.id = c.flat_id LEFT JOIN towers t ON t.id = f.tower_id
       JOIN users ru ON ru.id = c.raised_by LEFT JOIN users au ON au.id = c.assigned_to
      WHERE ${where} ORDER BY ${listSorts[q.sort]} LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = await one(`SELECT count(*)::int AS n FROM complaints c LEFT JOIN flats f ON f.id = c.flat_id WHERE ${where}`, params);
  const counts = await many(
    `SELECT c.status, count(*)::int AS n FROM complaints c WHERE c.society_id = $1 AND ${isStaff(req) ? 'TRUE' : '(c.raised_by = $2 OR c.flat_id = ANY($3))'} GROUP BY c.status`,
    isStaff(req) ? [a.societyId] : [a.societyId, a.userId, a.flatIds],
  );
  res.json({ complaints: rows, total: total.n, page: q.page, pageSize: q.pageSize, statusCounts: Object.fromEntries(counts.map((r) => [r.status, r.n])) });
});

complaintsRouter.get('/:id', async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const c = await loadComplaint(req, id);
  const staff = isStaff(req);
  const comments = await many(
    `SELECT cc.id, cc.body, cc.visibility, cc.kind, cc.created_at, u.full_name AS author_name, cc.author_id,
            (SELECT su.role FROM society_users su WHERE su.user_id = cc.author_id AND su.society_id = cc.society_id AND su.role IN ('admin','facility_manager') LIMIT 1) AS author_staff_role
       FROM complaint_comments cc JOIN users u ON u.id = cc.author_id
      WHERE cc.complaint_id = $1 ${staff ? '' : `AND cc.visibility = 'public'`} ORDER BY cc.created_at`,
    [id],
  );
  const attachments = await many(`SELECT id, comment_id, file_key, created_at FROM complaint_attachments WHERE complaint_id = $1 ORDER BY created_at`, [id]);
  const history = await many(
    `SELECT h.from_status, h.to_status, h.created_at, ${staff ? 'h.note,' : ''} u.full_name AS changed_by_name
       FROM complaint_status_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.complaint_id = $1 ORDER BY h.created_at`,
    [id],
  );
  const { raised_by, created_by, ...safe } = c;
  res.json({
    complaint: { ...safe, raised_by_me: raised_by === req.auth!.userId, overdue: !['resolved', 'closed'].includes(c.status) && c.resolution_due_at && new Date(c.resolution_due_at) < new Date() },
    comments: comments.map((x) => ({ ...x, mine: x.author_id === req.auth!.userId, author_is_staff: !!x.author_staff_role })),
    attachments: attachments.map((x) => ({ id: x.id, commentId: x.comment_id, url: photoUrl(x.file_key), createdAt: x.created_at })),
    history,
  });
});

complaintsRouter.post('/:id/comments', upload.array('photos', 5), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = z.object({ body: text(2000), visibility: z.enum(['public', 'internal']).default('public') }).parse(req.body);
  const staff = isStaff(req);
  if (!staff && b.visibility === 'internal') throw forbidden('Only management can add internal notes');
  const out = await tx(async (cl) => {
    const c = await loadComplaint(req, id, cl, true);
    const cm = (await cl.query(`INSERT INTO complaint_comments (society_id, complaint_id, author_id, body, visibility) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`, [a.societyId, id, a.userId, b.body, b.visibility])).rows[0];
    const photos = await attachPhotos(req, cl, id, cm.id);
    if (staff && b.visibility === 'public' && !c.first_response_at) await cl.query(`UPDATE complaints SET first_response_at = now() WHERE id = $1`, [id]);
    await cl.query(`UPDATE complaints SET updated_at = now() WHERE id = $1`, [id]);
    if (b.visibility === 'public') {
      const recipients = staff ? [c.raised_by] : c.assigned_to ? [c.assigned_to] : await societyStaffUserIds(a.societyId, cl);
      await notify(
        {
          societyId: a.societyId,
          userIds: recipients.filter((u: string) => u !== a.userId),
          type: 'complaint_comment',
          title: `New update on ${c.number}`,
          body: b.body.length > 120 ? `${b.body.slice(0, 117)}…` : b.body,
          entityType: 'complaint',
          entityId: id,
          url: staff ? `/app/complaints/${id}` : `/admin/complaints/${id}`,
        },
        cl,
      );
    }
    await audit(req, { action: b.visibility === 'internal' ? 'complaint.internal_note' : 'complaint.comment', entityType: 'complaint', entityId: id, summary: c.number }, cl);
    return { id: cm.id, createdAt: cm.created_at, photos };
  });
  res.status(201).json({ comment: out });
});

complaintsRouter.post('/:id/attachments', upload.array('photos', 5), async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  if (!(req.files as any[])?.length) throw badRequest('Choose at least one photo');
  const photos = await tx(async (cl) => {
    await loadComplaint(req, id, cl, true);
    return attachPhotos(req, cl, id, null);
  });
  await audit(req, { action: 'complaint.photos_added', entityType: 'complaint', entityId: id, newValues: { count: photos.length } });
  res.status(201).json({ photos });
});

// --- Admin: update status / priority / assignment -----------------------------
const updateInput = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedTo: z.string().uuid().optional().nullable(),
  assigneeName: optionalText(120),
  note: optionalText(1000),
  noteVisibility: z.enum(['public', 'internal']).default('public'),
});

complaintsRouter.patch('/:id', requirePermission('complaints:manage'), async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = updateInput.parse(req.body);
  const result = await tx(async (cl) => {
    const c = await loadComplaint(req, id, cl, true);
    const sets: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const changes: Record<string, unknown> = {};
    const old: Record<string, unknown> = {};
    const hasAssignee = 'assignedTo' in req.body;
    const hasName = 'assigneeName' in req.body;
    const assignmentChanged = (hasAssignee && (b.assignedTo ?? null) !== c.assigned_to) || (hasName && b.assigneeName !== c.assignee_name);
    if (b.assignedTo) {
      const ok = await cl.query(`SELECT 1 FROM society_users WHERE society_id = $1 AND user_id = $2 AND role IN ('admin','facility_manager') AND status = 'active'`, [a.societyId, b.assignedTo]);
      if (!ok.rowCount) throw badRequest('Assignee must be a member of the management team');
    }
    if (assignmentChanged) {
      if (hasAssignee) sets.push(`assigned_to = ${p(b.assignedTo ?? null)}`);
      if (hasName) sets.push(`assignee_name = ${p(b.assigneeName)}`);
      sets.push(`assigned_at = now()`);
      old.assigned_to = c.assigned_to_name ?? c.assignee_name;
      changes.assigned_to = b.assigneeName ?? b.assignedTo;
    }
    let newStatus: Status | undefined = b.status;
    if (!newStatus && assignmentChanged && c.status === 'open') newStatus = 'assigned';
    if (newStatus && newStatus !== c.status) {
      if (!ADMIN_TRANSITIONS[c.status as Status].includes(newStatus)) throw new AppError(409, 'invalid_transition', `Cannot move a complaint from ${STATUS_LABEL[c.status]} to ${STATUS_LABEL[newStatus]}`);
      if (newStatus === 'assigned' && !(b.assignedTo ?? b.assigneeName ?? c.assigned_to ?? c.assignee_name)) throw badRequest('Choose who to assign this complaint to');
      sets.push(`status = ${p(newStatus)}`);
      if (newStatus === 'in_progress') sets.push(`in_progress_at = COALESCE(in_progress_at, now())`);
      if (newStatus === 'resolved') sets.push(`resolved_at = now()`);
      if (newStatus === 'closed') sets.push(`closed_at = now()`);
      if (newStatus === 'in_progress' && ['resolved', 'closed'].includes(c.status)) sets.push(`resolved_at = NULL, closed_at = NULL`);
      if (!c.first_response_at) sets.push(`first_response_at = now()`);
      old.status = c.status;
      changes.status = newStatus;
    }
    if (b.priority && b.priority !== c.priority) {
      sets.push(`priority = ${p(b.priority)}`, `resolution_due_at = created_at + make_interval(hours => ${p(RESOLUTION_HOURS[b.priority])})`);
      old.priority = c.priority;
      changes.priority = b.priority;
    }
    if (sets.length) await cl.query(`UPDATE complaints SET ${sets.join(', ')} WHERE id = ${p(id)}`, params);
    if (changes.status) await addHistory(cl, a.societyId, id, c.status, changes.status as string, a.userId, b.note);
    if (b.note) {
      await cl.query(`INSERT INTO complaint_comments (society_id, complaint_id, author_id, body, visibility) VALUES ($1,$2,$3,$4,$5)`, [a.societyId, id, a.userId, b.note, b.noteVisibility]);
    }
    if (Object.keys(changes).length || b.note) {
      await audit(req, { action: changes.status ? 'complaint.status_changed' : 'complaint.updated', entityType: 'complaint', entityId: id, summary: c.number, oldValues: old, newValues: changes }, cl);
    }
    // Resident notifications
    const who = b.assigneeName ?? (b.assignedTo ? (await cl.query(`SELECT full_name FROM users WHERE id = $1`, [b.assignedTo])).rows[0]?.full_name : null);
    if (changes.status === 'resolved') {
      await notify({ societyId: a.societyId, userIds: [c.raised_by], type: 'complaint_resolved', title: `${c.number} resolved`, body: `“${c.title}” has been marked resolved. Please confirm or reopen if the issue persists.`, priority: 'important', entityType: 'complaint', entityId: id, url: `/app/complaints/${id}` }, cl);
    } else if (assignmentChanged && who) {
      await notify({ societyId: a.societyId, userIds: [c.raised_by], type: 'complaint_assigned', title: `${c.number}: technician assigned`, body: `${who} has been assigned to “${c.title}”.`, entityType: 'complaint', entityId: id, url: `/app/complaints/${id}` }, cl);
    } else if (changes.status) {
      await notify({ societyId: a.societyId, userIds: [c.raised_by], type: 'complaint_status_changed', title: `${c.number}: ${STATUS_LABEL[changes.status as string]}`, body: `Status of “${c.title}” changed to ${STATUS_LABEL[changes.status as string]}.`, entityType: 'complaint', entityId: id, url: `/app/complaints/${id}` }, cl);
    } else if (b.note && b.noteVisibility === 'public') {
      await notify({ societyId: a.societyId, userIds: [c.raised_by], type: 'complaint_comment', title: `New update on ${c.number}`, body: b.note.slice(0, 120), entityType: 'complaint', entityId: id, url: `/app/complaints/${id}` }, cl);
    }
    return changes;
  });
  res.json({ ok: true, changes: result });
});

// --- Resident actions ------------------------------------------------------------
async function residentAction(req: Request, id: string, fn: (c: any, cl: pg.PoolClient) => Promise<void>) {
  if (req.auth!.role !== 'resident') throw forbidden();
  await tx(async (cl) => {
    const c = await loadComplaint(req, id, cl, true);
    if (c.raised_by !== req.auth!.userId && !req.auth!.flatIds.includes(c.flat_id)) throw forbidden();
    await fn(c, cl);
  });
}

complaintsRouter.post('/:id/confirm', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  await residentAction(req, id, async (c, cl) => {
    if (c.status !== 'resolved') throw conflict('Only resolved complaints can be confirmed');
    await cl.query(`UPDATE complaints SET status = 'closed', closed_at = now() WHERE id = $1`, [id]);
    await addHistory(cl, a.societyId, id, 'resolved', 'closed', a.userId, 'Resident confirmed resolution');
    await audit(req, { action: 'complaint.resolution_confirmed', entityType: 'complaint', entityId: id, summary: c.number, oldValues: { status: 'resolved' }, newValues: { status: 'closed' } }, cl);
    if (c.assigned_to) await notify({ societyId: a.societyId, userIds: [c.assigned_to], type: 'complaint_status_changed', title: `${c.number} closed`, body: 'Resident confirmed the resolution.', entityType: 'complaint', entityId: id, url: `/admin/complaints/${id}` }, cl);
  });
  res.json({ ok: true, status: 'closed' });
});

complaintsRouter.post('/:id/reopen', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { reason } = z.object({ reason: text(1000, 3) }).parse(req.body);
  let newStatus = 'open';
  await residentAction(req, id, async (c, cl) => {
    if (!['resolved', 'closed'].includes(c.status)) throw conflict('Only resolved or closed complaints can be reopened');
    if (c.status === 'closed' && c.closed_at && Date.now() - new Date(c.closed_at).getTime() > 7 * 86400_000) throw conflict('Closed complaints can be reopened within 7 days. Please raise a new complaint.');
    newStatus = c.assigned_to || c.assignee_name ? 'assigned' : 'open';
    await cl.query(`UPDATE complaints SET status = $1, reopened_at = now(), reopen_count = reopen_count + 1, resolved_at = NULL, closed_at = NULL, rating = NULL, rated_at = NULL WHERE id = $2`, [newStatus, id]);
    await cl.query(`INSERT INTO complaint_comments (society_id, complaint_id, author_id, body, visibility, kind) VALUES ($1,$2,$3,$4,'public','status_change')`, [a.societyId, id, a.userId, `Reopened: ${reason}`]);
    await addHistory(cl, a.societyId, id, c.status, newStatus, a.userId, reason);
    await audit(req, { action: 'complaint.reopened', entityType: 'complaint', entityId: id, summary: c.number, oldValues: { status: c.status }, newValues: { status: newStatus } }, cl);
    await notify({ societyId: a.societyId, userIds: c.assigned_to ? [c.assigned_to] : await societyStaffUserIds(a.societyId, cl), type: 'complaint_status_changed', title: `${c.number} reopened`, body: reason.slice(0, 120), priority: 'important', entityType: 'complaint', entityId: id, url: `/admin/complaints/${id}` }, cl);
  });
  res.json({ ok: true, status: newStatus });
});

complaintsRouter.post('/:id/rate', async (req, res) => {
  const a = ctx(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const b = z.object({ rating: z.coerce.number().int().min(1).max(5), feedback: optionalText(500) }).parse(req.body);
  await residentAction(req, id, async (c, cl) => {
    if (!['resolved', 'closed'].includes(c.status)) throw conflict('You can rate a complaint once it is resolved');
    if (c.rating) throw conflict('You have already rated this complaint');
    await cl.query(`UPDATE complaints SET rating = $1, rating_feedback = $2, rated_at = now() WHERE id = $3`, [b.rating, b.feedback, id]);
    await audit(req, { action: 'complaint.rated', entityType: 'complaint', entityId: id, summary: c.number, newValues: { rating: b.rating } }, cl);
  });
  res.json({ ok: true });
});
