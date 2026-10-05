/**
 * Critical end-to-end workflows at the API level (Phase 1 success criteria).
 */
import { describe, expect, it } from 'vitest';
import { addDays, admin, as, DEMO, guard, latestNotification, otpLogin, pool, PNG, resident, spouse, tenant, todayIST } from './helpers.js';

describe('Visitor workflow: invite → QR/OTP → check-in → notification → check-out → history', () => {
  it('runs end to end', async () => {
    const r = await resident();
    const g = await guard();
    const created = await r.post('/visitors/invites', {
      visitorName: 'Ahmed Khan Test', mobile: '9876501299', visitDate: todayIST(), expectedArrival: '20:00', windowStart: '00:00', windowEnd: '23:59',
      purpose: 'Dinner', guestCount: 2, vehicleNumber: 'ts 09 ek 4521',
    });
    expect(created.status).toBe(201);
    const pass = created.body.pass;
    expect(pass.passCode).toMatch(/^VIS-\d{6}$/);
    expect(pass.otp).toMatch(/^\d{6}$/);
    expect(pass.qrSvg).toContain('<svg');
    expect(pass.vehicleNumber).toBe('TS09EK4521');
    expect(pass.flatNumber).toBe('A-1204');

    // Guard validates via QR
    const v = await g.post('/gate/verify', { qr: pass.qrToken });
    expect(v.status).toBe(200);
    expect(v.body.invite.visitorName).toBe('Ahmed Khan Test');
    expect(v.body.invite.validity.valid).toBe(true);
    expect(v.body.invite.visitorMobileMasked).toBe('•••••1299'); // data minimisation
    // ...and via OTP
    expect((await g.post('/gate/verify', { otp: pass.otp })).body.invite.id).toBe(pass.id);
    // Forged QR is rejected
    expect((await g.post('/gate/verify', { qr: pass.qrToken.slice(0, -3) + 'AAA' })).status).toBe(404);

    const ci = await g.post(`/gate/invites/${pass.id}/check-in`, {});
    expect(ci.status).toBe(201);
    const note = await latestNotification(DEMO.resident.mobile, 'visitor_checked_in');
    expect(note.body).toContain('Ahmed Khan Test');
    expect(note.body).toContain('Gate 1');
    // Also the other family member of the flat
    expect((await latestNotification(DEMO.residentSpouse.mobile, 'visitor_checked_in')).entity_id).toBe(ci.body.entry.id);

    // A one-time pass cannot be used twice while inside
    expect((await g.post(`/gate/invites/${pass.id}/check-in`, {})).status).toBe(409);
    const inside = await g.get('/gate/inside');
    expect(inside.body.inside.some((e: any) => e.id === ci.body.entry.id)).toBe(true);

    const co = await g.post(`/gate/entries/${ci.body.entry.id}/check-out`, {});
    expect(co.status).toBe(200);
    expect((await latestNotification(DEMO.resident.mobile, 'visitor_checked_out')).entity_id).toBe(ci.body.entry.id);
    const after = await r.get(`/visitors/invites/${pass.id}`);
    expect(after.body.pass.status).toBe('completed');
    expect((await g.post('/gate/verify', { qr: pass.qrToken })).body.invite.validity.valid).toBe(false);

    const hist = await r.get('/visitors/history?q=Ahmed Khan Test');
    expect(hist.body.entries[0].status).toBe('checked_out');
    expect(hist.body.entries[0].checked_out_at).toBeTruthy();
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1`, [ci.body.entry.id]);
    expect(audit.rows.map((x) => x.action)).toEqual(expect.arrayContaining(['gate.visitor_checked_in', 'gate.visitor_checked_out']));
  });

  it('refuses passes outside their validity window and cancelled passes', async () => {
    const r = await resident();
    const g = await guard();
    const future = await r.post('/visitors/invites', { visitorName: 'Tomorrow Guest', visitDate: addDays(todayIST(), 1), expectedArrival: '12:00', purpose: 'Visit' });
    const v = await g.post('/gate/verify', { passCode: future.body.pass.passCode });
    expect(v.body.invite.validity.valid).toBe(false);
    expect((await g.post(`/gate/invites/${future.body.pass.id}/check-in`, {})).status).toBe(409);
    expect((await r.post(`/visitors/invites/${future.body.pass.id}/cancel`)).status).toBe(200);
    expect((await g.post('/gate/verify', { passCode: future.body.pass.passCode })).body.invite.validity.reason).toMatch(/cancelled/);
    expect((await r.post('/visitors/invites', { visitorName: 'Past', visitDate: addDays(todayIST(), -1), expectedArrival: '12:00', purpose: 'x' })).status).toBe(400);
  });

  it('supports recurring passes', async () => {
    const r = await resident();
    const g = await guard();
    const rec = await r.post('/visitors/invites', { visitorName: 'Daily Cook', visitDate: todayIST(), expectedArrival: '08:00', windowStart: '00:00', windowEnd: '23:59', purpose: 'Cook', visitType: 'recurring', validUntil: addDays(todayIST(), 30), recurrenceDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(rec.status).toBe(201);
    const ci = await g.post(`/gate/invites/${rec.body.pass.id}/check-in`, {});
    expect(ci.status).toBe(201);
    await g.post(`/gate/entries/${ci.body.entry.id}/check-out`, {});
    // Still valid after use
    expect((await g.post('/gate/verify', { otp: rec.body.pass.otp })).body.invite.validity.valid).toBe(true);
  });
});

describe('Unexpected visitor workflow: guard request → resident approves → guard confirmation → check-in', () => {
  it('requires approval before check-in', async () => {
    const g = await guard();
    const r = await resident();
    const flat = (await g.get('/gate/search?q=A-1204')).body.flats[0];
    expect(flat.number).toBe('A-1204');
    expect(flat.residents).toContain('Ananya S.'); // minimised names
    const req = await g.post('/gate/approvals', { visitorName: 'Suresh Plumber', mobile: '9000011111', flatId: flat.id, purpose: 'Plumbing work' });
    expect(req.status).toBe(201);
    const id = req.body.approval.id;
    expect(req.body.approval.status).toBe('pending');
    // Not allowed before approval
    expect((await g.post(`/gate/approvals/${id}/check-in`, {})).status).toBe(409);
    const n = await latestNotification(DEMO.resident.mobile, 'visitor_approval_requested');
    expect(n.body).toContain('Suresh Plumber');
    expect(n.body).toContain('Gate 1');
    // Resident sees it on home and approves
    const home = await r.get('/home');
    expect(home.body.pendingApprovals.some((a: any) => a.id === id)).toBe(true);
    const ap = await r.post(`/visitors/approvals/${id}/respond`, { decision: 'approve' });
    expect(ap.body.status).toBe('approved');
    // Second response is rejected (already handled by a family member)
    expect((await (await spouse()).post(`/visitors/approvals/${id}/respond`, { decision: 'reject' })).status).toBe(409);
    // Guard receives confirmation
    expect((await g.get(`/gate/approvals/${id}`)).body.approval.status).toBe('approved');
    const gn = await latestNotification(DEMO.guard.mobile, 'visitor_approval_responded');
    expect(gn.entity_id).toBe(id);
    const ci = await g.post(`/gate/approvals/${id}/check-in`, {});
    expect(ci.status).toBe(201);
    expect((await g.post(`/gate/approvals/${id}/check-in`, {})).status).toBe(409);
  });

  it('blocks entry when the resident rejects, and other flats cannot respond', async () => {
    const g = await guard();
    const flat = (await g.get('/gate/search?q=A-1204')).body.flats[0];
    const req = await g.post('/gate/approvals', { visitorName: 'Unknown Salesman', flatId: flat.id, purpose: 'Sales' });
    const id = req.body.approval.id;
    expect((await (await tenant()).post(`/visitors/approvals/${id}/respond`, { decision: 'approve' })).status).toBe(403);
    await (await resident()).post(`/visitors/approvals/${id}/respond`, { decision: 'reject' });
    const ci = await g.post(`/gate/approvals/${id}/check-in`, {});
    expect(ci.status).toBe(409);
    expect(ci.body.error.message).toMatch(/rejected/);
  });

  it('expires unanswered approvals', async () => {
    const g = await guard();
    const flat = (await g.get('/gate/search?q=A-1204')).body.flats[0];
    const req = await g.post('/gate/approvals', { visitorName: 'Late Visitor', flatId: flat.id, purpose: 'Visit' });
    await pool.query(`UPDATE visitor_approvals SET expires_at = now() - interval '1 minute' WHERE id = $1`, [req.body.approval.id]);
    expect((await (await resident()).post(`/visitors/approvals/${req.body.approval.id}/respond`, { decision: 'approve' })).status).toBe(409);
  });
});

describe('Delivery, cab and domestic staff entries', () => {
  it('records a Swiggy delivery and notifies the flat', async () => {
    const g = await guard();
    const flat = (await g.get('/gate/search?q=A-1204')).body.flats[0];
    const res = await g.post('/gate/entries/quick', { category: 'food_delivery', provider: 'Swiggy', flatId: flat.id });
    expect(res.status).toBe(201);
    const n = await latestNotification(DEMO.resident.mobile, 'delivery_arrived');
    expect(n.body).toBe('Your Swiggy food delivery has arrived at Gate 1.');
    expect((await g.post(`/gate/entries/${res.body.entry.id}/check-out`, {})).status).toBe(200);
  });

  it('records cabs without a flat and domestic staff with a name', async () => {
    const g = await guard();
    expect((await g.post('/gate/entries/quick', { category: 'cab', provider: 'Uber', vehicleNumber: 'TS07UB1234' })).status).toBe(201);
    const flat = (await g.get('/gate/search?q=A-1204')).body.flats[0];
    expect((await g.post('/gate/entries/quick', { category: 'domestic_staff', flatId: flat.id })).status).toBe(400);
    expect((await g.post('/gate/entries/quick', { category: 'domestic_staff', flatId: flat.id, visitorName: 'Lakshmamma (Cook)' })).status).toBe(201);
  });

  it('is safe to replay from the offline queue (idempotency)', async () => {
    const g = await guard();
    const flat = (await g.get('/gate/search?q=A-1204')).body.flats[0];
    const body = { category: 'delivery', provider: 'Amazon', flatId: flat.id, leaveAtGate: true, clientRef: 'offline-ref-0001' };
    const a1 = await g.post('/gate/entries/quick', body);
    const a2 = await g.post('/gate/entries/quick', body);
    expect(a1.body.entry.id).toBe(a2.body.entry.id);
    const n = await pool.query(`SELECT count(*)::int AS n FROM visitor_entries WHERE client_ref = 'offline-ref-0001'`);
    expect(n.rows[0].n).toBe(1);
  });
});

describe('Complaint workflow: create with photo → admin assigns → status updates → resolve → confirm → rate', () => {
  it('runs end to end', async () => {
    const r = await resident();
    const a = await admin();
    const created = await r
      .raw('post', '/complaints')
      .field('category', 'plumbing')
      .field('subcategory', 'Leakage')
      .field('title', 'Bathroom tap leaking')
      .field('description', 'The wash basin tap leaks continuously.')
      .field('location', 'Master bathroom')
      .field('priority', 'high')
      .attach('photos', PNG, 'tap.png');
    expect(created.status).toBe(201);
    const c = created.body.complaint;
    expect(c.number).toMatch(/^SOC-INC-\d{4,}$/);
    expect(c.photos).toHaveLength(1);
    expect((await latestNotification(DEMO.admin.mobile, 'complaint_created')).entity_id).toBe(c.id);

    const list = await a.get('/complaints?status=open&category=plumbing');
    expect(list.body.complaints.some((x: any) => x.id === c.id)).toBe(true);
    const meta = await a.get('/complaints/meta');
    const fm = meta.body.staff.find((s: any) => s.role === 'facility_manager');

    const assign = await a.patch(`/complaints/${c.id}`, { assignedTo: fm.id, assigneeName: 'Ramu (Plumber)' });
    expect(assign.body.changes.status).toBe('assigned');
    expect((await latestNotification(DEMO.resident.mobile, 'complaint_assigned')).body).toContain('Ramu (Plumber)');

    expect((await a.patch(`/complaints/${c.id}`, { status: 'in_progress', note: 'Spare washer needed', noteVisibility: 'internal' })).status).toBe(200);
    expect((await latestNotification(DEMO.resident.mobile, 'complaint_status_changed')).title).toContain('In progress');
    // Internal note hidden from resident
    const rv = await r.get(`/complaints/${c.id}`);
    expect(rv.body.comments.some((x: any) => x.body.includes('Spare washer'))).toBe(false);
    expect((await a.get(`/complaints/${c.id}`)).body.comments.some((x: any) => x.body.includes('Spare washer'))).toBe(true);

    // Resident comments with an extra photo
    const cm = await r.raw('post', `/complaints/${c.id}/comments`).field('body', 'Technician can come after 5 PM').attach('photos', PNG, 'more.png');
    expect(cm.status).toBe(201);
    expect((await r.post(`/complaints/${c.id}/comments`, { body: 'x', visibility: 'internal' })).status).toBe(403);

    // Invalid transition
    expect((await a.patch(`/complaints/${c.id}`, { status: 'open' })).status).toBe(409);
    // Resident cannot rate before resolution
    expect((await r.post(`/complaints/${c.id}/rate`, { rating: 5 })).status).toBe(409);

    expect((await a.patch(`/complaints/${c.id}`, { status: 'resolved', note: 'Washer replaced.' })).status).toBe(200);
    expect((await latestNotification(DEMO.resident.mobile, 'complaint_resolved')).entity_id).toBe(c.id);

    expect((await r.post(`/complaints/${c.id}/confirm`)).body.status).toBe('closed');
    expect((await r.post(`/complaints/${c.id}/rate`, { rating: 5, feedback: 'Quick and clean work' })).status).toBe(200);
    expect((await r.post(`/complaints/${c.id}/rate`, { rating: 4 })).status).toBe(409);

    const final = (await a.get(`/complaints/${c.id}`)).body.complaint;
    expect(final.status).toBe('closed');
    expect(final.rating).toBe(5);
    for (const t of ['created_at', 'assigned_at', 'in_progress_at', 'resolved_at', 'closed_at']) expect(final[t], t).toBeTruthy();
    const history = (await a.get(`/complaints/${c.id}`)).body.history.map((h: any) => h.to_status);
    expect(history).toEqual(['open', 'assigned', 'in_progress', 'resolved', 'closed']);
  });

  it('lets residents reopen an unresolved issue', async () => {
    const r = await resident();
    const a = await admin();
    const c = (await r.post('/complaints', { category: 'electrical', title: 'Socket sparking', description: 'Kitchen socket sparks when plugged in', priority: 'urgent' })).body.complaint;
    await a.patch(`/complaints/${c.id}`, { assigneeName: 'Srinu (Electrician)' });
    await a.patch(`/complaints/${c.id}`, { status: 'resolved' });
    const re = await r.post(`/complaints/${c.id}/reopen`, { reason: 'Still sparking' });
    expect(re.body.status).toBe('assigned');
    const after = (await a.get(`/complaints/${c.id}`)).body.complaint;
    expect(after.reopen_count).toBe(1);
  });
});

describe('Facility workflow: availability → book → slot unavailable to others → cancel → available again', () => {
  it('runs end to end and prevents double booking', async () => {
    const r = await resident();
    const t = await tenant();
    const fac = (await r.get('/facilities')).body.facilities.find((f: any) => f.name === 'Badminton Court');
    const date = addDays(todayIST(), 2);
    const avail = await r.get(`/facilities/${fac.id}/availability?date=${date}`);
    const slot = avail.body.slots.find((s: any) => s.startTime === '07:00');
    expect(slot.status).toBe('available');

    const booked = await r.post(`/facilities/${fac.id}/bookings`, { date, startTime: '07:00' });
    expect(booked.status).toBe(201);
    expect(booked.body.booking).toMatchObject({ facilityName: 'Badminton Court', date, startTime: '07:00', endTime: '08:00', status: 'confirmed' });
    expect((await latestNotification(DEMO.resident.mobile, 'booking_confirmed')).body).toContain('Badminton Court');

    const forTenant = await t.get(`/facilities/${fac.id}/availability?date=${date}`);
    expect(forTenant.body.slots.find((s: any) => s.startTime === '07:00').status).toBe('booked');
    expect((await r.get(`/facilities/${fac.id}/availability?date=${date}`)).body.slots.find((s: any) => s.startTime === '07:00').status).toBe('mine');
    const clash = await t.post(`/facilities/${fac.id}/bookings`, { date, startTime: '07:00' });
    expect(clash.status).toBe(409);

    const mine = await r.get('/bookings/mine');
    expect(mine.body.bookings.some((b: any) => b.id === booked.body.booking.id)).toBe(true);

    const cancel = await r.post(`/bookings/${booked.body.booking.id}/cancel`, {});
    expect(cancel.body.booking.status).toBe('cancelled');
    expect((await t.get(`/facilities/${fac.id}/availability?date=${date}`)).body.slots.find((s: any) => s.startTime === '07:00').status).toBe('available');
    expect((await t.post(`/facilities/${fac.id}/bookings`, { date, startTime: '07:00' })).status).toBe(201);
  });

  it('serialises concurrent attempts so only one resident gets the slot', async () => {
    const r = await resident();
    const t = await tenant();
    const extraToken = await otpLogin((await pool.query(`SELECT u.mobile FROM users u JOIN residents re ON re.user_id = u.id JOIN resident_flat_relationships x ON x.resident_id = re.id AND x.is_primary JOIN flats f ON f.id = x.flat_id WHERE f.number = 'C-805'`)).rows[0]?.mobile ?? DEMO.residentSpouse.mobile);
    const fac = (await r.get('/facilities')).body.facilities.find((f: any) => f.name === 'Tennis Court');
    const date = addDays(todayIST(), 3);
    const results = await Promise.all([r, t, as(extraToken)].map((c) => c.post(`/facilities/${fac.id}/bookings`, { date, startTime: '18:00' })));
    const codes = results.map((x) => x.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409).length).toBe(results.length - 1);
  });

  it('enforces booking rules (advance window, duration, past slots)', async () => {
    const r = await resident();
    const fac = (await r.get('/facilities')).body.facilities.find((f: any) => f.name === 'Meeting Room');
    expect((await r.post(`/facilities/${fac.id}/bookings`, { date: addDays(todayIST(), 30), startTime: '10:00' })).status).toBe(400);
    expect((await r.post(`/facilities/${fac.id}/bookings`, { date: addDays(todayIST(), 1), startTime: '10:00', durationMinutes: 240 })).status).toBe(400);
    expect((await r.post(`/facilities/${fac.id}/bookings`, { date: addDays(todayIST(), 1), startTime: '10:30' })).status).toBe(400);
    const two = await r.post(`/facilities/${fac.id}/bookings`, { date: addDays(todayIST(), 1), startTime: '10:00', durationMinutes: 120 });
    expect(two.status).toBe(201);
    expect(two.body.booking.endTime).toBe('12:00');
  });
});

describe('Announcement workflow: publish → residents notified → appears on dashboard', () => {
  it('notifies relevant residents and shows on home', async () => {
    const a = await admin();
    const r = await resident();
    const res = await a.post('/announcements', { title: 'Swimming pool closed for cleaning', body: 'The pool will be closed on Wednesday for deep cleaning.', category: 'maintenance', priority: 'important' });
    expect(res.status).toBe(201);
    expect(res.body.recipients).toBeGreaterThan(1000);
    expect((await latestNotification(DEMO.resident.mobile, 'announcement_new')).entity_id).toBe(res.body.announcement.id);
    expect((await r.get('/home')).body.announcement.id).toBe(res.body.announcement.id);
    expect((await r.get('/announcements')).body.announcements[0].id).toBe(res.body.announcement.id);
  });

  it('targets towers, schedules future posts, and prioritises emergencies', async () => {
    const a = await admin();
    const towers = (await a.get('/structure/towers')).body.towers;
    const towerB = towers.find((t: any) => t.code === 'B').id;
    const targeted = await a.post('/announcements', { title: 'Tower B lift upgrade', body: 'Lift 1 in Tower B will be upgraded.', audience: 'towers', towerIds: [towerB] });
    const r = await resident(); // Tower A
    const t = await tenant(); // Tower B
    expect((await r.get('/announcements')).body.announcements.some((x: any) => x.id === targeted.body.announcement.id)).toBe(false);
    expect((await t.get('/announcements')).body.announcements.some((x: any) => x.id === targeted.body.announcement.id)).toBe(true);

    const later = await a.post('/announcements', { title: 'Scheduled notice', body: 'This goes out later.', publishAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(later.body.recipients).toBe(0);
    expect((await r.get('/announcements')).body.announcements.some((x: any) => x.id === later.body.announcement.id)).toBe(false);
    await pool.query(`UPDATE announcements SET publish_at = now() - interval '1 second' WHERE id = $1`, [later.body.announcement.id]);
    const { runJobs } = await import('../src/jobs.js');
    await runJobs();
    expect((await latestNotification(DEMO.resident.mobile, 'announcement_new')).entity_id).toBe(later.body.announcement.id);

    const em = await a.post('/announcements', { title: 'Gas leak near Tower C', body: 'Evacuate Tower C ground floor immediately.', category: 'emergency', priority: 'emergency' });
    const home = await r.get('/home');
    expect(home.body.emergencies[0].id).toBe(em.body.announcement.id);
    expect(home.body.announcement.id).toBe(em.body.announcement.id);
    const n = await latestNotification(DEMO.resident.mobile, 'announcement_emergency');
    expect(n.priority).toBe('emergency');
    // Guards also receive emergency announcements
    expect((await latestNotification(DEMO.guard.mobile, 'announcement_emergency')).entity_id).toBe(em.body.announcement.id);
    await a.delete(`/announcements/${em.body.announcement.id}`);
  });

  it('honours notification preferences (but never for emergencies)', async () => {
    const t = await tenant();
    const a = await admin();
    await t.put('/profile/notification-preferences', { preferences: [{ category: 'announcements', inApp: false, push: false }] });
    const quiet = await a.post('/announcements', { title: 'Quiet notice', body: 'Should not notify the tenant' });
    const got = await pool.query(`SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.mobile = $1 AND n.entity_id = $2`, [DEMO.tenant.mobile, quiet.body.announcement.id]);
    expect(got.rowCount).toBe(0);
    const em = await a.post('/announcements', { title: 'Emergency drill', body: 'Fire drill now', priority: 'emergency', category: 'emergency' });
    const got2 = await pool.query(`SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.mobile = $1 AND n.entity_id = $2`, [DEMO.tenant.mobile, em.body.announcement.id]);
    expect(got2.rowCount).toBe(1);
    await a.delete(`/announcements/${em.body.announcement.id}`);
    await t.put('/profile/notification-preferences', { preferences: [{ category: 'announcements', inApp: true, push: true }] });
  });
});

describe('Society onboarding (super admin → admin → structure → residents → guards)', () => {
  it('lets a new society register and onboard people', async () => {
    const { superAdmin } = await import('./helpers.js');
    const s = await superAdmin();
    const created = await s.post('/platform/societies', {
      name: 'Aparna Sarovar Test', code: 'APST', addressLine1: 'Nallagandla', city: 'Hyderabad', state: 'Telangana', pinCode: '500019',
      admin: { fullName: 'Test Admin', email: 'admin@apst.example.in', mobile: '9555500001' },
    });
    expect(created.status).toBe(201);
    expect(created.body.demoInviteLink).toContain('/reset-password?token=');
    const a = as(await otpLogin('+919555500001', true));
    expect((await a.get('/auth/me')).body.role).toBe('admin');
    const tower = await a.post('/structure/towers', { name: 'Block 1', code: 'B1', floorFrom: 1, floorTo: 10 });
    expect(tower.status).toBe(201);
    const bulk = await a.post('/structure/flats/bulk', { towerId: tower.body.id, floorFrom: 1, floorTo: 10, flatsPerFloor: 4, flatType: '2BHK' });
    expect(bulk.body.created).toBe(40);
    const again = await a.post('/structure/flats/bulk', { towerId: tower.body.id, floorFrom: 1, floorTo: 10, flatsPerFloor: 4 });
    expect(again.body.created).toBe(0);
    const flat = (await a.get('/structure/flats?q=B1-1003')).body.flats[0];
    expect(flat.number).toBe('B1-1003');
    const res = await a.post('/residents', { fullName: 'New Resident', mobile: '9555500002', flatId: flat.id, relation: 'owner', isPrimary: true });
    expect(res.status).toBe(201);
    expect((await a.get(`/structure/flats/${flat.id}`)).body.flat.occupancy_status).toBe('owner_occupied');
    const gates = (await a.get('/society/gates')).body.gates;
    const g = await a.post('/guards', { fullName: 'New Guard', mobile: '9555500003', defaultGateId: gates[0].id });
    expect(g.status).toBe(201);
    const nr = as(await otpLogin('+919555500002', true));
    expect((await nr.get('/auth/me')).body.flats[0].number).toBe('B1-1003');
    const ng = as(await otpLogin('+919555500003', true));
    expect((await ng.get('/auth/me')).body.home).toBe('/guard');

    // Removing a resident revokes their access immediately
    await a.delete(`/residents/${res.body.residentId}`);
    expect((await nr.get('/home')).status).toBe(401);

    // Deactivating the society blocks its users
    await s.patch(`/platform/societies/${created.body.society.id}`, { status: 'inactive' });
    expect((await a.get('/dashboard')).status).toBe(401);
    const blocked = await (async () => {
      await pool.query(`DELETE FROM otp_codes WHERE mobile = '+919555500001'`);
      try { await otpLogin('+919555500001', true); return false; } catch { return true; }
    })();
    expect(blocked).toBe(true);
  });
});

describe('Admin dashboard', () => {
  it('returns operational cards and charts for each range', async () => {
    const a = await admin();
    for (const range of ['today', '7d', '30d']) {
      const d = await a.get(`/dashboard?range=${range}`);
      expect(d.status).toBe(200);
      expect(d.body.cards.total_flats).toBe(640);
      expect(d.body.cards.residents).toBeGreaterThan(1000);
      expect(d.body.visitorSeries.length).toBe(range === 'today' ? 24 : range === '7d' ? 7 : 30);
    }
  });

  it('search tolerates partial matches', async () => {
    const a = await admin();
    const s = await a.get('/search?q=anany');
    expect(s.body.residents.some((x: any) => x.full_name === 'Ananya Sharma')).toBe(true);
    const g = await guard();
    const gs = await g.get('/gate/search?q=1204');
    expect(gs.body.flats.map((f: any) => f.number)).toEqual(expect.arrayContaining(['A-1204', 'B-1204']));
    // Guards never see resident mobile numbers
    expect(JSON.stringify(gs.body)).not.toMatch(/\+919848012345/);
    const r = await resident();
    const rs = await r.get('/search?q=badmin');
    expect(rs.body.facilities[0].name).toBe('Badminton Court');
  });
});
