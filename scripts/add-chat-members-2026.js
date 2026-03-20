#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Bot } = require('@maxhub/max-bot-api');

const DEFAULTS = {
  envFile: '.env',
  start: 0,
  count: 300,
  inviteBatchSize: 1,
  // Tuned for a 2-minute active wave on 400 users with invite-batch-size=10.
  pauseMs: 4200,
  pauseJitterMs: 200,
  verifyChunkSize: 100,
  verifyPauseMs: 80,
  maxRetries: 1,
  retryDelayMs: 1200,
  retryBackoff: 2,
  progressEvery: 25,
  sampleSize: 50,
  failureSampleSize: 200,
  skipExistingScan: false,
  dryRun: false,
  targetParticipantsGoal: null,
  retryActionFailed: false,
  splitActionFailedBatch: false,
  stopOnConsecutiveActionFailed: 2,
  runToEnd: false,
  waveActiveMs: 2 * 60 * 1000,
  waveRestMs: 30 * 1000,
};

const SAFE_MIN_PAUSE_PER_USER_MS = 220;

function printHelp() {
  const text = `
Usage:
  node scripts/add-chat-members-2026.js \\
    --source-file data/source_member_ids.json \\
    --target-chat-id -71313986483690 \\
    --start 0 \\
    --count 300

Required:
  --source-file <path>         Path to source ids (.json with "ids" or .txt)
  --target-chat-id <id>        Target chat id (positive or negative)

Optional:
  --env-file <path>            Env file path (default: .env)
  --source-chat-id <id>        Override source chat id in report
  --start <n>                  0-based start index (default: 0)
  --count <n>                  Number of ids to process (default: 300; with --run-to-end = users per wave)
  --invite-batch-size <n>      Add N users per API call (default: 1, max: 100)
  --pause-ms <n>               Base delay between invite attempts (default: 4200)
  --pause-jitter-ms <n>        Random jitter added to pause (default: 200)
  --verify-chunk-size <n>      Chunk size for verification (default: 100)
  --verify-pause-ms <n>        Delay between verify chunks (default: 80)
  --max-retries <n>            Retries for transient errors (default: 1)
  --retry-delay-ms <n>         Base retry delay (default: 1200)
  --retry-backoff <n>          Retry delay multiplier (default: 2)
  --retry-action-failed        Retry when API returns success=false
  --split-action-failed-batch  On action_failed for batch>1, retry users one-by-one
  --stop-on-action-failed <n>  Stop run after N consecutive action_failed (default: 2, 0=off)
  --stop-when-target-count-reaches <n>
                               Stop once target chat participants_count reaches N
  --run-to-end                 Continue wave-by-wave until source ids end
  --wave-active-ms <n>         Active invite window per wave (default: 120000)
  --wave-rest-ms <n>           Rest after each full wave (default: 30000)
  --skip-existing-scan         Skip full pre-scan of target members
  --progress-every <n>         Print progress every N attempts (default: 25)
  --result-file <path>         Output result json path
  --missing-file <path>        Output still-missing txt path
  --dry-run                    Validate and build report without invites
  --help, -h                   Show this help

Examples:
  node scripts/add-chat-members-2026.js \\
    --source-file data/avtorynok_volgogradskaya_oblast_member_ids.json \\
    --target-chat-id -71313986483690 \\
    --start 0 --count 300

  node scripts/add-chat-members-2026.js \\
    --source-file data/avtorynok_volgogradskaya_oblast_member_ids.txt \\
    --target-chat-id 71313986483690 \\
    --start 300 --count 300 --pause-ms 350 --max-retries 2

  node scripts/add-chat-members-2026.js \\
    --source-file data/source_member_ids.txt \\
    --target-chat-id -71313986483690 \\
    --start 0 --count 400 --invite-batch-size 10 --run-to-end
`.trim();

  console.log(text);
}

