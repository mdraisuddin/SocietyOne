import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { badRequest } from './errors.js';

/**
 * File storage adapter. Local disk for the MVP; swap for S3/GCS by implementing the same interface.
 * Files are stored under random keys, never user-supplied names, and are served only through
 * authorised endpoints that check society ownership.
 */
const MAGIC: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/** Validate by content (magic bytes), not by client-declared type or extension. */
export function detectImage(buf: Buffer) {
  const m = MAGIC.find((x) => buf.length > 12 && x.test(buf));
  if (!m) throw badRequest('Only JPEG, PNG or WebP images are allowed');
  return m;
}

export async function saveImage(societyId: string, folder: string, buf: Buffer) {
  if (buf.length > config.uploads.maxBytes) throw badRequest('Image is too large (max 5 MB)');
  const kind = detectImage(buf);
  const key = `${societyId}/${folder}/${crypto.randomUUID()}.${kind.ext}`;
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf, { mode: 0o640 });
  return { key, mime: kind.mime, size: buf.length };
}

export function resolveKey(key: string) {
  if (!/^[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) throw badRequest('Invalid file key');
  return path.resolve(config.uploadDir, key);
}

export function keySociety(key: string) {
  return key.split('/')[0];
}
