import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, DEMO, otpLogin, pool } from './helpers.js';

describe('Authentication', () => {
  it('logs a resident in with mobile + OTP and routes them to the Resident App', async () => {
    await pool.query(`DELETE FROM otp_codes WHERE mobile = $1`, [DEMO.resident.mobile]);
    const r1 = await request(app).post('/api/v1/auth/otp/request').send({ mobile: '98480 12345' });
    expect(r1.status).toBe(200);
    expect(r1.body.demoCode).toMatch(/^\d{6}$/);
    const r2 = await request(app).post('/api/v1/auth/otp/verify').send({ mobile: '+91 98480 12345', code: r1.body.demoCode });
    expect(r2.status).toBe(200);
    expect(r2.body.role).toBe('resident');
    expect(r2.body.home).toBe('/app');
    expect(r2.headers['set-cookie']?.[0]).toMatch(/so_session=.*HttpOnly/i);
    const me = await as(r2.body.token).get('/auth/me');
    expect(me.body.user.fullName).toBe('Ananya Sharma');
    expect(me.body.flats[0].number).toBe('A-1204');
  });

  it('routes each role to its interface', async () => {
    const g = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${await otpLogin(DEMO.guard.mobile)}`);
    expect(g.body.home).toBe('/guard');
    const a = await request(app).post('/api/v1/auth/login').send({ email: DEMO.admin.email, password: DEMO.admin.password });
    expect(a.body.home).toBe('/admin');
    const s = await request(app).post('/api/v1/auth/login').send({ email: DEMO.superAdmin.email, password: DEMO.superAdmin.password });
    expect(s.body.home).toBe('/platform');
  });

  it('rejects invalid Indian mobile numbers', async () => {
    const r = await request(app).post('/api/v1/auth/otp/request').send({ mobile: '12345' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_error');
  });

  it('enforces resend cooldown (rate limiting)', async () => {
    const mobile = DEMO.tenant.mobile;
    await pool.query(`DELETE FROM otp_codes WHERE mobile = $1`, [mobile]);
    expect((await request(app).post('/api/v1/auth/otp/request').send({ mobile })).status).toBe(200);
    const again = await request(app).post('/api/v1/auth/otp/request').send({ mobile });
    expect(again.status).toBe(429);
    expect(again.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('caps OTP requests per hour', async () => {
    const mobile = DEMO.tenant.mobile;
    await pool.query(`DELETE FROM otp_codes WHERE mobile = $1`, [mobile]);
    for (let i = 0; i < 5; i++) await pool.query(`INSERT INTO otp_codes (mobile, code_hash, expires_at, created_at) VALUES ($1,'x', now(), now() - interval '40 minutes')`, [mobile]);
    const r = await request(app).post('/api/v1/auth/otp/request').send({ mobile });
    expect(r.status).toBe(429);
    await pool.query(`DELETE FROM otp_codes WHERE mobile = $1`, [mobile]);
  });

  it('locks an OTP after too many wrong attempts and rejects expired codes', async () => {
    const mobile = DEMO.residentSpouse.mobile;
    await pool.query(`DELETE FROM otp_codes WHERE mobile = $1`, [mobile]);
    const r1 = await request(app).post('/api/v1/auth/otp/request').send({ mobile });
    const wrong = r1.body.demoCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/v1/auth/otp/verify').send({ mobile, code: wrong });
      expect(r.status).toBe(400);
    }
    const locked = await request(app).post('/api/v1/auth/otp/verify').send({ mobile, code: r1.body.demoCode });
    expect(locked.status).toBe(429);
    // Expired
    await pool.query(`DELETE FROM otp_codes WHERE mobile = $1`, [mobile]);
    const r2 = await request(app).post('/api/v1/auth/otp/request').send({ mobile });
    await pool.query(`UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE mobile = $1`, [mobile]);
    const expired = await request(app).post('/api/v1/auth/otp/verify').send({ mobile, code: r2.body.demoCode });
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('otp_expired');
  });

  it('does not reveal whether a mobile number is registered', async () => {
    const r = await request(app).post('/api/v1/auth/otp/request').send({ mobile: '9123456780' });
    expect(r.status).toBe(200);
    expect(r.body.demoCode).toBeUndefined();
    expect(r.body.ok).toBe(true);
  });

  it('reserves password login for administrators', async () => {
    const bad = await request(app).post('/api/v1/auth/login').send({ email: DEMO.admin.email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    // A resident with an email but no password cannot use password login
    const res = await request(app).post('/api/v1/auth/login').send({ email: DEMO.resident.email, password: 'whatever123' });
    expect(res.status).toBe(401);
  });

  it('supports forgot/reset password and revokes old sessions', async () => {
    const email = DEMO.facilityManager.email;
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: DEMO.facilityManager.password });
    expect(login.status).toBe(200);
    const f = await request(app).post('/api/v1/auth/password/forgot').send({ email });
    expect(f.status).toBe(200);
    expect(f.body.demoToken).toBeTruthy();
    const weak = await request(app).post('/api/v1/auth/password/reset').send({ token: f.body.demoToken, password: 'short' });
    expect(weak.status).toBe(400);
    const ok = await request(app).post('/api/v1/auth/password/reset').send({ token: f.body.demoToken, password: 'NewPassword2026' });
    expect(ok.status).toBe(200);
    const reuse = await request(app).post('/api/v1/auth/password/reset').send({ token: f.body.demoToken, password: 'NewPassword2027' });
    expect(reuse.status).toBe(400);
    expect((await as(login.body.token).get('/auth/me')).status).toBe(401);
    const relog = await request(app).post('/api/v1/auth/login').send({ email, password: 'NewPassword2026' });
    expect(relog.status).toBe(200);
    // restore
    const bcrypt = (await import('bcryptjs')).default;
    await pool.query(`UPDATE users SET password_hash = $1 WHERE email = $2`, [await bcrypt.hash(DEMO.facilityManager.password, 10), email]);
  });

  it('logout revokes the session', async () => {
    const token = await otpLogin(DEMO.tenant.mobile, true);
    expect((await as(token).get('/auth/me')).status).toBe(200);
    expect((await as(token).post('/auth/logout')).status).toBe(200);
    expect((await as(token).get('/auth/me')).status).toBe(401);
    await otpLogin(DEMO.tenant.mobile, true);
  });

  it('requires the CSRF client header for cookie-authenticated mutations', async () => {
    await pool.query(`DELETE FROM otp_codes WHERE mobile = $1`, [DEMO.resident.mobile]);
    const r1 = await request(app).post('/api/v1/auth/otp/request').send({ mobile: DEMO.resident.mobile });
    const r2 = await request(app).post('/api/v1/auth/otp/verify').send({ mobile: DEMO.resident.mobile, code: r1.body.demoCode });
    const cookie = r2.headers['set-cookie'][0].split(';')[0];
    const noHeader = await request(app).post('/api/v1/notifications/read-all').set('Cookie', cookie);
    expect(noHeader.status).toBe(403);
    const withHeader = await request(app).post('/api/v1/notifications/read-all').set('Cookie', cookie).set('X-SocietyOne-Client', 'web');
    expect(withHeader.status).toBe(200);
  });
});
