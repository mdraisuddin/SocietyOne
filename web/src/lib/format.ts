const TZ = 'Asia/Kolkata';

export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
export function addDaysISO(d: string, n: number) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}
export function nowHHMM() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

/** "7:00 PM" from "19:00" */
export function time12(hhmm?: string | null) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${suffix}`;
}
export const timeRange = (a?: string | null, b?: string | null) => `${time12(a).replace(/ (AM|PM)$/, (s) => (time12(b).endsWith(s.trim()) ? '' : s))}–${time12(b)}`;

/** "6 Oct 2026" from a YYYY-MM-DD */
export function dateLong(iso?: string | null) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
/** "Today", "Tomorrow", "Mon, 6 Oct" */
export function dayLabel(iso?: string | null) {
  if (!iso) return '';
  const t = todayISO();
  if (iso === t) return 'Today';
  if (iso === addDaysISO(t, 1)) return 'Tomorrow';
  if (iso === addDaysISO(t, -1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function dateTime(ts?: string | null) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
export function clock(ts?: string | null) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}
export function tsDay(ts: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts));
}
export function relative(ts?: string | null) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.round(diff / 86400)} d ago`;
  return dateLong(tsDay(ts));
}
export const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
export const firstName = (name?: string | null) => (name ?? '').split(/\s+/)[0];
export const titleCase = (s?: string | null) => (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const formatMobile = (m?: string | null) => (m ? m.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2') : '');
export const num = (n?: number | null) => (n ?? 0).toLocaleString('en-IN');

export const COMPLAINT_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'info' },
  assigned: { label: 'Technician assigned', tone: 'violet' },
  in_progress: { label: 'In progress', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' },
  closed: { label: 'Closed', tone: '' },
};
export const PRIORITY: Record<string, { label: string; tone: string }> = {
  low: { label: 'Low', tone: '' },
  medium: { label: 'Medium', tone: 'info' },
  high: { label: 'High', tone: 'warning' },
  urgent: { label: 'Urgent', tone: 'danger' },
};
export const CATEGORY_LABEL: Record<string, string> = {
  guest: 'Guest', delivery: 'Delivery', food_delivery: 'Food delivery', courier: 'Courier', cab: 'Cab', domestic_staff: 'Staff', service: 'Service',
};
