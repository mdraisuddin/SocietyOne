import { test } from '@playwright/test';
import { MOBILE, TABLET, PNG, adminLogin, asAdmin, asMobile, expect, istTimeFromNow, newPage, typeKeypad } from './helpers';

const RESIDENT = '9848012345'; // Ananya Sharma, A-1204
const TENANT = '9000000004'; // Vikram Iyer, B-1204
const GUARD = '9000000003'; // Ramesh Yadav

test.describe.configure({ mode: 'serial' });

test('Visitor: invite → QR/OTP pass → guard validates → check-in → resident notified → check-out → history', async ({ browser }) => {
  const resident = await asMobile(browser, RESIDENT, MOBILE);
  await resident.getByRole('link', { name: 'Visitors' }).first().click();
  await resident.getByRole('link', { name: 'Invite visitor' }).click();
  await resident.getByLabel('Visitor name').fill('Imran Qureshi');
  await resident.getByLabel('Expected arrival time').fill(istTimeFromNow(20));
  await resident.getByRole('button', { name: 'Family visit' }).click();
  await resident.getByRole('button', { name: 'Create visitor pass' }).click();
  await expect(resident.getByText('Pass created')).toBeVisible();
  await expect(resident.getByLabel('QR code for the visitor pass').locator('svg')).toBeVisible();
  const passcode = (await resident.locator('.passcode').innerText()).trim();
  expect(passcode).toMatch(/^\d{6}$/);

  const guard = await asMobile(browser, GUARD, TABLET);
  await guard.getByRole('link', { name: /Enter passcode/ }).click();
  await typeKeypad(guard, passcode);
  await expect(guard.getByText('Valid pass')).toBeVisible();
  await expect(guard.locator('.verify-name')).toHaveText('Imran Qureshi');
  await expect(guard.getByText('Tower A • A-1204')).toBeVisible();
  await guard.getByRole('button', { name: 'CHECK IN' }).click();
  await expect(guard.getByText('Imran Qureshi checked in')).toBeVisible();

  await resident.goto('/app/notifications');
  await expect(resident.getByText('Imran Qureshi has arrived')).toBeVisible();

  await guard.goto('/guard/inside');
  const row = guard.locator('.list-item', { hasText: 'Imran Qureshi' });
  await row.getByRole('button', { name: /Out/ }).click();
  await expect(guard.getByText('Imran Qureshi checked out')).toBeVisible();

  await resident.goto('/app/visitors');
  await resident.getByRole('button', { name: 'History' }).click();
  const hist = resident.locator('.list-item', { hasText: 'Imran Qureshi' });
  await expect(hist).toBeVisible();
  await expect(hist).toContainText('Out');
});

test('Unexpected visitor: guard requests → resident approves → guard sees approval → check-in', async ({ browser }) => {
  const guard = await asMobile(browser, GUARD, TABLET);
  await guard.getByRole('link', { name: /New visitor/ }).click();
  await guard.getByLabel('Visitor name').fill('Suresh Babu');
  await guard.getByLabel('Destination flat').fill('A-1204');
  await guard.locator('.list-item', { hasText: 'A-1204' }).first().click();
  await guard.getByRole('button', { name: 'Plumber' }).click();
  await guard.getByRole('button', { name: 'Request approval' }).click();
  await expect(guard.getByText('Waiting for resident to respond')).toBeVisible();

  const resident = await asMobile(browser, RESIDENT, MOBILE);
  const card = resident.locator('.card', { hasText: 'Suresh Babu' });
  await expect(card).toContainText('Gate 1');
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(resident.getByText('Visitor approved')).toBeVisible();

  await expect(guard.getByText(/Approved/)).toBeVisible({ timeout: 15_000 });
  await guard.getByRole('button', { name: 'CHECK IN' }).click();
  await expect(guard.getByText('Suresh Babu checked in')).toBeVisible();
});

