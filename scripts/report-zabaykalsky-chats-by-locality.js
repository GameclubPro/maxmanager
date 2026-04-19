#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Bot } = require('@maxhub/max-bot-api');

const DEFAULTS = {
  envFile: '.env',
  outputDir: 'data',
  outputPrefix: 'zabaykalsky_chats_check_precise',
  pauseMs: 60,
  pageSize: 100,
  chatType: 'chat',
  targetChatId: -71489818560519,
};

function term(pattern) {
  return `(^|[^\\p{L}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{N}])`;
}

function makeRegex(pattern) {
  return new RegExp(term(pattern), 'iu');
}

const REGION_RULES = [
  { label: 'Забайкальский край', regex: makeRegex('забайкальск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край') },
  { label: 'Забайкалье', regex: makeRegex('забайкалье') },
  { label: 'Заб. край', regex: makeRegex('заб\\.?\\s*,?\\s*кра(?:й|я|е)') },
  { label: '75 регион', regex: makeRegex('(?:75\\s*(?:rus|r|регион)|регион\\s*75)') },
  { label: 'Чита', regex: makeRegex('чит(?:а|е|ы|у|ой)') },
];

const LOCALITY_RULES = [
  { locality: 'Черновский район (Чита)', patterns: [makeRegex('черновск(?:ий|ого|ому|ом|им)?\\s*район')], suppress: ['Чита'] },
  { locality: 'Читинский район', patterns: [makeRegex('читинск(?:ий|ого|ому|ом|им)?\\s*район')], suppress: ['Чита'] },
  { locality: 'ГРЭС (Чита)', patterns: [makeRegex('грэс\\s*чита|чита\\s*грэс')], suppress: ['Чита'] },
  { locality: 'Чита', patterns: [makeRegex('чит(?:а|е|ы|у|ой)'), makeRegex('75\\s*(?:rus|r)')] },
  { locality: 'Краснокаменск', patterns: [makeRegex('краснокаменск(?:[а-яё-]+)?'), makeRegex('краснокаменск(?:ий|ого|ому|ом|им)?\\s*базар')] },
  { locality: 'Борзя', patterns: [makeRegex('борзя'), makeRegex('борзинск(?:ий|ого|ому|ом|им)?\\s*р(?:айо)?н')] },
  { locality: 'Балей', patterns: [makeRegex('бале(?:й|я|е|ем|ю)')] },
  { locality: 'Оловянная', patterns: [makeRegex('оловянн(?:ая|ой|ую|ою)')] },
  { locality: 'Приаргунск', patterns: [makeRegex('приаргунск(?:[а-яё-]+)?')] },
  { locality: 'Хилок', patterns: [makeRegex('хилок(?:[а-яё-]+)?')] },
  { locality: 'Забайкальск', patterns: [makeRegex('забайкальск(?:а|е|у)?')] },
  { locality: 'Нерчинск', patterns: [makeRegex('нерчинск(?:[а-яё-]+)?')] },
  { locality: 'Шилка', patterns: [makeRegex('шилка'), makeRegex('шилкинск(?:ий|ого|ому|ом|им)?')] },
  { locality: 'Могоча', patterns: [makeRegex('могоч(?:а|и|е|ой|у)')] },
  { locality: 'Агинское', patterns: [makeRegex('агинск(?:ое|ого|ому|ом|им)?')] },
  { locality: 'Дульдурга', patterns: [makeRegex('дульдург(?:а|и|е|ой|у)')] },
  { locality: 'Карымское', patterns: [makeRegex('карымск(?:ое|ого|ому|ом|им)?')] },
  { locality: 'Домна', patterns: [makeRegex('домна')] },
  { locality: 'Первомайский', patterns: [makeRegex('первомайск(?:ий|ого|ому|ом|им)?')], requireBroad: true },
  { locality: 'Шерловая Гора', patterns: [makeRegex('шерлов(?:ая)?\\s*гора')] },
  { locality: 'Дарасун', patterns: [makeRegex('дарасун(?:[а-яё-]+)?')] },
  { locality: 'Сретенск', patterns: [makeRegex('сретенск(?:[а-яё-]+)?')] },
  { locality: 'Петровск-Забайкальский', patterns: [makeRegex('петровск-?забайкальск(?:ий|ого|ому|ом|им)?')] },
  { locality: 'Улёты', patterns: [makeRegex('ул[её]т(?:ы|ах|ам|ами)?')] },
  { locality: 'Кокуй', patterns: [makeRegex('кокуй')] },
  { locality: 'Чернышевск', patterns: [makeRegex('чернышевск(?:[а-яё-]+)?')] },
  { locality: 'Новая Чара', patterns: [makeRegex('нов(?:ая|ой)\\s*чара')] },
  { locality: 'Газимурский Завод', patterns: [makeRegex('газимурск(?:ий|ого|ому|ом|им)?\\s*завод')] },
  { locality: 'Нерчинский Завод', patterns: [makeRegex('нерчинск(?:ий|ого|ому|ом|им)?\\s*завод')] },
  { locality: 'Кыра', patterns: [makeRegex('кыр(?:а|е|у|ой)')] },
  { locality: 'Акша', patterns: [makeRegex('акш(?:а|е|у|ой)')] },
  { locality: 'Калга', patterns: [makeRegex('калг(?:а|е|у|ой)')] },
  { locality: 'Шелопугино', patterns: [makeRegex('шелопугин(?:о|а|е|у)?')] },
  { locality: 'Тунгокочен', patterns: [makeRegex('тунгокочен(?:[а-яё-]+)?')] },
];

