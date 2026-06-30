import { Router } from 'express';
import {
  getRemoteVoiceStatus,
  joinRemoteVoiceChannel,
  leaveRemoteVoiceChannel,
  listRemoteChannels,
  RemoteValidationError,
  sendRemoteChannelMessage,
} from '../../../services/remoteControlService.js';

export function createRemoteOpsRouter(context) {
  const router = Router({ mergeParams: true });

  router.get('/remote/channels', wrap(async (req, res) => {
    const channels = await listRemoteChannels(req.guild);
    res.json(channels);
  }));

  router.get('/remote/voice', (req, res) => {
    res.json({ voice: getRemoteVoiceStatus(req.guild) });
  });

  router.post('/remote/messages', wrapRemote(async (req, res) => {
    const result = await sendRemoteChannelMessage(context, req.guild, req.session.user, req.body || {});
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  }));

  router.post('/remote/voice/join', wrapRemote(async (req, res) => {
    const result = await joinRemoteVoiceChannel(context, req.guild, req.session.user, req.body || {});
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  }));

  router.post('/remote/voice/leave', wrapRemote(async (req, res) => {
    const result = await leaveRemoteVoiceChannel(context, req.guild, req.session.user);
    res.json(result);
  }));

  return router;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function wrapRemote(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
    if (error instanceof RemoteValidationError) {
      res.status(400).json({ ok: false, message: error.message });
      return;
    }
    next(error);
  });
}
