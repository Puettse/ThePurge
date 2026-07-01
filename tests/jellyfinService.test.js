import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCatalogFacets,
  createJellyfinPlayUrl,
  filterCatalogItems,
  getJellyfinConfigStatus,
  getJellyfinCatalogForGuild,
  getJellyfinSnapshot,
  normalizeJellyfinBaseUrl,
} from '../src/services/jellyfinService.js';

test('Jellyfin config status reports missing env vars without exposing a token', () => {
  assert.deepEqual(getJellyfinConfigStatus({}), {
    configured: false,
    baseUrl: null,
    missingConfig: ['JELLYFIN_BASE_URL', 'JELLYFIN_API_KEY'],
  });
});

test('Jellyfin base URL normalization accepts only http URLs', () => {
  assert.equal(normalizeJellyfinBaseUrl('https://media.example.com///'), 'https://media.example.com');
  assert.equal(normalizeJellyfinBaseUrl('http://192.168.1.20:8096/'), 'http://192.168.1.20:8096');
  assert.equal(normalizeJellyfinBaseUrl('ftp://media.example.com'), '');
  assert.equal(normalizeJellyfinBaseUrl('not a url'), '');
});

test('Jellyfin snapshot calls stable API endpoints with server-side auth headers', async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url: String(url), headers: options.headers });

    if (String(url).includes('/System/Info/Public')) {
      return jsonResponse({ ServerName: 'Media', Version: '10.10.7' });
    }

    if (String(url).includes('/System/Info')) {
      return jsonResponse({
        Id: 'server-id',
        ServerName: 'Media',
        Version: '10.10.7',
        OperatingSystem: 'Linux',
        StartupWizardCompleted: true,
      });
    }

    if (String(url).includes('/Library/MediaFolders')) {
      return jsonResponse({ Items: [{ Id: 'movies', Name: 'Movies', CollectionType: 'movies', ChildCount: 42 }] });
    }

    if (String(url).includes('/Sessions')) {
      return jsonResponse([{ Id: 'session-1', UserName: 'seth', Client: 'Web', DeviceName: 'Chrome', IsActive: true }]);
    }

    if (String(url).includes('/System/ActivityLog/Entries')) {
      return jsonResponse({ Items: [{ Id: 1, Name: 'Playback started', Severity: 'Information' }] });
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  const snapshot = await getJellyfinSnapshot({
    jellyfinBaseUrl: 'https://media.example.com/',
    jellyfinApiKey: 'secret-token',
  }, { fetch });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.system.name, 'Media');
  assert.equal(snapshot.libraries[0].name, 'Movies');
  assert.equal(snapshot.sessions[0].userName, 'seth');
  assert.equal(requests.length, 5);
  assert.ok(requests.every((request) => request.headers.Authorization.includes('Token="secret-token"')));
  assert.ok(requests.every((request) => request.headers['X-Emby-Token'] === 'secret-token'));
  assert.ok(requests.every((request) => !request.headers['ngrok-skip-browser-warning']));
});

test('Jellyfin snapshot skips ngrok free-domain browser warning for server-side sync', async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url: String(url), headers: options.headers });

    if (String(url).includes('/System/Info/Public')) {
      return jsonResponse({ ServerName: 'Media', Version: '10.10.7' });
    }

    if (String(url).includes('/System/Info')) {
      return jsonResponse({ Id: 'server-id', ServerName: 'Media', Version: '10.10.7' });
    }

    if (String(url).includes('/Library/MediaFolders')) {
      return jsonResponse({ Items: [] });
    }

    if (String(url).includes('/Sessions')) {
      return jsonResponse([]);
    }

    if (String(url).includes('/System/ActivityLog/Entries')) {
      return jsonResponse({ Items: [] });
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  const snapshot = await getJellyfinSnapshot({
    jellyfinBaseUrl: 'https://goatskin-diffuser-fled.ngrok-free.dev/',
    jellyfinApiKey: 'secret-token',
  }, { fetch });

  assert.equal(snapshot.ok, true);
  assert.equal(requests.length, 5);
  assert.ok(requests.every((request) => request.headers['ngrok-skip-browser-warning'] === 'true'));
});

