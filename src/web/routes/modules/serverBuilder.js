import { Router } from 'express';
import { PermissionFlagsBits } from 'discord.js';
import {
  applyServerBuilderConfig,
  listServerBuilderConfigs,
  listServerBuilderRuns,
  previewServerBuilderConfig,
  saveServerBuilderConfig,
  ServerBuilderValidationError,
  validateSavedServerBuilderConfig,
} from '../../../services/serverBuilderService.js';

export function createServerBuilderRouter(context) {
  const router = Router({ mergeParams: true });

  router.use(requireGuildAdministrator);

  router.get('/server-builder/configs', wrap(async (req, res) => {
    res.json(await listServerBuilderConfigs(context, req.guild.id));
  }));

  router.post('/server-builder/configs', wrapServerBuilder(async (req, res) => {
    res.json(await saveServerBuilderConfig(context, req.guild, req.session.user, req.body || {}));
  }));

  router.post('/server-builder/configs/:configKey/validate', wrapServerBuilder(async (req, res) => {
    res.json(await validateSavedServerBuilderConfig(context, req.guild.id, req.params.configKey));
  }));

  router.post('/server-builder/configs/:configKey/preview', wrapServerBuilder(async (req, res) => {
    const result = await previewServerBuilderConfig(context, req.guild, req.session.user, {
      ...(req.body || {}),
      configKey: req.params.configKey,
    });
    res.status(result.ok ? 200 : 400).json(result);
  }));

  router.post('/server-builder/configs/:configKey/apply', wrapServerBuilder(async (req, res) => {
    const result = await applyServerBuilderConfig(context, req.guild, req.session.user, {
      ...(req.body || {}),
      configKey: req.params.configKey,
    });
    res.status(result.ok ? 200 : 400).json(result);
  }));

  router.get('/server-builder/runs', wrap(async (req, res) => {
    res.json(await listServerBuilderRuns(context, req.guild.id, req.query.limit));
  }));

  return router;
}

async function requireGuildAdministrator(req, res, next) {
  const member = await req.guild.members.fetch(req.session.user.id).catch(() => null);
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    res.status(403).json({ error: 'Server Builder requires Administrator permission in this guild.' });
    return;
  }
  next();
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function wrapServerBuilder(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
    if (error instanceof ServerBuilderValidationError) {
      res.status(400).json({
        ok: false,
        error: error.message,
        errors: error.details || [],
      });
      return;
    }
    next(error);
  });
}
