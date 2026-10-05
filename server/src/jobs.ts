import { many, pool } from './db/pool.js';
import { dispatchAnnouncement } from './modules/community.js';

/**
 * Lightweight in-process scheduler (MVP). For multi-instance deployments move to a
 * queue worker (e.g. pg-boss / BullMQ); every job here is idempotent so concurrent runs are safe.
 */
export async function runJobs() {
  // Expire unanswered gate approvals
  await pool.query(`UPDATE visitor_approvals SET status = 'expired' WHERE status = 'pending' AND expires_at < now()`);
  // Expire passes whose validity ended (society-local date)
  await pool.query(
    `UPDATE visitor_invites vi SET status = 'expired' FROM societies s
      WHERE s.id = vi.society_id AND vi.status = 'active' AND vi.valid_until < (now() AT TIME ZONE s.timezone)::date`,
  );
  // Complete finished bookings
  await pool.query(`UPDATE facility_bookings SET status = 'completed' WHERE status = 'confirmed' AND ends_at < now()`);
  // Dispatch scheduled announcements that just went live
  const due = await many(`SELECT id FROM announcements WHERE status = 'published' AND notified_at IS NULL AND publish_at <= now() AND (expires_at IS NULL OR expires_at > now())`);
  for (const a of due) await dispatchAnnouncement(a.id);
  // Housekeeping
  await pool.query(`DELETE FROM otp_codes WHERE created_at < now() - interval '1 day'`);
  await pool.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '3 days'`);
}

export function startScheduler(intervalMs = 60_000) {
  const tick = () => runJobs().catch((e) => console.error('[jobs]', e.message));
  tick();
  return setInterval(tick, intervalMs);
}