function parseArgs(argv) {
  const options = {
    ...DEFAULTS,
    sourceFile: '',
    targetChatIdRaw: null,
    sourceChatIdRaw: null,
    resultFile: '',
    missingFile: '',
    help: false,
    stopOnActionFailedExplicit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--skip-existing-scan') {
      options.skipExistingScan = true;
      continue;
    }

    if (arg === '--retry-action-failed') {
      options.retryActionFailed = true;
      continue;
    }

    if (arg === '--split-action-failed-batch') {
      options.splitActionFailedBatch = true;
      continue;
    }

    if (arg === '--run-to-end') {
      options.runToEnd = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(0, eqIndex) : arg;
    const inlineValue = eqIndex >= 0 ? arg.slice(eqIndex + 1) : null;
    const valueResult = resolveValue(key, inlineValue, argv, i);
    const value = valueResult.value;
    i = valueResult.nextIndex;

    switch (key) {
      case '--env-file':
        options.envFile = value;
        break;
      case '--source-file':
        options.sourceFile = value;
        break;
      case '--target-chat-id':
        options.targetChatIdRaw = value;
        break;
      case '--source-chat-id':
        options.sourceChatIdRaw = value;
        break;
      case '--start':
        options.start = parseInteger('start', value, 0);
        break;
      case '--count':
        options.count = parseInteger('count', value, 1);
        break;
      case '--invite-batch-size':
        options.inviteBatchSize = parseInteger('invite-batch-size', value, 1);
        if (options.inviteBatchSize > 100) {
          throw new Error(`Invalid --invite-batch-size: ${value} (max 100)`);
        }
        break;
      case '--pause-ms':
        options.pauseMs = parseInteger('pause-ms', value, 0);
        break;
      case '--pause-jitter-ms':
        options.pauseJitterMs = parseInteger('pause-jitter-ms', value, 0);
        break;
      case '--verify-chunk-size':
        options.verifyChunkSize = parseInteger('verify-chunk-size', value, 1);
        break;
      case '--verify-pause-ms':
        options.verifyPauseMs = parseInteger('verify-pause-ms', value, 0);
        break;
      case '--wave-active-ms':
        options.waveActiveMs = parseInteger('wave-active-ms', value, 0);
        break;
      case '--wave-rest-ms':
        options.waveRestMs = parseInteger('wave-rest-ms', value, 0);
        break;
      case '--max-retries':
        options.maxRetries = parseInteger('max-retries', value, 0);
        break;
      case '--retry-delay-ms':
        options.retryDelayMs = parseInteger('retry-delay-ms', value, 0);
        break;
      case '--retry-backoff':
        options.retryBackoff = parseFloatNumber('retry-backoff', value, 1);
        break;
      case '--progress-every':
        options.progressEvery = parseInteger('progress-every', value, 1);
        break;
      case '--stop-on-action-failed':
        options.stopOnConsecutiveActionFailed = parseInteger('stop-on-action-failed', value, 0);
        options.stopOnActionFailedExplicit = true;
        break;
      case '--stop-when-target-count-reaches':
        options.targetParticipantsGoal = parseInteger('stop-when-target-count-reaches', value, 1);
        break;
      case '--result-file':
        options.resultFile = value;
        break;
      case '--missing-file':
        options.missingFile = value;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!options.help) {
    if (!options.sourceFile) {
      throw new Error('--source-file is required');
    }
    if (options.targetChatIdRaw === null) {
      throw new Error('--target-chat-id is required');
    }
  }

  options.targetChatId = options.targetChatIdRaw === null
    ? null
    : normalizeChatId(options.targetChatIdRaw, 'target-chat-id');
  options.sourceChatId = options.sourceChatIdRaw === null
    ? null
    : normalizeChatId(options.sourceChatIdRaw, 'source-chat-id');

  if (options.runToEnd && !options.stopOnActionFailedExplicit) {
    options.stopOnConsecutiveActionFailed = 0;
  }

  return options;
}

function resolveValue(flag, inlineValue, argv, currentIndex) {
  if (inlineValue !== null) {
    if (inlineValue.trim() === '') {
      throw new Error(`${flag} requires a value`);
    }
    return { value: inlineValue, nextIndex: currentIndex };
  }

  const nextIndex = currentIndex + 1;
  if (nextIndex >= argv.length) {
    throw new Error(`${flag} requires a value`);
  }
  return { value: argv[nextIndex], nextIndex };
}

function parseInteger(name, raw, minValue) {
  const num = Number(raw);
  if (!Number.isInteger(num) || num < minValue) {
    throw new Error(`Invalid --${name}: ${raw}`);
  }
  return num;
}

function parseFloatNumber(name, raw, minValue) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num < minValue) {
    throw new Error(`Invalid --${name}: ${raw}`);
  }
  return num;
}