test('Jellyfin catalogue fetches movies and merges bot access flags', async () => {
  const requests = [];
  const context = {
    config: {
      jellyfinBaseUrl: 'https://catalog.example.com/',
      jellyfinPublicBaseUrl: 'https://entertainment.ebmsol.com/',
      jellyfinEnablePlayLinks: true,
      jellyfinApiKey: 'secret-token',
    },
    db: {
      query: async (sql, params) => {
        requests.push({ sql, params });
        return {
          rows: [{ item_id: 'movie-2', enabled: true, updated_at: new Date('2026-01-01T00:00:00Z'), updated_by: 'admin' }],
        };
      },
    },
  };
  const fetchRequests = [];
  const fetch = async (url) => {
    fetchRequests.push(String(url));
    const parsed = new URL(url);
    const startIndex = Number(parsed.searchParams.get('startIndex') || 0);
    if (startIndex === 0) {
      return jsonResponse({
        TotalRecordCount: 2,
        Items: [
          movieItem({ Id: 'movie-1', Name: 'Alpha', ProductionYear: 2001, Genres: ['Action'], People: [{ Name: 'Alex Actor', Type: 'Actor' }] }),
          movieItem({ Id: 'movie-2', Name: 'Beta', ProductionYear: 2002, Genres: ['Drama'], People: [{ Name: 'Bailey Star', Type: 'Actor' }] }),
        ],
      });
    }
    return jsonResponse({ TotalRecordCount: 2, Items: [] });
  };

  const catalog = await getJellyfinCatalogForGuild(context, 'guild-1', { fetch, forceRefresh: true });

  assert.equal(catalog.total, 2);
  assert.equal(catalog.enabledCount, 1);
  assert.equal(catalog.items[0].enabled, false);
  assert.equal(catalog.items[1].enabled, true);
  assert.equal(catalog.items[1].playUrl, 'https://entertainment.ebmsol.com/web/#/details?id=movie-2');
  assert.equal(fetchRequests[0].includes('/Items?'), true);
  assert.equal(requests[0].params[0], 'guild-1');
});

test('Jellyfin play links are disabled until the EBMSOL domain guard is live', () => {
  assert.equal(createJellyfinPlayUrl({
    jellyfinBaseUrl: 'https://goatskin-diffuser-fled.ngrok-free.dev/',
    jellyfinPublicBaseUrl: 'https://entertainment.ebmsol.com/',
    jellyfinEnablePlayLinks: false,
  }, 'movie-1'), '');
});

test('Jellyfin play links use the public EBMSOL domain when enabled', () => {
  assert.equal(createJellyfinPlayUrl({
    jellyfinBaseUrl: 'https://goatskin-diffuser-fled.ngrok-free.dev/',
    jellyfinPublicBaseUrl: 'https://entertainment.ebmsol.com/',
    jellyfinEnablePlayLinks: true,
  }, 'movie-1'), 'https://entertainment.ebmsol.com/web/#/details?id=movie-1');
});

test('Jellyfin play links require a public playback URL', () => {
  assert.equal(createJellyfinPlayUrl({
    jellyfinBaseUrl: 'https://goatskin-diffuser-fled.ngrok-free.dev/',
    jellyfinEnablePlayLinks: true,
  }, 'movie-1'), '');
});

test('Jellyfin catalogue retries localhost on IPv4 loopback', async () => {
  const context = {
    config: {
      jellyfinBaseUrl: 'http://localhost:8096/',
      jellyfinApiKey: 'secret-token',
    },
    db: {
      query: async () => ({ rows: [] }),
    },
  };
  const fetchRequests = [];
  const fetch = async (url) => {
    fetchRequests.push(String(url));
    if (new URL(url).hostname === 'localhost') {
      throw new TypeError('fetch failed');
    }
    return jsonResponse({
      TotalRecordCount: 1,
      Items: [movieItem({ Id: 'movie-1', Name: 'Alpha', ProductionYear: 2001 })],
    });
  };

  const catalog = await getJellyfinCatalogForGuild(context, 'guild-1', { fetch, forceRefresh: true });

  assert.equal(catalog.ok, true);
  assert.equal(catalog.total, 1);
  assert.equal(new URL(fetchRequests[0]).hostname, 'localhost');
  assert.equal(new URL(fetchRequests[1]).hostname, '127.0.0.1');
});

test('Jellyfin catalogue returns structured errors when the server is unreachable', async () => {
  const context = {
    config: {
      jellyfinBaseUrl: 'http://localhost:8096/',
      jellyfinApiKey: 'secret-token',
    },
    db: {
      query: async () => {
        throw new Error('database should not be called');
      },
    },
  };
  const fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const catalog = await getJellyfinCatalogForGuild(context, 'guild-1', { fetch, forceRefresh: true });

  assert.equal(catalog.ok, false);
  assert.equal(catalog.configured, true);
  assert.equal(catalog.total, 0);
  assert.deepEqual(catalog.items, []);
  assert.match(catalog.error, /loopback host/);
  assert.match(catalog.error, /Railway/);
});

test('Jellyfin catalogue facets support genre, year, and actor browsing', () => {
  const items = [
    { name: 'Alpha', sortName: 'Alpha', genres: ['Action'], productionYear: 2001, actors: ['Alex Actor'] },
    { name: 'Beta', sortName: 'Beta', genres: ['Action', 'Drama'], productionYear: 2002, actors: ['Alex Actor', 'Bailey Star'] },
  ];

  assert.deepEqual(buildCatalogFacets(items, 'genre').map((facet) => [facet.value, facet.count]), [['Action', 2], ['Drama', 1]]);
  assert.deepEqual(buildCatalogFacets(items, 'year').map((facet) => facet.value), ['2002', '2001']);
  assert.deepEqual(filterCatalogItems(items, 'actor', 'Alex Actor').map((item) => item.name), ['Alpha', 'Beta']);
});

function movieItem(overrides = {}) {
  return {
    Type: 'Movie',
    RunTimeTicks: 7_200_000_0000,
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  };
}
