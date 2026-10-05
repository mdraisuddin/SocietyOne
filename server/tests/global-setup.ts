export default async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://societyone:societyone@localhost:5432/societyone_test';
  const { migrate } = await import('../src/db/migrate.js');
  const { seed } = await import('../src/db/seed.js');
  const { pool } = await import('../src/db/pool.js');
  await migrate({ reset: true, quiet: true });
  await seed({ quiet: true });
  await pool.end();
}
