let selectedGuildId = null;

const TARGET_AUDIO_SAMPLE_RATE = 48000;
const MAX_AUDIO_SOCKET_BUFFERED_BYTES = 512 * 1024;
const INBOUND_AUDIO_PLAYBACK_DELAY = 0.08;

const state = {
  health: null,
  me: null,
  guilds: [],
  overview: null,
  remoteChannels: { textChannels: [], voiceChannels: [] },
  remoteVoice: { connected: false, channelId: null, status: 'disconnected' },
  remoteVoiceRecords: { events: [], clips: [] },
  remoteError: null,
  serverBuilder: { configs: [], runs: [], lastPreview: null },
};

const voiceCapture = {
  audioContext: null,
  audioNodes: [],
  micStream: null,
  screenStream: null,
  screenLabel: '',
  socket: null,
  socketReadyPromise: null,
  intentionalSocketClose: false,
  listenSocket: null,
  listenIntentionalClose: false,
  playbackAudioContext: null,
  playbackNextTime: 0,
  pushToTalkActive: false,
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
  inviteMemberForm: document.querySelector('#inviteMemberForm'),
  inviteChannel: document.querySelector('#inviteChannel'),
  inviteMemberStatus: document.querySelector('#inviteMemberStatus'),
  remoteVoiceForm: document.querySelector('#remoteVoiceForm'),
  remoteVoiceChannel: document.querySelector('#remoteVoiceChannel'),
  remoteVoiceLeaveButton: document.querySelector('#remoteVoiceLeaveButton'),
  remoteVoiceStatus: document.querySelector('#remoteVoiceStatus'),
  remoteMicStartButton: document.querySelector('#remoteMicStartButton'),
  remoteMicStopButton: document.querySelector('#remoteMicStopButton'),
  remoteScreenAudio: document.querySelector('#remoteScreenAudio'),
  remoteScreenSource: document.querySelector('#remoteScreenSource'),
  remoteScreenStartButton: document.querySelector('#remoteScreenStartButton'),
  remoteScreenStopButton: document.querySelector('#remoteScreenStopButton'),
  remoteAudioStatus: document.querySelector('#remoteAudioStatus'),
  remoteListenStartButton: document.querySelector('#remoteListenStartButton'),
  remoteListenStopButton: document.querySelector('#remoteListenStopButton'),
  remoteInboundStatus: document.querySelector('#remoteInboundStatus'),
  remoteVoiceRecordsRefreshButton: document.querySelector('#remoteVoiceRecordsRefreshButton'),
  remoteVoiceRecords: document.querySelector('#remoteVoiceRecords'),
  serverBuilderForm: document.querySelector('#serverBuilderForm'),
  serverBuilderFile: document.querySelector('#serverBuilderFile'),
  serverBuilderRefreshButton: document.querySelector('#serverBuilderRefreshButton'),
  serverBuilderValidateButton: document.querySelector('#serverBuilderValidateButton'),
  serverBuilderPreviewButton: document.querySelector('#serverBuilderPreviewButton'),
  serverBuilderApplyButton: document.querySelector('#serverBuilderApplyButton'),
  serverBuilderStatus: document.querySelector('#serverBuilderStatus'),
  serverBuilderConfigs: document.querySelector('#serverBuilderConfigs'),
  serverBuilderResult: document.querySelector('#serverBuilderResult'),
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
      stopAllVoiceCapture();
      selectedGuildId = guild.id;
      state.serverBuilder.lastPreview = null;
      setRemoteMessageStatus('');
      setServerBuilderStatus('');
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
  await Promise.all([
    refreshRemoteOps(),
    refreshVoiceRecords(),
    refreshServerBuilder(),
  ]);
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
  renderServerBuilder();
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
  populateChannelSelect(elements.inviteChannel, textChannels, 'Select invite channel');
  populateChannelSelect(elements.remoteVoiceChannel, voiceChannels, 'Select voice channel');

  const hasTextChannel = textChannels.length > 0;
  const hasVoiceChannel = voiceChannels.length > 0;
  elements.remoteMessageForm.querySelector('button[type="submit"]').disabled = !selectedGuildId || !hasTextChannel;
  elements.inviteMemberForm.querySelector('button[type="submit"]').disabled = !selectedGuildId || !hasTextChannel;
  elements.remoteVoiceForm.querySelector('button[type="submit"]').disabled = !selectedGuildId || !hasVoiceChannel;
  elements.remoteVoiceLeaveButton.disabled = !selectedGuildId;

  if (state.remoteError) {
    elements.remoteMessageStatus.textContent = state.remoteError;
    elements.inviteMemberStatus.textContent = state.remoteError;
    elements.remoteVoiceStatus.textContent = state.remoteError;
    updateVoiceCaptureControls();
    return;
  }

  if (!hasTextChannel) {
    elements.remoteMessageStatus.textContent = 'No text channels available.';
    elements.inviteMemberStatus.textContent = 'No invite-capable text channels available.';
  } else if (!elements.remoteMessageStatus.dataset.locked) {
    elements.remoteMessageStatus.textContent = '';
    if (!elements.inviteMemberStatus.dataset.locked) elements.inviteMemberStatus.textContent = '';
  }

  const connectedChannel = voiceChannels.find((channel) => channel.id === state.remoteVoice.channelId);
  elements.remoteVoiceStatus.textContent = state.remoteVoice.connected
    ? `Connected to ${connectedChannel?.name || state.remoteVoice.channelId} (${state.remoteVoice.status}) | ${state.remoteVoice.selfMute ? 'muted' : 'unmuted'} | ${state.remoteVoice.selfDeaf ? 'deafened' : 'listening allowed'}`
    : 'Disconnected';
  elements.remoteVoiceForm.selfMute.checked = Boolean(state.remoteVoice.selfMute);
  elements.remoteVoiceForm.selfDeaf.checked = Boolean(state.remoteVoice.selfDeaf);
  updateVoiceCaptureControls();
  renderVoiceRecords();
}

