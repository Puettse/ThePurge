import { Router } from 'express';
import { closeTicketFromDashboard, createTicketPanel } from '../../../services/ticketService.js';

export function createTicketsRouter(context) {
  const router = Router({ mergeParams: true });

  router.post('/ticket-panels', wrap(async (req, res) => {
    const body = req.body || {};
    if (!body.channelId) {
      res.status(400).json({ error: 'channelId is required.' });
      return;
    }

    const staffRoleIds = String(body.staffRoleIds || '')
      .split(',')
      .map((roleId) => roleId.trim())
      .filter(Boolean);

    const panel = await createTicketPanel(context, req.guild, {
      channelId: body.channelId,
      categoryId: body.categoryId || null,
      staffRoleIds,
      title: body.title || undefined,
      description: body.description || undefined,
      buttonLabel: body.buttonLabel || undefined,
      actorId: req.session.user.id,
      source: 'dashboard',
    });

    res.json({ ok: true, panel });
  }));

  router.post('/tickets/:ticketId/close', wrap(async (req, res) => {
    const result = await closeTicketFromDashboard(
      context,
      req.guild,
      req.session.user.id,
      req.params.ticketId,
      req.body?.reason || 'Closed from dashboard.',
    );

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
