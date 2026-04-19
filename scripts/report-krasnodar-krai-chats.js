#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Bot } = require('@maxhub/max-bot-api');

const DEFAULTS = {
  envFile: '.env',
  outputDir: 'data',
  outputPrefix: 'krasnodar_krai_chats_live',
  pauseMs: 60,
  pageSize: 100,
  chatType: 'chat',
};

function term(pattern) {
  return `(^|[^\\p{L}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{N}])`;
}

function makeRegex(pattern) {
  return new RegExp(term(pattern), 'iu');
}

const KUBAN_PATTERN = 'кубан(?:ь|и|ью|е|ям|ями|ях)?';

const REGION_REGEX = new RegExp(
  [
    KUBAN_PATTERN,
    'kuban',
    'краснодар(?!ск)(?:[а-яё]+)?',
    'краснодарск(?:[а-яё]+)?',
    'краснодарский\\s*край',
    'новороссийск(?:[а-яё]+)?',
    'сочи',
    'анап(?:а|[еы][а-яё]*)',
    'геленджик(?:[а-яё]+)?',
    'армавир(?:[а-яё]+)?',
    'туапсе(?:[а-яё]+)?',
    'ейск(?:[а-яё]+)?',
    'тимаш[её]вск(?:[а-яё]+)?',
    'кропоткин(?:[а-яё]+)?',
    'славянск(?:[а-яё-]+)?',
    'крымск(?:[а-яё]+)?',
    'белореченск(?:[а-яё]+)?',
    'лабинск(?:[а-яё]+)?',
    'кореновск(?:[а-яё]+)?',
    'темрюк(?:[а-яё]+)?',
    'горячий\\s*ключ',
    'щербинов(?:[а-яё]+)?',
    'красноармейск(?:[а-яё]+)?',
    'усть-?лабинск(?:[а-яё]+)?',
    'новокубанск(?:[а-яё]+)?',
    'гулькевич(?:[а-яё]+)?',
    'выселк(?:и|[а-яё]+)',
    'старощербинов(?:[а-яё]+)?',
    'староминск(?:[а-яё]+)?',
    'курганинск(?:[а-яё]+)?',
    'лазаревск(?:[а-яё]+)?',
    'адлер(?:[а-яё]+)?',
    'сириус(?:[а-яё]+)?',
  ].map((value) => `(?:${value})`).join('|'),
  'iu',
);

const EXCLUDE_REGEX = /(красноярск|красноярский\s*край|енисейск|бейск|алейск|крымский\s+полуостров)/iu;

