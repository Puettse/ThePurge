const commandLoaders = {
  setup: () => import('./setup.js').then((module) => module.handleSetup),
  dashboard: () => import('./setup.js').then((module) => module.handleDashboard),
  catalog: () => import('./catalog.js').then((module) => module.handleCatalog),
  purge: () => import('./moderation.js').then((module) => module.handlePurge),
  mod: () => import('./moderation.js').then((module) => module.handleMod),
  automod: () => import('./automation.js').then((module) => module.handleAutomod),
  logs: () => import('./logs.js').then((module) => module.handleLogs),
  'custom-command': () => import('./automation.js').then((module) => module.handleCustomCommand),
  welcome: () => import('./automation.js').then((module) => module.handleWelcome),
  autorole: () => import('./automation.js').then((module) => module.handleAutorole),
  schedule: () => import('./automation.js').then((module) => module.handleSchedule),
  rank: () => import('./engagement.js').then((module) => module.handleRank),
  economy: () => import('./engagement.js').then((module) => module.handleEconomy),
  ticket: () => import('./tickets.js').then((module) => module.handleTicket),
};

const buttonLoaders = {
  ticket: () => import('./tickets.js').then((module) => module.handleTicketButton),
  catalog: () => import('./catalog.js').then((module) => module.handleCatalogComponent),
};

export async function resolveCommandHandler(commandName) {
  const loader = commandLoaders[commandName];
  return loader ? loader() : null;
}

export async function resolveButtonHandler(namespace) {
  const loader = buttonLoaders[namespace];
  if (!loader) throw new Error(`Unknown button namespace: ${namespace}`);
  return loader();
}
