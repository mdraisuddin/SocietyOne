import { config } from './config.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { startScheduler } from './jobs.js';

async function main() {
  await migrate({ quiet: true });
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`SocietyOne API listening on http://localhost:${config.port} (${config.nodeEnv}${config.demoMode ? ', demo mode' : ''})`);
  });
  startScheduler();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