async function refreshVoiceRecords() {
  if (!selectedGuildId) {
    state.remoteVoiceRecords = { events: [], clips: [] };
    return;
  }

  try {
    state.remoteVoiceRecords = await api(`/api/guilds/${selectedGuildId}/remote/voice/activity`);
  } catch {
    state.remoteVoiceRecords = { events: [], clips: [] };
  }
}

async function refreshServerBuilder() {
  if (!selectedGuildId) {
    state.serverBuilder = { configs: [], runs: [], lastPreview: null };
    return;
  }

  try {
    const [configs, runs] = await Promise.all([
      api(`/api/guilds/${selectedGuildId}/server-builder/configs`),
      api(`/api/guilds/${selectedGuildId}/server-builder/runs`),
    ]);
    state.serverBuilder.configs = configs.configs || [];
    state.serverBuilder.runs = runs.runs || [];
  } catch (error) {
    state.serverBuilder.configs = [];
    state.serverBuilder.runs = [];
    setServerBuilderStatus(error.message);
  }
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

function renderServerBuilder() {
  if (!elements.serverBuilderConfigs) return;
  elements.serverBuilderConfigs.innerHTML = '';
  elements.serverBuilderApplyButton.disabled = !state.serverBuilder.lastPreview?.ok;
  elements.serverBuilderPreviewButton.disabled = !selectedGuildId;
  elements.serverBuilderValidateButton.disabled = !selectedGuildId;
  elements.serverBuilderRefreshButton.disabled = !selectedGuildId;

  const configs = state.serverBuilder.configs || [];
  if (configs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.textContent = selectedGuildId ? 'No Server Builder configs saved.' : 'Select a server first.';
    elements.serverBuilderConfigs.append(empty);
  }

  for (const config of configs.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'item';
    const summary = config.validationSummary || {};
    const title = document.createElement('strong');
    title.textContent = config.key;
    const detail = document.createElement('small');
    detail.textContent = `${config.fileName} | roles ${summary.roles || 0}, categories ${summary.categories || 0}, channels ${summary.channels || 0}`;
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'secondary';
    use.textContent = 'Use';
    use.onclick = () => {
      elements.serverBuilderForm.configKey.value = config.key;
      setServerBuilderStatus(`Selected ${config.key}.`);
    };
    row.append(title, detail, use);
    elements.serverBuilderConfigs.append(row);
  }

  if (!elements.serverBuilderResult.textContent.trim()) {
    elements.serverBuilderResult.textContent = 'Validate or preview a Server Builder config.';
  }
}

function renderVoiceRecords() {
  if (!elements.remoteVoiceRecords) return;
  elements.remoteVoiceRecords.innerHTML = '';
  const records = state.remoteVoiceRecords || { events: [], clips: [] };
  const clips = records.clips || [];
  const events = records.events || [];

  if (clips.length === 0 && events.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.textContent = 'No voice records yet.';
    elements.remoteVoiceRecords.append(empty);
    return;
  }

  for (const clip of clips.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = 'item';
    const title = document.createElement('strong');
    title.textContent = `Audio clip ${clip.id} | ${Math.round((clip.duration_ms || 0) / 1000)}s | ${clip.user_id || 'unknown user'}`;
    const detail = document.createElement('small');
    detail.textContent = `Recorded ${formatDate(clip.created_at)} | Transcript: ${clip.transcript_status || 'not_configured'}`;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.src = `/api/guilds/${selectedGuildId}/remote/voice/clips/${clip.id}/audio`;
    row.append(title, detail, audio);
    elements.remoteVoiceRecords.append(row);
  }

  for (const event of events.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = 'item';
    const title = document.createElement('strong');
    title.textContent = `${event.event_type || 'voice_event'} | ${event.user_id || 'unknown user'}`;
    const detail = document.createElement('small');
    detail.textContent = formatDate(event.created_at);
    row.append(title, detail);
    elements.remoteVoiceRecords.append(row);
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
      stopAllVoiceCapture();
      const result = await api(`/api/guilds/${selectedGuildId}/remote/voice/leave`, { method: 'POST' });
      state.remoteVoice = result.voice;
      elements.remoteVoiceStatus.textContent = result.message;
      await refreshRemoteOps();
      renderRemoteOps();
    } catch (error) {
      elements.remoteVoiceStatus.textContent = error.message;
    }
  };

  elements.inviteMemberForm.onsubmit = async (event) => {
    event.preventDefault();
    setInviteMemberStatus('Creating invite...');

    try {
      requireGuildSelection();
      const selectedChannelId = elements.inviteChannel.value;
      const result = await api(`/api/guilds/${selectedGuildId}/invites`, {
        method: 'POST',
        body: {
          target: elements.inviteMemberForm.target.value,
          channelId: selectedChannelId,
        },
      });

      elements.inviteMemberForm.reset();
      elements.inviteChannel.value = selectedChannelId;
      setInviteMemberStatus(`${result.message} ${result.dmDelivered ? '' : `Copy link: ${result.inviteUrl}`}`.trim());
    } catch (error) {
      setInviteMemberStatus(error.message);
    }
  };

  elements.serverBuilderForm.onsubmit = async (event) => {
    event.preventDefault();
    await validateServerBuilderConfig();
  };

  elements.serverBuilderPreviewButton.onclick = async () => {
    await previewServerBuilderConfig();
  };

  elements.serverBuilderApplyButton.onclick = async () => {
    await applyServerBuilderConfig();
  };

  elements.serverBuilderRefreshButton.onclick = async () => {
    await refreshServerBuilder();
    renderServerBuilder();
    setServerBuilderStatus('Server Builder configs refreshed.');
  };

  elements.remoteVoiceForm.selfMute.onchange = updateRemoteVoiceStateFromForm;
  elements.remoteVoiceForm.selfDeaf.onchange = updateRemoteVoiceStateFromForm;
  bindPushToTalk();
  elements.remoteMicStopButton.onclick = () => {
    stopMicCapture();
    setRemoteAudioStatus('Talk stopped.');
  };
  elements.remoteListenStartButton.onclick = startIncomingVoice;
  elements.remoteListenStopButton.onclick = () => stopIncomingVoice('dashboard');
  elements.remoteVoiceRecordsRefreshButton.onclick = async () => {
    await refreshVoiceRecords();
    renderVoiceRecords();
  };
  elements.remoteScreenStartButton.onclick = startScreenShare;
  elements.remoteScreenStopButton.onclick = () => {
    stopScreenShare();
    setRemoteAudioStatus('Screen/app capture stopped.');
  };
  elements.remoteScreenAudio.onchange = () => {
    refreshAudioBridge().catch((error) => setRemoteAudioStatus(error.message));
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

async function validateServerBuilderConfig() {
  setServerBuilderStatus('Validating...');
  state.serverBuilder.lastPreview = null;
  renderServerBuilder();

  try {
    requireGuildSelection();
    const configKey = getServerBuilderConfigKey();
    const file = elements.serverBuilderFile.files?.[0] || null;
    let result;

    if (file) {
      const content = await readFileAsText(file);
      result = await api(`/api/guilds/${selectedGuildId}/server-builder/configs`, {
        method: 'POST',
        body: {
          configKey,
          file: {
            fileName: file.name,
            content,
          },
        },
      });
    } else {
      result = await api(`/api/guilds/${selectedGuildId}/server-builder/configs/${encodeURIComponent(configKey)}/validate`, {
        method: 'POST',
        body: {},
      });
    }

    await refreshServerBuilder();
    renderServerBuilder();
    renderServerBuilderResult(result);
    setServerBuilderStatus(result.message || 'Config validated.');
  } catch (error) {
    state.serverBuilder.lastPreview = null;
    renderServerBuilderError(error);
  }
}

async function previewServerBuilderConfig() {
  setServerBuilderStatus('Building preview...');
  state.serverBuilder.lastPreview = null;
  renderServerBuilder();

  try {
    requireGuildSelection();
    const configKey = getServerBuilderConfigKey();
    const mode = elements.serverBuilderForm.mode.value;
    const result = await api(`/api/guilds/${selectedGuildId}/server-builder/configs/${encodeURIComponent(configKey)}/preview`, {
      method: 'POST',
      body: { mode },
    });
    state.serverBuilder.lastPreview = {
      ok: result.ok,
      configKey,
      mode,
    };
    await refreshServerBuilder();
    state.serverBuilder.lastPreview = {
      ok: result.ok,
      configKey,
      mode,
    };
    renderServerBuilder();
    renderServerBuilderResult(result);
    setServerBuilderStatus(result.message || 'Preview ready.');
  } catch (error) {
    state.serverBuilder.lastPreview = null;
    renderServerBuilderError(error);
  }
}

async function applyServerBuilderConfig() {
  setServerBuilderStatus('Applying Server Builder config...');

  try {
    requireGuildSelection();
    const configKey = getServerBuilderConfigKey();
    const mode = elements.serverBuilderForm.mode.value;
    if (!state.serverBuilder.lastPreview?.ok || state.serverBuilder.lastPreview.configKey !== configKey || state.serverBuilder.lastPreview.mode !== mode) {
      throw new Error('Run Preview successfully for this config and mode before Apply.');
    }
    const result = await api(`/api/guilds/${selectedGuildId}/server-builder/configs/${encodeURIComponent(configKey)}/apply`, {
      method: 'POST',
      body: { mode },
    });
    state.serverBuilder.lastPreview = null;
    await refreshServerBuilder();
    renderServerBuilder();
    renderServerBuilderResult(result);
    setServerBuilderStatus(result.message || 'Apply complete.');
  } catch (error) {
    renderServerBuilderError(error);
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsText(file);
  });
}

function getServerBuilderConfigKey() {
  const key = elements.serverBuilderForm.configKey.value.trim();
  if (!key) throw new Error('Enter a Server Builder config key.');
  return key;
}

function renderServerBuilderResult(result) {
  const output = {
    ok: result.ok,
    message: result.message,
    config: result.config ? {
      key: result.config.key,
      fileName: result.config.fileName,
      updatedAt: result.config.updatedAt,
    } : undefined,
    validation: result.validation?.summary ? result.validation : undefined,
    summary: result.summary,
    errors: result.errors || [],
    warnings: result.warnings || [],
    operations: Array.isArray(result.operations) ? result.operations.slice(0, 120) : undefined,
  };
  elements.serverBuilderResult.textContent = JSON.stringify(output, null, 2);
}

function renderServerBuilderError(error) {
  setServerBuilderStatus(error.message);
  elements.serverBuilderResult.textContent = JSON.stringify({
    ok: false,
    error: error.message,
  }, null, 2);
  renderServerBuilder();
}

function setServerBuilderStatus(message) {
  elements.serverBuilderStatus.textContent = message;
}

function setRemoteMessageStatus(message) {
  elements.remoteMessageStatus.dataset.locked = message ? 'true' : '';
  elements.remoteMessageStatus.textContent = message;
}

function setInviteMemberStatus(message) {
  elements.inviteMemberStatus.dataset.locked = message ? 'true' : '';
  elements.inviteMemberStatus.textContent = message;
}

async function updateRemoteVoiceStateFromForm() {
  if (!selectedGuildId || !state.remoteVoice.connected) return;
  elements.remoteVoiceStatus.textContent = 'Updating voice state...';

  try {
    const result = await api(`/api/guilds/${selectedGuildId}/remote/voice/state`, {
      method: 'POST',
      body: {
        selfMute: elements.remoteVoiceForm.selfMute.checked,
        selfDeaf: elements.remoteVoiceForm.selfDeaf.checked,
      },
    });
    state.remoteVoice = result.voice;
    elements.remoteVoiceStatus.textContent = result.message;
    if (state.remoteVoice.selfDeaf) stopIncomingVoice('self_deaf_enabled');
    updateVoiceCaptureControls();
  } catch (error) {
    elements.remoteVoiceStatus.textContent = error.message;
    await refreshRemoteOps();
    renderRemoteOps();
  }
}

function bindPushToTalk() {
  const start = (event) => {
    event.preventDefault();
    startPushToTalk();
  };
  const stop = (event) => {
    event.preventDefault();
    stopPushToTalk();
  };

  elements.remoteMicStartButton.onpointerdown = start;
  elements.remoteMicStartButton.onpointerup = stop;
  elements.remoteMicStartButton.onpointercancel = stop;
  elements.remoteMicStartButton.onpointerleave = stop;
  elements.remoteMicStartButton.onkeydown = (event) => {
    if (event.key === ' ' || event.key === 'Enter') start(event);
  };
  elements.remoteMicStartButton.onkeyup = (event) => {
    if (event.key === ' ' || event.key === 'Enter') stop(event);
  };
  window.addEventListener('pointerup', () => {
    if (voiceCapture.pushToTalkActive) stopPushToTalk();
  });
}

async function startPushToTalk() {
  if (voiceCapture.pushToTalkActive) return;
  voiceCapture.pushToTalkActive = true;
  elements.remoteMicStartButton.classList.add('active');
  elements.remoteMicStartButton.textContent = 'Talking...';
  await startDashboardMic();
}

function stopPushToTalk() {
  if (!voiceCapture.pushToTalkActive) return;
  resetPushToTalkButton();
  stopMicCapture();
  setRemoteAudioStatus('Push-to-talk released.');
}

function resetPushToTalkButton() {
  voiceCapture.pushToTalkActive = false;
  elements.remoteMicStartButton.classList.remove('active');
  elements.remoteMicStartButton.textContent = 'Hold to Talk';
}

async function startDashboardMic() {
  setRemoteAudioStatus('Opening microphone...');

  try {
    requireGuildSelection();
    requireVoiceReadyForAudio();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot open a microphone from the dashboard.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    if (!voiceCapture.pushToTalkActive) {
      stopMediaStream(stream);
      setRemoteAudioStatus('Push-to-talk released.');
      return;
    }

    stopMediaStream(voiceCapture.micStream);
    voiceCapture.micStream = stream;
    watchStreamEnd(stream, () => {
      if (voiceCapture.micStream === stream) {
        voiceCapture.micStream = null;
        refreshAudioBridge().catch((error) => setRemoteAudioStatus(error.message));
      }
    });

    await refreshAudioBridge();
    if (voiceCapture.pushToTalkActive) {
      setRemoteAudioStatus('Push-to-talk is live in Discord voice.');
    } else {
      stopMicCapture();
    }
  } catch (error) {
    stopMediaStream(voiceCapture.micStream);
    voiceCapture.micStream = null;
    resetPushToTalkButton();
    stopAudioTransport();
    setRemoteAudioStatus(error.message);
  } finally {
    updateVoiceCaptureControls();
  }
}

async function startScreenShare() {
  setRemoteAudioStatus('Opening screen/app picker...');

  try {
    requireGuildSelection();
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('This browser cannot share a screen or app from the dashboard.');
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: Boolean(elements.remoteScreenAudio.checked),
    });

    stopMediaStream(voiceCapture.screenStream);
    voiceCapture.screenStream = stream;
    voiceCapture.screenLabel = getStreamLabel(stream);
    updateScreenSourceSelect();

    watchStreamEnd(stream, () => {
      if (voiceCapture.screenStream === stream && stream.getTracks().every((track) => track.readyState === 'ended')) {
        stopScreenShare();
      }
    });

    if (stream.getAudioTracks().length > 0 && elements.remoteScreenAudio.checked) {
      await refreshAudioBridge();
      setRemoteAudioStatus('Screen/app audio is live in Discord voice.');
    } else {
      setRemoteAudioStatus('Screen/app selection is active. No captured audio track was provided by the browser.');
    }
  } catch (error) {
    setRemoteAudioStatus(error.message);
  } finally {
    updateVoiceCaptureControls();
  }
}