const LOCALITY_RULES = [
  { locality: 'Краснодарский край / общие', regex: makeRegex(`${KUBAN_PATTERN}|kuban|краснодарск(?:[а-яё]+)?|краснодарский\\s*край`) },
  { locality: 'Краснодар', regex: makeRegex('краснодар(?!ск)(?:[а-яё]+)?|прикубан(?:[а-яё]+)?') },
  { locality: 'Адлер', regex: makeRegex('адлер(?:[а-яё]+)?') },
  { locality: 'Сириус', regex: makeRegex('сириус(?:[а-яё]+)?') },
  { locality: 'Лазаревское', regex: makeRegex('лазаревск(?:[а-яё]+)?') },
  { locality: 'Сочи', regex: makeRegex('сочи|сочинск(?:[а-яё]+)?') },
  { locality: 'Новороссийск', regex: makeRegex('новороссийск(?:[а-яё]+)?') },
  { locality: 'Анапа', regex: makeRegex('анап(?:а|[еы][а-яё]*)') },
  { locality: 'Геленджик', regex: makeRegex('геленджик(?:[а-яё]+)?') },
  { locality: 'Армавир', regex: makeRegex('армавир(?:[а-яё]+)?') },
  { locality: 'Новокубанск', regex: makeRegex('новокубанск(?:[а-яё]+)?') },
  { locality: 'Туапсе', regex: makeRegex('туапсе(?:[а-яё]+)?') },
  { locality: 'Ейск', regex: makeRegex('ейск(?:[а-яё]+)?') },
  { locality: 'Щербиновский район', regex: makeRegex('щербинов(?:[а-яё]+)?') },
  { locality: 'Старощербиновская', regex: makeRegex('старощербинов(?:[а-яё]+)?') },
  { locality: 'Староминская', regex: makeRegex('староминск(?:[а-яё]+)?') },
  { locality: 'Тимашевск', regex: makeRegex('тимаш[её]вск(?:[а-яё]+)?') },
  { locality: 'Кропоткин', regex: makeRegex('кропоткин(?:[а-яё]+)?') },
  { locality: 'Гулькевичи', regex: makeRegex('гулькевич(?:[а-яё]+)?') },
  { locality: 'Славянск-на-Кубани', regex: makeRegex('славянск(?:[а-яё-]+)?') },
  { locality: 'Крымск', regex: makeRegex('крымск(?:[а-яё]+)?') },
  { locality: 'Белореченск', regex: makeRegex('белореченск(?:[а-яё]+)?') },
  { locality: 'Усть-Лабинск', regex: makeRegex('усть-?лабинск(?:[а-яё]+)?') },
  { locality: 'Лабинск', regex: makeRegex('лабинск(?:[а-яё]+)?') },
  { locality: 'Курганинск', regex: makeRegex('курганинск(?:[а-яё]+)?') },
  { locality: 'Кореновск', regex: makeRegex('кореновск(?:[а-яё]+)?') },
  { locality: 'Выселки', regex: makeRegex('выселк(?:и|[а-яё]+)') },
  { locality: 'Темрюк', regex: makeRegex('темрюк(?:[а-яё]+)?') },
  { locality: 'Горячий Ключ', regex: makeRegex('горячий\\s*ключ') },
  { locality: 'Красноармейский район', regex: makeRegex('красноармейск(?:[а-яё]+)?') },
];

