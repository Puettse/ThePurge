import { Router } from 'express';

export function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/^[!/]+/, '').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

export function lazyRouter(name, loader) {
  const boundary = Router({ mergeParams: true });
  let routerPromise = null;

  boundary.use(async (req, res, next) => {
    try {
      routerPromise ||= Promise.resolve(loader());
      const router = await routerPromise;
      router(req, res, next);
    } catch (error) {
      req.app?.locals?.liveFeed?.publish?.('dashboard.module_failed', {
        module: name,
        error: String(error?.message || error),
      }, 'error');

      res.status(503).json({
        error: `${name} dashboard module is unavailable.`,
        module: name,
      });
    }
  });

  return boundary;
}
