import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { DEMO } from '../src/db/seed.js';

export const app = createApp();
export { DEMO, pool };

const tokens = new Map<string, string>();

/** Sign in via mobile OTP (demo mode returns the code). Cached per mobile. */
export async function otpLogin(mobile: string, fresh = false): Promise<string> {
  if (!fresh && tokens.has(mobile)) return tokens.get(mobile)!;
  // Bypass the resend cooldown between tests by clearing this number's recent OTPs.
  await pool.query(`DELETE FROM otp_codes WHERE mobile = $1`, [mobile]);
  const r1 = await request(app).post('/api/v1/auth/otp/request').send({ mobile });
  if (r1.status !== 200) throw new Error(`otp request failed ${r1.status} ${JSON.stringify(r1.body)}`);
  const r2 = await request(app).post('/api/v1/auth/otp/verify').send({ mobile, code: r1.body.demoCode });
  if (r2.status !== 200) throw new Error(`otp verify failed ${r2.status} ${JSON.stringify(r2.body)}`);
  tokens.set(mobile, r2.body.token);
  return r2.body.token;
}

export async function passwordLogin(email: string, password: string): Promise<string> {
  const key = `pw:${email}`;
  if (tokens.has(key)) return tokens.get(key)!;
  const r = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
  tokens.set(key, r.body.token);
  return r.body.token;
}

/** Tiny authenticated client */
export function as(token: string) {
  const h = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => h(request(app).get(`/api/v1${url}`)),
    post: (url: string, body?: object) => h(request(app).post(`/api/v1${url}`)).send(body ?? {}),
    patch: (url: string, body?: object) => h(request(app).patch(`/api/v1${url}`)).send(body ?? {}),
    put: (url: string, body?: object) => h(request(app).put(`/api/v1${url}`)).send(body ?? {}),
    delete: (url: string) => h(request(app).delete(`/api/v1${url}`)),
    raw: (method: 'post' | 'patch', url: string) => h(request(app)[method](`/api/v1${url}`)),
  };
}

export const resident = () => otpLogin(DEMO.resident.mobile).then(as);
export const spouse = () => otpLogin(DEMO.residentSpouse.mobile).then(as);
export const tenant = () => otpLogin(DEMO.tenant.mobile).then(as);
export const guard = () => otpLogin(DEMO.guard.mobile).then(as);
export const admin = () => passwordLogin(DEMO.admin.email, DEMO.admin.password).then(as);
export const superAdmin = () => passwordLogin(DEMO.superAdmin.email, DEMO.superAdmin.password).then(as);
export const otherAdmin = () => passwordLogin(DEMO.otherAdmin.email, DEMO.otherAdmin.password).then(as);
export const otherResident = () => otpLogin(DEMO.otherResident.mobile).then(as);

export async function latestNotification(mobile: string, type?: string) {
  const r = await pool.query(
    `SELECT n.* FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.mobile = $1 ${type ? 'AND n.type = $2' : ''} ORDER BY n.created_at DESC LIMIT 1`,
    type ? [mobile, type] : [mobile],
  );
  return r.rows[0];
}

/** A minimal valid 1x1 PNG */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Today's date in IST */
export const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const addDays = (d: string, n: number) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
