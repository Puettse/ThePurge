let selectedGuildId = null;

const JELLYFIN_CATALOG_PAGE_SIZE = 50;

const state = {
  health: null,
  me: null,
  guilds: [],
  jellyfin: null,
  catalog: { items: [], total: 0, enabledCount: 0, configured: false },
  catalogPage: 0,
};

const elements = {
  status: document.querySelector('#status'),
  guildList: document.querySelector('#guildList'),
  loginButton: document.querySelector('#loginButton'),
  logoutButton: document.querySelector('#logoutButton'),
  jellyfinRefreshButton: document.querySelector('#jellyfinRefreshButton'),
  jellyfinStatus: document.querySelector('#jellyfinStatus'),
  jellyfinSummary: document.querySelector('#jellyfinSummary'),
  jellyfinLibraries: document.querySelector('#jellyfinLibraries'),
  jellyfinSessions: document.querySelector('#jellyfinSessions'),
  jellyfinErrors: document.querySelector('#jellyfinErrors'),
  jellyfinCatalogRefreshButton: document.querySelector('#jellyfinCatalogRefreshButton'),
  jellyfinCatalogSearch: document.querySelector('#jellyfinCatalogSearch'),
  jellyfinCatalogAvailableOnly: document.querySelector('#jellyfinCatalogAvailableOnly'),
  jellyfinCatalogStatus: document.querySelector('#jellyfinCatalogStatus'),
  jellyfinCatalogSummary: document.querySelector('#jellyfinCatalogSummary'),
  jellyfinCatalogList: document.querySelector('#jellyfinCatalogList'),
  jellyfinCatalogPrevButton: document.querySelector('#jellyfinCatalogPrevButton'),
  jellyfinCatalogNextButton: document.querySelector('#jellyfinCatalogNextButton'),
};

async function boot() {
  bindControls();
  await refreshHealth();
  await refreshMe();
  renderAuth();

  if (!state.me?.user) {
    renderLoggedOut();
    return;
  }

  await refreshGuilds();
}

function bindControls() {
  elements.logoutButton.onclick = async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.reload();
  };

  elements.jellyfinRefreshButton.onclick = async () => {
    await refreshSelectedGuildData();
  };

  elements.jellyfinCatalogRefreshButton.onclick = async () => {
    elements.jellyfinCatalogStatus.textContent = 'Syncing Jellyfin catalogue...';
    state.catalogPage = 0;
    await refreshCatalog({ forceRefresh: true });
    renderCatalog();
  };

  elements.jellyfinCatalogSearch.oninput = () => {
    state.catalogPage = 0;
    renderCatalog();
  };

  elements.jellyfinCatalogAvailableOnly.onchange = () => {
    state.catalogPage = 0;
    renderCatalog();
  };

  elements.jellyfinCatalogPrevButton.onclick = () => {
    state.catalogPage = Math.max(0, state.catalogPage - 1);
    renderCatalog();
  };

  elements.jellyfinCatalogNextButton.onclick = () => {
    state.catalogPage += 1;
    renderCatalog();
  };
}

async function refreshHealth() {
  try {
    state.health = await api('/api/health');
    elements.status.textContent = `Bot ${state.health.bot.ready ? 'online' : 'starting'} | Guilds ${state.health.bot.guildCount} | OAuth ${state.health.dashboard.authConfigured ? 'configured' : 'not configured'}`;
  } catch (error) {
    elements.status.textContent = error.message;
  }
}

async function refreshMe() {
  state.me = await api('/api/me');
}

async function refreshGuilds() {
  try {
    const data = await api('/api/guilds');
    state.guilds = data.guilds || [];

    const selectedStillValid = state.guilds.some((guild) => guild.id === selectedGuildId && guild.botPresent);
    if (!selectedStillValid) {
      selectedGuildId = state.guilds.find((guild) => guild.botPresent)?.id || null;
    }

    renderGuilds();
    await refreshSelectedGuildData();
  } catch (error) {
    elements.guildList.innerHTML = '';
    appendEmpty(elements.guildList, error.message);
    renderEmptyManagementState(error.message);
  }
}