function normalizeChatId(raw, fieldName) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value === 0) {
    throw new Error(`Invalid --${fieldName}: ${raw}`);
  }
  return value > 0 ? -value : value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(maxInclusive) {
  if (!Number.isInteger(maxInclusive) || maxInclusive <= 0) {
    return 0;
  }
  return Math.floor(Math.random() * (maxInclusive + 1));
}

function resolveInvitePauseMs(options, batchSize) {
  const safeFloorMs = Math.max(0, batchSize) * SAFE_MIN_PAUSE_PER_USER_MS;
  const baseMs = Math.max(options.pauseMs, safeFloorMs);
  return baseMs + randomInt(options.pauseJitterMs);
}

function resolveWavePacedPauseMs(options, batchSize, waveStartedAtMs, remainingBatchesInWave) {
  const basePauseMs = resolveInvitePauseMs(options, batchSize);

  if (
    !options.runToEnd
    || waveStartedAtMs === null
    || !Number.isInteger(remainingBatchesInWave)
    || remainingBatchesInWave <= 0
    || options.waveActiveMs <= 0
  ) {
    return basePauseMs;
  }

  const safeFloorMs = Math.max(0, batchSize) * SAFE_MIN_PAUSE_PER_USER_MS;
  const elapsedMs = Math.max(0, Date.now() - waveStartedAtMs);
  const remainingActiveMs = Math.max(0, options.waveActiveMs - elapsedMs);
  const evenSplitPauseMs = Math.floor(remainingActiveMs / remainingBatchesInWave);

  return Math.max(safeFloorMs, Math.min(basePauseMs, evenSplitPauseMs));
}

function dedupeNumericIds(values) {
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    const numberValue = typeof value === 'number'
      ? Math.trunc(value)
      : Number(String(value).trim());
    if (!Number.isInteger(numberValue) || numberValue <= 0) {
      continue;
    }
    if (seen.has(numberValue)) {
      continue;
    }
    seen.add(numberValue);
    unique.push(numberValue);
  }
  return unique;
}

