let selectedGuildId = null;

const state = {
  health: null,
  me: null,
  guilds: [],
  overview: null,
  remoteChannels: { textChannels: [], voiceChannels: [] },
  remoteVoice: { connected: false, channelId: null, status: 'disconnected' },
  remoteError: null,
};

const elements = {
  status: document.querySelector('#status'),
  guildList: document.querySelector('#guildList'),
  modules: document.querySelector('#modules'),
  commands: document.querySelector('#commands'),
  jobs: document.querySelector('#jobs'),
  feed: document.querySelector('#feed'),
  settingsForm: document.querySelector('#settingsForm'),
  commandForm: document.querySelector('#commandForm'),
  automodForm: document.querySelector('#automodForm'),
  scheduleForm: document.querySelector('#scheduleForm'),
  ticketPanelForm: document.querySelector('#ticketPanelForm'),
  tickets: document.querySelector('#tickets'),
  remoteMessageForm: document.querySelector('#remoteMessageForm'),
  remoteTextChannel: document.querySelector('#remoteTextChannel'),
  remoteFiles: document.querySelector('#remoteFiles'),
  remoteMessageStatus: document.querySelector('#remoteMessageStatus'),
  remoteVoiceForm: document.querySelector('#remoteVoiceForm'),
  remoteVoiceChannel: document.querySelector('#remoteVoiceChannel'),
  remoteVoiceLeaveButton: document.querySelector('#remoteVoiceLeaveButton'),
  remoteVoiceStatus: document.querySelector('#remoteVoiceStatus'),
  logoutButton: document.querySelector('#logoutButton'),
};

async function boot() {
  await refreshHealth();
  await refreshMe();
  bindForms();
  startFeed();
  renderRemoteOps();

  if (state.me?.user) {
    await refreshGuilds();
    if (!selectedGuildId) renderRemoteOps();
  }
}

async function refreshHealth() {
  state.health = await api('/api/health');
  elements.status.textContent = `Bot ${state.health.bot.ready ? 'online' : 'starting'} | Guilds ${state.health.bot.guildCount} | OAuth ${state.health.dashboard.authConfigured ? 'configured' : 'not configured'}`;
}

async function refreshMe() {
  state.me = await api('/api/me');
}

async function refreshGuilds() {
  const data = await api('/api/guilds');
  state.guilds = data.guilds;
  elements.guildList.innerHTML = '';

  for (const guild of state.guilds) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = guild.id === selectedGuildId ? '' : 'secondary';
    button.textContent = `${guild.name}${guild.botPresent ? '' : ' (bot missing)'}`;
    button.onclick = async () => {
      selectedGuildId = guild.id;
      setRemoteMessageStatus('');
      await refreshOverview();
      await refreshGuilds();
    };
    elements.guildList.append(button);
  }

  if (!selectedGuildId && state.guilds[0]?.botPresent) {
    selectedGuildId = state.guilds.find((guild) => guild.botPresent)?.id;
    await refreshOverview();
  }
}

async function refreshOverview() {
  if (!selectedGuildId) return;
  state.overview = await api(`/api/guilds/${selectedGuildId}/overview`);
  await refreshRemoteOps();
  renderOverview();
}

async function refreshRemoteOps() {
  try {
    const [channels, voice] = await Promise.all([
      api(`/api/guilds/${selectedGuildId}/remote/channels`),
      api(`/api/guilds/${selectedGuildId}/remote/voice`),
    ]);
    state.remoteChannels = channels;
    state.remoteVoice = voice.voice;
    state.remoteError = null;
  } catch (error) {
    state.remoteChannels = { textChannels: [], voiceChannels: [] };
    state.remoteVoice = { connected: false, channelId: null, status: 'unavailable' };
    state.remoteError = error.message;
  }
}

function renderOverview() {
  renderModules();
  renderRemoteOps();
  renderSettings();
  renderCommands();
  renderJobs();
  renderTickets();
}

function renderModules() {
  elements.modules.innerHTML = '';
  for (const module of state.overview.modules) {
    const row = document.createElement('div');
    row.className = 'module';
    row.innerHTML = `<strong>${module.module_name}</strong>`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = module.enabled ? 'On' : 'Off';
    toggle.className = module.enabled ? '' : 'secondary';
    toggle.onclick = async () => {
      await api(`/api/guilds/${selectedGuildId}/modules/${module.module_name}`, {
        method: 'PUT',
        body: { enabled: !module.enabled },
      });
      await refreshOverview();
    };
    row.append(toggle);
    elements.modules.append(row);
  }
}

