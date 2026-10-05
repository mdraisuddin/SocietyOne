import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';

export const config = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required(
    'DATABASE_URL',
    nodeEnv === 'test'
      ? 'postgres://societyone:societyone@localhost:5432/societyone_test'
      : 'postgres://societyone:societyone@localhost:5432/societyone_dev',
  ),
  // In production APP_SECRET must be supplied via the secret manager / env; no default.
  appSecret: isProd ? required('APP_SECRET') : (process.env.APP_SECRET ?? 'dev-only-insecure-secret-do-not-use-in-prod'),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  uploadDir: process.env.UPLOAD_DIR ?? (nodeEnv === 'test' ? './test-uploads' : './uploads'),
  // Demo mode returns OTP codes / reset tokens in responses so the demo can be used without SMS/email.
  // It is forcibly disabled in production.
  demoMode: !isProd && (process.env.DEMO_MODE ?? 'true') === 'true',
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:support@societyone.in',
  },
  otp: {
    ttlSeconds: 300,
    resendCooldownSeconds: 30,
    maxPerHour: 5,
    maxAttempts: 5,
  },
  session: {
    ttlDays: 30,
    cookieName: 'so_session',
  },
  uploads: {
    maxBytes: 5 * 1024 * 1024,
  },
  approvalTtlMinutes: 15,
};