async function refreshSelectedGuildData() {
  if (!selectedGuildId) {
    renderEmptyManagementState('Select a server to manage catalogue visibility.');
    return;
  }

  elements.jellyfinStatus.textContent = 'Loading Jellyfin status...';
  elements.jellyfinCatalogStatus.textContent = 'Loading catalogue...';
  await Promise.all([
    refreshJellyfin(),
    refreshCatalog(),
  ]);
  renderJellyfin();
  renderCatalog();
}

async function refreshJellyfin() {
  if (!selectedGuildId) {
    state.jellyfin = null;
    return;
  }

  try {
    state.jellyfin = await api(`/api/guilds/${selectedGuildId}/jellyfin/status`);
  } catch (error) {
    state.jellyfin = { ok: false, configured: false, error: error.message, missingConfig: [] };
  }
}

async function refreshCatalog(options = {}) {
  if (!selectedGuildId) {
    state.catalog = { items: [], total: 0, enabledCount: 0, configured: false };
    return;
  }

  try {
    const refresh = options.forceRefresh ? '?refresh=true' : '';
    state.catalog = await api(`/api/guilds/${selectedGuildId}/jellyfin/catalog${refresh}`);
  } catch (error) {
    state.catalog = {
      ok: false,
      configured: false,
      items: [],
      total: 0,
      enabledCount: 0,
      error: error.message,
      missingConfig: [],
    };
  }
}

function renderAuth() {
  const loggedIn = Boolean(state.me?.user);
  elements.loginButton.style.display = loggedIn ? 'none' : '';
  elements.logoutButton.style.display = loggedIn ? '' : 'none';
}

function renderLoggedOut() {
  elements.guildList.innerHTML = '';
  appendEmpty(elements.guildList, 'Sign in with Discord to load manageable servers.');
  renderEmptyManagementState('Authentication required.');
}

function renderGuilds() {
  elements.guildList.innerHTML = '';

  if (!state.guilds.length) {
    appendEmpty(elements.guildList, 'No manageable servers returned.');
    return;
  }

  for (const guild of state.guilds) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = guild.id === selectedGuildId ? '' : 'secondary';
    button.disabled = !guild.botPresent;
    button.textContent = `${guild.name}${guild.botPresent ? '' : ' (bot missing)'}`;
    button.onclick = async () => {
      selectedGuildId = guild.id;
      state.catalogPage = 0;
      renderGuilds();
      await refreshSelectedGuildData();
    };
    elements.guildList.append(button);
  }
}

function renderEmptyManagementState(message) {
  elements.jellyfinSummary.innerHTML = '';
  elements.jellyfinLibraries.innerHTML = '';
  elements.jellyfinSessions.innerHTML = '';
  elements.jellyfinErrors.textContent = '';
  elements.jellyfinCatalogSummary.innerHTML = '';
  elements.jellyfinCatalogList.innerHTML = '';
  elements.jellyfinStatus.textContent = message;
  elements.jellyfinCatalogStatus.textContent = message;
  setCatalogControlsDisabled(true);
}

