#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Bot } = require('@maxhub/max-bot-api');

const DEFAULTS = {
  envFile: '.env',
  tokenEnv: 'BOT_TOKEN2',
  titlePattern: '(уфа|уфим|сипайл|давлек|раевк|чишм|башкир|башкор|\\bрб\\b)',
  outputDir: 'data',
  outputPrefix: 'ufa_bot_token2_all_other_chats_member_ids_no_bots_no_admins_live',
  pauseMs: 60,
  chatPageSize: 100,
  membersPageSize: 100,
  chatType: 'chat',
};

function printHelp() {
  const text = `
Usage:
  node scripts/export-region-member-ids-2026.js \\
    --token-env BOT_TOKEN2 \\
    --exclude-chat-id -71443525791210

Optional:
  --env-file <path>           Env file path (default: .env)
  --token-env <name>          Env var with bot token (default: BOT_TOKEN2)
  --title-pattern <regex>     Case-insensitive regex for chat titles
  --exclude-chat-id <id>      Exclude chat id (repeatable)
  --output-dir <path>         Output directory (default: data)
  --output-prefix <name>      Output filename prefix without extension
  --pause-ms <n>              Delay between paged API calls (default: 60)
  --chat-page-size <n>        Page size for getAllChats (default: 100)
  --members-page-size <n>     Page size for getChatMembers (default: 100)
  --chat-type <type>          Filter by chat type (default: chat)
  --help, -h                  Show this help
`.trim();

  console.log(text);
}

function parseArgs(argv) {
  const options = {
    ...DEFAULTS,
    excludeChatIdsRaw: [],
    help: false,
  };

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
    const valueResult = resolveValue(key, inlineValue, argv, index);
    const value = valueResult.value;
    index = valueResult.nextIndex;

    switch (key) {
      case '--env-file':
        options.envFile = value;
        break;
      case '--token-env':
        options.tokenEnv = value;
        break;
      case '--title-pattern':
        options.titlePattern = value;
        break;
      case '--exclude-chat-id':
        options.excludeChatIdsRaw.push(value);
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
      case '--chat-page-size':
        options.chatPageSize = parseInteger('chat-page-size', value, 1);
        break;
      case '--members-page-size':
        options.membersPageSize = parseInteger('members-page-size', value, 1);
        break;
      case '--chat-type':
        options.chatType = value;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  options.excludeChatIds = options.excludeChatIdsRaw.map((value) => normalizeChatId(value, 'exclude-chat-id'));

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

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

async function fetchAllChats(api, options) {
  const chats = [];
  let marker = null;
  let pages = 0;

  do {
    const params = marker === null
      ? { count: options.chatPageSize }
      : { count: options.chatPageSize, marker };
    const response = await api.getAllChats(params);
    chats.push(...(response.chats || []));
    marker = response.marker ?? null;
    pages += 1;
    await sleep(options.pauseMs);
  } while (marker !== null);

  return { chats, pages };
}

async function fetchAllChatMembers(api, chatId, options) {
  const members = [];
  let marker = null;
  let pages = 0;

  do {
    const params = marker === null
      ? { count: options.membersPageSize }
      : { count: options.membersPageSize, marker };
    const response = await api.getChatMembers(chatId, params);
    members.push(...(response.members || []));
    marker = response.marker ?? null;
    pages += 1;
    await sleep(options.pauseMs);
  } while (marker !== null);

  return { members, pages };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

  const token = process.env[options.tokenEnv];
  if (!token) {
    throw new Error(`${options.tokenEnv} is missing in ${options.envFile}`);
  }

  const titleRegex = new RegExp(options.titlePattern, 'i');
  const excludedChatIds = new Set(options.excludeChatIds);
  const bot = new Bot(token);

  console.log(`[run] Loading chats using ${options.tokenEnv}...`);
  const allChatsResult = await fetchAllChats(bot.api, options);
  const matchedChats = allChatsResult.chats.filter((chat) => {
    if (chat.type !== options.chatType) return false;
    if (chat.status !== 'active') return false;
    if (excludedChatIds.has(Number(chat.chat_id))) return false;
    const title = typeof chat.title === 'string' ? chat.title : '';
    return titleRegex.test(title);
  });

  if (matchedChats.length === 0) {
    throw new Error('No chats matched the configured filters');
  }

  console.log(`[run] Matched ${matchedChats.length} source chats out of ${allChatsResult.chats.length}`);

  const uniqueIds = new Set();
  const perChat = [];
  const globalStats = {
    membersFetched: 0,
    botsFiltered: 0,
    adminsFiltered: 0,
    duplicatesFiltered: 0,
  };

  for (const [index, chat] of matchedChats.entries()) {
    console.log(`[run] [${index + 1}/${matchedChats.length}] Fetching chat ${chat.chat_id} ${chat.title || ''}`);
    const membersResult = await fetchAllChatMembers(bot.api, chat.chat_id, options);
    const chatUniqueIds = new Set();
    const chatStats = {
      membersFetched: membersResult.members.length,
      botsFiltered: 0,
      adminsFiltered: 0,
      duplicatesFiltered: 0,
    };

    for (const member of membersResult.members) {
      globalStats.membersFetched += 1;
      if (member.is_bot) {
        chatStats.botsFiltered += 1;
        globalStats.botsFiltered += 1;
        continue;
      }
      if (member.is_admin || member.is_owner) {
        chatStats.adminsFiltered += 1;
        globalStats.adminsFiltered += 1;
        continue;
      }
      if (uniqueIds.has(member.user_id)) {
        chatStats.duplicatesFiltered += 1;
        globalStats.duplicatesFiltered += 1;
        continue;
      }
      uniqueIds.add(member.user_id);
      chatUniqueIds.add(member.user_id);
    }

    perChat.push({
      chat_id: chat.chat_id,
      title: chat.title || null,
      participants_count: chat.participants_count ?? null,
      pages: membersResult.pages,
      members_fetched: chatStats.membersFetched,
      bots_filtered: chatStats.botsFiltered,
      admins_filtered: chatStats.adminsFiltered,
      duplicates_filtered: chatStats.duplicatesFiltered,
      unique_ids_added: chatUniqueIds.size,
    });
  }

  const ids = Array.from(uniqueIds).sort((left, right) => left - right);
  const timestamp = formatTimestamp();
  const outputDir = path.resolve(options.outputDir);
  ensureDir(outputDir);

  const jsonPath = path.join(outputDir, `${options.outputPrefix}_${timestamp}.json`);
  const txtPath = path.join(outputDir, `${options.outputPrefix}_${timestamp}.txt`);

  const payload = {
    generated_at: new Date().toISOString(),
    env_file: path.resolve(options.envFile),
    token_env: options.tokenEnv,
    title_pattern: options.titlePattern,
    chat_type: options.chatType,
    excluded_chat_ids: Array.from(excludedChatIds),
    scanned_chats_count: allChatsResult.chats.length,
    scanned_chat_pages: allChatsResult.pages,
    source_chats_count: matchedChats.length,
    source_chats: perChat,
    members_fetched: globalStats.membersFetched,
    excluded_bots_count: globalStats.botsFiltered,
    excluded_admins_count: globalStats.adminsFiltered,
    excluded_duplicates_count: globalStats.duplicatesFiltered,
    ids_count: ids.length,
    ids,
  };

  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(txtPath, `${ids.join('\n')}\n`);

  console.log(`[done] Saved ${ids.length} unique ids`);
  console.log(`[done] JSON: ${jsonPath}`);
  console.log(`[done] TXT: ${txtPath}`);
}

main().catch((error) => {
  console.error(`[fatal] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
