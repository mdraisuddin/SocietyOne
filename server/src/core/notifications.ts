import webpush from 'web-push';
import { config } from '../config.js';
import { many, pool, type Db } from '../db/pool.js';

/**
 * Notification architecture
 *  - Every event produces an in-app notification row (source of truth, polled by clients).
 *  - Channels (push today; SMS/WhatsApp later) are pluggable dispatchers that honour preferences.
 *  - Emergency priority bypasses user opt-outs.
 */
export type NotificationCategory = 'visitors' | 'complaints' | 'bookings' | 'announcements';

export const NOTIFICATION_TYPES = {
  visitor_arrived: 'visitors',
  visitor_approval_requested: 'visitors',
  visitor_approval_responded: 'visitors',
  visitor_checked_in: 'visitors',
  visitor_checked_out: 'visitors',
  delivery_arrived: 'visitors',
  complaint_created: 'complaints',
  complaint_assigned: 'complaints',
  complaint_status_changed: 'complaints',
  complaint_resolved: 'complaints',
  complaint_comment: 'complaints',
  booking_confirmed: 'bookings',
  booking_cancelled: 'bookings',
  announcement_new: 'announcements',
  announcement_emergency: 'announcements',
} as const satisfies Record<string, NotificationCategory>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export interface NotifyInput {
  societyId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  priority?: 'normal' | 'important' | 'emergency';
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  url?: string;
}

export interface PushChannel {
  send(userIds: string[], payload: { title: string; body: string; url?: string; tag?: string; priority: string }): Promise<void>;
}

class WebPushChannel implements PushChannel {
  private enabled = false;
  constructor() {
    if (config.vapid.publicKey && config.vapid.privateKey) {
      webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
      this.enabled = true;
    }
  }
  async send(userIds: string[], payload: { title: string; body: string; url?: string; tag?: string; priority: string }) {
    if (!this.enabled || !userIds.length) return;
    const subs = await many(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1)`, [userIds]);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
            TTL: 3600,
            urgency: payload.priority === 'emergency' ? 'high' : 'normal',
          });
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        }
      }),
    );
  }
}

let pushChannel: PushChannel = new WebPushChannel();
/** Test hook / future providers (FCM, APNs) */
export function setPushChannel(c: PushChannel) {
  pushChannel = c;
}

export async function notify(input: NotifyInput, db: Db = pool) {
  const userIds = [...new Set(input.userIds)].filter(Boolean);
  if (!userIds.length) return;
  const category = NOTIFICATION_TYPES[input.type];
  const priority = input.priority ?? 'normal';
  const prefs = await many<{ user_id: string; in_app: boolean; push: boolean }>(
    `SELECT user_id, in_app, push FROM notification_preferences WHERE society_id = $1 AND category = $2 AND user_id = ANY($3)`,
    [input.societyId, category, userIds],
    db,
  );
  const prefMap = new Map(prefs.map((p) => [p.user_id, p]));
  const isCritical = priority === 'emergency' || input.type === 'visitor_approval_requested';
  const inAppUsers = userIds.filter((u) => isCritical || prefMap.get(u)?.in_app !== false);
  const pushUsers = userIds.filter((u) => isCritical || prefMap.get(u)?.push !== false);
  if (inAppUsers.length) {
    await db.query(
      `INSERT INTO notifications (society_id, user_id, type, category, title, body, priority, entity_type, entity_id, data)
       SELECT $1, u, $2, $3, $4, $5, $6, $7, $8, $9 FROM unnest($10::uuid[]) AS u`,
      [
        input.societyId,
        input.type,
        category,
        input.title,
        input.body,
        priority,
        input.entityType ?? null,
        input.entityId ?? null,
        { ...(input.data ?? {}), url: input.url },
        inAppUsers,
      ],
    );
  }
  // Fire-and-forget: push delivery must never block or fail the business transaction.
  pushChannel
    .send(pushUsers, { title: input.title, body: input.body, url: input.url, tag: input.entityId, priority })
    .catch((e) => console.warn('push failed', e?.message));
}

/** All active resident user ids for a flat. */
export async function flatResidentUserIds(societyId: string, flatId: string, db: Db = pool): Promise<string[]> {
  const rows = await many(
    `SELECT DISTINCT r.user_id FROM resident_flat_relationships rfr
       JOIN residents r ON r.id = rfr.resident_id AND r.status = 'active'
       JOIN society_users su ON su.user_id = r.user_id AND su.society_id = r.society_id AND su.role = 'resident' AND su.status = 'active'
      WHERE rfr.society_id = $1 AND rfr.flat_id = $2 AND rfr.status = 'active'`,
    [societyId, flatId],
    db,
  );
  return rows.map((r) => r.user_id);
}

export async function societyStaffUserIds(societyId: string, db: Db = pool): Promise<string[]> {
  const rows = await many(
    `SELECT user_id FROM society_users WHERE society_id = $1 AND role IN ('admin','facility_manager') AND status = 'active'`,
    [societyId],
    db,
  );
  return rows.map((r) => r.user_id);
}