function printHelp() {
  console.log(`
Usage:
  node scripts/report-zabaykalsky-chats-by-locality.js

Options:
  --env-file <path>       Env file path (default: .env)
  --output-dir <path>     Output directory (default: data)
  --output-prefix <name>  Output filename prefix (default: zabaykalsky_chats_check_precise)
  --pause-ms <n>          Delay between paged API calls (default: 60)
  --page-size <n>         Page size for getAllChats (default: 100)
  --chat-type <type>      Chat type filter (default: chat)
  --target-chat-id <id>   Reference Zab chat id (default: -71489818560519)
  --help, -h              Show this help
`.trim());
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(0, eqIndex) : arg;
    const inlineValue = eqIndex >= 0 ? arg.slice(eqIndex + 1) : null;
    const { value, nextIndex } = resolveValue(key, inlineValue, argv, index);
    index = nextIndex;

    switch (key) {
      case '--env-file':
        options.envFile = value;
        break;
      case '--output-dir':
        options.outputDir = value;
        break;
      case '--output-prefix':
        options.outputPrefix = value;
        break;
      case '--pause-ms':
        options.pauseMs = parseInteger('pause-ms', value, 0);
        break;
      case '--page-size':
        options.pageSize = parseInteger('page-size', value, 1);
        break;
      case '--chat-type':
        options.chatType = value;
        break;
      case '--target-chat-id':
        options.targetChatId = normalizeChatId(value, 'target-chat-id');
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  return options;
}

function resolveValue(key, inlineValue, argv, currentIndex) {
  if (inlineValue !== null) {
    return { value: inlineValue, nextIndex: currentIndex };
  }

  const nextIndex = currentIndex + 1;
  if (nextIndex >= argv.length) {
    throw new Error(`Missing value for ${key}`);
  }

  return { value: argv[nextIndex], nextIndex };
}

function parseInteger(label, value, min) {
  if (!/^-?\d+$/.test(String(value))) {
    throw new Error(`Invalid --${label}: ${value}`);
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Invalid --${label}: ${value}`);
  }

  return parsed;
}

function normalizeChatId(rawValue, label) {
  const value = String(rawValue).trim();
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Invalid ${label}: ${rawValue}`);
  }

  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric === 0) {
    throw new Error(`Invalid ${label}: ${rawValue}`);
  }

  return numeric > 0 ? -Math.abs(numeric) : numeric;
}

function sleep(ms) {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function discoverTokenEnvNames(env) {
  return Object.keys(env)
    .filter((name) => /^BOT_TOKEN\d*$/.test(name))
    .filter((name) => String(env[name] || '').trim() !== '')
    .sort((left, right) => {
      if (left === 'BOT_TOKEN') return -1;
      if (right === 'BOT_TOKEN') return 1;
      return left.localeCompare(right, 'en');
    });
}

async function fetchAllChats(api, options) {
  const chats = [];
  let marker = null;
  let pages = 0;

  do {
    const params = marker === null
      ? { count: options.pageSize }
      : { count: options.pageSize, marker };
    const response = await api.getAllChats(params);
    chats.push(...(response.chats || []));
    marker = response.marker ?? null;
    pages += 1;
    await sleep(options.pauseMs);
  } while (marker !== null);

  return { chats, pages };
}

async function loadChatsForToken(tokenEnv, token, options) {
  const bot = new Bot(token);
  const botInfo = await bot.api.getMyInfo();
  const allChats = await fetchAllChats(bot.api, options);
  const visibleChats = allChats.chats.filter((chat) => chat.type === options.chatType && chat.status === 'active');
  const seesTarget = visibleChats.some((chat) => Number(chat.chat_id) === options.targetChatId);

  return {
    token_env: tokenEnv,
    bot: {
      user_id: botInfo.user_id ?? null,
      username: botInfo.username ?? null,
      name: botInfo.name ?? null,
    },
    pages: allChats.pages,
    total_visible_active_chats: visibleChats.length,
    sees_target_chat: seesTarget,
    chats: visibleChats,
  };
}

function collectFieldMatches(text, fieldName, rules) {
  if (!text) {
    return [];
  }

  const matches = [];
  for (const rule of rules) {
    if (rule.regex.test(text)) {
      matches.push(`${fieldName}:${rule.label}`);
    }
  }

  return matches;
}

function collectLocalityMatches(text, fieldName) {
  if (!text) {
    return [];
  }

  const matches = [];
  for (const rule of LOCALITY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        matches.push({
          locality: rule.locality,
          reason: `${fieldName}:${rule.locality}`,
          requireBroad: Boolean(rule.requireBroad),
          suppress: rule.suppress || [],
        });
        break;
      }
    }
  }

  return matches;
}

