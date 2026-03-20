#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Bot } = require('@maxhub/max-bot-api');

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DEFAULT_ENV_FILE = '.env';

function printHelp() {
  console.log(`
Usage:
  node scripts/collect-city-target-source-members.js \\
    --city "Барнаул" \\
    --city-slug barnaul \\
    --target-chat-id -12345678901234 \\
    --city-report data/bot_chats_by_city_YYYYMMDD_HHMMSS.json

What it does:
  - loads BOT_TOKEN from env
  - reads a grouped city report from data/
  - takes all chats for the selected city except the target chat
  - fetches members from each source chat
  - excludes bots, admins/owners, and everyone already in the target chat
  - saves one txt file with unique user ids and one json report
`.trim());
}

function parseArgs(argv) {
  const options = {
    envFile: DEFAULT_ENV_FILE,
    city: null,
    citySlug: null,
    targetChatId: null,
    cityReport: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--env-file') {
      options.envFile = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--city') {
      options.city = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--city-slug') {
      options.citySlug = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--target-chat-id') {
      const value = Number(requireValue(argv, index, arg));
      if (!Number.isInteger(value)) {
        throw new Error(`Invalid --target-chat-id value: ${argv[index + 1]}`);
      }
      options.targetChatId = value;
      index += 1;
      continue;
    }
    if (arg === '--city-report') {
      options.cityReport = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.help) {
    if (!options.city) {
      throw new Error('--city is required');
    }
    if (!options.citySlug) {
      throw new Error('--city-slug is required');
    }
    if (!options.targetChatId) {
      throw new Error('--target-chat-id is required');
    }
    if (!options.cityReport) {
      options.cityReport = findLatestCityReport();
    }
  }

  return options;
}

