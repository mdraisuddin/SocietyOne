/**
 * Demo data: Green Meadows Residential Society, Hyderabad (+ a second society, Lakeview Heights,
 * used to demonstrate and test tenant isolation).
 *
 *   npm run db:reset   # drop, migrate and seed
 */
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { pool, tx } from './pool.js';
import { migrate } from './migrate.js';
import { addDays, localDate, localTime, zonedToUtc, fromMinutes, toMinutes } from '../core/time.js';
import { randomDigits } from '../core/crypto.js';

const TZ = 'Asia/Kolkata';

export const DEMO = {
  superAdmin: { name: 'Arjun Mehta', email: 'superadmin@societyone.in', mobile: '+919000000001', password: 'SocietyOne@2026' },
  admin: { name: 'Kavitha Reddy', email: 'admin@greenmeadows.in', mobile: '+919000000002', password: 'GreenMeadows@2026' },
  facilityManager: { name: 'Mohammed Irfan', email: 'fm@greenmeadows.in', mobile: '+919000000005', password: 'GreenMeadows@2026' },
  resident: { name: 'Ananya Sharma', mobile: '+919848012345', email: 'ananya.sharma@example.in', flat: 'A-1204' },
  residentSpouse: { name: 'Rohit Sharma', mobile: '+919848012346', flat: 'A-1204' },
  tenant: { name: 'Vikram Iyer', mobile: '+919000000004', flat: 'B-1204' },
  guard: { name: 'Ramesh Yadav', mobile: '+919000000003' },
  guard2: { name: 'Shaik Basha', mobile: '+919000000006' },
  otherAdmin: { name: 'Deepak Agarwal', email: 'admin@lakeviewheights.in', mobile: '+919000000010', password: 'Lakeview@2026' },
  otherResident: { name: 'Sneha Kulkarni', mobile: '+919000000011', flat: 'L1-301' },
};

// Deterministic PRNG so demo data is stable between resets.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261005);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const chance = (p: number) => rand() < p;

const MALE = ['Rahul', 'Srinivas', 'Venkat', 'Ravi', 'Karthik', 'Suresh', 'Mahesh', 'Arvind', 'Imran', 'Syed', 'Farhan', 'Naveen', 'Kiran', 'Prakash', 'Sandeep',
  'Anil', 'Rajesh', 'Harish', 'Vamsi', 'Sai', 'Pranav', 'Abhishek', 'Nikhil', 'Joseph', 'Thomas', 'Sanjay', 'Gopal', 'Raghav', 'Aditya', 'Manoj', 'Yusuf', 'Sameer',
  'Chaitanya', 'Phani', 'Krishna', 'Bharat', 'Deepak', 'Vinod', 'Ashok', 'Tarun'];
const FEMALE = ['Priya', 'Lakshmi', 'Divya', 'Swathi', 'Sravani', 'Anusha', 'Keerthi', 'Pooja', 'Ayesha', 'Fatima', 'Sana', 'Meera', 'Kavya', 'Nandini', 'Shreya',
  'Harika', 'Bhavana', 'Deepika', 'Sowmya', 'Madhavi', 'Radhika', 'Anjali', 'Neha', 'Mary', 'Grace', 'Asha', 'Rekha', 'Padma', 'Sunitha', 'Zoya', 'Tanvi', 'Ishita'];
const SURNAMES = ['Reddy', 'Rao', 'Naidu', 'Chowdary', 'Sharma', 'Varma', 'Goud', 'Kumar', 'Iyer', 'Menon', 'Nair', 'Patel', 'Gupta', 'Agarwal', 'Jain', 'Khan',
  'Ahmed', 'Siddiqui', 'Hussain', 'Qureshi', 'Fernandes', "D'Souza", 'Thomas', 'Kulkarni', 'Deshpande', 'Joshi', 'Mehta', 'Bhat', 'Murthy', 'Prasad', 'Shetty',
  'Pillai', 'Banerjee', 'Das', 'Mishra', 'Yadav', 'Singh', 'Raju', 'Sastry', 'Kapoor'];
const VISITOR_NAMES = ['Ahmed Khan', 'Suresh Babu', 'Anitha Rao', 'Farooq Ali', 'Ramya Krishnan', 'Venu Gopal', 'Salma Begum', 'Prasanna Kumar', 'Lalitha Devi',
  'Rajiv Menon', 'Harsha Vardhan', 'Nazia Parveen', 'Gautham Reddy', 'Sirisha Varma', 'Imtiaz Hussain', 'Bhaskar Naidu', 'Uma Maheshwari', 'Arif Mohammed',
  'Sunil Joshi', 'Pavani Goud', 'Kishore Kumar', 'Rukhsar Fatima', 'Devendra Singh', 'Anuradha Iyer'];
const STAFF_NAMES = ['Saroja (Housekeeping)', 'Lakshmamma (Cook)', 'Raju (Driver)', 'Yadamma (Maid)', 'Venkatesh (Driver)', 'Parvathi (Nanny)', 'Mallesh (Car cleaner)', 'Anjamma (Maid)'];
const PURPOSES = ['Family visit', 'Friends dinner', 'Birthday party', 'Business meeting', 'Tuition', 'Relatives visiting', 'Interior designer', 'AC service', 'House help interview', 'Pooja ceremony'];

let mobileCounter = 0;
const usedMobiles = new Set<string>();
function newMobile() {
  for (;;) {
    mobileCounter++;
    const m = `+91${pick(['9', '8', '7', '6'])}${String(between(100000000, 999999999))}`;
    if (!usedMobiles.has(m) && !/^\+9190000000/.test(m)) {
      usedMobiles.add(m);
      return m;
    }
  }
}
const vehicle = () => `TS${String(between(1, 15)).padStart(2, '0')}${pick(['E', 'F', 'G', 'H', 'K', 'EA', 'EZ', 'FA', 'FK'])}${between(1000, 9999)}`;

async function insertMany(c: pg.PoolClient, table: string, cols: string[], rows: unknown[][], returning = 'id') {
  const out: any[] = [];
  const chunk = Math.floor(30000 / cols.length);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const values = slice.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(',')})`).join(',');
    const res = await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values} RETURNING ${returning}`, params);
    out.push(...res.rows);
  }
  return out;
}

