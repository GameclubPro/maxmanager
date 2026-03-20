#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Bot } = require('@maxhub/max-bot-api');

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DEFAULT_ENV_FILE = '.env';
const DEFAULT_CONCURRENCY = 8;

function printHelp() {
  console.log(`
Usage:
  node scripts/collect-target-source-members.js \\
    --target-chat-id -12345678901234 \\
    --target-slug target_chat_slug \\
    [--source-report data/all_bot_chats_live_YYYYMMDD_HHMMSS.json] \\
    [--priority-chat-ids-file data/priority_chat_ids.txt] \\
    [--concurrency 8] \\
    [--exclude-admins]

What it does:
  - loads BOT_TOKEN from env
  - reads the latest all_bot_chats_live_*.json report unless --source-report is provided
  - treats the selected chat as target
  - optionally prioritizes specific source chats so their user ids go first in the txt output
  - fetches members from all other active chats/channels visible to the bot
  - excludes bots and users already present in the target chat
  - optionally excludes admins/owners when --exclude-admins is passed
  - saves one txt file with unique user ids and one json report
`.trim());
}

function parseArgs(argv) {
  const options = {
    envFile: DEFAULT_ENV_FILE,
    sourceReport: null,
    priorityChatIdsFile: null,
    targetChatId: null,
    targetChatTitle: null,
    targetSlug: null,
    concurrency: DEFAULT_CONCURRENCY,
    excludeAdmins: false,
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
    if (arg === '--source-report') {
      options.sourceReport = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--priority-chat-ids-file') {
      options.priorityChatIdsFile = requireValue(argv, index, arg);
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
    if (arg === '--target-chat-title') {
      options.targetChatTitle = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--target-slug') {
      options.targetSlug = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--concurrency') {
      const value = Number(requireValue(argv, index, arg));
      if (!Number.isInteger(value) || value < 1 || value > 32) {
        throw new Error(`Invalid --concurrency value: ${argv[index + 1]} (expected 1..32)`);
      }
      options.concurrency = value;
      index += 1;
      continue;
    }
    if (arg === '--exclude-admins') {
      options.excludeAdmins = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.help) {
    if (!options.targetChatId && !options.targetChatTitle) {
      throw new Error('Either --target-chat-id or --target-chat-title is required');
    }
    if (!options.targetSlug) {
      throw new Error('--target-slug is required');
    }
    if (!options.sourceReport) {
      options.sourceReport = findLatestLiveChatsReport();
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

function resolvePathMaybeRelative(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(ROOT_DIR, filePath);
}

function findLatestLiveChatsReport() {
  if (!fs.existsSync(DATA_DIR)) {
    throw new Error('data directory not found');
  }

  const candidates = fs.readdirSync(DATA_DIR)
    .filter((name) => /^all_bot_chats_live_\d{8}_\d{6}\.json$/u.test(name))
    .sort();

  if (candidates.length === 0) {
    throw new Error('No all_bot_chats_live_*.json report found in data/');
  }

  return path.join('data', candidates[candidates.length - 1]);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadPriorityChatIds(filePath) {
  if (!filePath) {
    return new Set();
  }

  const absolutePath = resolvePathMaybeRelative(filePath);
  const values = fs.readFileSync(absolutePath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => Number(line))
    .filter((value) => Number.isInteger(value));

  return new Set(values);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeError(error) {
  return {
    message: error?.message || String(error),
    status: typeof error?.status === 'number' ? error.status : null,
    code: typeof error?.code === 'string' ? error.code : null,
    stack: error?.stack || null,
  };
}

function isTransientError(error) {
  const status = typeof error?.status === 'number' ? error.status : null;
  const code = typeof error?.code === 'string' ? error.code : '';
  return status === 429
    || (status !== null && status >= 500)
    || code === 'ETIMEDOUT'
    || code === 'ECONNRESET'
    || code === 'EAI_AGAIN';
}

async function withRetry(fn, label, maxAttempts = 5) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientError(error)) {
        throw error;
      }
      const delayMs = attempt * 1000;
      console.log(`[retry] ${label}: attempt ${attempt}/${maxAttempts} failed (${error.message || error}), waiting ${delayMs}ms`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function fetchAllChatMembers(api, chatId, logLabel) {
  const members = [];
  const memberIds = new Set();
  let marker = null;
  let firstRequest = true;
  let pages = 0;

  while (firstRequest || marker !== null) {
    const response = await withRetry(
      () => api.getChatMembers(chatId, firstRequest ? { count: 100 } : { count: 100, marker }),
      `${logLabel} page ${pages + 1}`,
    );

    for (const member of response.members || []) {
      members.push(member);
      if (typeof member?.user_id === 'number') {
        memberIds.add(member.user_id);
      }
    }

    marker = response.marker ?? null;
    firstRequest = false;
    pages += 1;

    if (pages % 100 === 0) {
      console.log(`[pages] ${logLabel}: ${pages} pages loaded`);
    }
  }

  return { members, memberIds, pages };
}

function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase();
}

function findTargetChat(activeChats, options) {
  if (options.targetChatId) {
    const match = activeChats.find((chat) => Number(chat?.chat_id) === options.targetChatId);
    if (!match) {
      throw new Error(`Target chat ${options.targetChatId} not found in source report`);
    }
    return match;
  }

  const normalizedTitle = normalizeTitle(options.targetChatTitle);
  const matches = activeChats.filter((chat) => normalizeTitle(chat?.title) === normalizedTitle);

  if (matches.length === 0) {
    throw new Error(`Target chat title "${options.targetChatTitle}" not found in source report`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple chats matched title "${options.targetChatTitle}": ${matches.map((chat) => chat.chat_id).join(', ')}`);
  }

  return matches[0];
}

async function collectFromChat(api, chat, sourceOrder, targetMemberIds, options) {
  const logLabel = `chat ${sourceOrder}/${options.sourceChatCount} ${chat.chat_id}`;
  const snapshot = await fetchAllChatMembers(api, chat.chat_id, logLabel);

  let botsCount = 0;
  let adminOrOwnerCount = 0;
  let excludedAlreadyInTargetCount = 0;
  let numericMembersSeen = 0;
  const candidateIds = [];

  for (const member of snapshot.members) {
    const userId = member?.user_id;
    if (typeof userId !== 'number') {
      continue;
    }

    numericMembersSeen += 1;

    if (member.is_bot) {
      botsCount += 1;
      continue;
    }

    if (options.excludeAdmins && (member.is_admin || member.is_owner)) {
      adminOrOwnerCount += 1;
      continue;
    }

    if (targetMemberIds.has(userId)) {
      excludedAlreadyInTargetCount += 1;
      continue;
    }

    candidateIds.push(userId);
  }

  return {
    source_order: sourceOrder,
    chat_id: chat.chat_id,
    title: chat.title,
    type: chat.type,
    status: chat.status,
    is_priority: Boolean(chat.is_priority),
    participants_count_report: chat.participants_count ?? null,
    pages_fetched: snapshot.pages,
    members_seen_total: snapshot.members.length,
    numeric_members_seen: numericMembersSeen,
    bots_count: botsCount,
    admin_or_owner_count: adminOrOwnerCount,
    excluded_already_in_target_count: excludedAlreadyInTargetCount,
    candidate_ids: candidateIds,
  };
}

async function runWorkerPool(api, sourceChats, targetMemberIds, failures, options) {
  let nextIndex = 0;
  let completed = 0;
  const successReports = [];

  async function worker(workerId) {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= sourceChats.length) {
        return;
      }

      const chat = sourceChats[currentIndex];
      const sourceOrder = currentIndex + 1;

      if (sourceOrder <= options.concurrency || sourceOrder % 50 === 0) {
        console.log(`[worker ${workerId}] start ${sourceOrder}/${sourceChats.length}: ${chat.title || '(без названия)'} [${chat.chat_id}] (${chat.participants_count || 0})`);
      }

      try {
        const report = await collectFromChat(api, chat, sourceOrder, targetMemberIds, options);
        successReports.push(report);
      } catch (error) {
        failures.push({
          chat,
          summary: summarizeError(error),
        });
        console.log(`[warn] failed chat ${chat.chat_id}: ${error.message || error}`);
      }

      completed += 1;
      if (completed % 10 === 0 || completed === sourceChats.length) {
        console.log(`[progress] completed=${completed}/${sourceChats.length}, failed=${failures.length}`);
      }
    }
  }

  const workers = [];
  for (let workerId = 1; workerId <= options.concurrency; workerId += 1) {
    workers.push(worker(workerId));
  }

  await Promise.all(workers);
  return successReports;
}

async function retryFailedChats(api, failedJobs, targetMemberIds, options) {
  if (failedJobs.length === 0) {
    return { reports: [], failures: [] };
  }

  console.log(`[retry] retrying ${failedJobs.length} failed chats sequentially...`);
  const recoveredReports = [];
  const finalFailures = [];

  for (let index = 0; index < failedJobs.length; index += 1) {
    const { chat } = failedJobs[index];
    const sourceOrder = chat.source_order || 0;

    try {
      const report = await collectFromChat(api, chat, sourceOrder, targetMemberIds, options);
      recoveredReports.push(report);
      console.log(`[retry] recovered chat ${chat.chat_id}`);
    } catch (error) {
      finalFailures.push({
        chat_id: chat.chat_id,
        title: chat.title,
        ...summarizeError(error),
      });
      console.log(`[warn] final failure chat ${chat.chat_id}: ${error.message || error}`);
    }
  }

  return { reports: recoveredReports, failures: finalFailures };
}

function finalizeReports(sourceReports) {
  const sortedReports = [...sourceReports].sort((left, right) => left.source_order - right.source_order);
  const seenUserIds = new Set();
  const orderedUniqueIds = [];
  let priorityPrefixUniqueIdsCount = 0;

  for (const report of sortedReports) {
    let duplicateAcrossSourcesCount = 0;
    let uniqueIdsAddedCount = 0;

    for (const userId of report.candidate_ids) {
      if (seenUserIds.has(userId)) {
        duplicateAcrossSourcesCount += 1;
        continue;
      }

      seenUserIds.add(userId);
      orderedUniqueIds.push(userId);
      uniqueIdsAddedCount += 1;

      if (report.is_priority) {
        priorityPrefixUniqueIdsCount += 1;
      }
    }

    report.duplicate_across_sources_count = duplicateAcrossSourcesCount;
    report.unique_ids_added_count = uniqueIdsAddedCount;
    delete report.candidate_ids;
  }

  return {
    orderedUniqueIds,
    priorityPrefixUniqueIdsCount,
    sortedReports,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  dotenv.config({ path: options.envFile, quiet: true });
  if (!process.env.BOT_TOKEN) {
    throw new Error(`BOT_TOKEN is missing in ${options.envFile}`);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const sourceReportPath = resolvePathMaybeRelative(options.sourceReport);
  const sourceReport = loadJson(sourceReportPath);
  const priorityChatIds = loadPriorityChatIds(options.priorityChatIdsFile);
  const activeChats = Array.isArray(sourceReport?.chats)
    ? sourceReport.chats.filter((chat) => chat && chat.status === 'active' && (chat.type === 'chat' || chat.type === 'channel'))
    : [];

  const targetChat = findTargetChat(activeChats, options);
  const sourceChats = activeChats
    .filter((chat) => Number(chat?.chat_id) !== Number(targetChat.chat_id))
    .map((chat) => ({
      ...chat,
      is_priority: priorityChatIds.has(Number(chat?.chat_id)),
    }))
    .sort((left, right) => {
      if (Number(right.is_priority) !== Number(left.is_priority)) {
        return Number(right.is_priority) - Number(left.is_priority);
      }
      return Number(right?.participants_count || 0) - Number(left?.participants_count || 0);
    })
    .map((chat, index) => ({ ...chat, source_order: index + 1 }));

  const bot = new Bot(process.env.BOT_TOKEN);
  const checkedAt = new Date().toISOString();
  const timestamp = formatTimestamp(new Date());

  console.log(`[run] source report: ${path.relative(ROOT_DIR, sourceReportPath)}`);
  console.log(`[run] target: ${targetChat.title} [${targetChat.chat_id}]`);
  console.log(`[run] source chats: ${sourceChats.length}`);
  console.log(`[run] priority chats: ${sourceChats.filter((chat) => chat.is_priority).length}`);
  console.log(`[run] concurrency: ${options.concurrency}`);
  console.log('[run] loading target members...');

  const targetLive = await withRetry(() => bot.api.getChat(targetChat.chat_id), `target chat ${targetChat.chat_id}`);
  const targetSnapshot = await fetchAllChatMembers(bot.api, targetChat.chat_id, `target ${targetChat.chat_id}`);
  console.log(`[run] target snapshot loaded: ${targetSnapshot.memberIds.size} members across ${targetSnapshot.pages} pages`);

  const initialFailures = [];
  options.sourceChatCount = sourceChats.length;

  const initialReports = await runWorkerPool(
    bot.api,
    sourceChats,
    targetSnapshot.memberIds,
    initialFailures,
    options,
  );

  const retryResult = await retryFailedChats(
    bot.api,
    initialFailures,
    targetSnapshot.memberIds,
    options,
  );

  const finalized = finalizeReports([...initialReports, ...retryResult.reports]);
  const orderedUniqueIds = finalized.orderedUniqueIds;
  const finalReports = finalized.sortedReports;
  const txtBaseName = `${options.targetSlug}_all_other_chats_member_ids_no_bots${options.excludeAdmins ? '_no_admins' : ''}_not_in_target_live_${timestamp}`;
  const txtFilePath = path.join(DATA_DIR, `${txtBaseName}.txt`);
  const jsonFilePath = path.join(DATA_DIR, `${txtBaseName}.json`);

  fs.writeFileSync(txtFilePath, orderedUniqueIds.map(String).join('\n') + (orderedUniqueIds.length > 0 ? '\n' : ''));

  const report = {
    checked_at: checkedAt,
    source_report_file: path.relative(ROOT_DIR, sourceReportPath),
    target_chat: {
      chat_id: targetChat.chat_id,
      title: targetChat.title,
      type: targetChat.type,
      status_live: targetLive?.status ?? null,
      participants_count_report: targetChat.participants_count ?? null,
      participants_count_live: targetLive?.participants_count ?? null,
      link: targetChat.link ?? null,
      target_snapshot_member_count: targetSnapshot.memberIds.size,
      target_snapshot_pages: targetSnapshot.pages,
    },
    source_chat_count: sourceChats.length,
    priority_source_chat_count: sourceChats.filter((chat) => chat.is_priority).length,
    source_chat_failures_count: retryResult.failures.length,
    unique_ids_count: orderedUniqueIds.length,
    priority_prefix_unique_ids_count: finalized.priorityPrefixUniqueIdsCount,
    filters_applied: {
      excluded_bots: true,
      excluded_admins: options.excludeAdmins,
      excluded_target_members: true,
      excluded_duplicate_user_ids: true,
    },
    files: {
      txt: path.relative(ROOT_DIR, txtFilePath),
      json: path.relative(ROOT_DIR, jsonFilePath),
    },
    source_chats: finalReports,
    failed_source_chats: retryResult.failures,
  };

  fs.writeFileSync(jsonFilePath, JSON.stringify(report, null, 2));

  console.log(`[done] txt: ${path.relative(ROOT_DIR, txtFilePath)}`);
  console.log(`[done] json: ${path.relative(ROOT_DIR, jsonFilePath)}`);
  console.log(`[summary] priority_prefix_unique=${finalized.priorityPrefixUniqueIdsCount}, unique=${orderedUniqueIds.length}, sources_ok=${finalReports.length}, sources_failed=${retryResult.failures.length}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
