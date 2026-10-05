import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { errorHandler, notFound } from './core/errors.js';
import { loadSession } from './core/auth.js';
import { authRouter } from './modules/auth.js';
import { profileRouter, filesRouter } from './modules/profile.js';
import { notificationsRouter } from './modules/notifications.js';
import { platformRouter } from './modules/platform.js';
import { societyRouter, structureRouter } from './modules/society.js';
import { residentsRouter, guardsRouter } from './modules/people.js';
import { visitorsRouter, gateRouter } from './modules/visitors.js';
import { complaintsRouter } from './modules/complaints.js';
import { facilitiesRouter, bookingsRouter } from './modules/facilities.js';
import { announcementsRouter, emergencyRouter } from './modules/community.js';
import { dashboardRouter, homeRouter, searchRouter, auditRouter } from './modules/insights.js';
import { pool } from './db/pool.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind a TLS-terminating load balancer in production

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'", 'blob:'],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());

  // CORS: only for configured dev origins. Production serves the web app from the same origin.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-SocietyOne-Client,Idempotency-Key');
        res.setHeader('Access-Control-Max-Age', '600');
        return res.sendStatus(204);
      }
    }
    next();
  });

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'societyone', time: new Date().toISOString() });
  });

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(loadSession);
  api.use('/auth', authRouter);
  api.use('/profile', profileRouter);
  api.use('/files', filesRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/platform', platformRouter);
  api.use('/society', societyRouter);
  api.use('/structure', structureRouter);
  api.use('/residents', residentsRouter);
  api.use('/guards', guardsRouter);
  api.use('/visitors', visitorsRouter);
  api.use('/gate', gateRouter);
  api.use('/complaints', complaintsRouter);
  api.use('/facilities', facilitiesRouter);
  api.use('/bookings', bookingsRouter);
  api.use('/announcements', announcementsRouter);
  api.use('/emergency-contacts', emergencyRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/home', homeRouter);
  api.use('/search', searchRouter);
  api.use('/audit', auditRouter);
  api.use(() => {
    throw notFound('Endpoint');
  });
  app.use('/api/v1', api);

  // Serve the built web app (Resident, Security, Management and Platform apps) when present.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = [path.resolve(here, '../../web/dist'), path.resolve(here, '../web/dist')].find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (webDist) {
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders: (res, file) => {
          if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