function printHelp() {
  console.log(`
Usage:
  node scripts/report-krasnodar-krai-chats.js

Options:
  --env-file <path>      Env file path (default: .env)
  --output-dir <path>    Output directory (default: data)
  --output-prefix <name> Output filename prefix (default: krasnodar_krai_chats_live)
  --pause-ms <n>         Delay between paged API calls (default: 60)
  --page-size <n>        Page size for getAllChats (default: 100)
  --chat-type <type>     Chat type filter (default: chat)
  --help, -h             Show this help
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

function detectLocality(title) {
  if (EXCLUDE_REGEX.test(title)) {
    return null;
  }

  for (const rule of LOCALITY_RULES) {
    if (rule.regex.test(title)) {
      return rule.locality;
    }
  }

  return 'Не распределено';
}

function toChatRecord(chat) {
  const title = typeof chat.title === 'string' ? chat.title : '';
  const locality = detectLocality(title);
  return {
    chat_id: Number(chat.chat_id),
    type: chat.type ?? null,
    status: chat.status ?? null,
    title: title || null,
    participants_count: chat.participants_count ?? null,
    link: chat.link ?? null,
    locality,
  };
}

function sortChats(chats) {
  chats.sort((left, right) => {
    const participantsDelta = (right.participants_count ?? -1) - (left.participants_count ?? -1);
    if (participantsDelta !== 0) return participantsDelta;
    return String(left.title || '').localeCompare(String(right.title || ''), 'ru');
  });
}

async function loadChatsForToken(tokenEnv, token, options) {
  const bot = new Bot(token);
  const botInfo = await bot.api.getMyInfo();
  const { chats, pages } = await fetchAllChats(bot.api, options);
  const visibleChats = chats.filter((chat) => chat.type === options.chatType && chat.status === 'active');
  const matchedChats = visibleChats.filter((chat) => {
    const title = String(chat.title || '');
    return REGION_REGEX.test(title) && !EXCLUDE_REGEX.test(title);
  });

  return {
    token_env: tokenEnv,
    bot: {
      user_id: botInfo.user_id ?? null,
      username: botInfo.username ?? null,
      name: botInfo.name ?? null,
    },
    all_chats_visible_to_bot: chats.length,
    active_target_type_chats: visibleChats.length,
    pages,
    matched_chats_count: matchedChats.length,
    matched_chats: matchedChats,
  };
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

  const scanResults = [];
  const uniqueChats = new Map();

  for (const tokenEnv of tokenEnvNames) {
    const token = String(process.env[tokenEnv] || '').trim();
    console.log(`[run] Scanning chats via ${tokenEnv}`);
    const result = await loadChatsForToken(tokenEnv, token, options);
    scanResults.push({
      token_env: result.token_env,
      bot: result.bot,
      all_chats_visible_to_bot: result.all_chats_visible_to_bot,
      active_target_type_chats: result.active_target_type_chats,
      pages: result.pages,
      matched_chats_count: result.matched_chats_count,
    });

    for (const chat of result.matched_chats) {
      const chatId = Number(chat.chat_id);
      const existing = uniqueChats.get(chatId);

      if (!existing) {
        const record = toChatRecord(chat);
        if (!record.locality) {
          continue;
        }
        uniqueChats.set(chatId, { ...record, visible_via_tokens: [tokenEnv] });
        continue;
      }

      existing.visible_via_tokens.push(tokenEnv);
      const existingCount = existing.participants_count ?? -1;
      const incomingCount = chat.participants_count ?? -1;
      if (incomingCount > existingCount) {
        existing.participants_count = chat.participants_count ?? existing.participants_count;
      }
      if (!existing.link && chat.link) {
        existing.link = chat.link;
      }
      if (!existing.title && chat.title) {
        existing.title = chat.title;
      }
      if (existing.locality === 'Не распределено') {
        const locality = detectLocality(String(chat.title || ''));
        if (locality) {
          existing.locality = locality;
        }
      }
    }
  }

  const chats = Array.from(uniqueChats.values());
  sortChats(chats);

  const grouped = new Map();
  for (const chat of chats) {
    if (!grouped.has(chat.locality)) {
      grouped.set(chat.locality, []);
    }
    grouped.get(chat.locality).push(chat);
  }

  const groupedObject = Object.fromEntries(
    Array.from(grouped.entries())
      .sort((left, right) => {
        const countDelta = right[1].length - left[1].length;
        if (countDelta !== 0) return countDelta;
        return left[0].localeCompare(right[0], 'ru');
      })
      .map(([locality, localityChats]) => {
        sortChats(localityChats);
        return [
          locality,
          {
            chats_count: localityChats.length,
            chats: localityChats,
          },
        ];
      }),
  );

  const summaryLines = [];
  summaryLines.push(`Актуальный срез чатов Краснодарского края`);
  summaryLines.push(`Сгенерировано: ${new Date().toISOString()}`);
  summaryLines.push(`Токены: ${tokenEnvNames.join(', ')}`);
  summaryLines.push(`Уникальных чатов: ${chats.length}`);
  summaryLines.push('');

  for (const [locality, data] of Object.entries(groupedObject)) {
    summaryLines.push(`${locality} (${data.chats_count})`);
    for (const chat of data.chats) {
      const countLabel = chat.participants_count === null ? 'n/a' : String(chat.participants_count);
      summaryLines.push(`- ${chat.title || '(без названия)'} | ${chat.chat_id} | users=${countLabel} | tokens=${chat.visible_via_tokens.join(',')}`);
    }
    summaryLines.push('');
  }

  const payload = {
    ok: true,
    generated_at: new Date().toISOString(),
    env_file: path.resolve(options.envFile),
    token_envs: tokenEnvNames,
    filter: REGION_REGEX.source,
    scan_results: scanResults,
    unique_krasnodar_krai_chats_count: chats.length,
    grouped_by_locality: groupedObject,
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
