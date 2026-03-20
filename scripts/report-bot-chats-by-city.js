#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Bot } = require('@maxhub/max-bot-api');

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DEFAULT_ENV_FILE = '.env';
const SEED_CITY_LABELS_FILE = path.join(DATA_DIR, 'bot_chats_all_geo_tags_20260311_162459.json');

const EXTRA_CITY_LABELS = [
  'Омск',
  'Заринск',
  'Семикаракорск',
  'Константиновск',
  'Карасук',
  'Воронеж',
  'Усть-Илимск',
  'Уссурийск',
  'Челябинск',
  'Гуково',
  'Зверево',
  'Красный Сулин',
  'Каменск-Шахтинский',
  'Новошахтинск',
  'Братск',
];

const FALLBACK_CITY_LABELS = [
  'Чита',
  'Таганрог',
  'Казань',
  'Красноярск',
  'Тюмень',
  'Краснодар',
  'Иркутск',
  'Москва',
  'Барнаул',
  'Новороссийск',
  'Новосибирск',
  'Ростов-на-Дону',
  'Сочи',
  'Анапа',
  'Ейск',
  'Екатеринбург',
  'Ставрополь',
  'Уфа',
  'Волгоград',
  'Набережные Челны',
  'Саратов',
  'Шахты',
  'Волгодонск',
  'Миллерово',
  'Хабаровск',
  'Якутск',
];

const MANUAL_CITY_PATTERNS = {
  'астрахань': [
    'астрахан(?:ь|и|е|ью|ю)',
    'астраханск(?:ий|ая|ое|ие|ого|ой|ую|ых|им|ими|ом|ому)',
  ],
  'ростов-на-дону': [
    'ростов(?:[\\s-]+на[\\s-]+дону)',
    'ростове(?:[\\s-]+на[\\s-]+дону)',
    'рнд',
  ],
  'санкт-петербург': [
    'санкт(?:[\\s-]+)петербург(?:а|у|е|ом)?',
    'питер(?:а|у|е|ом)?',
  ],
  'екатеринбург': [
    'екатеринбург(?:а|у|е|ом)?',
    'екб',
  ],
  'новосибирск': [
    'новосибирск(?:а|у|е|ом)?',
    'нск',
  ],
  'набережные челны': [
    'набережн(?:ые|ых)?\\s+челн(?:ы|ах|ов|ам)?',
  ],
  'славянск-на-кубани': [
    'славянск(?:[\\s-]+на[\\s-]+кубани)',
  ],
  'усть-лабинск': [
    'усть(?:[\\s-]+)лабинск(?:а|у|е|ом)?',
  ],
  'усть-илимск': [
    'усть(?:[\\s-]+)илимск(?:а|у|е|ом)?',
  ],
  'красный сулин': [
    'красн(?:ый|ого|ому|ом)?\\s+сулин(?:а|у|е|ом)?',
  ],
  'каменск-шахтинский': [
    'каменск(?:[\\s-]+шахтинск(?:ий|ого|ому|им|ом|е)?)',
  ],
};

function printHelp() {
  console.log(`
Usage:
  node scripts/report-bot-chats-by-city.js [--env-file .env]

What it does:
  - loads BOT_TOKEN from env
  - fetches all chats/channels available to the bot
  - groups active entries by city using title + description
  - saves raw and grouped reports to data/
`.trim());
}

function parseArgs(argv) {
  const options = {
    envFile: DEFAULT_ENV_FILE,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--env-file') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --env-file');
      }
      options.envFile = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatTimestamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function readSeedCityLabels() {
  if (!fs.existsSync(SEED_CITY_LABELS_FILE)) {
    return [...FALLBACK_CITY_LABELS];
  }

  try {
    const payload = JSON.parse(fs.readFileSync(SEED_CITY_LABELS_FILE, 'utf8'));
    const labels = Array.isArray(payload?.groups?.city)
      ? payload.groups.city.map((entry) => entry?.label).filter((label) => typeof label === 'string' && label.trim() !== '')
      : [];
    if (labels.length > 0) {
      return labels;
    }
  } catch (error) {
    console.warn(`[warn] failed to read seed labels from ${SEED_CITY_LABELS_FILE}: ${error.message}`);
  }

  return [...FALLBACK_CITY_LABELS];
}

function buildFlexiblePhrasePattern(normalizedLabel) {
  const escaped = escapeRegExp(normalizedLabel);
  return escaped
    .replace(/\\ /g, '[\\s\\u00A0]+')
    .replace(/-/g, '[\\s-]+');
}

