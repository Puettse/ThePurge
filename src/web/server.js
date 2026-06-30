import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createAuth } from './auth.js';
import { createCoreRouter } from './routes/core.js';
import { createGuildRouter } from './routes/guilds.js';
import { createHealthSnapshot } from './routes/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

export function createDashboardServer(context) {
  const app = express();
  const auth = createAuth(context.config);
  let server = null;

  app.disable('x-powered-by');
  app.locals.liveFeed = context.liveFeed;
  app.use(express.json({ limit: '12mb' }));
  app.use(cookieParser());
  app.use(express.static(publicDir));

  app.get('/health', (req, res) => {
    res.json(createHealthSnapshot(context, auth));
  });

  app.get('/auth/login', auth.login);
  app.get('/auth/callback', wrap(auth.callback));
  app.post('/auth/logout', auth.logout);

  app.use('/api', createCoreRouter(context, auth));
  app.use('/api/guilds', auth.requireAuth, createGuildRouter(context));

  app.use((error, req, res, next) => {
    console.error('[dashboard] Request failed', error);
    context.liveFeed.publish('dashboard.error', { error: String(error?.message || error), path: req.path }, 'error');
    res.status(500).json({ error: 'Dashboard request failed.' });
  });

  return {
    app,
    listen(port, callback) {
      server = app.listen(port, callback);
      return server;
    },
    close() {
      if (server) server.close();
    },
  };
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
