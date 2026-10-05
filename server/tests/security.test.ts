import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { admin, app, as, guard, otherAdmin, otherResident, pool, resident, superAdmin, tenant, PNG, DEMO, todayIST } from './helpers.js';

describe('Role-based access control', () => {
  it('guards cannot reach administrative, financial or resident-private data', async () => {
    const g = await guard();
    for (const url of ['/residents', '/structure/flats', '/dashboard', '/audit', '/complaints', '/bookings', '/visitors/admin/entries', '/platform/stats', '/search?q=sharma']) {
      expect([403], url).toContain((await g.get(url)).status);
    }
  });

  it('residents cannot access management or platform APIs', async () => {
    const r = await resident();
    for (const url of ['/residents', '/structure/towers', '/dashboard', '/audit', '/guards', '/bookings', '/platform/societies', '/gate/expected']) {
      expect((await r.get(url)).status, url).toBe(403);
    }
    expect((await r.patch('/society', { name: 'Hacked' })).status).toBe(403);
  });

  it('super admin cannot browse resident data of a society', async () => {
    const s = await superAdmin();
    expect((await s.get('/residents')).status).toBe(403);
    expect((await s.get('/complaints')).status).toBe(403);
    expect((await s.get('/visitors/admin/entries')).status).toBe(403);
    const stats = await s.get('/platform/stats');
    expect(stats.status).toBe(200);
    expect(JSON.stringify(stats.body)).not.toMatch(/Sharma|\+91/);
    const list = await s.get('/platform/societies');
    expect(JSON.stringify(list.body)).not.toMatch(/Ananya/);
  });

  it('residents cannot read another flat’s complaints or passes', async () => {
    const t = await tenant(); // B-1204
    const r = await resident(); // A-1204
    const mine = await r.get('/complaints');
    const target = mine.body.complaints[0];
    expect((await t.get(`/complaints/${target.id}`)).status).toBe(404);
    const invites = await r.get('/visitors/invites');
    expect((await t.get(`/visitors/invites/${invites.body.invites[0].id}`)).status).toBe(403);
    // and cannot create a pass for someone else's flat
    const flatA = invites.body.invites[0];
    void flatA;
    const otherFlat = (await pool.query(`SELECT id FROM flats WHERE number = 'A-1204'`)).rows[0].id;
    const bad = await t.post('/visitors/invites', { flatId: otherFlat, visitorName: 'Test', visitDate: todayIST(), expectedArrival: '23:00', purpose: 'x' });
    expect(bad.status).toBe(403);
  });

  it('residents may edit only limited profile fields', async () => {
    const r = await resident();
    const res = await r.patch('/profile', { flatId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
  });
});

describe('Tenant (society) isolation', () => {
  it('an admin of another society cannot see or modify Green Meadows records', async () => {
    const lv = await otherAdmin();
    const gm = await admin();
    const gmComplaint = (await gm.get('/complaints')).body.complaints[0];
    const gmFlat = (await gm.get('/structure/flats?q=A-1204')).body.flats[0];
    const gmResident = (await gm.get('/residents?q=Ananya')).body.residents[0];
    expect((await lv.get(`/complaints/${gmComplaint.id}`)).status).toBe(404);
    expect((await lv.patch(`/complaints/${gmComplaint.id}`, { status: 'closed' })).status).toBe(404);
    expect((await lv.get(`/structure/flats/${gmFlat.id}`)).status).toBe(404);
    expect((await lv.get(`/residents/${gmResident.id}`)).status).toBe(404);
    expect((await lv.delete(`/residents/${gmResident.id}`)).status).toBe(404);
    const lvComplaints = (await lv.get('/complaints')).body.complaints;
    expect(lvComplaints.every((c: any) => c.number.startsWith('LVH'))).toBe(true);
    const dash = await lv.get('/dashboard');
    expect(dash.body.cards.total_flats).toBe(20);
    const search = await lv.get('/search?q=Sharma');
    expect(search.body.residents).toHaveLength(0);
  });

  it('a resident of another society cannot use Green Meadows passes, facilities or announcements', async () => {
    const lvr = await otherResident();
    const r = await resident();
    const inv = (await r.get('/visitors/invites')).body.invites[0];
    expect((await lvr.get(`/visitors/invites/${inv.id}`)).status).toBe(404);
    const facilities = (await r.get('/facilities')).body.facilities;
    expect((await lvr.get(`/facilities/${facilities[0].id}`)).status).toBe(404);
    const anns = (await lvr.get('/announcements')).body.announcements;
    expect(anns.every((a: any) => a.title.includes('Lakeview'))).toBe(true);
  });

  it('a Green Meadows guard cannot validate another society’s pass', async () => {
    const lvr = await otherResident();
    const created = await lvr.post('/visitors/invites', { visitorName: 'Cross Society', visitDate: todayIST(), expectedArrival: '23:00', windowStart: '00:00', windowEnd: '23:59', purpose: 'test' });
    expect(created.status).toBe(201);
    const g = await guard();
    expect((await g.post('/gate/verify', { qr: created.body.pass.qrToken })).status).toBe(404);
    expect((await g.post('/gate/verify', { otp: created.body.pass.otp })).status).toBe(404);
  });

  it('uploaded files are only served to members of the owning society', async () => {
    const r = await resident();
    const up = await r.raw('post', '/complaints').field('category', 'other').field('title', 'Photo isolation').field('description', 'Testing file isolation').attach('photos', PNG, 'p.png');
    expect(up.status).toBe(201);
    const url = up.body.complaint.photos[0].url.replace('/api/v1', '');
    expect((await r.get(url)).status).toBe(200);
    expect((await (await otherAdmin()).get(url)).status).toBe(403);
    expect((await (await tenant()).get(url)).status).toBe(403); // same society, different flat
    expect((await (await guard()).get(url)).status).toBe(403);
  });
});

describe('Input & upload validation', () => {
  it('rejects non-image uploads by content, not extension', async () => {
    const r = await resident();
    const bad = await r.raw('post', '/complaints').field('category', 'other').field('title', 'Bad file').field('description', 'Trying a script').attach('photos', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.png', contentType: 'image/png' });
    expect(bad.status).toBe(400);
  });

  it('returns safe validation errors without leaking SQL', async () => {
    const r = await resident();
    const res = await r.get(`/complaints/not-a-uuid`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/select|syntax|postgres/i);
  });

  it('treats search input as data (no LIKE/SQL injection)', async () => {
    const a = await admin();
    const res = await a.get(`/residents?q=${encodeURIComponent("%' OR 1=1 --")}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('Audit log', () => {
  it('cannot be modified or deleted, even directly in the database', async () => {
    const row = (await pool.query(`SELECT id FROM audit_logs LIMIT 1`)).rows[0];
    await expect(pool.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = $1`, [row.id])).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM audit_logs WHERE id = $1`, [row.id])).rejects.toThrow(/append-only/);
  });

  it('is readable by society admins only, scoped to their society', async () => {
    const a = await admin();
    const logs = await a.get('/audit');
    expect(logs.status).toBe(200);
    expect(logs.body.total).toBeGreaterThan(0);
    const lv = await otherAdmin();
    const lvLogs = await lv.get('/audit');
    expect(lvLogs.body.logs.every((l: any) => !String(l.summary ?? '').includes('Green Meadows'))).toBe(true);
  });

  it('records actor, role, old/new values and request metadata', async () => {
    const a = await admin();
    const c = (await a.get('/complaints?status=open')).body.complaints[0];
    await a.patch(`/complaints/${c.id}`, { priority: 'urgent' });
    const log = (await pool.query(`SELECT * FROM audit_logs WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [c.id])).rows[0];
    expect(log.actor_role).toBe('admin');
    expect(log.new_values.priority).toBe('urgent');
    expect(log.old_values.priority).toBeTruthy();
    expect(log.ip).toBeTruthy();
    void DEMO;
  });
});
