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
  node scripts/collect-chat-list-members.js \\
    --source-chat-ids-file data/no_city_promo_chats_YYYYMMDD_HHMMSS.txt \\
    [--source-label promo_non_city] \\
    [--concurrency 8] \\
    [--include-admins] \\
    [--env-file .env]

What it does:
  - loads BOT_TOKEN from env
  - reads source chat ids from .txt or .json
  - fetches all members from each chat visible to the bot
  - always excludes bots
  - by default also excludes chat admins/owners
  - with --include-admins keeps admins/owners and excludes only bots
  - saves one txt file with unique user ids and one json report
`.trim());
}

function parseArgs(argv) {
  const options = {
    envFile: DEFAULT_ENV_FILE,
    sourceChatIdsFile: null,
    sourceLabel: null,
    concurrency: DEFAULT_CONCURRENCY,
    includeAdmins: false,
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
    if (arg === '--source-chat-ids-file') {
      options.sourceChatIdsFile = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--source-label') {
      options.sourceLabel = requireValue(argv, index, arg);
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
    if (arg === '--include-admins') {
      options.includeAdmins = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.help) {
    if (!options.sourceChatIdsFile) {
      throw new Error('--source-chat-ids-file is required');
    }
    if (!options.sourceLabel) {
      options.sourceLabel = deriveSourceLabel(options.sourceChatIdsFile);
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

function deriveSourceLabel(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'chat_list';
}

function resolvePathMaybeRelative(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(ROOT_DIR, filePath);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseChatIdsFromTxt(content) {
  const chatIds = [];
  const seen = new Set();
  const lines = content.split(/\r?\n/u);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = line.match(/^-?\d+/u);
    if (!match) {
      continue;
    }
    const chatId = Number(match[0]);
    if (!Number.isInteger(chatId) || seen.has(chatId)) {
      continue;
    }
    seen.add(chatId);
    chatIds.push(chatId);
  }

  return chatIds;
}

function parseChatIdsFromJson(payload) {
  const candidates = [];

  if (Array.isArray(payload)) {
    candidates.push(...payload);
  }
  if (Array.isArray(payload?.ids)) {
    candidates.push(...payload.ids);
  }
  if (Array.isArray(payload?.chat_ids)) {
    candidates.push(...payload.chat_ids);
  }
  if (Array.isArray(payload?.chats)) {
    candidates.push(...payload.chats);
  }
  if (Array.isArray(payload?.no_city_chats)) {
    candidates.push(...payload.no_city_chats);
  }
  if (Array.isArray(payload?.source_chats)) {
    candidates.push(...payload.source_chats);
  }

  const chatIds = [];
  const seen = new Set();
  for (const item of candidates) {
    const value = typeof item === 'number'
      ? item
      : Number(item?.chat_id ?? item?.id ?? item);
    if (!Number.isInteger(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    chatIds.push(value);
  }

  return chatIds;
}

function loadSourceChatIds(filePath) {
  const absolutePath = resolvePathMaybeRelative(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Source chat ids file not found: ${filePath}`);
  }

  const extension = path.extname(absolutePath).toLowerCase();
  let chatIds;

  if (extension === '.json') {
    chatIds = parseChatIdsFromJson(loadJson(absolutePath));
  } else {
    chatIds = parseChatIdsFromTxt(fs.readFileSync(absolutePath, 'utf8'));
  }

  if (chatIds.length === 0) {
    throw new Error(`No valid chat ids found in ${filePath}`);
  }

  return {
    absolutePath,
    chatIds,
  };
}

async function fetchAllChatMembers(api, chatId, logLabel) {
  const members = [];
  let marker = null;
  let firstRequest = true;
  let pages = 0;

  while (firstRequest || marker !== null) {
    const response = await withRetry(
      () => api.getChatMembers(chatId, firstRequest ? { count: 100 } : { count: 100, marker }),
      `${logLabel} page ${pages + 1}`,
    );

    members.push(...(response.members || []));
    marker = response.marker ?? null;
    firstRequest = false;
    pages += 1;

    if (pages % 100 === 0) {
      console.log(`[pages] ${logLabel}: ${pages} pages loaded`);
    }
  }

  return { members, pages };
}

async function collectFromChat(api, chatId, sourceOrder, sourceChatCount, options) {
  const chat = await withRetry(() => api.getChat(chatId), `chat ${chatId} metadata`);
  const logLabel = `chat ${sourceOrder}/${sourceChatCount} ${chatId}`;
  const snapshot = await fetchAllChatMembers(api, chatId, logLabel);

  let botsCount = 0;
  let adminOrOwnerCount = 0;
  let numericMembersSeen = 0;
  const candidateIds = [];
  const adminUserIds = [];

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

    if (member.is_admin || member.is_owner) {
      adminOrOwnerCount += 1;
      adminUserIds.push(userId);
      if (!options.includeAdmins) {
        continue;
      }
    }

    candidateIds.push(userId);
  }

  return {
    source_order: sourceOrder,
    chat_id: chatId,
    title: chat?.title ?? null,
    type: chat?.type ?? null,
    status: chat?.status ?? null,
    participants_count_live: chat?.participants_count ?? null,
    pages_fetched: snapshot.pages,
    members_seen_total: snapshot.members.length,
    numeric_members_seen: numericMembersSeen,
    bots_count: botsCount,
    admin_or_owner_count: adminOrOwnerCount,
    admin_user_ids: adminUserIds,
    candidate_ids: candidateIds,
  };
}

