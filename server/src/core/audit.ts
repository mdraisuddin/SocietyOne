import type { Request } from 'express';
import { pool, type Db } from '../db/pool.js';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | null;
  summary?: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  societyId?: string | null;
}

const SENSITIVE = new Set(['password', 'password_hash', 'otp_code', 'token', 'token_hash', 'code_hash']);

function scrub(v: Record<string, unknown> | null | undefined) {
  if (!v) return null;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = SENSITIVE.has(k) ? '[redacted]' : val;
  return out;
}

/** Append an audit record. Audit rows are immutable (enforced by DB trigger). */
export async function audit(req: Request | null, entry: AuditEntry, db: Db = pool) {
  const auth = req?.auth;
  await db.query(
    `INSERT INTO audit_logs (society_id, actor_id, actor_role, action, entity_type, entity_id, summary, old_values, new_values, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      entry.societyId !== undefined ? entry.societyId : (auth?.societyId ?? null),
      auth?.userId ?? null,
      auth?.role ?? null,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.summary ?? null,
      scrub(entry.oldValues),
      scrub(entry.newValues),
      req ? clientIp(req) : null,
      req?.get('user-agent')?.slice(0, 300) ?? null,
    ],
  );
}

export function clientIp(req: Request): string | null {
  const ip = req.ip ?? null;
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
