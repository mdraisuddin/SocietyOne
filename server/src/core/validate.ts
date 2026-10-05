import { z } from 'zod';

export { z };

/** Indian mobile: accepts 9876543210, +919876543210, 09876543210, "+91 98765 43210" and normalises to E.164. */
export const indianMobile = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .transform((s) => (s.startsWith('+91') ? s.slice(3) : s.startsWith('91') && s.length === 12 ? s.slice(2) : s.startsWith('0') && s.length === 11 ? s.slice(1) : s))
  .refine((s) => /^[6-9]\d{9}$/.test(s), 'Enter a valid 10-digit Indian mobile number')
  .transform((s) => `+91${s}`);

export const uuid = z.string().uuid('Invalid identifier');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD date format');
export const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, 'Use HH:MM 24-hour time')
  .transform((s) => s.slice(0, 5));
export const text = (max: number, min = 1) => z.string().trim().min(min, 'This field is required').max(max, `Maximum ${max} characters`);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maximum ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
export const vehicleNumber = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .refine((s) => s === '' || /^[A-Z0-9]{4,12}$/.test(s), 'Invalid vehicle number')
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function pageClause(p: { page: number; pageSize: number }) {
  return { limit: p.pageSize, offset: (p.page - 1) * p.pageSize };
}

/** Escape LIKE wildcards in user search input. */
export function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
