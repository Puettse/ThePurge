import { Router } from 'express';
import { InviteValidationError, sendServerInvite } from '../../../services/inviteService.js';

export function createInvitesRouter(context) {
  const router = Router({ mergeParams: true });

  router.post('/invites', wrap(async (req, res) => {
    try {
      const result = await sendServerInvite(context, req.guild, req.session.user, req.body || {});
      res.json(result);
    } catch (error) {
      if (error instanceof InviteValidationError) {
        res.status(400).json({ ok: false, message: error.message });
        return;
      }
      throw error;
    }
  }));

  return router;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