function pickLocality(localityMatches, broadReasons) {
  const eligibleMatches = localityMatches.filter((match) => !match.requireBroad || broadReasons.length > 0);

  if (eligibleMatches.length === 0) {
    if (broadReasons.length > 0) {
      return {
        locality_bucket: 'Забайкальский край / общие',
        matched_localities: [],
      };
    }

    return null;
  }

  const localities = [];
  const seen = new Set();

  for (const match of eligibleMatches) {
    if (!seen.has(match.locality)) {
      seen.add(match.locality);
      localities.push(match.locality);
    }
  }

  const suppressed = new Set();
  for (const match of eligibleMatches) {
    for (const item of match.suppress) {
      suppressed.add(item);
    }
  }

  const filtered = localities.filter((locality) => !suppressed.has(locality));
  const finalLocalities = filtered.length > 0 ? filtered : localities;

  if (finalLocalities.length === 1) {
    return {
      locality_bucket: finalLocalities[0],
      matched_localities: finalLocalities,
    };
  }

  return {
    locality_bucket: finalLocalities.join(' / '),
    matched_localities: finalLocalities,
  };
}

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toChatRecord(chat, visibleViaTokens) {
  const title = toText(chat.title);
  const description = toText(chat.description);
  const link = toText(chat.link);

  const broadReasons = [
    ...collectFieldMatches(title, 'title', REGION_RULES),
    ...collectFieldMatches(description, 'description', REGION_RULES),
    ...collectFieldMatches(link, 'link', REGION_RULES),
  ];

  const localityMatches = [
    ...collectLocalityMatches(title, 'title'),
    ...collectLocalityMatches(description, 'description'),
    ...collectLocalityMatches(link, 'link'),
  ];

  const locality = pickLocality(localityMatches, broadReasons);
  if (!locality) {
    return null;
  }

  const reasons = Array.from(new Set([
    ...broadReasons,
    ...localityMatches.map((item) => item.reason),
  ]));

  const matchedBy = Array.from(new Set(reasons.map((item) => item.split(':', 1)[0])));

  return {
    chat_id: Number(chat.chat_id),
    type: chat.type ?? null,
    status: chat.status ?? null,
    title: title || null,
    description: description || null,
    participants_count: chat.participants_count ?? null,
    is_public: chat.is_public ?? null,
    link: link || null,
    last_event_time: chat.last_event_time ?? null,
    visible_in_tokens: visibleViaTokens.slice().sort((left, right) => left.localeCompare(right, 'en')),
    locality_bucket: locality.locality_bucket,
    matched_localities: locality.matched_localities,
    matched_by: matchedBy,
    reasons,
    classification: matchedBy.includes('description') && !matchedBy.includes('title')
      ? 'matched_by_description'
      : locality.locality_bucket === 'Забайкальский край / общие'
        ? 'broad_region'
        : 'locality_confirmed',
  };
}

function sortChats(chats) {
  chats.sort((left, right) => {
    const participantsDelta = (right.participants_count ?? -1) - (left.participants_count ?? -1);
    if (participantsDelta !== 0) return participantsDelta;
    return String(left.title || '').localeCompare(String(right.title || ''), 'ru');
  });
}