function renderRemoteOps() {
  const textChannels = state.remoteChannels.textChannels || [];
  const voiceChannels = state.remoteChannels.voiceChannels || [];

  populateChannelSelect(elements.remoteTextChannel, textChannels, 'Select text channel');
  populateChannelSelect(elements.remoteVoiceChannel, voiceChannels, 'Select voice channel');

  const hasTextChannel = textChannels.length > 0;
  const hasVoiceChannel = voiceChannels.length > 0;
  elements.remoteMessageForm.querySelector('button[type="submit"]').disabled = !selectedGuildId || !hasTextChannel;
  elements.remoteVoiceForm.querySelector('button[type="submit"]').disabled = !selectedGuildId || !hasVoiceChannel;
  elements.remoteVoiceLeaveButton.disabled = !selectedGuildId;

  if (state.remoteError) {
    elements.remoteMessageStatus.textContent = state.remoteError;
    elements.remoteVoiceStatus.textContent = state.remoteError;
    return;
  }

  if (!hasTextChannel) {
    elements.remoteMessageStatus.textContent = 'No text channels available.';
  } else if (!elements.remoteMessageStatus.dataset.locked) {
    elements.remoteMessageStatus.textContent = '';
  }

  const connectedChannel = voiceChannels.find((channel) => channel.id === state.remoteVoice.channelId);
  elements.remoteVoiceStatus.textContent = state.remoteVoice.connected
    ? `Connected to ${connectedChannel?.name || state.remoteVoice.channelId} (${state.remoteVoice.status})`
    : 'Disconnected';
}

function renderSettings() {
  const settings = state.overview.settings || {};
  elements.settingsForm.prefix.value = settings.prefix || '!';
  elements.settingsForm.logChannelId.value = settings.log_channel_id || '';
  elements.settingsForm.welcomeChannelId.value = settings.welcome_channel_id || '';
  elements.settingsForm.welcomeMessage.value = settings.welcome_message || '';
}

function renderCommands() {
  elements.commands.innerHTML = '';
  for (const command of state.overview.customCommands) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<span>!${escapeHtml(command.name)}</span>`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.onclick = async () => {
      await api(`/api/guilds/${selectedGuildId}/custom-commands/${command.name}`, { method: 'DELETE' });
      await refreshOverview();
    };
    row.append(remove);
    elements.commands.append(row);
  }
}

function renderJobs() {
  elements.jobs.innerHTML = '';
  for (const job of state.overview.scheduledJobs) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<span>#${job.id} ${escapeHtml(job.job_type)} every ${job.interval_seconds}s</span>`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Disable';
    remove.onclick = async () => {
      await api(`/api/guilds/${selectedGuildId}/scheduled-jobs/${job.id}`, { method: 'DELETE' });
      await refreshOverview();
    };
    row.append(remove);
    elements.jobs.append(row);
  }
}

function renderTickets() {
  elements.tickets.innerHTML = '';
  const tickets = state.overview.tickets || [];
  for (const ticket of tickets) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<span>#${ticket.id} ${escapeHtml(ticket.status)} <#${ticket.channel_id}> by ${escapeHtml(ticket.opener_id)}</span>`;

    if (ticket.status === 'open') {
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close';
      close.onclick = async () => {
        await api(`/api/guilds/${selectedGuildId}/tickets/${ticket.id}/close`, {
          method: 'POST',
          body: { reason: 'Closed from dashboard.' },
        });
        await refreshOverview();
      };
      row.append(close);
    }

    elements.tickets.append(row);
  }
}

