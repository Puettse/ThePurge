import { Router } from 'express';
import {
  getJellyfinCatalogForGuild,
  getJellyfinSnapshot,
  setJellyfinCatalogAccess,
} from '../../../services/jellyfinService.js';

export function createJellyfinRouter(context) {
  const router = Router({ mergeParams: true });

  router.get('/jellyfin/status', wrap(async (req, res) => {
    const snapshot = await getJellyfinSnapshot(context.config);
    res.json(snapshot);
  }));

  router.get('/jellyfin/catalog', wrap(async (req, res) => {
    const catalog = await getJellyfinCatalogForGuild(context, req.guild.id, {
      forceRefresh: req.query.refresh === 'true',
    });
    res.json(catalog);
  }));

  router.put('/jellyfin/catalog/:itemId/access', wrap(async (req, res) => {
    const result = await setJellyfinCatalogAccess(
      context,
      req.guild.id,
      req.session.user.id,
      req.params.itemId,
      req.body?.enabled === true,
    );
    res.json(result);
  }));

  return router;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