function sortBuckets(entries) {
  return entries.sort((left, right) => {
    const countDelta = right[1].length - left[1].length;
    if (countDelta !== 0) return countDelta;
    return left[0].localeCompare(right[0], 'ru');
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const envResult = dotenv.config({ path: options.envFile, quiet: true });
  if (envResult.error) {
    throw envResult.error;
  }

  const tokenEnvNames = discoverTokenEnvNames(process.env);
  if (tokenEnvNames.length === 0) {
    throw new Error(`No BOT_TOKEN* variables found in ${options.envFile}`);
  }

  const tokenResults = [];
  for (const tokenEnv of tokenEnvNames) {
    const token = String(process.env[tokenEnv] || '').trim();
    console.log(`[run] Scanning ${tokenEnv}`);
    tokenResults.push(await loadChatsForToken(tokenEnv, token, options));
  }

  const relevantTokens = tokenResults
    .filter((item) => item.sees_target_chat)
    .map((item) => item.token_env);

  if (relevantTokens.length === 0) {
    throw new Error(`Target chat ${options.targetChatId} was not found in any BOT_TOKEN* scope`);
  }

  const uniqueChats = new Map();
  for (const tokenResult of tokenResults) {
    if (!tokenResult.sees_target_chat) {
      continue;
    }

    for (const chat of tokenResult.chats) {
      const chatId = Number(chat.chat_id);
      const existing = uniqueChats.get(chatId);

      if (!existing) {
        uniqueChats.set(chatId, {
          ...chat,
          visible_in_tokens: [tokenResult.token_env],
        });
        continue;
      }

      if (!existing.visible_in_tokens.includes(tokenResult.token_env)) {
        existing.visible_in_tokens.push(tokenResult.token_env);
      }

      if (!existing.description && chat.description) {
        existing.description = chat.description;
      }
      if (!existing.link && chat.link) {
        existing.link = chat.link;
      }
      if (!existing.title && chat.title) {
        existing.title = chat.title;
      }
      if ((chat.participants_count ?? -1) > (existing.participants_count ?? -1)) {
        existing.participants_count = chat.participants_count;
      }
      if ((chat.last_event_time ?? -1) > (existing.last_event_time ?? -1)) {
        existing.last_event_time = chat.last_event_time;
      }
    }
  }

  const matchedChats = [];
  for (const chat of uniqueChats.values()) {
    const record = toChatRecord(chat, chat.visible_in_tokens || []);
    if (record) {
      matchedChats.push(record);
    }
  }

  sortChats(matchedChats);

  const grouped = new Map();
  for (const chat of matchedChats) {
    if (!grouped.has(chat.locality_bucket)) {
      grouped.set(chat.locality_bucket, []);
    }
    grouped.get(chat.locality_bucket).push(chat);
  }

  const groupedByLocality = Object.fromEntries(
    sortBuckets(Array.from(grouped.entries())).map(([locality, chats]) => {
      sortChats(chats);
      return [locality, {
        chats_count: chats.length,
        chats,
      }];
    }),
  );

  const fieldStats = {
    title: matchedChats.filter((chat) => chat.matched_by.includes('title')).length,
    description: matchedChats.filter((chat) => chat.matched_by.includes('description')).length,
    link: matchedChats.filter((chat) => chat.matched_by.includes('link')).length,
  };

  const summaryLines = [];
  summaryLines.push('Забайкальский край: чаты по городам и поселкам');
  summaryLines.push(`Сгенерировано: ${new Date().toISOString()}`);
  summaryLines.push(`Целевой чат: ${options.targetChatId}`);
  summaryLines.push(`Токены с доступом к целевому чату: ${relevantTokens.join(', ')}`);
  summaryLines.push(`Всего релевантных чатов: ${matchedChats.length}`);
  summaryLines.push(`Совпадение по title: ${fieldStats.title}`);
  summaryLines.push(`Совпадение по description: ${fieldStats.description}`);
  summaryLines.push(`Совпадение по link: ${fieldStats.link}`);
  summaryLines.push('');

  for (const [locality, data] of Object.entries(groupedByLocality)) {
    summaryLines.push(`${locality} (${data.chats_count})`);
    for (const chat of data.chats) {
      const countLabel = chat.participants_count === null ? 'n/a' : String(chat.participants_count);
      summaryLines.push(`- ${chat.title || '(без названия)'} | ${chat.chat_id} | users=${countLabel} | via=${chat.matched_by.join(',')} | tokens=${chat.visible_in_tokens.join(',')}`);
    }
    summaryLines.push('');
  }

  const payload = {
    checked_at: new Date().toISOString(),
    env_file: path.resolve(options.envFile),
    target_chat_id: options.targetChatId,
    relevant_tokens: relevantTokens,
    token_scan: tokenResults.map((item) => ({
      token_env: item.token_env,
      bot: item.bot,
      pages: item.pages,
      total_visible_active_chats: item.total_visible_active_chats,
      sees_target_chat: item.sees_target_chat,
    })),
    total_unique_visible_chats_in_scope: uniqueChats.size,
    matched_count: matchedChats.length,
    matched_by_field: fieldStats,
    grouped_by_locality: groupedByLocality,
  };

  const outputDir = path.resolve(options.outputDir);
  ensureDir(outputDir);
  const timestamp = formatTimestamp();
  const jsonPath = path.join(outputDir, `${options.outputPrefix}_${timestamp}.json`);
  const txtPath = path.join(outputDir, `${options.outputPrefix}_${timestamp}.txt`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(txtPath, `${summaryLines.join('\n')}\n`);

  console.log(`[done] JSON: ${jsonPath}`);
  console.log(`[done] TXT: ${txtPath}`);
}

main().catch((error) => {
  console.error(`[fatal] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
