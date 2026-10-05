import crypto from 'node:crypto';
import { config } from '../config.js';

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Uniformly random numeric code (no modulo bias). */
export function randomDigits(n: number): string {
  let out = '';
  while (out.length < n) out += crypto.randomInt(0, 10).toString();
  return out;
}

export function hmac(data: string): string {
  return crypto.createHmac('sha256', config.appSecret).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** OTP hash binds the code to the mobile number and server secret. */
export const hashOtp = (mobile: string, code: string) => hmac(`otp:${mobile}:${code}`);
