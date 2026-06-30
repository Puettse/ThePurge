export const JELLYFIN_CLIENT_NAME = 'ThePurge';
export const JELLYFIN_DEVICE_NAME = 'Railway Dashboard';
export const JELLYFIN_DEVICE_ID = 'thepurge-dashboard';
export const JELLYFIN_CLIENT_VERSION = '4.3.3';

const DEFAULT_TIMEOUT_MS = 10_000;

export function getJellyfinConfigStatus(config) {
  const baseUrl = normalizeJellyfinBaseUrl(config?.jellyfinBaseUrl || '');
  const apiKey = String(config?.jellyfinApiKey || '').trim();
  const missingConfig = [];

  if (!baseUrl) missingConfig.push('JELLYFIN_BASE_URL');
  if (!apiKey) missingConfig.push('JELLYFIN_API_KEY');

  return {
    configured: missingConfig.length === 0,
    baseUrl: baseUrl || null,
    missingConfig,
  };
}

export async function getJellyfinSnapshot(config, options = {}) {
  const status = getJellyfinConfigStatus(config);
  const checkedAt = new Date().toISOString();

  if (!status.configured) {
    return {
      ok: false,
      ...status,
      checkedAt,
      system: null,
      libraries: [],
      sessions: [],
      activity: [],
      sectionErrors: {},
    };
  }

  const sections = await loadJellyfinSections(config, options);

  return {
    ok: !sections.sectionErrors.system,
    ...status,
    checkedAt,
    system: sections.system,
    publicInfo: sections.publicInfo,
    libraries: sections.libraries,
    sessions: sections.sessions,
    activity: sections.activity,
    sectionErrors: sections.sectionErrors,
  };
}

export function normalizeJellyfinBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

async function loadJellyfinSections(config, options) {
  const definitions = {
    system: async () => normalizeSystemInfo(await jellyfinRequest(config, '/System/Info', {}, options)),
    publicInfo: async () => normalizePublicInfo(await jellyfinRequest(config, '/System/Info/Public', {}, options)),
    libraries: async () => normalizeMediaFolders(await jellyfinRequest(config, '/Library/MediaFolders', { isHidden: false }, options)),
    sessions: async () => normalizeSessions(await jellyfinRequest(config, '/Sessions', { activeWithinSeconds: 3600 }, options)),
    activity: async () => normalizeActivity(await jellyfinRequest(config, '/System/ActivityLog/Entries', { startIndex: 0, limit: 10 }, options)),
  };

  const loaded = {};
  const sectionErrors = {};

  await Promise.all(Object.entries(definitions).map(async ([name, load]) => {
    try {
      loaded[name] = await load();
    } catch (error) {
      loaded[name] = defaultSectionValue(name);
      sectionErrors[name] = String(error?.message || error);
    }
  }));

  return {
    system: loaded.system,
    publicInfo: loaded.publicInfo,
    libraries: loaded.libraries,
    sessions: loaded.sessions,
    activity: loaded.activity,
    sectionErrors,
  };
}

async function jellyfinRequest(config, path, query = {}, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new JellyfinApiError('Fetch is not available in this runtime.');
  }

  const baseUrl = normalizeJellyfinBaseUrl(config.jellyfinBaseUrl);
  if (!baseUrl) {
    throw new JellyfinApiError('Jellyfin base URL is not configured.');
  }

  const url = new URL(path, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: jellyfinHeaders(config.jellyfinApiKey),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new JellyfinApiError(`Jellyfin request failed: ${response.status} ${response.statusText}`.trim(), response.status);
    }

    if (response.status === 204) return null;
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new JellyfinApiError('Jellyfin request timed out.');
    }
    if (error instanceof JellyfinApiError) throw error;
    throw new JellyfinApiError(`Jellyfin request failed: ${error?.message || error}`);
  } finally {
    clearTimeout(timeout);
  }
}

function jellyfinHeaders(apiKey) {
  const token = String(apiKey || '').trim();
  return {
    Accept: 'application/json',
    Authorization: `MediaBrowser Client="${JELLYFIN_CLIENT_NAME}", Device="${JELLYFIN_DEVICE_NAME}", DeviceId="${JELLYFIN_DEVICE_ID}", Version="${JELLYFIN_CLIENT_VERSION}", Token="${token}"`,
    'X-Emby-Token': token,
  };
}

function normalizeSystemInfo(value = {}) {
  return {
    id: value.Id || null,
    name: value.ServerName || value.LocalAddress || 'Jellyfin',
    version: value.Version || null,
    operatingSystem: value.OperatingSystem || null,
    architecture: value.SystemArchitecture || null,
    startupWizardCompleted: Boolean(value.StartupWizardCompleted),
    webSocketPortNumber: value.WebSocketPortNumber || null,
  };
}

function normalizePublicInfo(value = {}) {
  return {
    id: value.Id || null,
    name: value.ServerName || 'Jellyfin',
    version: value.Version || null,
    startupWizardCompleted: Boolean(value.StartupWizardCompleted),
  };
}

function normalizeMediaFolders(value = {}) {
  return (value.Items || []).map((item) => ({
    id: item.Id,
    name: item.Name || 'Unnamed library',
    collectionType: item.CollectionType || item.Type || 'library',
    itemCount: item.ChildCount || 0,
    pathCount: Array.isArray(item.Locations) ? item.Locations.length : 0,
  }));
}

function normalizeSessions(value = []) {
  return value.map((session) => ({
    id: session.Id || session.DeviceId || null,
    userName: session.UserName || null,
    client: session.Client || null,
    deviceName: session.DeviceName || null,
    remoteEndPoint: session.RemoteEndPoint || null,
    isActive: Boolean(session.IsActive),
    lastActivityDate: session.LastActivityDate || null,
    nowPlaying: session.NowPlayingItem ? {
      name: session.NowPlayingItem.Name || null,
      type: session.NowPlayingItem.Type || null,
      productionYear: session.NowPlayingItem.ProductionYear || null,
    } : null,
    playState: session.PlayState ? {
      paused: Boolean(session.PlayState.IsPaused),
      positionTicks: session.PlayState.PositionTicks || 0,
    } : null,
  }));
}

function normalizeActivity(value = {}) {
  return (value.Items || []).map((item) => ({
    id: item.Id || null,
    name: item.Name || null,
    overview: item.Overview || item.ShortOverview || null,
    type: item.Type || null,
    severity: item.Severity || null,
    date: item.Date || null,
    userName: item.UserName || null,
  }));
}

function defaultSectionValue(name) {
  if (name === 'system' || name === 'publicInfo') return null;
  return [];
}

export class JellyfinApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'JellyfinApiError';
    this.status = status;
  }
}
