import { Router } from 'express';
import {
  getRemoteVoiceClip,
  getRemoteVoiceStatus,
  joinRemoteVoiceChannel,
  leaveRemoteVoiceChannel,
  listRemoteVoiceRecords,
  listRemoteChannels,
  RemoteValidationError,
  sendRemoteChannelMessage,
  updateRemoteVoiceState,
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

  router.post('/remote/voice/state', wrapRemote(async (req, res) => {
    const result = await updateRemoteVoiceState(context, req.guild, req.session.user, req.body || {});
    res.json(result);
  }));

  router.get('/remote/voice/activity', wrap(async (req, res) => {
    const records = await listRemoteVoiceRecords(context, req.guild.id, req.query.limit);
    res.json(records);
  }));

  router.get('/remote/voice/clips/:clipId/audio', wrap(async (req, res) => {
    const clip = await getRemoteVoiceClip(context, req.guild.id, req.params.clipId);
    if (!clip) {
      res.status(404).json({ error: 'Voice clip not found.' });
      return;
    }
    res.setHeader('Content-Type', clip.content_type || 'audio/wav');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(clip.audio);
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
