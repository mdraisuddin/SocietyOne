import type { NextFunction, Request, Response } from 'express';
import { one, pool } from '../db/pool.js';

/**
 * Idempotency for mutation endpoints used by the offline guard queue.
 * Clients send `Idempotency-Key`; a replay returns the stored response instead of re-executing.
 */
export async function idempotent(req: Request, res: Response, next: NextFunction) {
  const key = req.get('idempotency-key');
  if (!key || !req.auth) return next();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) return next();
  const existing = await one(`SELECT status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2`, [req.auth.userId, key]);
  if (existing) {
    res.setHeader('Idempotent-Replay', 'true');
    return res.status(existing.status_code).json(existing.response);
  }
  const json = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode < 500) {
      pool
        .query(`INSERT INTO idempotency_keys (key, user_id, status_code, response) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [
          key,
          req.auth!.userId,
          res.statusCode,
          body,
        ])
        .catch(() => {});
    }
    return json(body);
  };
  next();
}