function renderJellyfin() {
  elements.jellyfinSummary.innerHTML = '';
  elements.jellyfinLibraries.innerHTML = '';
  elements.jellyfinSessions.innerHTML = '';
  elements.jellyfinErrors.textContent = '';
  elements.jellyfinRefreshButton.disabled = !selectedGuildId;

  if (!selectedGuildId) {
    elements.jellyfinStatus.textContent = 'Select a server to load Jellyfin status.';
    return;
  }

  const jellyfin = state.jellyfin;
  if (!jellyfin) {
    elements.jellyfinStatus.textContent = 'Loading Jellyfin status...';
    return;
  }

  if (jellyfin.error) {
    elements.jellyfinStatus.textContent = jellyfin.error;
    appendMetrics(elements.jellyfinSummary, [
      ['Host', jellyfin.baseUrl || 'Unknown'],
      ['Server', 'Unavailable'],
    ]);
    return;
  }

  if (!jellyfin.configured) {
    elements.jellyfinStatus.textContent = `Not configured. Missing ${jellyfin.missingConfig.join(', ')}.`;
    appendMetrics(elements.jellyfinSummary, [
      ['Host', jellyfin.baseUrl || 'Not set'],
      ['Server', 'Not connected'],
    ]);
    return;
  }

  const system = jellyfin.system || jellyfin.publicInfo || {};
  elements.jellyfinStatus.textContent = jellyfin.ok
    ? `Connected to ${system.name || 'Jellyfin'}${system.version ? ` ${system.version}` : ''}.`
    : 'Jellyfin configured, but system info failed.';

  appendMetrics(elements.jellyfinSummary, [
    ['Host', jellyfin.baseUrl],
    ['Server', system.name || 'Unknown'],
    ['Version', system.version || 'Unknown'],
    ['Libraries', String((jellyfin.libraries || []).length)],
    ['Active Sessions', String((jellyfin.sessions || []).length)],
  ]);

  appendList(
    elements.jellyfinLibraries,
    jellyfin.libraries || [],
    (library) => ({
      title: library.name,
      detail: `${library.collectionType || 'library'} | ${library.itemCount || 0} items | ${library.pathCount || 0} paths`,
    }),
    'No libraries returned.',
  );

  appendList(
    elements.jellyfinSessions,
    jellyfin.sessions || [],
    (session) => ({
      title: [session.userName, session.client, session.deviceName].filter(Boolean).join(' | ') || 'Unknown session',
      detail: session.nowPlaying
        ? `Now playing: ${session.nowPlaying.name || 'Unknown'}${session.playState?.paused ? ' (paused)' : ''}`
        : `Last active: ${formatDate(session.lastActivityDate)}`,
    }),
    'No active sessions returned.',
  );

  elements.jellyfinErrors.textContent = formatSectionErrors(jellyfin.sectionErrors || {});
}

function renderCatalog() {
  elements.jellyfinCatalogList.innerHTML = '';
  elements.jellyfinCatalogSummary.innerHTML = '';
  setCatalogControlsDisabled(!selectedGuildId);

  if (!selectedGuildId) {
    elements.jellyfinCatalogStatus.textContent = 'Select a server to load the catalogue.';
    return;
  }

  const catalog = state.catalog || {};
  appendMetrics(elements.jellyfinCatalogSummary, [
    ['Synced Titles', String(catalog.total || 0)],
    ['Visible In Server', String(catalog.enabledCount || 0)],
    ['Hidden From Server', String(Math.max(0, (catalog.total || 0) - (catalog.enabledCount || 0)))],
  ]);

  if (catalog.error) {
    elements.jellyfinCatalogStatus.textContent = catalog.error;
    elements.jellyfinCatalogPrevButton.disabled = true;
    elements.jellyfinCatalogNextButton.disabled = true;
    return;
  }

  if (!catalog.configured) {
    const missing = catalog.missingConfig?.length ? ` Missing ${catalog.missingConfig.join(', ')}.` : '';
    elements.jellyfinCatalogStatus.textContent = `Catalogue not configured.${missing}`;
    elements.jellyfinCatalogPrevButton.disabled = true;
    elements.jellyfinCatalogNextButton.disabled = true;
    return;
  }

  const filtered = getFilteredCatalogItems();
  const pageCount = Math.max(1, Math.ceil(filtered.length / JELLYFIN_CATALOG_PAGE_SIZE));
  state.catalogPage = Math.min(Math.max(0, state.catalogPage), pageCount - 1);
  const pageItems = filtered.slice(
    state.catalogPage * JELLYFIN_CATALOG_PAGE_SIZE,
    state.catalogPage * JELLYFIN_CATALOG_PAGE_SIZE + JELLYFIN_CATALOG_PAGE_SIZE,
  );

  elements.jellyfinCatalogStatus.textContent = `${catalog.total || 0} titles synced. ${catalog.enabledCount || 0} visible in the Discord server. Showing ${filtered.length} filtered title${filtered.length === 1 ? '' : 's'}.`;
  elements.jellyfinCatalogPrevButton.disabled = state.catalogPage <= 0;
  elements.jellyfinCatalogNextButton.disabled = state.catalogPage >= pageCount - 1;

  if (!pageItems.length) {
    appendEmpty(elements.jellyfinCatalogList, 'No catalogue titles match the current filter.');
    return;
  }

  for (const item of pageItems) {
    elements.jellyfinCatalogList.append(createCatalogRow(item));
  }
}