function stopMicCapture() {
  stopMediaStream(voiceCapture.micStream);
  voiceCapture.micStream = null;
  resetPushToTalkButton();
  refreshAudioBridge().catch((error) => setRemoteAudioStatus(error.message));
  updateVoiceCaptureControls();
}

function stopScreenShare() {
  stopMediaStream(voiceCapture.screenStream);
  voiceCapture.screenStream = null;
  voiceCapture.screenLabel = '';
  updateScreenSourceSelect();
  refreshAudioBridge().catch((error) => setRemoteAudioStatus(error.message));
  updateVoiceCaptureControls();
}

function stopAllVoiceCapture() {
  stopMediaStream(voiceCapture.micStream);
  stopMediaStream(voiceCapture.screenStream);
  voiceCapture.micStream = null;
  voiceCapture.screenStream = null;
  resetPushToTalkButton();
  voiceCapture.screenLabel = '';
  updateScreenSourceSelect();
  stopAudioTransport();
  stopIncomingVoice('dashboard_reset');
  updateVoiceCaptureControls();
}

async function startIncomingVoice() {
  try {
    requireGuildSelection();
    if (!state.remoteVoice.connected) {
      throw new Error('Join a voice channel before listening.');
    }
    if (state.remoteVoice.selfDeaf) {
      throw new Error('Turn Self deaf off before listening.');
    }

    await ensurePlaybackAudioContext();
    stopIncomingVoice('restart');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/guilds/${selectedGuildId}/remote/voice/listen`);
    socket.binaryType = 'arraybuffer';
    voiceCapture.listenIntentionalClose = false;
    voiceCapture.listenSocket = socket;
    elements.remoteInboundStatus.textContent = 'Connecting incoming voice feed...';

    socket.onmessage = (event) => handleIncomingVoiceMessage(event.data);
    socket.onerror = () => {
      elements.remoteInboundStatus.textContent = 'Incoming voice socket failed.';
    };
    socket.onclose = () => {
      const intentional = voiceCapture.listenIntentionalClose;
      voiceCapture.listenSocket = null;
      if (!intentional) elements.remoteInboundStatus.textContent = 'Incoming voice feed disconnected.';
      updateVoiceCaptureControls();
      refreshVoiceRecords().then(renderVoiceRecords).catch(() => null);
    };
  } catch (error) {
    elements.remoteInboundStatus.textContent = error.message;
    updateVoiceCaptureControls();
  }
}

function stopIncomingVoice(reason = 'dashboard') {
  voiceCapture.listenIntentionalClose = true;
  if (voiceCapture.listenSocket && voiceCapture.listenSocket.readyState < WebSocket.CLOSING) {
    voiceCapture.listenSocket.close(1000, reason);
  }
  voiceCapture.listenSocket = null;
  if (elements.remoteInboundStatus) {
    elements.remoteInboundStatus.textContent = 'Incoming voice feed disconnected.';
  }
  updateVoiceCaptureControls();
}

function handleIncomingVoiceMessage(data) {
  if (data instanceof ArrayBuffer) {
    playIncomingPcm(data).catch((error) => {
      elements.remoteInboundStatus.textContent = error.message;
    });
    return;
  }

  const payload = parseSocketMessage(data);
  if (!payload) return;
  if (payload.voice) state.remoteVoice = payload.voice;

  if (payload.type === 'ready') {
    elements.remoteInboundStatus.textContent = payload.message || 'Incoming voice feed is live.';
  } else if (payload.type === 'speaking_start') {
    elements.remoteInboundStatus.textContent = `Receiving audio from ${payload.userId}.`;
  } else if (payload.type === 'speaking_end') {
    elements.remoteInboundStatus.textContent = 'Incoming voice feed is live.';
  } else if (payload.type === 'stopped') {
    elements.remoteInboundStatus.textContent = payload.message || 'Incoming voice feed stopped.';
  } else if (payload.type === 'error') {
    elements.remoteInboundStatus.textContent = payload.message || 'Incoming voice feed failed.';
  }

  updateVoiceCaptureControls();
}

async function ensurePlaybackAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser cannot play incoming voice audio.');
  if (!voiceCapture.playbackAudioContext || voiceCapture.playbackAudioContext.state === 'closed') {
    voiceCapture.playbackAudioContext = new AudioContextClass({ sampleRate: TARGET_AUDIO_SAMPLE_RATE });
    voiceCapture.playbackNextTime = 0;
  }
  if (voiceCapture.playbackAudioContext.state === 'suspended') {
    await voiceCapture.playbackAudioContext.resume();
  }
}

async function playIncomingPcm(arrayBuffer) {
  await ensurePlaybackAudioContext();
  const context = voiceCapture.playbackAudioContext;
  const view = new DataView(arrayBuffer);
  const frameCount = Math.floor(view.byteLength / 4);
  if (frameCount === 0) return;

  const buffer = context.createBuffer(2, frameCount, TARGET_AUDIO_SAMPLE_RATE);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let index = 0; index < frameCount; index += 1) {
    const offset = index * 4;
    left[index] = view.getInt16(offset, true) / 32768;
    right[index] = view.getInt16(offset + 2, true) / 32768;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const startAt = Math.max(context.currentTime + INBOUND_AUDIO_PLAYBACK_DELAY, voiceCapture.playbackNextTime);
  source.start(startAt);
  voiceCapture.playbackNextTime = startAt + buffer.duration;
}

async function refreshAudioBridge() {
  const streams = getActiveAudioStreams();
  if (streams.length === 0) {
    stopAudioTransport();
    return;
  }

  requireVoiceReadyForAudio();
  await ensureVoiceSocket();
  await rebuildAudioGraph(streams);
}

function getActiveAudioStreams() {
  const streams = [];
  if (voiceCapture.micStream?.getAudioTracks().some((track) => track.readyState === 'live')) {
    streams.push(voiceCapture.micStream);
  }

  if (
    elements.remoteScreenAudio.checked
    && voiceCapture.screenStream?.getAudioTracks().some((track) => track.readyState === 'live')
  ) {
    streams.push(voiceCapture.screenStream);
  }

  return streams;
}

function requireVoiceReadyForAudio() {
  if (!state.remoteVoice.connected) {
    throw new Error('Join a voice channel before starting dashboard audio.');
  }

  if (state.remoteVoice.selfMute) {
    throw new Error('Rejoin voice with Self mute off before sending dashboard audio.');
  }
}

async function ensureVoiceSocket() {
  if (voiceCapture.socket?.readyState === WebSocket.OPEN) return;
  if (voiceCapture.socketReadyPromise) return voiceCapture.socketReadyPromise;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/guilds/${selectedGuildId}/remote/voice/mic`);
  socket.binaryType = 'arraybuffer';
  voiceCapture.intentionalSocketClose = false;
  voiceCapture.socket = socket;

  voiceCapture.socketReadyPromise = new Promise((resolve, reject) => {
    let settled = false;
    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      voiceCapture.socketReadyPromise = null;
      handler(value);
    };

    socket.onopen = () => settle(resolve);
    socket.onerror = () => settle(reject, new Error('Dashboard audio socket failed to connect.'));
    socket.onmessage = (event) => {
      const payload = parseSocketMessage(event.data);
      if (!payload) return;
      if (payload.type === 'ready') setRemoteAudioStatus(payload.message || 'Dashboard audio connected.');
      if (payload.type === 'error') setRemoteAudioStatus(payload.message || 'Dashboard audio failed.');
      if (payload.voice) state.remoteVoice = payload.voice;
      updateVoiceCaptureControls();
    };
    socket.onclose = () => {
      const intentional = voiceCapture.intentionalSocketClose;
      voiceCapture.socket = null;
      voiceCapture.socketReadyPromise = null;
      stopAudioGraph();
      if (!intentional && getActiveAudioStreams().length > 0) {
        setRemoteAudioStatus('Dashboard audio disconnected.');
      }
      updateVoiceCaptureControls();
    };
  });

  return voiceCapture.socketReadyPromise;
}