function requireValue(argv, index, argName) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${argName}`);
  }
  return value;
}

function findLatestCityReport() {
  if (!fs.existsSync(DATA_DIR)) {
    throw new Error('data directory not found');
  }

  const candidates = fs.readdirSync(DATA_DIR)
    .filter((name) => /^bot_chats_by_city_\d{8}_\d{6}\.json$/u.test(name))
    .sort();

  if (candidates.length === 0) {
    throw new Error('No bot_chats_by_city_*.json report found in data/');
  }

  return path.join('data', candidates[candidates.length - 1]);
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

function resolvePathMaybeRelative(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(ROOT_DIR, filePath);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function summarizeError(error) {
  return {
    message: error?.message || String(error),
    status: typeof error?.status === 'number' ? error.status : null,
    code: typeof error?.code === 'string' ? error.code : null,
    stack: error?.stack || null,
  };
}

async function fetchAllChatMembers(api, chatId) {
  const members = [];
  const memberIds = new Set();
  let marker = null;
  let firstRequest = true;
  let pages = 0;

  while (firstRequest || marker !== null) {
    const response = await api.getChatMembers(chatId, firstRequest ? { count: 100 } : { count: 100, marker });
    for (const member of response.members || []) {
      members.push(member);
      if (typeof member?.user_id === 'number') {
        memberIds.add(member.user_id);
      }
    }
    marker = response.marker ?? null;
    firstRequest = false;
    pages += 1;
  }

  return { members, memberIds, pages };
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

  const cityReportPath = resolvePathMaybeRelative(options.cityReport);
  const cityReport = loadJson(cityReportPath);
  const cityEntry = Array.isArray(cityReport?.cities)
    ? cityReport.cities.find((entry) => entry?.city === options.city)
    : null;

  if (!cityEntry) {
    throw new Error(`City "${options.city}" not found in ${path.relative(ROOT_DIR, cityReportPath)}`);
  }

  const targetChatFromReport = Array.isArray(cityEntry?.chats)
    ? cityEntry.chats.find((chat) => Number(chat?.chat_id) === options.targetChatId)
    : null;

  if (!targetChatFromReport) {
    throw new Error(`Target chat ${options.targetChatId} not found inside city "${options.city}" in ${path.relative(ROOT_DIR, cityReportPath)}`);
  }

  const sourceChats = cityEntry.chats.filter((chat) => Number(chat?.chat_id) !== options.targetChatId);
  const bot = new Bot(process.env.BOT_TOKEN);
  const checkedAt = new Date().toISOString();
  const timestamp = formatTimestamp(new Date());

  console.log(`[run] city=${options.city}, source chats=${sourceChats.length}, target=${options.targetChatId}`);
  console.log('[run] loading target chat snapshot...');
  const targetLive = await bot.api.getChat(options.targetChatId);
  const targetSnapshot = await fetchAllChatMembers(bot.api, options.targetChatId);
  console.log(`[run] target snapshot loaded: ${targetSnapshot.memberIds.size} members across ${targetSnapshot.pages} pages`);

  const uniqueIds = [];
  const uniqueIdSet = new Set();
  const sourceReports = [];
  const failures = [];

  for (let index = 0; index < sourceChats.length; index += 1) {
    const sourceChat = sourceChats[index];
    console.log(`[chat ${index + 1}/${sourceChats.length}] ${sourceChat.title || '(без названия)'} [${sourceChat.chat_id}]`);

    try {
      const liveChat = await bot.api.getChat(sourceChat.chat_id);
      const snapshot = await fetchAllChatMembers(bot.api, sourceChat.chat_id);
      let botsCount = 0;
      let adminOrOwnerCount = 0;
      let eligibleCount = 0;
      let excludedAlreadyInTargetCount = 0;
      let duplicateAcrossSourcesCount = 0;
      let addedUniqueCount = 0;

      for (const member of snapshot.members) {
        const userId = member?.user_id;
        if (typeof userId !== 'number') {
          continue;
        }

        if (member.is_bot) {
          botsCount += 1;
          continue;
        }

        if (member.is_admin || member.is_owner) {
          adminOrOwnerCount += 1;
          continue;
        }

        eligibleCount += 1;

        if (targetSnapshot.memberIds.has(userId)) {
          excludedAlreadyInTargetCount += 1;
          continue;
        }

        if (uniqueIdSet.has(userId)) {
          duplicateAcrossSourcesCount += 1;
          continue;
        }

        uniqueIdSet.add(userId);
        uniqueIds.push(userId);
        addedUniqueCount += 1;
      }

      sourceReports.push({
        chat_id: sourceChat.chat_id,
        title: sourceChat.title,
        type: sourceChat.type,
        status: liveChat?.status ?? sourceChat.status ?? null,
        participants_count_report: sourceChat.participants_count ?? null,
        participants_count_live: liveChat?.participants_count ?? null,
        matched_fields: sourceChat.matched_fields ?? [],
        pages_fetched: snapshot.pages,
        members_seen_total: snapshot.members.length,
        bots_count: botsCount,
        admin_or_owner_count: adminOrOwnerCount,
        eligible_non_bot_non_admin_count: eligibleCount,
        excluded_already_in_target_count: excludedAlreadyInTargetCount,
        duplicate_across_source_chats_count: duplicateAcrossSourcesCount,
        unique_ids_added_count: addedUniqueCount,
      });
    } catch (error) {
      const summary = summarizeError(error);
      failures.push({
        chat_id: sourceChat.chat_id,
        title: sourceChat.title,
        ...summary,
      });
      console.log(`[warn] failed chat ${sourceChat.chat_id}: ${summary.message}`);
    }
  }

  const txtFileName = `${options.citySlug}_all_chats_except_target_member_ids_no_bots_no_admins_not_in_target_live_${timestamp}.txt`;
  const jsonFileName = `${options.citySlug}_all_chats_except_target_member_ids_no_bots_no_admins_not_in_target_live_${timestamp}.json`;
  const txtFilePath = path.join(DATA_DIR, txtFileName);
  const jsonFilePath = path.join(DATA_DIR, jsonFileName);

  fs.writeFileSync(txtFilePath, uniqueIds.map(String).join('\n') + (uniqueIds.length > 0 ? '\n' : ''));

  const report = {
    checked_at: checkedAt,
    city: options.city,
    city_slug: options.citySlug,
    city_report_file: path.relative(ROOT_DIR, cityReportPath),
    target_chat: {
      chat_id: options.targetChatId,
      title: targetChatFromReport.title,
      type: targetChatFromReport.type,
      status_live: targetLive?.status ?? null,
      participants_count_report: targetChatFromReport.participants_count ?? null,
      participants_count_live: targetLive?.participants_count ?? null,
      target_snapshot_member_count: targetSnapshot.memberIds.size,
      target_snapshot_pages: targetSnapshot.pages,
    },
    source_chat_count: sourceChats.length,
    source_chat_failures_count: failures.length,
    unique_ids_count: uniqueIds.length,
    files: {
      txt: path.relative(ROOT_DIR, txtFilePath),
      json: path.relative(ROOT_DIR, jsonFilePath),
    },
    source_chats: sourceReports,
    failed_source_chats: failures,
  };

  fs.writeFileSync(jsonFilePath, JSON.stringify(report, null, 2));

  console.log(`[done] txt: ${path.relative(ROOT_DIR, txtFilePath)}`);
  console.log(`[done] json: ${path.relative(ROOT_DIR, jsonFilePath)}`);
  console.log(`[summary] unique=${uniqueIds.length}, sources_ok=${sourceReports.length}, sources_failed=${failures.length}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
