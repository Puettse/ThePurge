import { Router } from 'express';
import { getJellyfinSnapshot } from '../../../services/jellyfinService.js';

export function createJellyfinRouter(context) {
  const router = Router({ mergeParams: true });

  router.get('/jellyfin/status', wrap(async (req, res) => {
    const snapshot = await getJellyfinSnapshot(context.config);
    res.json(snapshot);
  }));

  return router;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
