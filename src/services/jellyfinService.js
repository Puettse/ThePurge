export const JELLYFIN_CLIENT_NAME = 'ThePurge';
export const JELLYFIN_DEVICE_NAME = 'Railway Dashboard';
export const JELLYFIN_DEVICE_ID = 'thepurge-dashboard';
export const JELLYFIN_CLIENT_VERSION = '4.3.8';

const DEFAULT_TIMEOUT_MS = 10_000;
const CATALOG_PAGE_SIZE = 200;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const MOVIE_FIELDS = [
  'Genres',
  'Overview',
  'People',
  'PrimaryImageAspectRatio',
  'ProductionLocations',
  'ProviderIds',
  'Studios',
];

const catalogCache = new Map();

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

export async function getJellyfinCatalogForGuild(context, guildId, options = {}) {
  const status = getJellyfinConfigStatus(context.config);
  const checkedAt = new Date().toISOString();
  if (!status.configured) {
    return {
      ok: false,
      ...status,
      items: [],
      total: 0,
      enabledCount: 0,
      checkedAt,
    };
  }

  let mergedItems;
  try {
    const items = await getJellyfinMovieCatalog(context.config, options);
    mergedItems = await mergeCatalogAccess(context.db, guildId, items);
  } catch (error) {
    return {
      ok: false,
      ...status,
      items: [],
      total: 0,
      enabledCount: 0,
      checkedAt,
      error: String(error?.message || error),
    };
  }

  return {
    ok: true,
    ...status,
    total: mergedItems.length,
    enabledCount: mergedItems.filter((item) => item.enabled).length,
    checkedAt,
    items: mergedItems,
  };
}

export async function setJellyfinCatalogAccess(context, guildId, actorId, itemId, enabled) {
  const movie = await getJellyfinMovieById(context.config, itemId);
  await context.db.query(
    `
    INSERT INTO jellyfin_catalog_access (
      guild_id, item_id, title, production_year, genres, people, enabled, updated_by, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (guild_id, item_id) DO UPDATE SET
      title = EXCLUDED.title,
      production_year = EXCLUDED.production_year,
      genres = EXCLUDED.genres,
      people = EXCLUDED.people,
      enabled = EXCLUDED.enabled,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING *;
    `,
    [
      guildId,
      movie.id,
      movie.name,
      movie.productionYear,
      JSON.stringify(movie.genres),
      JSON.stringify(movie.people),
      Boolean(enabled),
      actorId,
    ],
  );

  await recordJellyfinAudit(context, {
    guildId,
    actorId,
    targetId: movie.id,
    action: 'jellyfin.catalog_access_updated',
    details: {
      itemId: movie.id,
      title: movie.name,
      enabled: Boolean(enabled),
    },
  });

  return {
    ok: true,
    item: {
      ...movie,
      enabled: Boolean(enabled),
      playUrl: createJellyfinPlayUrl(context.config, movie.id),
    },
  };
}

export async function getEnabledJellyfinCatalog(context, guildId, options = {}) {
  const catalog = await getJellyfinCatalogForGuild(context, guildId, options);
  return {
    ...catalog,
    items: catalog.items.filter((item) => item.enabled),
    enabledCount: catalog.enabledCount,
  };
}

export function buildCatalogFacets(items, mode) {
  const counts = new Map();

  for (const item of items) {
    for (const value of getFacetValues(item, mode)) {
      const key = String(value || '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const facets = Array.from(counts.entries()).map(([value, count]) => ({
    value,
    label: value,
    count,
  }));

  if (mode === 'year') {
    facets.sort((left, right) => Number(right.value) - Number(left.value));
  } else {
    facets.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
  }

  return facets;
}

export function filterCatalogItems(items, mode, value) {
  const expected = String(value || '').trim().toLowerCase();
  if (!expected) return [];

  return items
    .filter((item) => getFacetValues(item, mode).some((facet) => String(facet).trim().toLowerCase() === expected))
    .sort(sortMoviesByTitle);
}