function buildAutoPattern(normalizedLabel) {
  if (normalizedLabel.includes(' ') || normalizedLabel.includes('-')) {
    return buildFlexiblePhrasePattern(normalizedLabel);
  }

  if (normalizedLabel.endsWith('ь')) {
    const root = escapeRegExp(normalizedLabel.slice(0, -1));
    return `${root}(?:ь|и|е|ью|ю)`;
  }

  if (normalizedLabel.endsWith('а')) {
    const root = escapeRegExp(normalizedLabel.slice(0, -1));
    return `${root}(?:а|ы|е|у|ой|ою)`;
  }

  if (normalizedLabel.endsWith('я')) {
    const root = escapeRegExp(normalizedLabel.slice(0, -1));
    return `${root}(?:я|и|е|ю|ей|ею)`;
  }

  if (normalizedLabel.endsWith('й')) {
    const root = escapeRegExp(normalizedLabel.slice(0, -1));
    return `${root}(?:й|я|ю|е|ем)`;
  }

  if (normalizedLabel.endsWith('о')) {
    return escapeRegExp(normalizedLabel);
  }

  return `${escapeRegExp(normalizedLabel)}(?:а|у|е|ом)?`;
}

function buildBoundaryRegex(pattern) {
  return new RegExp(`(^|[^а-яa-z0-9])(?:${pattern})(?=[^а-яa-z0-9]|$)`, 'iu');
}

function buildCityMatchers() {
  const canonicalLabels = [...new Set([...readSeedCityLabels(), ...EXTRA_CITY_LABELS])].sort((a, b) => a.localeCompare(b, 'ru'));

  return canonicalLabels.map((label) => {
    const normalized = normalizeText(label);
    const patterns = new Set();
    patterns.add(buildAutoPattern(normalized));
    for (const extraPattern of MANUAL_CITY_PATTERNS[normalized] || []) {
      patterns.add(extraPattern);
    }
    return {
      label,
      normalized,
      regexes: [...patterns].map(buildBoundaryRegex),
    };
  });
}

async function fetchAllChats(api) {
  const chats = [];
  let marker = null;
  let pages = 0;

  do {
    const response = await api.getAllChats({ count: 100, marker });
    chats.push(...(response.chats || []));
    marker = response.marker ?? null;
    pages += 1;
    console.log(`[fetch] page ${pages}: +${response.chats?.length || 0} chats`);
  } while (marker !== null);

  return { chats, pages };
}

function summarizeChat(chat, extra = {}) {
  return {
    chat_id: chat.chat_id,
    type: chat.type,
    status: chat.status,
    title: chat.title,
    participants_count: chat.participants_count,
    description: chat.description ?? null,
    link: chat.link ?? null,
    ...extra,
  };
}