export async function seed({ quiet = false } = {}) {
  const log = (...a: unknown[]) => !quiet && console.log(...a);
  const exists = await pool.query(`SELECT 1 FROM societies WHERE code = 'GMRS'`);
  if (exists.rowCount) {
    log('Demo data already present (run `npm run db:reset` to rebuild).');
    return;
  }
  const now = new Date();
  const today = localDate(now, TZ);
  const nowMin = toMinutes(localTime(now, TZ));
  const at = (date: string, time: string) => zonedToUtc(date, time, TZ);
  const hashAdmin = await bcrypt.hash(DEMO.admin.password, 10);
  const hashSuper = await bcrypt.hash(DEMO.superAdmin.password, 10);
  const hashOther = await bcrypt.hash(DEMO.otherAdmin.password, 10);

  await tx(async (c) => {
    // ---------------------------------------------------------------- platform
    const superAdmin = (
      await c.query(`INSERT INTO users (full_name, email, mobile, password_hash, platform_role) VALUES ($1,$2,$3,$4,'super_admin') RETURNING id`, [
        DEMO.superAdmin.name, DEMO.superAdmin.email, DEMO.superAdmin.mobile, hashSuper,
      ])
    ).rows[0].id;

    // ---------------------------------------------------------------- society
    const society = (
      await c.query(
        `INSERT INTO societies (name, code, address_line1, address_line2, city, state, pin_code, contact_phone, contact_email, complaint_prefix, created_by, settings)
         VALUES ('Green Meadows Residential Society','GMRS','Survey No. 142, Kondapur Main Road','Near Botanical Garden, Kondapur','Hyderabad','Telangana','500084',
                 '+919000000002','office@greenmeadows.in','SOC',$1,'{"deliveryRequiresApproval":false,"approvalTimeoutMinutes":15,"allowRecurringVisitors":true}') RETURNING id`,
        [superAdmin],
      )
    ).rows[0].id;
    await c.query(`INSERT INTO society_subscriptions (society_id, plan, status, starts_on, ends_on, max_flats, created_by) VALUES ($1,'standard','active',$2,$3,800,$4)`, [
      society, addDays(today, -120), addDays(today, 245), superAdmin,
    ]);
    const gates = await insertMany(c, 'gates', ['society_id', 'name', 'created_by'], [[society, 'Gate 1', superAdmin], [society, 'Gate 2', superAdmin]], 'id, name');
    const gate1 = gates[0].id;
    const gate2 = gates[1].id;

    // Staff
    const mkUser = async (name: string, mobile: string, email: string | null, hash: string | null) =>
      (await c.query(`INSERT INTO users (full_name, mobile, email, password_hash, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, mobile, email, hash, superAdmin])).rows[0].id as string;
    const admin = await mkUser(DEMO.admin.name, DEMO.admin.mobile, DEMO.admin.email, hashAdmin);
    const fm = await mkUser(DEMO.facilityManager.name, DEMO.facilityManager.mobile, DEMO.facilityManager.email, hashAdmin);
    await c.query(`INSERT INTO society_users (society_id, user_id, role, created_by) VALUES ($1,$2,'admin',$4), ($1,$3,'facility_manager',$4)`, [society, admin, fm, superAdmin]);

    const guardUsers: string[] = [];
    const guardsData = [
      { ...DEMO.guard, code: 'GM-SEC-014', shift: 'day', gate: gate1 },
      { ...DEMO.guard2, code: 'GM-SEC-022', shift: 'day', gate: gate2 },
      { name: 'Narsimha Chary', mobile: newMobile(), code: 'GM-SEC-031', shift: 'night', gate: gate1 },
      { name: 'Prem Bahadur Thapa', mobile: newMobile(), code: 'GM-SEC-037', shift: 'night', gate: gate2 },
      { name: 'Krishna Murthy', mobile: newMobile(), code: 'GM-SEC-041', shift: 'rotational', gate: gate1 },
    ];
    for (const g of guardsData) {
      const uid = await mkUser(g.name, g.mobile, null, null);
      guardUsers.push(uid);
      await c.query(`INSERT INTO society_users (society_id, user_id, role, created_by) VALUES ($1,$2,'guard',$3)`, [society, uid, admin]);
      await c.query(`INSERT INTO security_guards (society_id, user_id, employee_code, agency_name, shift, default_gate_id, created_by) VALUES ($1,$2,$3,'Shield Force Security Services',$4,$5,$6)`, [
        society, uid, g.code, g.shift, g.gate, admin,
      ]);
    }
    log('✓ society, staff, guards');

    // ---------------------------------------------------------------- towers / floors / flats
    const towerRows = await insertMany(
      c, 'towers', ['society_id', 'name', 'code', 'sort_order', 'created_by'],
      ['A', 'B', 'C', 'D'].map((code, i) => [society, `Tower ${code}`, code, i + 1, admin]), 'id, code',
    );
    const floorRows: unknown[][] = [];
    for (const t of towerRows) for (let f = 1; f <= 20; f++) floorRows.push([society, t.id, f, `Floor ${f}`]);
    const floors = await insertMany(c, 'floors', ['society_id', 'tower_id', 'floor_number', 'label'], floorRows, 'id, tower_id, floor_number');
    const flatRows: unknown[][] = [];
    for (const fl of floors) {
      const tower = towerRows.find((t) => t.id === fl.tower_id)!;
      for (let u = 1; u <= 8; u++) {
        const unit = `${fl.floor_number}${String(u).padStart(2, '0')}`;
        const type = u <= 2 ? '3BHK' : u <= 6 ? '2BHK' : '3BHK Premium';
        const area = u <= 2 ? 1650 : u <= 6 ? 1220 : 1980;
        flatRows.push([society, tower.id, fl.id, `${tower.code}-${unit}`, unit, type, area, admin]);
      }
    }
    const flats = await insertMany(c, 'flats', ['society_id', 'tower_id', 'floor_id', 'number', 'unit_code', 'flat_type', 'area_sqft', 'created_by'], flatRows, 'id, number, tower_id');
    const flatByNumber = new Map(flats.map((f) => [f.number as string, f]));
    log(`✓ ${towerRows.length} towers, ${floors.length} floors, ${flats.length} flats`);

    // ---------------------------------------------------------------- residents
    type R = { name: string; mobile: string; email: string | null; flat: string; relation: string; primary: boolean; moveIn: string };
    const people: R[] = [];
    const demoFlats = new Set([DEMO.resident.flat, DEMO.tenant.flat]);
    people.push({ name: DEMO.resident.name, mobile: DEMO.resident.mobile, email: DEMO.resident.email, flat: DEMO.resident.flat, relation: 'owner', primary: true, moveIn: '2021-04-18' });
    people.push({ name: DEMO.residentSpouse.name, mobile: DEMO.residentSpouse.mobile, email: null, flat: DEMO.resident.flat, relation: 'family_member', primary: false, moveIn: '2021-04-18' });
    people.push({ name: DEMO.tenant.name, mobile: DEMO.tenant.mobile, email: 'vikram.iyer@example.in', flat: DEMO.tenant.flat, relation: 'tenant', primary: true, moveIn: '2024-07-01' });
    for (const f of flats) {
      if (demoFlats.has(f.number)) continue;
      if (!chance(0.86)) continue; // ~14% vacant
      const surname = pick(SURNAMES);
      const tenantOccupied = chance(0.28);
      const moveIn = addDays(today, -between(60, 2400));
      const male = chance(0.55);
      const first = male ? pick(MALE) : pick(FEMALE);
      const emailOk = chance(0.6);
      const mk = (fn: string) => `${fn}.${surname}`.toLowerCase().replace(/[^a-z.]/g, '') + `${between(1, 99)}@example.in`;
      people.push({ name: `${first} ${surname}`, mobile: newMobile(), email: emailOk ? mk(first) : null, flat: f.number, relation: tenantOccupied ? 'tenant' : 'owner', primary: true, moveIn });
      const familyCount = between(1, 3);
      for (let i = 0; i < familyCount; i++) {
        const fn = i === 0 ? (male ? pick(FEMALE) : pick(MALE)) : chance(0.5) ? pick(FEMALE) : pick(MALE);
        people.push({ name: `${fn} ${surname}`, mobile: newMobile(), email: null, flat: f.number, relation: 'family_member', primary: false, moveIn });
      }
    }
    const userIds = await insertMany(c, 'users', ['full_name', 'mobile', 'email', 'created_by'], people.map((p) => [p.name, p.mobile, p.email, admin]));
    await insertMany(c, 'society_users', ['society_id', 'user_id', 'role', 'created_by'], userIds.map((u) => [society, u.id, 'resident', admin]));
    const residentIds = await insertMany(c, 'residents', ['society_id', 'user_id', 'created_by'], userIds.map((u) => [society, u.id, admin]));
    await insertMany(
      c, 'resident_flat_relationships', ['society_id', 'resident_id', 'flat_id', 'relation', 'is_primary', 'move_in_date', 'created_by'],
      people.map((p, i) => [society, residentIds[i].id, flatByNumber.get(p.flat)!.id, p.relation, p.primary, p.moveIn, admin]),
    );
    await c.query(
      `UPDATE flats f SET occupancy_status = CASE
         WHEN EXISTS (SELECT 1 FROM resident_flat_relationships r WHERE r.flat_id = f.id AND r.status = 'active' AND r.relation = 'tenant') THEN 'tenant_occupied'
         WHEN EXISTS (SELECT 1 FROM resident_flat_relationships r WHERE r.flat_id = f.id AND r.status = 'active') THEN 'owner_occupied' ELSE 'vacant' END
       WHERE f.society_id = $1`,
      [society],
    );
    const userIdByIndex = userIds.map((u) => u.id as string);
    const demoResident = userIdByIndex[0];
    const demoSpouse = userIdByIndex[1];
    const occupiedFlats = [...new Set(people.map((p) => p.flat))].map((n) => flatByNumber.get(n)!);
    const flatOwner = new Map<string, string>();
    people.forEach((p, i) => p.primary && flatOwner.set(flatByNumber.get(p.flat)!.id, userIdByIndex[i]));
    log(`✓ ${people.length} residents across ${occupiedFlats.length} occupied flats`);

    // ---------------------------------------------------------------- facilities
    const facilityDefs = [
      { name: 'Badminton Court', desc: 'Indoor synthetic court with LED lighting. Two rackets available at the clubhouse desk.', loc: 'Clubhouse, Ground Floor', open: '06:00', close: '22:00', slot: 60, max: 60, cap: 4, conc: 1, adv: 7, cut: 60, perDay: 1, rules: 'Non-marking shoes only.\nMaximum 4 players per booking.\nPlease vacate on time for the next booking.' },
      { name: 'Tennis Court', desc: 'Floodlit hard court.', loc: 'Sports Arena, behind Tower D', open: '06:00', close: '21:00', slot: 60, max: 120, cap: 4, conc: 1, adv: 7, cut: 120, perDay: 1, rules: 'Tennis shoes mandatory.\nCoaching sessions on Sat/Sun 6–8 AM are reserved.' },
      { name: 'Swimming Pool', desc: 'Temperature-controlled 25 m pool with separate kids’ pool. Lifeguard on duty.', loc: 'Clubhouse Terrace', open: '06:00', close: '21:00', slot: 60, max: 60, cap: 4, conc: 10, adv: 3, cut: 30, perDay: 2, rules: 'Swimming costume and cap compulsory.\nChildren under 12 must be accompanied by an adult.\nPool closed Mondays 12–3 PM for cleaning.' },
      { name: 'Gym', desc: 'Fully equipped gym with cardio and strength sections.', loc: 'Clubhouse, First Floor', open: '05:00', close: '23:00', slot: 60, max: 120, cap: 1, conc: 15, adv: 2, cut: 15, perDay: 2, rules: 'Carry a towel and water bottle.\nRe-rack weights after use.\nMinimum age 16.' },
      { name: 'Clubhouse', desc: 'Lounge with indoor games — carrom, chess and table tennis.', loc: 'Clubhouse, Ground Floor', open: '09:00', close: '22:00', slot: 60, max: 180, cap: 20, conc: 1, adv: 14, cut: 240, perDay: 1, rules: 'No outside caterers without prior approval.\nMusic to be turned off by 10 PM.' },
      { name: 'Function Hall', desc: 'Air-conditioned banquet hall for up to 150 guests, with pantry.', loc: 'Clubhouse, Second Floor', open: '09:00', close: '23:00', slot: 240, max: 480, cap: 150, conc: 1, adv: 60, cut: 2880, perDay: 1, rules: 'Booking subject to management approval for events above 100 guests.\nRefundable deposit applies (collected offline in Phase 1).\nNo loud music after 10:30 PM as per local norms.' },
      { name: 'BBQ Area', desc: 'Open-air barbecue deck with two grills and seating for 20.', loc: 'Garden Deck, near Tower C', open: '17:00', close: '23:00', slot: 120, max: 240, cap: 20, conc: 1, adv: 14, cut: 240, perDay: 1, rules: 'Bring your own charcoal.\nClean the grill after use.' },
      { name: 'Meeting Room', desc: 'Quiet room with projector, whiteboard and Wi-Fi for 8 people.', loc: 'Clubhouse, First Floor', open: '08:00', close: '22:00', slot: 60, max: 180, cap: 8, conc: 1, adv: 7, cut: 60, perDay: 3, rules: 'Keep noise to a minimum.\nSwitch off the projector and AC after use.' },
      { name: 'Kids Play Area', desc: 'Soft-floor indoor play zone for children aged 2–10.', loc: 'Clubhouse, Ground Floor', open: '07:00', close: '20:00', slot: 60, max: 120, cap: 6, conc: 8, adv: 3, cut: 15, perDay: 2, rules: 'Children must be supervised by an adult at all times.\nSocks mandatory in the play zone.' },
    ];
    const facilities: any[] = [];
    for (const f of facilityDefs) {
      const row = (
        await c.query(
          `INSERT INTO facilities (society_id, name, description, location, open_time, close_time, slot_duration_minutes, max_booking_minutes, capacity, max_concurrent_bookings,
             advance_booking_days, cancellation_cutoff_minutes, max_bookings_per_flat_per_day, rules, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, name, slot_duration_minutes, max_concurrent_bookings`,
          [society, f.name, f.desc, f.loc, f.open, f.close, f.slot, f.max, f.cap, f.conc, f.adv, f.cut, f.perDay, f.rules, admin],
        )
      ).rows[0];
      const slots: unknown[][] = [];
      for (let m = toMinutes(f.open); m + f.slot <= toMinutes(f.close); m += f.slot) slots.push([society, row.id, fromMinutes(m), fromMinutes(m + f.slot)]);
      row.slots = await insertMany(c, 'facility_slots', ['society_id', 'facility_id', 'start_time', 'end_time'], slots, 'id, start_time, end_time');
      facilities.push(row);
    }
    log(`✓ ${facilities.length} facilities`);

    // ---------------------------------------------------------------- bookings
    const bookingRows: unknown[][] = [];
    const taken = new Set<string>();
    const addBooking = (fac: any, date: string, slot: any, flatId: string, by: string, status: string, guests = 2) => {
      const key = `${fac.id}|${date}|${slot.start_time}`;
      const count = [...taken].filter((k) => k.startsWith(key)).length;
      if (count >= fac.max_concurrent_bookings) return false;
      taken.add(`${key}|${flatId}`);
      const st = slot.start_time.slice(0, 5);
      const et = slot.end_time.slice(0, 5);
      bookingRows.push([society, fac.id, slot.id, flatId, by, `BKG-${randomDigits(6)}`, date, st, et, at(date, st), at(date, et), guests, status,
        status === 'cancelled' ? at(date, st) : null, status === 'cancelled' ? by : null]);
      return true;
    };
    const badminton = facilities.find((f) => f.name === 'Badminton Court');
    const demoFlatId = flatByNumber.get(DEMO.resident.flat)!.id;
    // Demo resident: badminton tomorrow 7–8 PM (spec example) + history
    addBooking(badminton, addDays(today, 1), badminton.slots.find((s: any) => s.start_time.startsWith('19:00')), demoFlatId, demoResident, 'confirmed', 4);
    addBooking(facilities.find((f) => f.name === 'Swimming Pool'), addDays(today, -3), facilities.find((f) => f.name === 'Swimming Pool').slots[1], demoFlatId, demoSpouse, 'completed');
    addBooking(badminton, addDays(today, -6), badminton.slots.find((s: any) => s.start_time.startsWith('18:00')), demoFlatId, demoResident, 'completed', 4);
    addBooking(facilities.find((f) => f.name === 'Meeting Room'), addDays(today, -10), facilities.find((f) => f.name === 'Meeting Room').slots[3], demoFlatId, demoResident, 'cancelled');
    for (let d = -20; d <= 6; d++) {
      const date = addDays(today, d);
      const n = d === 0 ? 8 : between(4, 10);
      for (let i = 0; i < n; i++) {
        const fac = pick(facilities.filter((f) => f.name !== 'Function Hall'));
        const slot = d === 0 ? pick(fac.slots.filter((s: any) => toMinutes(s.start_time.slice(0, 5)) >= 9 * 60)) : pick(fac.slots);
        const flat = pick(occupiedFlats);
        if (flat.id === demoFlatId) continue;
        const ended = at(date, (slot as any).end_time.slice(0, 5)).getTime() < now.getTime();
        const status = chance(0.08) ? 'cancelled' : ended ? 'completed' : 'confirmed';
        if (!addBooking(fac, date, slot, flat.id, flatOwner.get(flat.id)!, status, between(1, 4))) i--;
        if (d === 0 && i > 30) break;
      }
    }
    const hall = facilities.find((f) => f.name === 'Function Hall');
    addBooking(hall, addDays(today, 12), hall.slots[2], pick(occupiedFlats).id, userIdByIndex[10], 'confirmed', 120);
    await insertMany(
      c, 'facility_bookings',
      ['society_id', 'facility_id', 'slot_id', 'flat_id', 'booked_by', 'reference', 'booking_date', 'start_time', 'end_time', 'starts_at', 'ends_at', 'guest_count', 'status', 'cancelled_at', 'cancelled_by'],
      bookingRows.map((r) => {
        const flatId = r[3] as string;
        if (!r[4]) r[4] = flatOwner.get(flatId) ?? demoResident;
        return r;
      }),
    );
    log(`✓ ${bookingRows.length} facility bookings`);

    // ---------------------------------------------------------------- visitors
    const visitorIdByKey = new Map<string, string>();
    const getVisitor = async (name: string, mobile: string | null) => {
      const key = `${name}|${mobile}`;
      if (visitorIdByKey.has(key)) return visitorIdByKey.get(key)!;
      const id = (await c.query(`INSERT INTO visitors (society_id, full_name, mobile, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [society, name, mobile, admin])).rows[0].id;
      visitorIdByKey.set(key, id);
      return id;
    };
    const visitorPool = await Promise.all(VISITOR_NAMES.map(async (n) => ({ name: n, mobile: newMobile() })));
    const usedOtps = new Set<string>();
    const freshOtp = () => {
      for (;;) {
        const o = randomDigits(6);
        if (!usedOtps.has(o)) return usedOtps.add(o), o;
      }
    };
    const makeInvite = async (o: { flatId: string; by: string; visitor: { name: string; mobile: string | null }; date: string; arrival: string; type?: string; until?: string; days?: number[] | null; status: string; purpose: string; guests?: number; vehicle?: string | null; notes?: string | null; windowStart?: string; windowEnd?: string }) => {
      const vid = await getVisitor(o.visitor.name, o.visitor.mobile);
      const arr = toMinutes(o.arrival);
      const r = await c.query(
        `INSERT INTO visitor_invites (society_id, flat_id, visitor_id, invited_by, pass_code, otp_code, visit_type, purpose, guest_count, vehicle_number, notes, valid_from, valid_until,
                                      window_start, window_end, expected_arrival, recurrence_days, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [society, o.flatId, vid, o.by, `VIS-${randomDigits(6)}`, freshOtp(), o.type ?? 'one_time', o.purpose, o.guests ?? 1, o.vehicle ?? null, o.notes ?? null, o.date, o.until ?? o.date,
          o.windowStart ?? fromMinutes(Math.max(0, arr - 60)), o.windowEnd ?? fromMinutes(Math.min(1439, arr + 180)), o.arrival, o.days ?? null, o.status, at(addDays(o.date, -1), '18:30')],
      );
      return { id: r.rows[0].id as string, visitorId: vid };
    };

    // Demo resident's upcoming visitors
    await makeInvite({ flatId: demoFlatId, by: demoResident, visitor: { name: 'Ahmed Khan', mobile: '+919876501234' }, date: today, arrival: '20:00', windowStart: '19:00', windowEnd: '23:00', status: 'active', purpose: 'Family dinner', guests: 2, vehicle: 'TS09EK4521', notes: 'Please allow car parking in visitor bay V3.' });
    await makeInvite({ flatId: demoFlatId, by: demoResident, visitor: { name: 'Saroja', mobile: '+919701234567' }, date: addDays(today, -14), until: addDays(today, 76), arrival: '07:30', windowStart: '07:00', windowEnd: '11:00', type: 'recurring', days: [1, 2, 3, 4, 5, 6], status: 'active', purpose: 'Housekeeping (daily)' });
    await makeInvite({ flatId: demoFlatId, by: demoSpouse, visitor: { name: 'Rajiv Menon', mobile: '+919845098450' }, date: addDays(today, 2), arrival: '11:00', status: 'active', purpose: 'Interior designer site visit' });

    // Upcoming invites across the society (today/tomorrow) for the guard demo
    for (let i = 0; i < 18; i++) {
      const flat = pick(occupiedFlats);
      if (flat.id === demoFlatId) continue;
      const date = addDays(today, i < 12 ? 0 : 1);
      const arrMin = Math.max(nowMin + 30, between(10 * 60, 21 * 60));
      await makeInvite({ flatId: flat.id, by: flatOwner.get(flat.id)!, visitor: pick(visitorPool), date, arrival: fromMinutes(Math.min(arrMin - (arrMin % 15), 22 * 60)), status: 'active', purpose: pick(PURPOSES), guests: between(1, 4), vehicle: chance(0.4) ? vehicle() : null });
    }

    // Visitor entries: last 30 days
    const entries: unknown[][] = [];
    const demoInsideLeft: number[] = [];
    for (let d = -30; d <= 0; d++) {
      const date = addDays(today, d);
      const isToday = d === 0;
      const count = isToday ? 37 : between(28, 52);
      const maxMin = isToday ? Math.max(nowMin - 5, 30) : 22 * 60 + 30;
      const minMin = isToday ? Math.min(6 * 60, Math.max(0, nowMin - 300)) : 6 * 60;
      for (let i = 0; i < count; i++) {
        const flat = d > -12 && i === 3 ? flatByNumber.get(DEMO.resident.flat)! : pick(occupiedFlats);
        const r = rand();
        const t = between(minMin, maxMin);
        const checkIn = at(date, fromMinutes(t));
        let category: string, provider: string | null = null, name: string, mobile: string | null = null, veh: string | null = null, stay: number;
        if (r < 0.34) {
          const v = pick(visitorPool);
          category = 'guest'; name = v.name; mobile = v.mobile; veh = chance(0.35) ? vehicle() : null; stay = between(30, 240);
        } else if (r < 0.55) {
          category = 'food_delivery'; provider = pick(['Swiggy', 'Zomato']); name = `${provider} delivery`; stay = between(3, 12);
        } else if (r < 0.75) {
          category = 'delivery'; provider = pick(['Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'BigBasket']); name = `${provider} delivery`; stay = between(3, 15);
        } else if (r < 0.8) {
          category = 'courier'; provider = pick(['Blue Dart', 'Delhivery', 'DTDC', 'India Post']); name = `${provider} courier`; stay = between(3, 10);
        } else if (r < 0.9) {
          category = 'cab'; provider = pick(['Uber', 'Ola', 'Rapido']); name = `${provider} cab`; veh = vehicle(); stay = between(2, 10);
        } else {
          category = 'domestic_staff'; name = pick(STAFF_NAMES); stay = between(60, 300);
        }
        const leftAtGate = ['delivery', 'courier'].includes(category) && chance(0.25);
        let checkOut: Date | null = new Date(checkIn.getTime() + stay * 60000);
        let status = leftAtGate ? 'left_at_gate' : 'checked_out';
        if (leftAtGate) checkOut = checkIn;
        if (isToday && !leftAtGate && checkOut.getTime() > now.getTime()) {
          checkOut = null;
          status = 'inside';
        }
        const guard = pick(guardUsers.slice(0, 2));
        const gate = category === 'domestic_staff' || category === 'delivery' ? gate2 : gate1;
        entries.push([society, flat.id, category, provider, name, mobile, veh, category === 'guest' ? between(1, 3) : 1, gate, guard, checkIn, checkOut, checkOut ? guard : null, checkOut ? gate : null, status]);
      }
      // Ensure ~12 visitors are currently inside today
      if (isToday) {
        const todays = entries.slice(-count);
        let inside = todays.filter((e) => e[14] === 'inside').length;
        for (const e of todays.sort((a, b) => (b[10] as Date).getTime() - (a[10] as Date).getTime())) {
          if (inside >= 12) break;
          if (e[14] === 'checked_out' && ['guest', 'domestic_staff'].includes(e[2] as string)) {
            e[11] = null; e[12] = null; e[13] = null; e[14] = 'inside'; inside++;
          }
        }
      }
    }
    void demoInsideLeft;
    const entryCols = ['society_id', 'flat_id', 'category', 'provider', 'visitor_name', 'visitor_mobile', 'vehicle_number', 'guest_count', 'gate_id', 'checked_in_by', 'checked_in_at', 'checked_out_at', 'checked_out_by', 'checkout_gate_id', 'status'];
    await insertMany(c, 'visitor_entries', entryCols, entries);
    // Link guest entries to completed invites where the visitor was pre-approved
    const guestEntries = (await c.query(`SELECT id, flat_id, visitor_name, visitor_mobile, checked_in_at, status FROM visitor_entries WHERE society_id = $1 AND category = 'guest'`, [society])).rows;
    for (const e of guestEntries) {
      if (!chance(0.6)) continue;
      const date = localDate(new Date(e.checked_in_at), TZ);
      const arrival = localTime(new Date(e.checked_in_at), TZ);
      const inv = await makeInvite({ flatId: e.flat_id, by: flatOwner.get(e.flat_id) ?? demoResident, visitor: { name: e.visitor_name, mobile: e.visitor_mobile }, date, arrival: fromMinutes(toMinutes(arrival) - (toMinutes(arrival) % 15)), status: e.status === 'inside' ? 'checked_in' : 'completed', purpose: pick(PURPOSES) });
      await c.query(`UPDATE visitor_entries SET invite_id = $1, visitor_id = $2 WHERE id = $3`, [inv.id, inv.visitorId, e.id]);
    }
    log(`✓ ${entries.length} visitor entries (last 30 days)`);

    // ---------------------------------------------------------------- complaints
    const complaintTemplates: Record<string, { title: string; desc: string; sub: string; loc?: string }[]> = {
      plumbing: [
        { title: 'Kitchen sink leakage', desc: 'Water is leaking from the pipe under the kitchen sink. The cabinet floor is getting wet.', sub: 'Leakage', loc: 'Kitchen' },
        { title: 'Bathroom drain blocked', desc: 'Master bathroom floor drain is clogged; water takes a long time to drain.', sub: 'Blocked drain', loc: 'Master bathroom' },
        { title: 'Low water pressure in shower', desc: 'Very low pressure in the guest bathroom shower since last week.', sub: 'Low water pressure', loc: 'Guest bathroom' },
      ],
      electrical: [
        { title: 'Balcony light not working', desc: 'The balcony light fitting stopped working. Bulb was replaced but still no power.', sub: 'Wiring', loc: 'Balcony' },
        { title: 'MCB tripping frequently', desc: 'Main MCB trips whenever the geyser and AC run together.', sub: 'MCB tripping', loc: 'Distribution board' },
        { title: 'Corridor lights off on 14th floor', desc: 'Lights near the lift lobby on the 14th floor are off at night.', sub: 'Common area lighting', loc: 'Lift lobby' },
      ],
      housekeeping: [
        { title: 'Garbage not collected', desc: 'Dry waste has not been collected from the floor bin for two days.', sub: 'Garbage collection', loc: 'Floor service area' },
        { title: 'Staircase needs cleaning', desc: 'Staircase between floors 8 and 10 is dusty with paan stains.', sub: 'Staircase' },
      ],
      lift: [
        { title: 'Lift 2 making jerking movements', desc: 'Service lift jerks between floors 5 and 7. Elderly residents are worried.', sub: 'Noise / jerks', loc: 'Lift 2' },
        { title: 'Lift door closing too fast', desc: 'Passenger lift door closes before people can enter; sensor may be faulty.', sub: 'Door issue', loc: 'Lift 1' },
      ],
      security: [{ title: 'Unknown vehicle parked overnight', desc: 'A car without a society sticker was parked near Tower C overnight.', sub: 'Unauthorised entry', loc: 'Tower C parking' }],
      parking: [
        { title: 'Someone parked in my slot', desc: 'An unknown two-wheeler is repeatedly parked in my allotted slot B2-47.', sub: 'Slot blocked', loc: 'Basement 2' },
        { title: 'Visitor parking full every evening', desc: 'Visitor bays are being used by residents for second cars.', sub: 'Visitor parking' },
      ],
      water: [
        { title: 'No water supply since morning', desc: 'No water in the kitchen and bathrooms since 6 AM.', sub: 'No water supply' },
        { title: 'Muddy water from taps', desc: 'Water from the taps is brownish after the tank cleaning.', sub: 'Water quality' },
      ],
      common_area: [
        { title: 'Treadmill not working in gym', desc: 'Treadmill #2 shows an error and stops after a minute.', sub: 'Gym', loc: 'Clubhouse gym' },
        { title: 'Swing broken in play area', desc: 'One of the swings in the kids play area has a broken chain. It is unsafe.', sub: 'Play area', loc: 'Kids play area' },
      ],
      noise: [{ title: 'Renovation noise after 8 PM', desc: 'Drilling noise from the flat above continues late into the evening.', sub: 'Construction / renovation' }],
      pest_control: [
        { title: 'Cockroaches in kitchen', desc: 'Need pest control treatment for cockroaches in the kitchen.', sub: 'Cockroaches', loc: 'Kitchen' },
        { title: 'Mosquito breeding near garden', desc: 'Stagnant water near the garden sprinklers is breeding mosquitoes.', sub: 'Mosquitoes', loc: 'Central garden' },
      ],
      other: [{ title: 'Intercom not working', desc: 'The intercom handset in the flat does not ring when the gate calls.', sub: 'General' }],
    };
    const technicians = ['Ramu (Plumber)', 'Srinu (Electrician)', 'Otis Service Team', 'HMWSSB liaison', 'PestFree Services', 'Housekeeping Supervisor – Anil'];
    const TECH_BY_CATEGORY: Record<string, string> = {
      plumbing: 'Ramu (Plumber)', water: 'Ramu (Plumber)', electrical: 'Srinu (Electrician)', lift: 'Otis Service Team', pest_control: 'PestFree Services',
      housekeeping: 'Housekeeping Supervisor – Anil', common_area: 'Housekeeping Supervisor – Anil', security: 'Security Supervisor – Venkat Rao', parking: 'Security Supervisor – Venkat Rao',
    };
    const statusPool = ['open', 'open', 'assigned', 'in_progress', 'resolved', 'closed', 'closed', 'closed', 'closed'];
    let seq = 1000;
    const complaintIds: { id: string; status: string; raised_by: string }[] = [];
    const insertComplaint = async (o: { flatId: string; by: string; category: string; t: { title: string; desc: string; sub: string; loc?: string }; status: string; priority: string; createdAt: Date; number?: number; assignee?: string | null; rating?: number | null }) => {
      const number = o.number ?? ++seq;
      const created = o.createdAt;
      const h = (n: number) => new Date(created.getTime() + n * 3600_000);
      const assigned = ['assigned', 'in_progress', 'resolved', 'closed'].includes(o.status);
      const tech = assigned ? (o.assignee ?? TECH_BY_CATEGORY[o.category] ?? pick(technicians)) : null;
      const r = await c.query(
        `INSERT INTO complaints (society_id, number, flat_id, raised_by, category, subcategory, title, description, location, priority, status, assignee_name, assigned_to,
                                 assigned_at, in_progress_at, resolved_at, closed_at, rating, rated_at, first_response_at, resolution_due_at, created_at, updated_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$4) RETURNING id`,
        [society, `SOC-INC-${number}`, o.flatId, o.by, o.category, o.t.sub, o.t.title, o.t.desc, o.t.loc ?? null, o.priority, o.status, tech, assigned ? fm : null,
          assigned ? h(2) : null, ['in_progress', 'resolved', 'closed'].includes(o.status) ? h(5) : null, ['resolved', 'closed'].includes(o.status) ? h(26) : null,
          o.status === 'closed' ? h(40) : null, o.rating ?? null, o.rating ? h(41) : null, assigned ? h(2) : null,
          new Date(created.getTime() + ({ urgent: 4, high: 24, medium: 72, low: 120 } as any)[o.priority] * 3600_000), created, h(o.status === 'open' ? 0 : 40)],
      );
      const id = r.rows[0].id;
      const hist: [string | null, string, Date][] = [[null, 'open', created]];
      if (assigned) hist.push(['open', 'assigned', h(2)]);
      if (['in_progress', 'resolved', 'closed'].includes(o.status)) hist.push(['assigned', 'in_progress', h(5)]);
      if (['resolved', 'closed'].includes(o.status)) hist.push(['in_progress', 'resolved', h(26)]);
      if (o.status === 'closed') hist.push(['resolved', 'closed', h(40)]);
      for (const [f, t, when] of hist) await c.query(`INSERT INTO complaint_status_history (society_id, complaint_id, from_status, to_status, changed_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [society, id, f, t, t === 'open' ? o.by : t === 'closed' && o.rating ? o.by : fm, when]);
      if (assigned) await c.query(`INSERT INTO complaint_comments (society_id, complaint_id, author_id, body, visibility, created_at) VALUES ($1,$2,$3,$4,'public',$5)`, [society, id, fm, `${tech} has been assigned and will visit ${pick(['today', 'within 24 hours', 'tomorrow morning'])}.`, h(2)]);
      if (assigned && chance(0.5)) await c.query(`INSERT INTO complaint_comments (society_id, complaint_id, author_id, body, visibility, created_at) VALUES ($1,$2,$3,$4,'internal',$5)`, [society, id, admin, pick(['Spare part ordered from vendor; ETA 2 days.', 'Recurring issue in this stack — schedule a full inspection.', 'Covered under AMC, no charge to resident.']), h(3)]);
      if (['resolved', 'closed'].includes(o.status)) await c.query(`INSERT INTO complaint_comments (society_id, complaint_id, author_id, body, visibility, created_at) VALUES ($1,$2,$3,$4,'public',$5)`, [society, id, fm, pick(['Issue fixed and tested. Please confirm.', 'Work completed. Kindly check and close the ticket.', 'Resolved — part replaced.']), h(26)]);
      complaintIds.push({ id, status: o.status, raised_by: o.by });
      return id;
    };
    const cats = Object.keys(complaintTemplates);
    for (let i = 0; i < 44; i++) {
      const flat = pick(occupiedFlats.filter((f) => f.id !== demoFlatId));
      const cat = pick(cats);
      const daysAgo = between(0, 45);
      const st = daysAgo > 20 ? pick(['closed', 'closed', 'resolved']) : pick(statusPool);
      const created = new Date(now.getTime() - daysAgo * 86400_000 - between(1, 10) * 3600_000);
      await insertComplaint({ flatId: flat.id, by: flatOwner.get(flat.id)!, category: cat, t: pick(complaintTemplates[cat]), status: st, priority: pick(['low', 'medium', 'medium', 'high', 'urgent']), createdAt: created, rating: st === 'closed' && chance(0.7) ? between(3, 5) : null });
    }
    // Demo resident complaints (spec example: Plumbing, SOC-INC-1045, Technician Assigned)
    await insertComplaint({ flatId: demoFlatId, by: demoResident, category: 'plumbing', t: complaintTemplates.plumbing[0], status: 'assigned', priority: 'high', createdAt: new Date(now.getTime() - 20 * 3600_000), number: 1045, assignee: 'Ramu (Plumber)' });
    seq = 1045;
    await insertComplaint({ flatId: demoFlatId, by: demoResident, category: 'electrical', t: complaintTemplates.electrical[0], status: 'closed', priority: 'medium', createdAt: new Date(now.getTime() - 18 * 86400_000), rating: 5, assignee: 'Srinu (Electrician)' });
    await insertComplaint({ flatId: demoFlatId, by: demoSpouse, category: 'pest_control', t: complaintTemplates.pest_control[0], status: 'resolved', priority: 'low', createdAt: new Date(now.getTime() - 4 * 86400_000), assignee: 'PestFree Services' });
    for (let i = 0; i < 12; i++) {
      const flat = pick(occupiedFlats.filter((f) => f.id !== demoFlatId));
      const cat = pick(cats);
      await insertComplaint({ flatId: flat.id, by: flatOwner.get(flat.id)!, category: cat, t: pick(complaintTemplates[cat]), status: pick(['open', 'assigned', 'in_progress', 'open']), priority: pick(['medium', 'high', 'urgent', 'low']), createdAt: new Date(now.getTime() - between(1, 96) * 3600_000) });
    }
    await c.query(`INSERT INTO society_counters (society_id, key, value) VALUES ($1, 'complaint', $2)`, [society, seq]);
    log(`✓ ${complaintIds.length} complaints`);

    // ---------------------------------------------------------------- announcements
    const towerId = (code: string) => towerRows.find((t) => t.code === code)!.id;
    const ann = [
      { title: 'Water supply interruption – Tower B & C', body: 'Due to HMWSSB pipeline maintenance on the Kondapur main line, water supply to Tower B and Tower C will be interrupted tomorrow between 10:00 AM and 4:00 PM. Please store sufficient water in advance. Tankers have been arranged for emergencies — contact the facility office.', category: 'water', priority: 'important', publish: -2, expires: 2, audience: 'towers', towers: [towerId('B'), towerId('C')] },
      { title: 'Diwali celebrations at the Clubhouse', body: 'Join us for Diwali celebrations this Saturday from 6:30 PM at the central lawn — rangoli competition, kids’ games, dinner and a safe, eco-friendly fireworks session (7:30–9:30 PM only, in the designated area). Register at the clubhouse desk by Thursday.', category: 'event', priority: 'normal', publish: -1, expires: 12 },
      { title: 'Lift maintenance – Tower A, Lift 2', body: 'Otis will carry out the half-yearly maintenance of Lift 2 in Tower A on Saturday between 9:00 AM and 1:00 PM. Lift 1 will remain operational. We regret the inconvenience.', category: 'maintenance', priority: 'normal', publish: -3, expires: 5, audience: 'towers', towers: [towerId('A')] },
      { title: 'Security advisory: verify delivery personnel', body: 'Residents are requested not to share OTPs with delivery agents over the phone and to approve visitors only through the SocietyOne app. Delivery agents will not be allowed above the ground floor without resident approval.', category: 'security', priority: 'important', publish: -6, expires: 30 },
      { title: 'Annual General Body Meeting – 26 October', body: 'The Annual General Body Meeting will be held on Sunday, 26 October at 10:30 AM in the Function Hall. Agenda: FY 2025–26 accounts, CCTV upgrade proposal and solar panel installation. One member per flat is requested to attend.', category: 'general', priority: 'important', publish: -4, expires: 22 },
      { title: 'Mosquito fogging schedule', body: 'GHMC fogging will be done across all towers on Wednesday and Saturday evenings between 6:00 and 7:00 PM. Please keep windows closed during this time.', category: 'maintenance', priority: 'normal', publish: -8, expires: 10 },
      { title: 'Scheduled power shutdown – DG test', body: 'TSSPDCL has notified a planned shutdown on Sunday 6:00–8:00 AM. Diesel generator backup will cover lifts, common areas and essential loads only.', category: 'electricity', priority: 'normal', publish: -15, expires: -12 },
      { title: 'Yoga sessions every morning', body: 'Free yoga sessions on the terrace garden every weekday from 6:15 to 7:00 AM, conducted by resident volunteer Padma Iyer. All are welcome.', category: 'event', priority: 'normal', publish: -20, expires: null },
    ];
    for (const a of ann) {
      await c.query(
        `INSERT INTO announcements (society_id, title, body, category, priority, audience, tower_ids, publish_at, expires_at, status, notified_at, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published',$8,$10,$8)`,
        [society, a.title, a.body, a.category, a.priority, a.audience ?? 'all', a.towers ?? null, new Date(now.getTime() + a.publish * 86400_000),
          a.expires === null ? null : new Date(now.getTime() + a.expires * 86400_000), admin],
      );
    }
    log(`✓ ${ann.length} announcements`);

    // ---------------------------------------------------------------- emergency contacts
    const contacts = [
      ['Main Gate (Gate 1)', 'society', '+914023001001', 'Security desk at the main entrance', true],
      ['Security Supervisor – Venkat Rao', 'society', '+919000000007', 'Shield Force Security, on-site supervisor', true],
      ['Facility Manager – Mohammed Irfan', 'society', DEMO.facilityManager.mobile, 'Maintenance and facility issues (9 AM – 7 PM)', false],
      ['Ambulance', 'medical', '108', 'Emergency medical services', true],
      ['Police', 'police', '100', 'Dial 100 / 112 – Hyderabad City Police', true],
      ['Fire', 'fire', '101', 'Telangana State Disaster Response & Fire Services', true],
      ['Electrician – Srinu', 'maintenance', '+919000000008', 'Society electrician (on call)', false],
      ['Plumber – Ramu', 'maintenance', '+919000000009', 'Society plumber (on call)', false],
      ['Lift Emergency – Otis 24x7', 'maintenance', '18002091111', 'Lift breakdown / entrapment', true],
      ['Continental Hospitals, Gachibowli', 'medical', '+914067000000', 'Nearest multi-speciality hospital (4 km)', true],
    ];
    await insertMany(c, 'emergency_contacts', ['society_id', 'name', 'category', 'phone', 'description', 'available_24x7', 'sort_order', 'created_by'], contacts.map((x, i) => [society, ...x, i, admin]));

    // ---------------------------------------------------------------- notifications (demo resident)
    const notes = [
      ['complaint_assigned', 'complaints', 'SOC-INC-1045: technician assigned', 'Ramu (Plumber) has been assigned to “Kitchen sink leakage”.', 2],
      ['delivery_arrived', 'visitors', 'Swiggy food delivery at Gate 1', 'Your Swiggy food delivery has arrived at Gate 1.', 5],
      ['booking_confirmed', 'bookings', 'Booking confirmed', `Badminton Court • ${addDays(today, 1)} • 19:00–20:00`, 8],
      ['announcement_new', 'announcements', 'Diwali celebrations at the Clubhouse', 'Join us for Diwali celebrations this Saturday from 6:30 PM at the central lawn…', 24],
    ];
    for (const [type, cat, title, body, hoursAgo] of notes) {
      await c.query(`INSERT INTO notifications (society_id, user_id, type, category, title, body, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        society, demoResident, type, cat, title, body, new Date(now.getTime() - (hoursAgo as number) * 3600_000),
      ]);
    }

    // ---------------------------------------------------------------- audit trail samples
    const auditRows = [
      [society, superAdmin, 'super_admin', 'platform.society_created', 'society', society, 'Green Meadows onboarded'],
      [society, admin, 'admin', 'flats.bulk_created', 'tower', towerRows[0].id, 'Tower A: floors 1–20, 8 flats per floor'],
      [society, admin, 'admin', 'guard.added', 'security_guard', null, 'Ramesh Yadav (day shift)'],
      [society, fm, 'facility_manager', 'complaint.status_changed', 'complaint', null, 'SOC-INC-1045 → assigned'],
    ];
    await insertMany(c, 'audit_logs', ['society_id', 'actor_id', 'actor_role', 'action', 'entity_type', 'entity_id', 'summary'], auditRows);

    // ================================================================ second society (isolation)
    const other = (
      await c.query(
        `INSERT INTO societies (name, code, address_line1, city, state, pin_code, contact_email, complaint_prefix, created_by)
         VALUES ('Lakeview Heights','LVH','Road No. 3, Financial District, Nanakramguda','Hyderabad','Telangana','500032','office@lakeviewheights.in','LVH',$1) RETURNING id`,
        [superAdmin],
      )
    ).rows[0].id;
    await c.query(`INSERT INTO society_subscriptions (society_id, plan, status, starts_on, ends_on, created_by) VALUES ($1,'trial','trial',$2,$3,$4)`, [other, addDays(today, -10), addDays(today, 20), superAdmin]);
    const otherGate = (await c.query(`INSERT INTO gates (society_id, name) VALUES ($1,'Main Gate') RETURNING id`, [other])).rows[0].id;
    const oAdmin = (await c.query(`INSERT INTO users (full_name, email, mobile, password_hash) VALUES ($1,$2,$3,$4) RETURNING id`, [DEMO.otherAdmin.name, DEMO.otherAdmin.email, DEMO.otherAdmin.mobile, hashOther])).rows[0].id;
    await c.query(`INSERT INTO society_users (society_id, user_id, role) VALUES ($1,$2,'admin')`, [other, oAdmin]);
    const oTower = (await c.query(`INSERT INTO towers (society_id, name, code) VALUES ($1,'Lake Tower 1','L1') RETURNING id`, [other])).rows[0].id;
    const oFlats: string[] = [];
    for (let fnum = 1; fnum <= 5; fnum++) {
      const fl = (await c.query(`INSERT INTO floors (society_id, tower_id, floor_number) VALUES ($1,$2,$3) RETURNING id`, [other, oTower, fnum])).rows[0].id;
      for (let u = 1; u <= 4; u++) {
        oFlats.push((await c.query(`INSERT INTO flats (society_id, tower_id, floor_id, number, unit_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [other, oTower, fl, `L1-${fnum}0${u}`, `${fnum}0${u}`])).rows[0].id);
      }
    }
    const oRes = (await c.query(`INSERT INTO users (full_name, mobile) VALUES ($1,$2) RETURNING id`, [DEMO.otherResident.name, DEMO.otherResident.mobile])).rows[0].id;
    await c.query(`INSERT INTO society_users (society_id, user_id, role) VALUES ($1,$2,'resident')`, [other, oRes]);
    const oResident = (await c.query(`INSERT INTO residents (society_id, user_id) VALUES ($1,$2) RETURNING id`, [other, oRes])).rows[0].id;
    const l1301 = (await c.query(`SELECT id FROM flats WHERE society_id = $1 AND number = 'L1-301'`, [other])).rows[0].id;
    await c.query(`INSERT INTO resident_flat_relationships (society_id, resident_id, flat_id, relation, is_primary) VALUES ($1,$2,$3,'owner',true)`, [other, oResident, l1301]);
    await c.query(`UPDATE flats SET occupancy_status = 'owner_occupied' WHERE id = $1`, [l1301]);
    await c.query(
      `INSERT INTO complaints (society_id, number, flat_id, raised_by, category, title, description, priority) VALUES ($1,'LVH-INC-1001',$2,$3,'water','Lakeview: no hot water','Solar water heater not working since yesterday.','medium')`,
      [other, l1301, oRes],
    );
    await c.query(`INSERT INTO society_counters (society_id, key, value) VALUES ($1,'complaint',1001)`, [other]);
    await c.query(`INSERT INTO announcements (society_id, title, body, created_by) VALUES ($1,'Lakeview Heights welcomes you to SocietyOne','Our society is now live on SocietyOne.',$2)`, [other, oAdmin]);
    void otherGate;
    log('✓ second society (Lakeview Heights) for isolation demo');
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    await migrate({ quiet: true });
    await seed();
    await pool.end();
    console.log('\nDemo accounts are listed in README.md (section "Demo accounts").');
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