test('Complaint: resident raises with photo → admin assigns → status updates → resolved → resident confirms and rates', async ({ browser }) => {
  const resident = await asMobile(browser, RESIDENT, MOBILE);
  await resident.goto('/app/complaints/new');
  await resident.getByRole('button', { name: 'Plumbing' }).click();
  await resident.getByRole('button', { name: 'Leakage' }).click();
  await resident.getByLabel('Title').fill('Balcony drain pipe leaking');
  await resident.getByLabel('Description').fill('Water drips from the balcony drain pipe onto the flat below.');
  await resident.locator('input[type=file]').setInputFiles({ name: 'leak.png', mimeType: 'image/png', buffer: PNG });
  await expect(resident.locator('img.photo-thumb')).toHaveCount(1);
  await resident.getByRole('button', { name: 'Submit complaint' }).click();
  await expect(resident.getByText(/Complaint registered\. Ticket #SOC-INC-\d+/)).toBeVisible();
  const ticket = (await resident.locator('h1').innerText()).replace('#', '').trim();
  await expect(resident.locator('img.photo-thumb')).toHaveCount(1);

  const admin = await asAdmin(browser);
  await admin.goto('/admin/complaints');
  await admin.getByPlaceholder('Ticket, title, description or flat').fill(ticket);
  await admin.locator('tr', { hasText: ticket }).click();
  await expect(admin.getByRole('heading', { name: 'Balcony drain pipe leaking' })).toBeVisible();
  await admin.getByLabel('Technician / vendor').fill('Ramu (Plumber)');
  await admin.getByRole('button', { name: 'Save assignment' }).click();
  await expect(admin.locator('.page-head').getByText('Technician assigned')).toBeVisible();
  await admin.getByRole('button', { name: 'Start work' }).click();
  await expect(admin.locator('.page-head').getByText('In progress')).toBeVisible();
  await admin.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(admin.locator('.page-head').getByText('Resolved')).toBeVisible();

  await resident.goto('/app/notifications');
  await expect(resident.getByText(`${ticket} resolved`)).toBeVisible();
  await expect(resident.getByText(`${ticket}: technician assigned`)).toBeVisible();
  await resident.goto('/app/complaints');
  await resident.getByRole('button', { name: 'All' }).click();
  await resident.locator('.list-item', { hasText: 'Balcony drain pipe leaking' }).click();
  await resident.getByRole('button', { name: 'Yes, it’s fixed' }).click();
  await expect(resident.getByText('Thanks for confirming')).toBeVisible();
  await resident.getByRole('radio', { name: '5 stars' }).click();
  await resident.getByRole('button', { name: 'Submit rating' }).click();
  await expect(resident.getByText('Your rating')).toBeVisible();

  await admin.reload();
  await expect(admin.locator('.page-head').getByText('Closed')).toBeVisible();
  await expect(admin.getByText('Resident rating')).toBeVisible();
});

test('Facility: book a slot → unavailable to others → cancel → available again', async ({ browser }) => {
  const resident = await asMobile(browser, RESIDENT, MOBILE);
  await resident.goto('/app/facilities');
  await resident.getByRole('link', { name: /Meeting Room/ }).click();
  await resident.locator('.date-pill').nth(1).click(); // tomorrow
  const slot = resident.getByRole('button', { name: /^10:00–11:00 AM available$/ });
  await slot.click();
  await resident.getByRole('button', { name: /Book 10:00 AM/ }).click();
  await expect(resident.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible();
  await expect(resident.getByRole('dialog')).toContainText('Meeting Room');
  await resident.getByRole('button', { name: 'Done' }).click();
  await expect(resident.getByRole('button', { name: /^10:00–11:00 AM mine$/ })).toBeVisible();

  const tenant = await asMobile(browser, TENANT, MOBILE);
  await tenant.goto(resident.url());
  await tenant.locator('.date-pill').nth(1).click();
  await expect(tenant.getByRole('button', { name: /^10:00–11:00 AM booked$/ })).toBeDisabled();

  await resident.goto('/app/facilities/bookings');
  const booking = resident.locator('.card', { hasText: 'Meeting Room' });
  resident.once('dialog', (d) => d.accept());
  await booking.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(resident.getByText('Booking cancelled')).toBeVisible();

  await tenant.reload();
  await tenant.locator('.date-pill').nth(1).click();
  await expect(tenant.getByRole('button', { name: /^10:00–11:00 AM available$/ })).toBeEnabled();
});

test('Announcement: admin publishes → residents notified → appears on resident home', async ({ browser }) => {
  const admin = await asAdmin(browser);
  await admin.goto('/admin/announcements');
  await admin.getByRole('button', { name: 'New announcement' }).click();
  await admin.getByLabel('Title').fill('Clubhouse closed on Sunday');
  await admin.getByLabel('Message').fill('The clubhouse will be closed this Sunday for floor polishing.');
  await admin.getByLabel('Priority').selectOption('important');
  await admin.getByRole('button', { name: 'Publish & notify' }).click();
  await expect(admin.getByText(/Published — [\d,]+ people notified/)).toBeVisible();

  const resident = await asMobile(browser, RESIDENT, MOBILE);
  await expect(resident.locator('.card', { hasText: 'LATEST ANNOUNCEMENT' })).toContainText('Clubhouse closed on Sunday');
  await resident.goto('/app/notifications');
  await expect(resident.getByText('Clubhouse closed on Sunday')).toBeVisible();
});

test('Super admin sees platform aggregates but cannot open society resident data', async ({ browser }) => {
  const page = await newPage(browser, { viewport: { width: 1400, height: 900 } });
  await adminLogin(page, 'superadmin@societyone.in', 'SocietyOne@2026');
  await expect(page.getByRole('heading', { name: 'SocietyOne Platform' })).toBeVisible();
  await page.goto('/platform/societies');
  await expect(page.getByText('Green Meadows Residential Society')).toBeVisible();
  await expect(page.getByText('Lakeview Heights')).toBeVisible();
  await page.goto('/admin/residents');
  await expect(page).toHaveURL(/\/platform/); // redirected back to own portal
});