export function createJellyfinPlayUrl(config, itemId) {
  if (!config?.jellyfinEnablePlayLinks) return '';
  const baseUrl = normalizeJellyfinBaseUrl(config?.jellyfinPublicBaseUrl || '');
  if (!baseUrl || !itemId) return '';
  return `${baseUrl}/web/#/details?id=${encodeURIComponent(itemId)}`;
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

async function getJellyfinMovieCatalog(config, options = {}) {
  const status = getJellyfinConfigStatus(config);
  if (!status.configured) {
    throw new JellyfinApiError(`Jellyfin is not configured. Missing ${status.missingConfig.join(', ')}.`);
  }

  const cacheKey = [
    status.baseUrl,
    normalizeJellyfinBaseUrl(config?.jellyfinPublicBaseUrl || ''),
    config?.jellyfinEnablePlayLinks ? 'links-on' : 'links-off',
  ].join('|');
  const cached = catalogCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  const items = [];
  let startIndex = 0;
  let total = null;

  do {
    const result = await jellyfinRequest(config, '/Items', {
      recursive: true,
      includeItemTypes: ['Movie'],
      fields: MOVIE_FIELDS,
      sortBy: ['SortName'],
      sortOrder: ['Ascending'],
      startIndex,
      limit: CATALOG_PAGE_SIZE,
    }, options);

    const pageItems = (result?.Items || []).map((item) => normalizeMovieItem(config, item));
    items.push(...pageItems);
    total = Number.isFinite(result?.TotalRecordCount) ? result.TotalRecordCount : items.length;
    startIndex += pageItems.length;

    if (pageItems.length === 0) break;
  } while (items.length < total);

  catalogCache.set(cacheKey, {
    items,
    expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
  });

  return items;
}

async function getJellyfinMovieById(config, itemId, options = {}) {
  const result = await jellyfinRequest(config, `/Items/${encodeURIComponent(itemId)}`, {
    fields: MOVIE_FIELDS,
  }, options);
  return normalizeMovieItem(config, result);
}

async function mergeCatalogAccess(db, guildId, items) {
  if (!items.length) return [];

  const itemIds = items.map((item) => item.id);
  const result = await db.query(
    `
    SELECT item_id, enabled, updated_at, updated_by
    FROM jellyfin_catalog_access
    WHERE guild_id = $1
      AND item_id = ANY($2::text[])
    `,
    [guildId, itemIds],
  );
  const accessByItemId = new Map(result.rows.map((row) => [row.item_id, row]));

  return items.map((item) => {
    const access = accessByItemId.get(item.id);
    return {
      ...item,
      enabled: Boolean(access?.enabled),
      updatedAt: access?.updated_at || null,
      updatedBy: access?.updated_by || null,
    };
  });
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

  const urls = [url];
  const localhostFallbackUrl = createLocalhostIpv4FallbackUrl(url);
  if (localhostFallbackUrl) urls.push(localhostFallbackUrl);

  try {
    let lastNetworkError = null;

    for (const requestUrl of urls) {
      try {
        const response = await fetchImpl(requestUrl, {
          headers: jellyfinHeaders(config.jellyfinApiKey, requestUrl),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new JellyfinApiError(`Jellyfin request failed: ${response.status} ${response.statusText}`.trim(), response.status);
        }

        if (response.status === 204) return null;
        return response.json();
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (error instanceof JellyfinApiError) throw error;
        lastNetworkError = error;
      }
    }

    throw new JellyfinApiError(formatJellyfinConnectionError(baseUrl, lastNetworkError));
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

function jellyfinHeaders(apiKey, requestUrl) {
  const token = String(apiKey || '').trim();
  const headers = {
    Accept: 'application/json',
    Authorization: `MediaBrowser Client="${JELLYFIN_CLIENT_NAME}", Device="${JELLYFIN_DEVICE_NAME}", DeviceId="${JELLYFIN_DEVICE_ID}", Version="${JELLYFIN_CLIENT_VERSION}", Token="${token}"`,
    'X-Emby-Token': token,
  };

  if (isNgrokFreeUrl(requestUrl)) {
    headers['ngrok-skip-browser-warning'] = 'true';
  }

  return headers;
}

function isNgrokFreeUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().endsWith('.ngrok-free.dev');
  } catch {
    return false;
  }
}

function createLocalhostIpv4FallbackUrl(url) {
  if (String(url.hostname || '').toLowerCase() !== 'localhost') return null;
  const fallbackUrl = new URL(url.toString());
  fallbackUrl.hostname = '127.0.0.1';
  return fallbackUrl;
}

function formatJellyfinConnectionError(baseUrl, error) {
  const reason = String(error?.message || error || 'fetch failed');
  const loopbackNote = isLoopbackBaseUrl(baseUrl)
    ? ' JELLYFIN_BASE_URL is a loopback host; it only reaches Jellyfin when the dashboard server runs on the same machine. On Railway, set it to a public, tunnel, VPN, or Railway-private URL reachable from the Railway service.'
    : ' Confirm JELLYFIN_BASE_URL is reachable from the dashboard server.';
  return `Jellyfin request failed: ${reason}.${loopbackNote}`;
}

function isLoopbackBaseUrl(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

function normalizeMovieItem(config, value = {}) {
  const people = normalizePeople(value.People || []);
  return {
    id: value.Id,
    serverId: value.ServerId || null,
    name: value.Name || value.OriginalTitle || 'Untitled',
    originalTitle: value.OriginalTitle || null,
    sortName: value.SortName || value.Name || '',
    type: value.Type || 'Movie',
    overview: value.Overview || '',
    productionYear: Number.isFinite(value.ProductionYear) ? value.ProductionYear : null,
    premiereDate: value.PremiereDate || null,
    officialRating: value.OfficialRating || null,
    communityRating: Number.isFinite(value.CommunityRating) ? value.CommunityRating : null,
    runtimeTicks: Number.isFinite(value.RunTimeTicks) ? value.RunTimeTicks : null,
    runtimeMinutes: Number.isFinite(value.RunTimeTicks) ? Math.round(value.RunTimeTicks / 600_000_000) : null,
    genres: Array.isArray(value.Genres) ? value.Genres.filter(Boolean).map(String) : [],
    people,
    actors: people.filter((person) => person.type.toLowerCase() === 'actor').map((person) => person.name),
    studios: normalizeNamedValues(value.Studios || []),
    productionLocations: Array.isArray(value.ProductionLocations) ? value.ProductionLocations.filter(Boolean).map(String) : [],
    providerIds: value.ProviderIds || {},
    hasPrimaryImage: Boolean(value.ImageTags?.Primary),
    playUrl: createJellyfinPlayUrl(config, value.Id),
  };
}

function normalizePeople(people) {
  return people
    .filter((person) => person?.Name)
    .map((person) => ({
      id: person.Id || null,
      name: person.Name,
      type: person.Type || 'Person',
      role: person.Role || null,
    }));
}

function normalizeNamedValues(values) {
  return values
    .map((value) => (typeof value === 'string' ? value : value?.Name))
    .filter(Boolean)
    .map(String);
}

function getFacetValues(item, mode) {
  if (mode === 'genre') return item.genres || [];
  if (mode === 'year') return item.productionYear ? [String(item.productionYear)] : [];
  if (mode === 'actor') return item.actors || [];
  return [];
}

function sortMoviesByTitle(left, right) {
  return (left.sortName || left.name).localeCompare(right.sortName || right.name, undefined, { sensitivity: 'base' });
}

async function recordJellyfinAudit(context, event) {
  if (context.audit) {
    await context.audit.record({
      ...event,
      source: 'dashboard',
    });
    return;
  }

  context.liveFeed.publish(`audit.${event.action}`, {
    ...event,
    source: 'dashboard',
    severity: 'info',
  });
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
