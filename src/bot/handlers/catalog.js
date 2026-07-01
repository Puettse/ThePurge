import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { isModuleEnabled } from '../../db/index.js';
import {
  buildCatalogFacets,
  filterCatalogItems,
  getEnabledJellyfinCatalog,
  getJellyfinConfigStatus,
} from '../../services/jellyfinService.js';

const FACET_PAGE_SIZE = 25;
const MOVIE_PAGE_SIZE = 25;
const SESSION_TTL_MS = 10 * 60 * 1000;
const catalogSessions = new Map();

const MODES = {
  genre: 'Genre',
  year: 'Year',
  actor: 'Actor',
};

export async function handleCatalog(context, interaction) {
  if (!(await isModuleEnabled(context.db, interaction.guild.id, 'jellyfinCatalog'))) {
    await interaction.reply({ content: 'Jellyfin catalog browsing is disabled for this server.', ephemeral: true });
    return;
  }

  const status = getJellyfinConfigStatus(context.config);
  if (!status.configured) {
    await interaction.reply({
      content: `Jellyfin is not configured. Missing ${status.missingConfig.join(', ')}.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply(createModeResponse());
}

export async function handleCatalogComponent(context, interaction) {
  if (!(await isModuleEnabled(context.db, interaction.guild.id, 'jellyfinCatalog'))) {
    await replyOrUpdate(interaction, { content: 'Jellyfin catalog browsing is disabled for this server.', components: [], embeds: [] });
    return;
  }

  const [, action, ...parts] = interaction.customId.split(':');

  if (action === 'mode') {
    await handleModeSelection(context, interaction, parts[0], 0);
    return;
  }

  if (action === 'facetpage') {
    await handleModeSelection(context, interaction, parts[0], Number.parseInt(parts[1] || '0', 10));
    return;
  }

  if (action === 'facet' && interaction.isStringSelectMenu()) {
    await handleFacetSelection(
      context,
      interaction,
      parts[0],
      Number.parseInt(parts[1] || '0', 10),
      Number.parseInt(interaction.values[0] || '0', 10),
      0,
    );
    return;
  }

  if (action === 'moviepage') {
    await handleMoviePage(context, interaction, parts[0], Number.parseInt(parts[1] || '0', 10));
    return;
  }

  if (action === 'movie' && interaction.isStringSelectMenu()) {
    await handleMovieSelection(context, interaction, parts[0], interaction.values[0]);
    return;
  }

  if (action === 'restart') {
    await interaction.update(createModeResponse());
    return;
  }

  await replyOrUpdate(interaction, { content: 'That catalog control is no longer valid.', components: [], embeds: [] });
}

async function handleModeSelection(context, interaction, mode, page) {
  if (!MODES[mode]) {
    await replyOrUpdate(interaction, { content: 'Unknown catalog sort mode.', components: [], embeds: [] });
    return;
  }

  const catalog = await getEnabledJellyfinCatalog(context, interaction.guild.id);
  if (!catalog.ok) {
    await replyOrUpdate(interaction, {
      embeds: [baseEmbed('Jellyfin Catalog').setDescription(catalog.error || 'Jellyfin catalogue is unavailable right now.')],
      components: [modeButtons()],
    });
    return;
  }

  if (catalog.items.length === 0) {
    await replyOrUpdate(interaction, {
      embeds: [baseEmbed('Jellyfin Catalog').setDescription('No Jellyfin titles are enabled for bot access yet.')],
      components: [modeButtons()],
    });
    return;
  }

  const facets = buildCatalogFacets(catalog.items, mode);
  if (facets.length === 0) {
    await interaction.update({
      embeds: [baseEmbed(`Browse by ${MODES[mode]}`).setDescription(`No ${MODES[mode].toLowerCase()} values were found for enabled titles.`)],
      components: [modeButtons()],
    });
    return;
  }

  await interaction.update(createFacetResponse(mode, facets, page, catalog.items.length));
}

async function handleFacetSelection(context, interaction, mode, facetPage, facetIndex, page) {
  const catalog = await getEnabledJellyfinCatalog(context, interaction.guild.id);
  const facets = buildCatalogFacets(catalog.items, mode);
  const safeFacetPage = clampPage(facetPage, facets.length, FACET_PAGE_SIZE);
  const facet = pageSlice(facets, safeFacetPage, FACET_PAGE_SIZE)[facetIndex];

  if (!facet) {
    await replyOrUpdate(interaction, { content: 'That catalog option is no longer available.', components: [], embeds: [] });
    return;
  }

  const facetValue = facet.value;
  const movies = filterCatalogItems(catalog.items, mode, facetValue);
  const token = createCatalogSession({
    guildId: interaction.guild.id,
    mode,
    facetValue,
    userId: interaction.user.id,
  });

  await interaction.update(createMovieListResponse(token, mode, facetValue, movies, page));
}

async function handleMoviePage(context, interaction, token, page) {
  const session = getCatalogSession(token, interaction);
  if (!session) {
    await replyOrUpdate(interaction, { content: 'That catalog session expired. Run /catalog again.', components: [], embeds: [] });
    return;
  }

  const catalog = await getEnabledJellyfinCatalog(context, interaction.guild.id);
  const movies = filterCatalogItems(catalog.items, session.mode, session.facetValue);
  await interaction.update(createMovieListResponse(token, session.mode, session.facetValue, movies, page));
}

async function handleMovieSelection(context, interaction, token, itemId) {
  const session = getCatalogSession(token, interaction);
  if (!session) {
    await interaction.reply({ content: 'That catalog session expired. Run /catalog again.', ephemeral: true });
    return;
  }

  const catalog = await getEnabledJellyfinCatalog(context, interaction.guild.id);
  const movie = catalog.items.find((item) => item.id === itemId && item.enabled);
  if (!movie) {
    await interaction.reply({ content: 'That title is no longer enabled for bot access.', ephemeral: true });
    return;
  }

  await interaction.reply(createMovieSelectionResponse(movie));
}

export function createMovieSelectionResponse(movie) {
  const fallbackDescription = movie.playUrl
    ? 'Open this title in Jellyfin.'
    : 'This title is enabled in the server catalogue. Jellyfin playback links are disabled until the EBMSOL domain guard is live.';
  const embed = baseEmbed(movie.name)
    .setDescription(movie.overview ? truncate(movie.overview, 800) : fallbackDescription)
    .addFields(
      { name: 'Year', value: movie.productionYear ? String(movie.productionYear) : 'Unknown', inline: true },
      { name: 'Runtime', value: movie.runtimeMinutes ? `${movie.runtimeMinutes} min` : 'Unknown', inline: true },
      { name: 'Genres', value: movie.genres.slice(0, 6).join(', ') || 'Unknown', inline: false },
    );

  const components = movie.playUrl ? [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Open in Jellyfin')
        .setURL(movie.playUrl),
    ),
  ] : [];

  return {
    embeds: [embed],
    components,
    ephemeral: true,
  };
}

function createModeResponse() {
  return {
    embeds: [
      baseEmbed('Jellyfin Catalog')
        .setDescription('Choose how to browse titles enabled for bot access.'),
    ],
    components: [modeButtons()],
  };
}

function createFacetResponse(mode, facets, page, enabledCount) {
  const safePage = clampPage(page, facets.length, FACET_PAGE_SIZE);
  const pageItems = pageSlice(facets, safePage, FACET_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(facets.length / FACET_PAGE_SIZE));

  const embed = baseEmbed(`Browse by ${MODES[mode]}`)
    .setDescription(`${enabledCount} enabled titles. Select a ${MODES[mode].toLowerCase()} to list matching movies.`)
    .setFooter({ text: `Page ${safePage + 1} of ${pageCount}` });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`catalog:facet:${mode}:${safePage}`)
    .setPlaceholder(`Select ${MODES[mode].toLowerCase()}`)
    .addOptions(pageItems.map((facet, index) => ({
      label: truncate(`${facet.label}`, 90),
      value: String(index),
      description: `${facet.count} title${facet.count === 1 ? '' : 's'}`,
    })));

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      facetNavButtons(mode, safePage, pageCount),
    ],
  };
}

function createMovieListResponse(token, mode, facetValue, movies, page) {
  const safePage = clampPage(page, movies.length, MOVIE_PAGE_SIZE);
  const pageItems = pageSlice(movies, safePage, MOVIE_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(movies.length / MOVIE_PAGE_SIZE));

  const description = pageItems.slice(0, 10)
    .map((movie, index) => `${safePage * MOVIE_PAGE_SIZE + index + 1}. ${movie.name}${movie.productionYear ? ` (${movie.productionYear})` : ''}`)
    .join('\n') || 'No matching titles are currently enabled.';

  const embed = baseEmbed(`${MODES[mode]}: ${facetValue}`)
    .setDescription(`${description}\n\nSelect a movie to receive a Jellyfin link.`)
    .setFooter({ text: `Page ${safePage + 1} of ${pageCount} | ${movies.length} title${movies.length === 1 ? '' : 's'}` });

  const components = [];
  if (pageItems.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`catalog:movie:${token}:${safePage}`)
      .setPlaceholder('Select movie')
      .addOptions(pageItems.map((movie) => ({
        label: truncate(movie.name, 90),
        value: movie.id,
        description: truncate([movie.productionYear, movie.genres[0], movie.runtimeMinutes ? `${movie.runtimeMinutes} min` : null].filter(Boolean).join(' | '), 100),
      })));
    components.push(new ActionRowBuilder().addComponents(select));
  }
  components.push(movieNavButtons(token, safePage, pageCount));

  return { embeds: [embed], components };
}

function modeButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('catalog:mode:genre').setLabel('Genre').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('catalog:mode:year').setLabel('Year').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('catalog:mode:actor').setLabel('Actor').setStyle(ButtonStyle.Secondary),
  );
}

function facetNavButtons(mode, page, pageCount) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`catalog:facetpage:${mode}:${Math.max(0, page - 1)}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`catalog:facetpage:${mode}:${Math.min(pageCount - 1, page + 1)}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount - 1),
    new ButtonBuilder()
      .setCustomId('catalog:restart')
      .setLabel('Modes')
      .setStyle(ButtonStyle.Secondary),
  );
}

function movieNavButtons(token, page, pageCount) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`catalog:moviepage:${token}:${Math.max(0, page - 1)}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`catalog:moviepage:${token}:${Math.min(pageCount - 1, page + 1)}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount - 1),
    new ButtonBuilder()
      .setCustomId('catalog:restart')
      .setLabel('Modes')
      .setStyle(ButtonStyle.Secondary),
  );
}

function baseEmbed(title) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0xb71c1c);
}

function createCatalogSession(session) {
  cleanupCatalogSessions();
  const token = crypto.randomBytes(6).toString('base64url');
  catalogSessions.set(token, {
    ...session,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getCatalogSession(token, interaction) {
  cleanupCatalogSessions();
  const session = catalogSessions.get(token);
  if (!session || session.guildId !== interaction.guild.id) return null;
  return session;
}

function cleanupCatalogSessions() {
  const now = Date.now();
  for (const [token, session] of catalogSessions.entries()) {
    if (session.expiresAt <= now) catalogSessions.delete(token);
  }
}

async function replyOrUpdate(interaction, payload) {
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    await interaction.update(payload);
    return;
  }
  await interaction.reply({ ...payload, ephemeral: true });
}

function clampPage(page, totalItems, pageSize) {
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  if (!Number.isFinite(page) || page < 0) return 0;
  return Math.min(page, pageCount - 1);
}

function pageSlice(items, page, pageSize) {
  return items.slice(page * pageSize, page * pageSize + pageSize);
}

function truncate(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}