async function rebuildAudioGraph(streams) {
  stopAudioGraph();

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('This browser cannot process dashboard audio.');
  }

  if (!voiceCapture.audioContext || voiceCapture.audioContext.state === 'closed') {
    try {
      voiceCapture.audioContext = new AudioContextClass({ sampleRate: TARGET_AUDIO_SAMPLE_RATE });
    } catch {
      voiceCapture.audioContext = new AudioContextClass();
    }
  }

  if (voiceCapture.audioContext.state === 'suspended') {
    await voiceCapture.audioContext.resume();
  }

  const destination = voiceCapture.audioContext.createMediaStreamDestination();
  for (const stream of streams) {
    const source = voiceCapture.audioContext.createMediaStreamSource(stream);
    source.connect(destination);
    voiceCapture.audioNodes.push(source);
  }

  const mixedSource = voiceCapture.audioContext.createMediaStreamSource(destination.stream);
  const processor = voiceCapture.audioContext.createScriptProcessor(4096, 1, 1);
  const silentOutput = voiceCapture.audioContext.createGain();
  silentOutput.gain.value = 0;

  processor.onaudioprocess = (event) => {
    sendPcmAudio(event.inputBuffer.getChannelData(0));
  };

  mixedSource.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(voiceCapture.audioContext.destination);
  voiceCapture.audioNodes.push(destination, mixedSource, processor, silentOutput);
}

