import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getJellyfinConfigStatus,
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
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  };
}
