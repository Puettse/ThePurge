import { PassThrough } from 'node:stream';
import { WebSocketServer } from 'ws';
import { canManageGuild } from './auth.js';
import {
  RemoteValidationError,
  startRemoteMicStream,
  stopRemoteMicStream,
} from '../services/remoteControlService.js';

const MAX_AUDIO_CHUNK_BYTES = 128 * 1024;
const REMOTE_MIC_PATH = /^\/api\/guilds\/(\d+)\/remote\/voice\/mic$/;

export function createRemoteVoiceBridge(context, auth) {
  const wsServer = new WebSocketServer({
    maxPayload: MAX_AUDIO_CHUNK_BYTES,
    noServer: true,
  });

  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      const match = getMicPathMatch(req);
      if (!match) return;

      let access;
      try {
        access = authorizeRequest(context, auth, req, match[1]);
      } catch (error) {
        rejectUpgrade(socket, error.statusCode || 401, error.message || 'Unauthorized');
        return;
      }

      wsServer.handleUpgrade(req, socket, head, (ws) => {
        wsServer.emit('connection', ws, req, access);
      });
    });
  }

  wsServer.on('connection', (ws, req, access) => {
    handleRemoteMicConnection(context, ws, access).catch((error) => {
      sendSocketJson(ws, { type: 'error', message: error.message || 'Dashboard audio failed.' });
      ws.close(error instanceof RemoteValidationError ? 1008 : 1011);
    });
  });

  return {
    attach,
    close() {
      wsServer.close();
    },
  };
}

async function handleRemoteMicConnection(context, ws, { guild, session }) {
  const pcmStream = new PassThrough({ highWaterMark: MAX_AUDIO_CHUNK_BYTES * 4 });
  let stopped = false;

  const stop = async (reason) => {
    if (stopped) return;
    stopped = true;
    pcmStream.end();
    await stopRemoteMicStream(context, guild, session.user, { reason }).catch(() => null);
  };

  let result;
  try {
    result = await startRemoteMicStream(context, guild, session.user, pcmStream, {
      source: 'dashboard',
    });
  } catch (error) {
    pcmStream.destroy();
    throw error;
  }
  sendSocketJson(ws, { type: 'ready', message: result.message, voice: result.voice });

  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (chunk.length > MAX_AUDIO_CHUNK_BYTES) {
      sendSocketJson(ws, { type: 'error', message: 'Audio chunk is too large.' });
      ws.close(1009);
      return;
    }

    if (!pcmStream.destroyed) {
      pcmStream.write(chunk);
    }
  });

  ws.on('close', () => {
    stop('socket_closed');
  });
  ws.on('error', () => {
    stop('socket_error');
  });
}

function authorizeRequest(context, auth, req, guildId) {
  req.cookies = parseCookies(req.headers.cookie || '');
  const session = auth.readCookie(req);
  if (!session || session.expiresAt < Date.now()) {
    throw createHttpError(401, 'Authentication required.');
  }

  const userGuild = session.guilds.find((guild) => guild.id === guildId);
  if (!userGuild || !canManageGuild(userGuild)) {
    throw createHttpError(403, 'Manage Server access is required.');
  }

  const guild = context.client.guilds.cache.get(guildId);
  if (!guild) {
    throw createHttpError(404, 'The bot is not in this guild.');
  }

  return { guild, session };
}

function getMicPathMatch(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  return url.pathname.match(REMOTE_MIC_PATH);
}

function rejectUpgrade(socket, statusCode, message) {
  socket.write([
    `HTTP/1.1 ${statusCode} ${httpStatusText(statusCode)}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(message)}`,
    '',
    message,
  ].join('\r\n'));
  socket.destroy();
}

function parseCookies(header) {
  return String(header)
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex === -1) return cookies;
      const key = decodeURIComponent(pair.slice(0, separatorIndex).trim());
      const value = decodeURIComponent(pair.slice(separatorIndex + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
}

function sendSocketJson(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function httpStatusText(statusCode) {
  if (statusCode === 403) return 'Forbidden';
  if (statusCode === 404) return 'Not Found';
  return 'Unauthorized';
}