function stopAudioTransport() {
  voiceCapture.intentionalSocketClose = true;
  if (voiceCapture.socket && voiceCapture.socket.readyState < WebSocket.CLOSING) {
    voiceCapture.socket.close(1000);
  }
  voiceCapture.socket = null;
  voiceCapture.socketReadyPromise = null;
  stopAudioGraph();
}

function stopAudioGraph() {
  for (const node of voiceCapture.audioNodes.splice(0)) {
    try {
      node.disconnect();
    } catch {
      // Some browser media destination nodes are already detached by the time tracks end.
    }
  }
}

function sendPcmAudio(inputSamples) {
  const socket = voiceCapture.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_AUDIO_SOCKET_BUFFERED_BYTES) return;
  socket.send(encodePcm16Stereo(inputSamples, voiceCapture.audioContext.sampleRate));
}

function encodePcm16Stereo(inputSamples, sampleRate) {
  const samples = sampleRate === TARGET_AUDIO_SAMPLE_RATE
    ? inputSamples
    : resampleAudio(inputSamples, sampleRate, TARGET_AUDIO_SAMPLE_RATE);
  const buffer = new ArrayBuffer(samples.length * 4);
  const view = new DataView(buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] || 0));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    const offset = index * 4;
    view.setInt16(offset, intSample, true);
    view.setInt16(offset + 2, intSample, true);
  }

  return buffer;
}