async function runWorkerPool(api, chatIds, failures, options) {
  let nextIndex = 0;
  let completed = 0;
  const successReports = [];

  async function worker(workerId) {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= chatIds.length) {
        return;
      }

      const chatId = chatIds[currentIndex];
      const sourceOrder = currentIndex + 1;

      if (sourceOrder <= options.concurrency || sourceOrder % 25 === 0) {
        console.log(`[worker ${workerId}] start ${sourceOrder}/${chatIds.length}: ${chatId}`);
      }

      try {
        const report = await collectFromChat(api, chatId, sourceOrder, chatIds.length, options);
        successReports.push(report);
      } catch (error) {
        const summary = summarizeError(error);
        failures.push({
          source_order: sourceOrder,
          chat_id: chatId,
          ...summary,
        });
        console.log(`[warn] failed chat ${chatId}: ${summary.message}`);
      }

      completed += 1;
      if (completed % 10 === 0 || completed === chatIds.length) {
        console.log(`[progress] completed=${completed}/${chatIds.length}, failed=${failures.length}`);
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

function finalizeReports(sourceReports, options) {
  const sortedReports = [...sourceReports].sort((left, right) => left.source_order - right.source_order);
  const globalAdminUserIds = new Set();
  const excludeAdmins = !options.includeAdmins;

  if (excludeAdmins) {
    for (const report of sortedReports) {
      for (const userId of report.admin_user_ids) {
        globalAdminUserIds.add(userId);
      }
    }
  }

  const seenUserIds = new Set();
  const orderedUniqueIds = [];

  for (const report of sortedReports) {
    let duplicateAcrossSourcesCount = 0;
    let excludedGlobalAdminCount = 0;
    let uniqueIdsAddedCount = 0;

    for (const userId of report.candidate_ids) {
      if (excludeAdmins && globalAdminUserIds.has(userId)) {
        excludedGlobalAdminCount += 1;
        continue;
      }

      if (seenUserIds.has(userId)) {
        duplicateAcrossSourcesCount += 1;
        continue;
      }

      seenUserIds.add(userId);
      orderedUniqueIds.push(userId);
      uniqueIdsAddedCount += 1;
    }

    report.excluded_global_admin_user_count = excludedGlobalAdminCount;
    report.duplicate_across_source_chats_count = duplicateAcrossSourcesCount;
    report.unique_ids_added_count = uniqueIdsAddedCount;
    delete report.admin_user_ids;
    delete report.candidate_ids;
  }

  return {
    orderedUniqueIds,
    sortedReports,
    globalAdminUserIdsCount: excludeAdmins ? globalAdminUserIds.size : 0,
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

  const sourceInput = loadSourceChatIds(options.sourceChatIdsFile);
  const sourceChatIds = sourceInput.chatIds;
  const bot = new Bot(process.env.BOT_TOKEN);
  const checkedAt = new Date().toISOString();
  const timestamp = formatTimestamp(new Date());

  console.log(`[run] source file: ${path.relative(ROOT_DIR, sourceInput.absolutePath)}`);
  console.log(`[run] source label: ${options.sourceLabel}`);
  console.log(`[run] source chats: ${sourceChatIds.length}`);
  console.log(`[run] concurrency: ${options.concurrency}`);
  console.log(`[run] include admins: ${options.includeAdmins ? 'yes' : 'no'}`);

  const failures = [];
  const sourceReports = await runWorkerPool(bot.api, sourceChatIds, failures, options);
  const finalized = finalizeReports(sourceReports, options);
  const outputMode = options.includeAdmins ? 'no_bots' : 'no_bots_no_admins';

  const txtFileName = `${options.sourceLabel}_member_ids_${outputMode}_live_${timestamp}.txt`;
  const jsonFileName = `${options.sourceLabel}_member_ids_${outputMode}_live_${timestamp}.json`;
  const txtFilePath = path.join(DATA_DIR, txtFileName);
  const jsonFilePath = path.join(DATA_DIR, jsonFileName);

  fs.writeFileSync(
    txtFilePath,
    finalized.orderedUniqueIds.map(String).join('\n') + (finalized.orderedUniqueIds.length > 0 ? '\n' : ''),
  );

  const report = {
    checked_at: checkedAt,
    source_label: options.sourceLabel,
    source_chat_ids_file: path.relative(ROOT_DIR, sourceInput.absolutePath),
    source_chat_count_requested: sourceChatIds.length,
    source_chat_count_processed: sourceReports.length,
    source_chat_failures_count: failures.length,
    unique_ids_count: finalized.orderedUniqueIds.length,
    include_admins: options.includeAdmins,
    global_admin_user_ids_count: finalized.globalAdminUserIdsCount,
    files: {
      txt: path.relative(ROOT_DIR, txtFilePath),
      json: path.relative(ROOT_DIR, jsonFilePath),
    },
    source_chats: finalized.sortedReports,
    failed_source_chats: failures,
  };

  fs.writeFileSync(jsonFilePath, JSON.stringify(report, null, 2));

  console.log(`[done] txt: ${path.relative(ROOT_DIR, txtFilePath)}`);
  console.log(`[done] json: ${path.relative(ROOT_DIR, jsonFilePath)}`);
  console.log(`[summary] unique=${finalized.orderedUniqueIds.length}, global_admin_users=${finalized.globalAdminUserIdsCount}, sources_ok=${sourceReports.length}, sources_failed=${failures.length}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
