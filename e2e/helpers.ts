import { expect, type Browser, type Page } from '@playwright/test';

export const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
export const TABLET = { viewport: { width: 820, height: 1180 }, hasTouch: true };

export async function otpLogin(page: Page, mobile: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await page.getByRole('button', { name: 'Use code' }).click();
  await page.waitForURL(/\/(app|guard)/);
}

export async function adminLogin(page: Page, email = 'admin@greenmeadows.in', password = 'GreenMeadows@2026') {
  await page.goto('/login');
  await page.getByRole('button', { name: /Admin login/ }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/(admin|platform)/);
}

export async function newPage(browser: Browser, opts = {}) {
  const ctx = await browser.newContext(opts);
  return ctx.newPage();
}

// Sign each person in once and reuse the session: re-requesting an OTP within 30 s is
// (correctly) rate-limited by the API.
const sessions = new Map<string, any>();
export async function asMobile(browser: Browser, mobile: string, opts = {}) {
  const ctx = await browser.newContext({ ...opts, storageState: sessions.get(mobile) });
  const page = await ctx.newPage();
  if (sessions.has(mobile)) {
    await page.goto('/');
    await page.waitForURL(/\/(app|guard)/);
  } else {
    await otpLogin(page, mobile);
    sessions.set(mobile, await ctx.storageState());
  }
  return page;
}
export async function asAdmin(browser: Browser, email = 'admin@greenmeadows.in', password = 'GreenMeadows@2026', opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...opts, storageState: sessions.get(email) });
  const page = await ctx.newPage();
  if (sessions.has(email)) await page.goto('/');
  else {
    await adminLogin(page, email, password);
    sessions.set(email, await ctx.storageState());
  }
  return page;
}

/** HH:MM in IST, `mins` from now (capped to keep the pass window inside today). */
export function istTimeFromNow(mins: number) {
  const d = new Date(Date.now() + mins * 60_000);
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return t < '00:30' ? '23:30' : t;
}

export async function typeKeypad(page: Page, code: string) {
  for (const d of code) await page.locator('.keypad').getByRole('button', { name: d, exact: true }).click();
}

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
export { expect };