function resampleAudio(inputSamples, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const outputLength = Math.max(1, Math.floor(inputSamples.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, inputSamples.length - 1);
    const weight = sourceIndex - leftIndex;
    output[index] = (inputSamples[leftIndex] || 0) * (1 - weight) + (inputSamples[rightIndex] || 0) * weight;
  }

  return output;
}

function watchStreamEnd(stream, callback) {
  for (const track of stream.getTracks()) {
    track.addEventListener('ended', callback, { once: true });
  }
}

function stopMediaStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    track.stop();
  }
}

function updateScreenSourceSelect() {
  elements.remoteScreenSource.innerHTML = '';
  const option = document.createElement('option');
  option.value = voiceCapture.screenLabel ? 'screen' : '';
  option.textContent = voiceCapture.screenLabel || 'No source selected';
  elements.remoteScreenSource.append(option);
  elements.remoteScreenSource.value = option.value;
}

function getStreamLabel(stream) {
  return stream.getTracks().find((track) => track.kind !== 'audio')?.label
    || stream.getAudioTracks()[0]?.label
    || 'Captured screen/app';
}

function parseSocketMessage(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function updateVoiceCaptureControls() {
  const connected = Boolean(selectedGuildId && state.remoteVoice.connected);
  const micActive = Boolean(voiceCapture.micStream);
  const screenActive = Boolean(voiceCapture.screenStream);
  const audioActive = Boolean(voiceCapture.socket) || getActiveAudioStreams().length > 0;
  const listenActive = Boolean(voiceCapture.listenSocket);

  elements.remoteMicStartButton.disabled = !connected || micActive;
  elements.remoteMicStopButton.disabled = !micActive;
  elements.remoteScreenStartButton.disabled = !selectedGuildId || screenActive;
  elements.remoteScreenStopButton.disabled = !screenActive;
  elements.remoteScreenAudio.disabled = !selectedGuildId;
  elements.remoteScreenSource.disabled = !screenActive;
  elements.remoteListenStartButton.disabled = !connected || listenActive || Boolean(state.remoteVoice.selfDeaf);
  elements.remoteListenStopButton.disabled = !listenActive;
  elements.remoteVoiceRecordsRefreshButton.disabled = !selectedGuildId;

  if (!connected && audioActive) {
    stopAllVoiceCapture();
  }
  if (!connected && listenActive) {
    stopIncomingVoice('voice_disconnected');
  }

  if (state.remoteVoice.transmitting && !elements.remoteAudioStatus.textContent) {
    setRemoteAudioStatus('Dashboard audio is live in Discord voice.');
  }
}

function setRemoteAudioStatus(message) {
  elements.remoteAudioStatus.textContent = message;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
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

window.addEventListener('beforeunload', stopAllVoiceCapture);

boot().catch((error) => {
  elements.status.textContent = error.message;
});