function classifyChat(chat, cityMatchers) {
  const title = normalizeText(chat.title || '');
  const description = normalizeText(chat.description || '');
  const matches = [];

  for (const matcher of cityMatchers) {
    let score = 0;
    const matchedFields = [];

    if (title && matcher.regexes.some((regex) => regex.test(title))) {
      score += 3;
      matchedFields.push('title');
    }

    if (description && matcher.regexes.some((regex) => regex.test(description))) {
      score += 1;
      matchedFields.push('description');
    }

    if (score > 0) {
      matches.push({
        label: matcher.label,
        score,
        matchedFields,
      });
    }
  }

  if (matches.length === 0) {
    return {
      kind: 'no_city',
      matches: [],
    };
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.label.localeCompare(right.label, 'ru');
  });

  const topScore = matches[0].score;
  const topMatches = matches.filter((entry) => entry.score === topScore);

  if (topMatches.length > 1) {
    return {
      kind: 'ambiguous',
      matches,
      topMatches,
    };
  }

  return {
    kind: 'city',
    city: topMatches[0].label,
    matches,
    matchedFields: topMatches[0].matchedFields,
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# MAX bot chats grouped by city');
  lines.push('');
  lines.push(`checked_at: ${report.checked_at}`);
  lines.push(`source_file: ${report.source_file}`);
  lines.push(`active_chat_or_channel_count: ${report.active_chat_or_channel_count}`);
  lines.push(`city_assigned_chat_count: ${report.city_assigned_chat_count}`);
  lines.push(`description_only_city_matches: ${report.description_only_city_matches}`);
  lines.push(`ambiguous_chat_count: ${report.ambiguous_chat_count}`);
  lines.push(`no_city_chat_count: ${report.no_city_chat_count}`);
  lines.push(`type_counts: ${Object.entries(report.type_counts).map(([type, count]) => `${type}=${count}`).join(', ')}`);
  lines.push('');
  lines.push('## City counts');
  lines.push('');
  for (const city of report.cities) {
    lines.push(`- ${city.city} - ${city.chat_count}`);
  }
  lines.push('');
  lines.push('## Ambiguous city matches');
  lines.push('');
  for (const chat of report.ambiguous_chats.slice(0, 40)) {
    lines.push(`- ${chat.title || '(без названия)'} [${chat.chat_id}] -> ${chat.top_matches.join(', ')}`);
  }
  lines.push('');
  lines.push('## No clear city');
  lines.push('');
  for (const chat of report.no_city_chats.slice(0, 60)) {
    lines.push(`- ${chat.title || '(без названия)'} [${chat.chat_id}]`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  dotenv.config({ path: options.envFile });
  if (!process.env.BOT_TOKEN) {
    throw new Error(`BOT_TOKEN is missing in ${options.envFile}`);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const bot = new Bot(process.env.BOT_TOKEN);
  const checkedAt = new Date().toISOString();
  const timestamp = formatTimestamp(new Date());
  const cityMatchers = buildCityMatchers();

  console.log(`[run] loaded ${cityMatchers.length} city labels`);
  const { chats, pages } = await fetchAllChats(bot.api);
  const rawFileName = `all_bot_chats_live_${timestamp}.json`;
  const rawFilePath = path.join(DATA_DIR, rawFileName);

  fs.writeFileSync(rawFilePath, JSON.stringify({
    checked_at: checkedAt,
    pages_fetched: pages,
    total: chats.length,
    chats,
  }, null, 2));

  const active = chats.filter((chat) => chat && chat.status === 'active' && (chat.type === 'chat' || chat.type === 'channel'));
  const typeCounts = active.reduce((acc, chat) => {
    acc[chat.type] = (acc[chat.type] || 0) + 1;
    return acc;
  }, {});

  const cityMap = new Map();
  const ambiguousChats = [];
  const noCityChats = [];
  let descriptionOnlyCityMatches = 0;

  for (const chat of active) {
    const classification = classifyChat(chat, cityMatchers);

    if (classification.kind === 'city') {
      if (classification.matchedFields.length === 1 && classification.matchedFields[0] === 'description') {
        descriptionOnlyCityMatches += 1;
      }

      if (!cityMap.has(classification.city)) {
        cityMap.set(classification.city, {
          city: classification.city,
          chat_count: 0,
          participants_sum: 0,
          chats: [],
        });
      }

      const entry = cityMap.get(classification.city);
      entry.chat_count += 1;
      entry.participants_sum += Number(chat.participants_count || 0);
      entry.chats.push(summarizeChat(chat, {
        matched_fields: classification.matchedFields,
        city_matches: classification.matches.map((match) => ({
          city: match.label,
          score: match.score,
          matched_fields: match.matchedFields,
        })),
      }));
      continue;
    }

    if (classification.kind === 'ambiguous') {
      ambiguousChats.push(summarizeChat(chat, {
        top_matches: classification.topMatches.map((match) => match.label),
        city_matches: classification.matches.map((match) => ({
          city: match.label,
          score: match.score,
          matched_fields: match.matchedFields,
        })),
      }));
      continue;
    }

    noCityChats.push(summarizeChat(chat));
  }

  const cities = [...cityMap.values()]
    .map((entry) => ({
      ...entry,
      chats: entry.chats.sort((left, right) => (right.participants_count || 0) - (left.participants_count || 0)),
    }))
    .sort((left, right) => {
      if (right.chat_count !== left.chat_count) {
        return right.chat_count - left.chat_count;
      }
      return left.city.localeCompare(right.city, 'ru');
    });

  const countsOnlyLines = cities.map((entry) => `${entry.city} - ${entry.chat_count}`);
  const countsOnlyFileName = `bot_chats_by_city_counts_${timestamp}.txt`;
  const jsonFileName = `bot_chats_by_city_${timestamp}.json`;
  const mdFileName = `bot_chats_by_city_${timestamp}.md`;

  const report = {
    checked_at: checkedAt,
    source_file: path.relative(ROOT_DIR, rawFilePath),
    total_chats_seen: chats.length,
    active_chat_or_channel_count: active.length,
    type_counts: typeCounts,
    city_label_count_used: cityMatchers.length,
    city_group_count: cities.length,
    city_assigned_chat_count: cities.reduce((sum, entry) => sum + entry.chat_count, 0),
    description_only_city_matches: descriptionOnlyCityMatches,
    ambiguous_chat_count: ambiguousChats.length,
    no_city_chat_count: noCityChats.length,
    cities,
    ambiguous_chats: ambiguousChats.sort((left, right) => (right.participants_count || 0) - (left.participants_count || 0)),
    no_city_chats: noCityChats.sort((left, right) => (right.participants_count || 0) - (left.participants_count || 0)),
    files: {
      raw: path.relative(ROOT_DIR, rawFilePath),
      counts_txt: path.join('data', countsOnlyFileName),
      json: path.join('data', jsonFileName),
      markdown: path.join('data', mdFileName),
    },
  };

  fs.writeFileSync(path.join(DATA_DIR, countsOnlyFileName), `${countsOnlyLines.join('\n')}\n`);
  fs.writeFileSync(path.join(DATA_DIR, jsonFileName), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, mdFileName), renderMarkdown(report));

  console.log(`[done] raw report: data/${rawFileName}`);
  console.log(`[done] city counts: data/${countsOnlyFileName}`);
  console.log(`[done] grouped json: data/${jsonFileName}`);
  console.log(`[done] grouped md: data/${mdFileName}`);
  console.log(`[summary] active=${active.length}, assigned=${report.city_assigned_chat_count}, ambiguous=${ambiguousChats.length}, no_city=${noCityChats.length}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
