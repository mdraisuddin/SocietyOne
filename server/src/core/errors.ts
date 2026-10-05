import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Please sign in to continue') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have permission to do this') => new AppError(403, 'forbidden', msg);
export const notFound = (what = 'Record') => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'conflict', msg, details);
export const tooMany = (msg: string, retryAfterSeconds?: number) =>
  new AppError(429, 'rate_limited', msg, retryAfterSeconds ? { retryAfterSeconds } : undefined);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'validation_error',
        message: err.issues[0]?.message ?? 'Invalid input',
        fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  const anyErr = err as any;
  if (anyErr?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
  }
  if (anyErr?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'file_too_large', message: 'File is too large (max 5 MB)' } });
  }
  // Postgres constraint violations -> safe messages, never leak SQL
  if (anyErr?.code === '23505') {
    return res.status(409).json({ error: { code: 'duplicate', message: 'A record with these details already exists' } });
  }
  if (anyErr?.code === '23503') {
    return res.status(400).json({ error: { code: 'invalid_reference', message: 'A referenced record does not exist' } });
  }
  if (anyErr?.code === '23514' || anyErr?.code === '22P02' || anyErr?.code === '22007' || anyErr?.code === '22008') {
    return res.status(400).json({ error: { code: 'invalid_value', message: 'One or more values are invalid' } });
  }
  console.error(err);
  return res.status(500).json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
}