function loadSourceIds(sourcePath) {
  const absPath = path.resolve(process.cwd(), sourcePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Source file not found: ${absPath}`);
  }

  const ext = path.extname(absPath).toLowerCase();
  const raw = fs.readFileSync(absPath, 'utf8');
  let idsRaw;
  let meta = {};

  if (ext === '.json') {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      idsRaw = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.ids)) {
      idsRaw = parsed.ids;
      meta = {
        chat_id: typeof parsed.chat_id === 'number' ? parsed.chat_id : null,
        title: typeof parsed.title === 'string' ? parsed.title : null,
        type: typeof parsed.type === 'string' ? parsed.type : null,
        status: typeof parsed.status === 'string' ? parsed.status : null,
      };
    } else {
      throw new Error('JSON source must be an array or object with "ids" array');
    }
  } else {
    idsRaw = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
  }

  const ids = dedupeNumericIds(idsRaw);
  if (!ids.length) {
    throw new Error('No valid ids found in source file');
  }

  return {
    absPath,
    ids,
    meta,
  };
}

function parseApiError(error) {
  const statusCandidate = error?.status ?? error?.response?.status ?? error?.body?.status;
  const status = Number.isFinite(Number(statusCandidate)) ? Number(statusCandidate) : null;
  const code = String(
    error?.body?.code
      ?? error?.code
      ?? 'unknown_error',
  );
  const message = String(
    error?.body?.message
      ?? error?.message
      ?? 'Unknown error',
  );
  return { status, code, message };
}

function isRetryableError(parsedError) {
  if (parsedError.status === 429) {
    return true;
  }
  if (parsedError.status !== null && parsedError.status >= 500) {
    return true;
  }

  const haystack = `${parsedError.code} ${parsedError.message}`.toLowerCase();
  const transientMarkers = [
    'too.many',
    'rate',
    'timeout',
    'timed out',
    'tempor',
    'network',
    'unavailable',
    'econnreset',
    'etimedout',
    'socket hang up',
  ];

  return transientMarkers.some((marker) => haystack.includes(marker));
}

function backoffDelayMs(baseMs, backoff, attemptNumber) {
  const scaled = Math.round(baseMs * Math.pow(backoff, Math.max(0, attemptNumber - 1)));
  const jitterMax = Math.max(50, Math.round(baseMs * 0.2));
  const jitter = Math.floor(Math.random() * (jitterMax + 1));
  return scaled + jitter;
}

async function callApiWithRetry(fn, options, label) {
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      const parsed = parseApiError(error);
      const canRetry = attempt <= options.maxRetries && isRetryableError(parsed);
      if (!canRetry) {
        throw error;
      }

      const delayMs = backoffDelayMs(options.retryDelayMs, options.retryBackoff, attempt);
      console.log(
        `[run] Retry ${label}: attempt ${attempt}/${options.maxRetries}, waiting ${delayMs}ms (${parsed.code}, status ${parsed.status ?? 'null'})`,
      );
      await sleep(delayMs);
    }
  }
}

function chunkArray(values, chunkSize) {
  const chunks = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

async function fetchAllChatMemberIds(api, chatId, options) {
  const memberIds = new Set();
  let marker = null;
  let firstRequest = true;
  let pages = 0;

  while (firstRequest || marker !== null) {
    const response = await callApiWithRetry(
      () => api.getChatMembers(chatId, firstRequest ? { count: 100 } : { count: 100, marker }),
      options,
      `getChatMembers snapshot chat ${chatId} page ${pages + 1}`,
    );
    for (const member of response.members || []) {
      if (typeof member.user_id === 'number') {
        memberIds.add(member.user_id);
      }
    }
    marker = response.marker ?? null;
    firstRequest = false;
    pages += 1;
  }

  return { memberIds, pages };
}

async function verifyMembershipByIds(api, chatId, ids, chunkSize, pauseMs, options) {
  const found = new Set();
  const errors = [];
  const chunks = chunkArray(ids, chunkSize);

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    try {
      const response = await callApiWithRetry(
        () => api.getChatMembers(chatId, { user_ids: chunk }),
        options,
        `verifyMembers chat ${chatId} chunk ${i + 1}/${chunks.length}`,
      );
      for (const member of response.members || []) {
        if (typeof member.user_id === 'number') {
          found.add(member.user_id);
        }
      }
    } catch (error) {
      const parsed = parseApiError(error);
      errors.push({
        chunk_index: i,
        chunk_size: chunk.length,
        ...parsed,
      });
    }

    if (pauseMs > 0 && i < chunks.length - 1) {
      await sleep(pauseMs);
    }
  }

  return { found, errors };
}

function aggregateFailuresByCode(failures) {
  const result = {};
  for (const failure of failures) {
    result[failure.code] = (result[failure.code] || 0) + 1;
  }
  return result;
}

function aggregateFailuresByStatus(failures) {
  const result = {};
  for (const failure of failures) {
    const key = failure.status === null ? 'null' : String(failure.status);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function slugify(input) {
  const normalized = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'members';
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function buildOutputPaths(options, sourceAbsPath, targetChatId, startIndex, endIndex) {
  const dataDir = path.resolve(process.cwd(), 'data');
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const sourceName = slugify(path.basename(sourceAbsPath, path.extname(sourceAbsPath)));
  const rangeStartHuman = startIndex + 1;
  const rangeEndHuman = endIndex;
  const targetAbs = Math.abs(targetChatId);
  const base = `${sourceName}_to_${targetAbs}_${rangeStartHuman}_${rangeEndHuman}_${stamp}`;

  const resultFile = options.resultFile
    ? path.resolve(process.cwd(), options.resultFile)
    : path.join(dataDir, `add_${base}_result.json`);
  const missingFile = options.missingFile
    ? path.resolve(process.cwd(), options.missingFile)
    : path.join(dataDir, `still_missing_${base}.txt`);

  return { resultFile, missingFile };
}

async function addMembersBatchWithRetry(api, chatId, userIds, options) {
  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      const response = await api.addChatMembers(chatId, userIds);
      if (response && response.success === false) {
        if (options.retryActionFailed && attempt <= options.maxRetries) {
          await sleep(backoffDelayMs(options.retryDelayMs, options.retryBackoff, attempt));
          continue;
        }
        return {
          ok: false,
          attempts: attempt,
          status: 200,
          code: 'action_failed',
          message: 'API returned success=false',
        };
      }

      return {
        ok: true,
        attempts: attempt,
      };
    } catch (error) {
      const parsed = parseApiError(error);
      const canRetry = attempt <= options.maxRetries && isRetryableError(parsed);
      if (canRetry) {
        await sleep(backoffDelayMs(options.retryDelayMs, options.retryBackoff, attempt));
        continue;
      }
      return {
        ok: false,
        attempts: attempt,
        ...parsed,
      };
    }
  }
}

function finishFullWaveMessage(waveNumber, waveUserLimit, waveActiveMs, waveRestMs, elapsedMs) {
  const activeWaitMs = Math.max(0, waveActiveMs - elapsedMs);
  const details = [`elapsed ${elapsedMs}ms`];

  if (activeWaitMs > 0) {
    details.push(`active_wait ${activeWaitMs}ms`);
  }
  if (waveRestMs > 0) {
    details.push(`rest ${waveRestMs}ms`);
  }

  return `[run] Wave ${waveNumber} reached ${waveUserLimit} users (${details.join(', ')})`;
}

async function resolveSourceChat(api, sourceMeta, sourceChatIdOption) {
  const fallback = {
    chat_id: sourceMeta?.chat_id ?? sourceChatIdOption ?? null,
    title: sourceMeta?.title ?? null,
    type: sourceMeta?.type ?? null,
    status: sourceMeta?.status ?? null,
  };

  const candidateId = sourceChatIdOption ?? sourceMeta?.chat_id ?? null;
  if (typeof candidateId !== 'number') {
    return fallback;
  }

  try {
    const live = await api.getChat(candidateId);
    return {
      chat_id: live.chat_id,
      title: live.title,
      type: live.type,
      status: live.status,
    };
  } catch {
    return fallback;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const envPath = path.resolve(process.cwd(), options.envFile);
  dotenv.config({ path: envPath });

  const token = process.env.BOT_TOKEN?.trim();
  if (!token) {
    throw new Error(`BOT_TOKEN is missing (env file: ${envPath})`);
  }

  const source = loadSourceIds(options.sourceFile);
  const totalSourceIds = source.ids.length;
  const startIndex = Math.min(options.start, totalSourceIds);
  const endIndex = options.runToEnd
    ? totalSourceIds
    : Math.min(startIndex + options.count, totalSourceIds);
  const sourceSliceAll = source.ids.slice(startIndex, endIndex);
  if (!sourceSliceAll.length) {
    throw new Error(`Selected range is empty: start=${startIndex}, count=${options.count}, source_total=${totalSourceIds}`);
  }

  const outputPaths = buildOutputPaths(options, source.absPath, options.targetChatId, startIndex, endIndex);
  ensureParentDir(outputPaths.resultFile);
  ensureParentDir(outputPaths.missingFile);

  const bot = new Bot(token);
  const botInfo = await callApiWithRetry(
    () => bot.api.getMyInfo(),
    options,
    'getMyInfo',
  );

  const targetBefore = await callApiWithRetry(
    () => bot.api.getChat(options.targetChatId),
    options,
    `getChat target ${options.targetChatId} before run`,
  );
  const sourceChat = await resolveSourceChat(bot.api, source.meta, options.sourceChatId);

  let botMembershipInTarget;
  try {
    const response = await bot.api.getChatMembers(options.targetChatId, { user_ids: [botInfo.user_id] });
    botMembershipInTarget = {
      status: 200,
      data: response,
    };
  } catch (error) {
    const parsed = parseApiError(error);
    botMembershipInTarget = {
      status: parsed.status ?? 500,
      data: parsed,
    };
  }

  const sourceSlice = sourceSliceAll.filter((id) => id !== botInfo.user_id);
  const skippedBotSelfCount = sourceSliceAll.length - sourceSlice.length;

  let existingInTarget = new Set();
  let targetSnapshot = null;
  if (!options.skipExistingScan) {
    console.log('[run] Loading target member snapshot...');
    targetSnapshot = await fetchAllChatMemberIds(bot.api, options.targetChatId, options);
    existingInTarget = targetSnapshot.memberIds;
    console.log(`[run] Snapshot loaded: ${existingInTarget.size} members across ${targetSnapshot.pages} pages`);
  }

  const alreadyInTargetIds = options.skipExistingScan
    ? []
    : sourceSlice.filter((id) => existingInTarget.has(id));
  const inviteQueue = options.skipExistingScan
    ? sourceSlice.slice()
    : sourceSlice.filter((id) => !existingInTarget.has(id));
  const inviteBatches = chunkArray(inviteQueue, options.inviteBatchSize);
  const safePauseFloorForBatchMs = options.inviteBatchSize * SAFE_MIN_PAUSE_PER_USER_MS;
  if (options.pauseMs < safePauseFloorForBatchMs) {
    console.log(
      `[run] Safety pause floor applied: base ${options.pauseMs}ms -> ${safePauseFloorForBatchMs}ms (batch size ${options.inviteBatchSize})`,
    );
  }

  const failures = [];
  const invitedWithoutImmediateFailure = [];
  const attemptedUserIds = [];
  let consecutiveActionFailed = 0;
  let stopTriggered = null;
  let targetCountReachedSnapshot = null;

  if (
    typeof options.targetParticipantsGoal === 'number'
    && targetBefore.participants_count >= options.targetParticipantsGoal
  ) {
    stopTriggered = {
      reason: 'target_participants_goal_already_reached',
      target_participants_goal: options.targetParticipantsGoal,
      current_target_participants_count: targetBefore.participants_count,
      attempted_count: 0,
      remaining_count: inviteQueue.length,
      checked_at_iso: new Date().toISOString(),
    };
    console.log(
      `[run] Target chat already has ${targetBefore.participants_count} members, goal ${options.targetParticipantsGoal} reached before invites`,
    );
  }

  if (!options.dryRun && stopTriggered === null) {
    console.log(
      `[run] Inviting ${inviteQueue.length} users to chat ${options.targetChatId} in batches of ${options.inviteBatchSize} (${inviteBatches.length} calls)...`,
    );
    if (options.runToEnd) {
      console.log(
        `[run] Wave mode enabled: ${options.count} users per wave, ${options.waveActiveMs}ms active window, ${options.waveRestMs}ms rest`,
      );
    }

    let waveNumber = 1;
    let usersInCurrentWave = 0;
    let waveStartedAtMs = null;

    for (let i = 0; i < inviteBatches.length; i += 1) {
      const batchUserIds = inviteBatches[i];
      if (options.runToEnd && waveStartedAtMs === null) {
        waveStartedAtMs = Date.now();
        console.log(`[run] Wave ${waveNumber} started`);
      }
      attemptedUserIds.push(...batchUserIds);
      const inviteResult = await addMembersBatchWithRetry(bot.api, options.targetChatId, batchUserIds, options);

      if (inviteResult.ok) {
        invitedWithoutImmediateFailure.push(...batchUserIds);
        consecutiveActionFailed = 0;
      } else if (
        options.splitActionFailedBatch
        && batchUserIds.length > 1
        && inviteResult.code === 'action_failed'
      ) {
        let allFailedAsActionFailed = true;
        let anyRecovered = false;

        for (let j = 0; j < batchUserIds.length; j += 1) {
          const userId = batchUserIds[j];
          const singleInviteResult = await addMembersBatchWithRetry(bot.api, options.targetChatId, [userId], options);

          if (singleInviteResult.ok) {
            invitedWithoutImmediateFailure.push(userId);
            anyRecovered = true;
            allFailedAsActionFailed = false;
          } else {
            failures.push({
              user_id: userId,
              attempts: singleInviteResult.attempts,
              status: singleInviteResult.status,
              code: singleInviteResult.code,
              message: singleInviteResult.message,
            });
            if (singleInviteResult.code !== 'action_failed') {
              allFailedAsActionFailed = false;
            }
          }

          if (j < batchUserIds.length - 1) {
            await sleep(resolveInvitePauseMs(options, 1));
          }
        }

        if (anyRecovered || !allFailedAsActionFailed) {
          consecutiveActionFailed = 0;
        } else {
          consecutiveActionFailed += 1;
        }
      } else {
        if (inviteResult.code === 'action_failed') {
          consecutiveActionFailed += 1;
        } else {
          consecutiveActionFailed = 0;
        }

        for (const userId of batchUserIds) {
          failures.push({
            user_id: userId,
            attempts: inviteResult.attempts,
            status: inviteResult.status,
            code: inviteResult.code,
            message: inviteResult.message,
          });
        }
      }

      const processed = attemptedUserIds.length;
      if (options.runToEnd) {
        usersInCurrentWave += batchUserIds.length;
      }
      if (processed % options.progressEvery === 0 || processed === inviteQueue.length) {
        console.log(`[run] Progress: ${processed}/${inviteQueue.length} users`);
      }

      if (
        options.stopOnConsecutiveActionFailed > 0
        && consecutiveActionFailed >= options.stopOnConsecutiveActionFailed
      ) {
        stopTriggered = {
          reason: 'consecutive_action_failed_limit',
          limit: options.stopOnConsecutiveActionFailed,
          current_streak: consecutiveActionFailed,
          attempted_count: attemptedUserIds.length,
          remaining_count: inviteQueue.length - attemptedUserIds.length,
          last_user_id: batchUserIds[batchUserIds.length - 1],
        };
        console.log(
          `[run] Stop triggered: ${consecutiveActionFailed} consecutive action_failed (limit ${options.stopOnConsecutiveActionFailed})`,
        );
        break;
      }

      if (typeof options.targetParticipantsGoal === 'number') {
        const targetCountSnapshot = await callApiWithRetry(
          () => bot.api.getChat(options.targetChatId),
          options,
          `getChat target ${options.targetChatId} goal check`,
        );
        if (targetCountSnapshot.participants_count >= options.targetParticipantsGoal) {
          targetCountReachedSnapshot = targetCountSnapshot;
          stopTriggered = {
            reason: 'target_participants_goal_reached',
            target_participants_goal: options.targetParticipantsGoal,
            current_target_participants_count: targetCountSnapshot.participants_count,
            attempted_count: attemptedUserIds.length,
            remaining_count: inviteQueue.length - attemptedUserIds.length,
            last_user_id: batchUserIds[batchUserIds.length - 1],
            checked_at_iso: new Date().toISOString(),
          };
          console.log(
            `[run] Stop triggered: target chat reached ${targetCountSnapshot.participants_count} members (goal ${options.targetParticipantsGoal})`,
          );
          break;
        }
      }

      if (processed < inviteQueue.length) {
        const isWaveBoundary = options.runToEnd && usersInCurrentWave >= options.count;
        if (isWaveBoundary) {
          const elapsedMs = waveStartedAtMs === null
            ? 0
            : Date.now() - waveStartedAtMs;
          console.log(
            finishFullWaveMessage(
              waveNumber,
              options.count,
              options.waveActiveMs,
              options.waveRestMs,
              elapsedMs,
            ),
          );

          const activeWaitMs = Math.max(0, options.waveActiveMs - elapsedMs);
          if (activeWaitMs > 0) {
            await sleep(activeWaitMs);
          }
          if (options.waveRestMs > 0) {
            await sleep(options.waveRestMs);
          }

          waveNumber += 1;
          usersInCurrentWave = 0;
          waveStartedAtMs = null;
        } else {
          const remainingUsersInWave = Math.max(0, options.count - usersInCurrentWave);
          const remainingBatchesInWave = Math.ceil(remainingUsersInWave / options.inviteBatchSize);
          await sleep(resolveWavePacedPauseMs(options, batchUserIds.length, waveStartedAtMs, remainingBatchesInWave));
        }
      }
    }
  } else {
    console.log('[run] Dry-run enabled, invite calls were skipped.');
  }

  console.log(`[run] Verifying membership for ${sourceSlice.length} users...`);
  const verification = await verifyMembershipByIds(
    bot.api,
    options.targetChatId,
    sourceSlice,
    options.verifyChunkSize,
    options.verifyPauseMs,
    options,
  );

  const verifiedInTargetSet = verification.found;
  const attemptedInviteCount = attemptedUserIds.length;
  const notAttemptedIds = inviteQueue.slice(attemptedInviteCount);
  const verifiedAddedIds = attemptedUserIds.filter((id) => verifiedInTargetSet.has(id));
  const stillMissingAttemptedIds = attemptedUserIds.filter((id) => !verifiedInTargetSet.has(id));
  const stillMissingIds = inviteQueue.filter((id) => !verifiedInTargetSet.has(id));
  const targetAfter = await callApiWithRetry(
    () => bot.api.getChat(options.targetChatId),
    options,
    `getChat target ${options.targetChatId} after run`,
  );

  const result = {
    ok: true,
    source_chat: {
      chat_id: sourceChat.chat_id,
      title: sourceChat.title,
      type: sourceChat.type,
      status: sourceChat.status,
      file: path.relative(process.cwd(), source.absPath),
      total_ids_in_source_file: totalSourceIds,
    },
    target_chat: {
      chat_id: targetBefore.chat_id,
      title: targetBefore.title,
      type: targetBefore.type,
      status: targetBefore.status,
      before_participants_count: targetBefore.participants_count,
      after_participants_count: targetAfter.participants_count,
    },
    bot: {
      user_id: botInfo.user_id,
      name: botInfo.name,
      username: botInfo.username,
    },
    bot_membership_in_target: botMembershipInTarget,
    source_slice: {
      start_index_0_based: startIndex,
      end_index_exclusive_0_based: endIndex,
      range_human: `${startIndex + 1}-${endIndex}`,
      requested_count: options.count,
      selected_count: sourceSliceAll.length,
      run_to_end: options.runToEnd,
      skipped_bot_self_count: skippedBotSelfCount,
      processed_count: sourceSlice.length,
      invite_batch_size: options.inviteBatchSize,
    },
    run_options: {
      dry_run: options.dryRun,
      invite_batch_size: options.inviteBatchSize,
      pause_ms: options.pauseMs,
      pause_jitter_ms: options.pauseJitterMs,
      safe_min_pause_per_user_ms: SAFE_MIN_PAUSE_PER_USER_MS,
      max_retries: options.maxRetries,
      retry_delay_ms: options.retryDelayMs,
      retry_backoff: options.retryBackoff,
      retry_action_failed: options.retryActionFailed,
      split_action_failed_batch: options.splitActionFailedBatch,
      stop_on_consecutive_action_failed: options.stopOnConsecutiveActionFailed,
      stop_when_target_count_reaches: options.targetParticipantsGoal,
      run_to_end: options.runToEnd,
      wave_active_ms: options.waveActiveMs,
      wave_rest_ms: options.waveRestMs,
      skip_existing_scan: options.skipExistingScan,
      verify_chunk_size: options.verifyChunkSize,
      verify_pause_ms: options.verifyPauseMs,
    },
    precheck: {
      target_snapshot_pages: targetSnapshot?.pages ?? null,
      target_snapshot_members_count: targetSnapshot?.memberIds?.size ?? null,
    },
    target_count_goal_reached_snapshot: targetCountReachedSnapshot
      ? {
          chat_id: targetCountReachedSnapshot.chat_id,
          participants_count: targetCountReachedSnapshot.participants_count,
          title: targetCountReachedSnapshot.title,
          type: targetCountReachedSnapshot.type,
          status: targetCountReachedSnapshot.status,
        }
      : null,
    stop_triggered: stopTriggered,
    already_in_target_count: alreadyInTargetIds.length,
    attempted_invite_count: attemptedInviteCount,
    invited_without_immediate_failure_count: invitedWithoutImmediateFailure.length,
    verified_added_count: verifiedAddedIds.length,
    still_not_in_target_from_attempted_count: stillMissingAttemptedIds.length,
    not_attempted_due_to_stop_count: notAttemptedIds.length,
    still_not_in_target_from_this_chunk_count: stillMissingIds.length,
    failed_by_code: aggregateFailuresByCode(failures),
    failed_by_status: aggregateFailuresByStatus(failures),
    verification_errors_count: verification.errors.length,
    verification_errors_sample: verification.errors.slice(0, options.sampleSize),
    sample_verified_added_ids: verifiedAddedIds.slice(0, options.sampleSize),
    sample_still_missing_ids: stillMissingIds.slice(0, options.sampleSize),
    failed_details_sample: failures.slice(0, options.failureSampleSize),
    generated_at_iso: new Date().toISOString(),
  };

  fs.writeFileSync(outputPaths.resultFile, JSON.stringify(result, null, 2) + '\n', 'utf8');
  fs.writeFileSync(
    outputPaths.missingFile,
    stillMissingIds.map(String).join('\n') + (stillMissingIds.length ? '\n' : ''),
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        source_file: path.relative(process.cwd(), source.absPath),
        target_chat_id: options.targetChatId,
        processed_count: sourceSlice.length,
        already_in_target_count: alreadyInTargetIds.length,
        attempted_invite_count: attemptedInviteCount,
        invited_without_immediate_failure_count: invitedWithoutImmediateFailure.length,
        verified_added_count: verifiedAddedIds.length,
        still_not_in_target_from_this_chunk_count: stillMissingIds.length,
        before_participants_count: targetBefore.participants_count,
        after_participants_count: targetAfter.participants_count,
        result_file: path.relative(process.cwd(), outputPaths.resultFile),
        still_missing_file: path.relative(process.cwd(), outputPaths.missingFile),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const parsed = parseApiError(error);
  const message = error?.message || String(error);
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
        code: parsed.code,
        status: parsed.status,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