function bindForms() {
  elements.logoutButton.onclick = async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.reload();
  };

  elements.remoteMessageForm.onsubmit = async (event) => {
    event.preventDefault();
    setRemoteMessageStatus('Sending...');

    try {
      requireGuildSelection();
      const selectedChannelId = elements.remoteTextChannel.value;
      const files = await readSelectedFiles(elements.remoteFiles.files);
      const result = await api(`/api/guilds/${selectedGuildId}/remote/messages`, {
        method: 'POST',
        body: {
          channelId: selectedChannelId,
          content: elements.remoteMessageForm.content.value,
          files,
          allowMentions: elements.remoteMessageForm.allowMentions.checked,
        },
      });

      elements.remoteMessageForm.reset();
      elements.remoteTextChannel.value = selectedChannelId;
      setRemoteMessageStatus(result.message);
    } catch (error) {
      setRemoteMessageStatus(error.message);
    }
  };

  elements.remoteVoiceForm.onsubmit = async (event) => {
    event.preventDefault();
    elements.remoteVoiceStatus.textContent = 'Connecting...';

    try {
      requireGuildSelection();
      const result = await api(`/api/guilds/${selectedGuildId}/remote/voice/join`, {
        method: 'POST',
        body: {
          channelId: elements.remoteVoiceChannel.value,
          selfMute: elements.remoteVoiceForm.selfMute.checked,
          selfDeaf: elements.remoteVoiceForm.selfDeaf.checked,
        },
      });
      state.remoteVoice = result.voice;
      elements.remoteVoiceStatus.textContent = result.message;
      await refreshRemoteOps();
      renderRemoteOps();
    } catch (error) {
      elements.remoteVoiceStatus.textContent = error.message;
    }
  };

  elements.remoteVoiceLeaveButton.onclick = async () => {
    elements.remoteVoiceStatus.textContent = 'Disconnecting...';

    try {
      requireGuildSelection();
      const result = await api(`/api/guilds/${selectedGuildId}/remote/voice/leave`, { method: 'POST' });
      state.remoteVoice = result.voice;
      elements.remoteVoiceStatus.textContent = result.message;
      await refreshRemoteOps();
      renderRemoteOps();
    } catch (error) {
      elements.remoteVoiceStatus.textContent = error.message;
    }
  };

  elements.settingsForm.onsubmit = async (event) => {
    event.preventDefault();
    await api(`/api/guilds/${selectedGuildId}/settings`, {
      method: 'PUT',
      body: {
        prefix: elements.settingsForm.prefix.value,
        logChannelId: elements.settingsForm.logChannelId.value,
        welcomeChannelId: elements.settingsForm.welcomeChannelId.value,
        welcomeMessage: elements.settingsForm.welcomeMessage.value,
      },
    });
    await refreshOverview();
  };

  elements.commandForm.onsubmit = async (event) => {
    event.preventDefault();
    await api(`/api/guilds/${selectedGuildId}/custom-commands`, {
      method: 'POST',
      body: {
        name: elements.commandForm.name.value,
        response: elements.commandForm.response.value,
        allowMentions: elements.commandForm.allowMentions.checked,
      },
    });
    elements.commandForm.reset();
    await refreshOverview();
  };

  elements.automodForm.onsubmit = async (event) => {
    event.preventDefault();
    const blockedWord = elements.automodForm.blockedWord.value.trim();
    const trigger = {
      blockInvites: elements.automodForm.blockInvites.checked,
      blockLinks: elements.automodForm.blockLinks.checked,
      blockedWords: blockedWord ? [blockedWord] : [],
    };
    await api(`/api/guilds/${selectedGuildId}/automod-rules`, {
      method: 'POST',
      body: { trigger, actions: [{ type: 'delete' }], enabled: true },
    });
    elements.automodForm.reset();
    await refreshOverview();
  };

  elements.scheduleForm.onsubmit = async (event) => {
    event.preventDefault();
    await api(`/api/guilds/${selectedGuildId}/scheduled-jobs`, {
      method: 'POST',
      body: {
        channelId: elements.scheduleForm.channelId.value,
        jobType: 'message',
        intervalSeconds: Number(elements.scheduleForm.intervalSeconds.value),
        payload: { message: elements.scheduleForm.message.value },
      },
    });
    elements.scheduleForm.reset();
    await refreshOverview();
  };

  elements.ticketPanelForm.onsubmit = async (event) => {
    event.preventDefault();
    await api(`/api/guilds/${selectedGuildId}/ticket-panels`, {
      method: 'POST',
      body: {
        channelId: elements.ticketPanelForm.channelId.value,
        staffRoleIds: elements.ticketPanelForm.staffRoleIds.value,
        categoryId: elements.ticketPanelForm.categoryId.value,
        title: elements.ticketPanelForm.title.value,
        description: elements.ticketPanelForm.description.value,
        buttonLabel: elements.ticketPanelForm.buttonLabel.value,
      },
    });
    await refreshOverview();
  };
}

function startFeed() {
  const source = new EventSource('/api/feed/events');
  source.onmessage = (event) => addEvent(JSON.parse(event.data));
  source.addEventListener('audit.dashboard.module_updated', (event) => addEvent(JSON.parse(event.data)));
  source.onerror = () => addEvent({ type: 'feed.disconnected', severity: 'error', payload: {}, createdAt: new Date().toISOString() });

  api('/api/feed/history').then((data) => {
    for (const event of data.events.reverse()) addEvent(event);
  });
}

function addEvent(event) {
  const row = document.createElement('div');
  row.className = `event ${event.severity === 'error' ? 'error' : ''}`;
  row.textContent = `${event.createdAt} ${event.type}\n${JSON.stringify(event.payload)}`;
  elements.feed.prepend(row);
  while (elements.feed.children.length > 80) elements.feed.lastChild.remove();
}

function populateChannelSelect(select, channels, placeholder) {
  const previousValue = select.value;
  select.innerHTML = '';

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  select.append(placeholderOption);

  for (const channel of channels) {
    const option = document.createElement('option');
    option.value = channel.id;
    option.textContent = channel.name;
    select.append(option);
  }

  if (channels.some((channel) => channel.id === previousValue)) {
    select.value = previousValue;
  } else if (channels[0]) {
    select.value = channels[0].id;
  }
}

async function readSelectedFiles(fileList) {
  const files = Array.from(fileList || []);
  return Promise.all(files.map(readFileAsBase64));
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const dataBase64 = String(reader.result || '').split(',')[1] || '';
      resolve({ name: file.name, dataBase64 });
    };
    reader.readAsDataURL(file);
  });
}

function setRemoteMessageStatus(message) {
  elements.remoteMessageStatus.dataset.locked = message ? 'true' : '';
  elements.remoteMessageStatus.textContent = message;
}

function requireGuildSelection() {
  if (!selectedGuildId) {
    throw new Error('Select a server first.');
  }
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

boot().catch((error) => {
  elements.status.textContent = error.message;
});
