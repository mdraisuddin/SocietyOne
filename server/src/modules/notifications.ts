import { Router } from 'express';
import { many, one, pool } from '../db/pool.js';
import { requireAuth } from '../core/auth.js';
import { z } from '../core/validate.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  const q = z.object({ unreadOnly: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
  const a = req.auth!;
  const rows = await many(
    `SELECT id, type, category, title, body, priority, entity_type, entity_id, data, read_at, created_at
       FROM notifications
      WHERE user_id = $1 AND (society_id = $2 OR ($2::uuid IS NULL AND society_id IS NULL)) ${q.unreadOnly ? 'AND read_at IS NULL' : ''}
      ORDER BY created_at DESC LIMIT $3`,
    [a.userId, a.societyId, q.limit],
  );
  const unread = await one(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND (society_id = $2 OR ($2::uuid IS NULL AND society_id IS NULL)) AND read_at IS NULL`,
    [a.userId, a.societyId],
  );
  res.json({ notifications: rows, unreadCount: unread.n });
});

/** Lightweight poll endpoint: unread count + latest id (cheap on mobile data). */
notificationsRouter.get('/summary', async (req, res) => {
  const a = req.auth!;
  const r = await one(
    `SELECT count(*) FILTER (WHERE read_at IS NULL)::int AS unread,
            (SELECT id FROM notifications WHERE user_id = $1 AND society_id IS NOT DISTINCT FROM $2 ORDER BY created_at DESC LIMIT 1) AS latest_id
       FROM notifications WHERE user_id = $1 AND society_id IS NOT DISTINCT FROM $2`,
    [a.userId, a.societyId],
  );
  res.json({ unreadCount: r.unread, latestId: r.latest_id });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  await pool.query(`UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`, [id, req.auth!.userId]);
  res.json({ ok: true });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await pool.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND society_id IS NOT DISTINCT FROM $2 AND read_at IS NULL`, [
    req.auth!.userId,
    req.auth!.societyId,
  ]);
  res.json({ ok: true });
});