function setCatalogControlsDisabled(disabled) {
  elements.jellyfinCatalogRefreshButton.disabled = disabled;
  elements.jellyfinCatalogSearch.disabled = disabled;
  elements.jellyfinCatalogAvailableOnly.disabled = disabled;
  elements.jellyfinCatalogPrevButton.disabled = disabled;
  elements.jellyfinCatalogNextButton.disabled = disabled;
}

function getFilteredCatalogItems() {
  const search = elements.jellyfinCatalogSearch.value.trim().toLowerCase();
  const availableOnly = elements.jellyfinCatalogAvailableOnly.checked;

  return (state.catalog.items || []).filter((item) => {
    if (availableOnly && !item.enabled) return false;
    if (!search) return true;

    return [
      item.name,
      item.productionYear,
      ...(item.genres || []),
      ...(item.actors || []),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });
}

function createCatalogRow(item) {
  const row = document.createElement('div');
  row.className = 'item catalog-row';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'catalog-title';
  const title = document.createElement('strong');
  title.textContent = item.productionYear ? `${item.name} (${item.productionYear})` : item.name;
  const detail = document.createElement('small');
  detail.textContent = [
    (item.genres || []).slice(0, 3).join(', '),
    (item.actors || []).slice(0, 3).join(', '),
    item.runtimeMinutes ? `${item.runtimeMinutes} min` : '',
  ].filter(Boolean).join(' | ') || 'No metadata returned.';
  titleWrap.append(title, detail);

  const switchLabel = document.createElement('label');
  switchLabel.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(item.enabled);
  input.setAttribute('aria-label', `Make ${item.name} visible in Discord server catalog`);
  const slider = document.createElement('span');
  slider.className = 'slider';
  input.onchange = async () => {
    const nextValue = input.checked;
    input.disabled = true;
    elements.jellyfinCatalogStatus.textContent = `${nextValue ? 'Showing' : 'Hiding'} ${item.name} in the Discord server...`;

    try {
      const result = await api(`/api/guilds/${selectedGuildId}/jellyfin/catalog/${encodeURIComponent(item.id)}/access`, {
        method: 'PUT',
        body: { enabled: nextValue },
      });
      const current = (state.catalog.items || []).find((catalogItem) => catalogItem.id === item.id);
      if (current) current.enabled = result.item.enabled;
      state.catalog.enabledCount = (state.catalog.items || []).filter((catalogItem) => catalogItem.enabled).length;
      renderCatalog();
    } catch (error) {
      input.checked = !nextValue;
      input.disabled = false;
      elements.jellyfinCatalogStatus.textContent = error.message;
    }
  };
  switchLabel.append(input, slider);

  row.append(titleWrap, switchLabel);
  return row;
}

function appendMetrics(container, metrics) {
  container.innerHTML = '';
  for (const [label, value] of metrics) {
    const card = document.createElement('div');
    card.className = 'metric-card';
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const valueEl = document.createElement('strong');
    valueEl.textContent = value || 'Unknown';
    card.append(labelEl, valueEl);
    container.append(card);
  }
}

function appendList(container, items, renderItem, emptyText) {
  container.innerHTML = '';
  if (!items.length) {
    appendEmpty(container, emptyText);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'item';
    const rendered = renderItem(item);
    const title = document.createElement('strong');
    title.textContent = rendered.title;
    const detail = document.createElement('small');
    detail.textContent = rendered.detail;
    row.append(title, detail);
    container.append(row);
  }
}

function appendEmpty(container, text) {
  const empty = document.createElement('div');
  empty.className = 'item';
  empty.textContent = text;
  container.append(empty);
}

function formatDate(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatSectionErrors(sectionErrors = {}) {
  const seenMessages = new Set();
  return Object.entries(sectionErrors)
    .filter(([, message]) => {
      const key = String(message || '');
      if (!key || seenMessages.has(key)) return false;
      seenMessages.add(key);
      return true;
    })
    .map(([section, message]) => `${section}: ${message}`)
    .join(' | ');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

boot().catch((error) => {
  elements.status.textContent = error.message;
});
