import { Router } from 'express';
import { runDashboardModerationAction } from '../../webActions.js';

export function createModerationRouter(context) {
  const router = Router({ mergeParams: true });

  router.post('/moderation/actions', wrap(async (req, res) => {
    const result = await runDashboardModerationAction(context, req.guild, req.session.user, req.body || {});
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  }));

  return router;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
