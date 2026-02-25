#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_FILE="${1:-$ROOT_DIR/data/avtorynok_volgogradskaya_oblast_member_ids.json}"
TARGET_CHAT_ID_RAW="${2:--71313986483690}"

# Tune via env vars when launching.
WAVE_SIZE="${WAVE_SIZE:-120}"
WAVE_PAUSE_SEC="${WAVE_PAUSE_SEC:-300}"
INVITE_PAUSE_MS="${INVITE_PAUSE_MS:-80}"
INVITE_BATCH_SIZE="${INVITE_BATCH_SIZE:-1}"
MAX_RETRIES="${MAX_RETRIES:-1}"
MAX_WAVES="${MAX_WAVES:-0}" # 0 = unlimited

TARGET_CHAT_ID="$TARGET_CHAT_ID_RAW"
if [[ "$TARGET_CHAT_ID" != -* ]]; then
  TARGET_CHAT_ID="-$TARGET_CHAT_ID"
fi

RUN_ID="$(date +%Y%m%d_%H%M%S)"
RUN_DIR="$ROOT_DIR/data/wave_invite_$RUN_ID"
LOG_FILE="$RUN_DIR/wave_runner.log"
SUMMARY_FILE="$RUN_DIR/summary.jsonl"

mkdir -p "$RUN_DIR"

log() {
  local msg="$1"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$msg" | tee -a "$LOG_FILE"
}

min() {
  if (( "$1" < "$2" )); then
    echo "$1"
  else
    echo "$2"
  fi
}

log "Wave invite started"
log "source_file=$SOURCE_FILE"
log "target_chat_id=$TARGET_CHAT_ID"
log "wave_size=$WAVE_SIZE wave_pause_sec=$WAVE_PAUSE_SEC invite_pause_ms=$INVITE_PAUSE_MS invite_batch_size=$INVITE_BATCH_SIZE max_retries=$MAX_RETRIES"
log "run_dir=$RUN_DIR"

wave=1
while true; do
  if (( MAX_WAVES > 0 && wave > MAX_WAVES )); then
    log "Reached max_waves=$MAX_WAVES, stopping"
    break
  fi

  compute_file="$RUN_DIR/wave_${wave}_compute.json"
  remaining_file="$RUN_DIR/wave_${wave}_remaining.txt"
  remaining_shuffled_file="$RUN_DIR/wave_${wave}_remaining_shuffled.txt"
  result_file="$RUN_DIR/wave_${wave}_result.json"
  missing_file="$RUN_DIR/wave_${wave}_missing.txt"

  if node - "$ROOT_DIR" "$SOURCE_FILE" "$TARGET_CHAT_ID" "$remaining_file" "$remaining_shuffled_file" "$compute_file" >>"$LOG_FILE" 2>&1 <<'NODE'
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Bot } = require('@maxhub/max-bot-api');

function loadIds(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (filePath.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(Number).filter(Number.isFinite);
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.ids)) {
      return parsed.ids.map(Number).filter(Number.isFinite);
    }
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(Number)
    .filter(Number.isFinite);
}

function dedupe(ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

(async () => {
  const [rootDir, sourceFile, targetChatIdRaw, remainingFile, remainingShuffledFile, computeFile] = process.argv.slice(2);
  dotenv.config({ path: path.join(rootDir, '.env') });

  const token = process.env.BOT_TOKEN?.trim();
  if (!token) {
    throw new Error('BOT_TOKEN is missing in .env');
  }

  const targetChatIdNumRaw = Number(targetChatIdRaw);
  if (!Number.isInteger(targetChatIdNumRaw) || targetChatIdNumRaw === 0) {
    throw new Error(`Invalid target chat id: ${targetChatIdRaw}`);
  }
  const targetChatId = targetChatIdNumRaw > 0 ? -targetChatIdNumRaw : targetChatIdNumRaw;

  const sourceIds = dedupe(loadIds(sourceFile));
  const bot = new Bot(token);

  const targetSet = new Set();
  let marker = null;
  let first = true;
  while (first || marker !== null) {
    const resp = await bot.api.getChatMembers(targetChatId, first ? { count: 100 } : { count: 100, marker });
    for (const member of (resp.members || [])) {
      if (typeof member.user_id === 'number') {
        targetSet.add(member.user_id);
      }
    }
    marker = resp.marker ?? null;
    first = false;
  }

  const remaining = sourceIds.filter((id) => !targetSet.has(id));
  const remainingShuffled = shuffle(remaining.slice());

  fs.writeFileSync(remainingFile, remaining.join('\n') + (remaining.length ? '\n' : ''), 'utf8');
  fs.writeFileSync(remainingShuffledFile, remainingShuffled.join('\n') + (remainingShuffled.length ? '\n' : ''), 'utf8');
  fs.writeFileSync(
    computeFile,
    JSON.stringify(
      {
        ok: true,
        source_total: sourceIds.length,
        target_members_count: targetSet.size,
        remaining_count: remaining.length,
        generated_at_iso: new Date().toISOString(),
        remaining_file: remainingFile,
        remaining_shuffled_file: remainingShuffledFile,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
})();
NODE
  then
    :
  else
    log "wave=$wave compute remaining failed, sleeping ${WAVE_PAUSE_SEC}s before retry"
    sleep "$WAVE_PAUSE_SEC"
    wave=$((wave + 1))
    continue
  fi

  if [[ ! -f "$compute_file" ]]; then
    log "wave=$wave compute file not found, sleeping ${WAVE_PAUSE_SEC}s before retry"
    sleep "$WAVE_PAUSE_SEC"
    wave=$((wave + 1))
    continue
  fi

  remaining_count="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(j.remaining_count)" "$compute_file" 2>>"$LOG_FILE" || echo 0)"
  target_members_count="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(j.target_members_count)" "$compute_file" 2>>"$LOG_FILE" || echo 0)"
  log "wave=$wave target_members=$target_members_count remaining=$remaining_count"

  if (( remaining_count <= 0 )); then
    log "No remaining users, stopping"
    break
  fi

  wave_count="$(min "$WAVE_SIZE" "$remaining_count")"
  log "wave=$wave trying wave_count=$wave_count"

  if node "$ROOT_DIR/scripts/add-chat-members-2026.js" \
    --source-file "$remaining_shuffled_file" \
    --target-chat-id "$TARGET_CHAT_ID" \
    --start 0 \
    --count "$wave_count" \
    --invite-batch-size "$INVITE_BATCH_SIZE" \
    --pause-ms "$INVITE_PAUSE_MS" \
    --max-retries "$MAX_RETRIES" \
    --stop-on-action-failed 0 \
    --skip-existing-scan \
    --progress-every 1000 \
    --result-file "$result_file" \
    --missing-file "$missing_file" >>"$LOG_FILE" 2>&1; then
    :
  else
    log "wave=$wave add script returned non-zero, continuing to next wave"
  fi

  attempted="$(node -e "const fs=require('fs');const p=process.argv[1];if(!fs.existsSync(p)){console.log(0);process.exit(0)};const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log(j.attempted_invite_count||0)" "$result_file" 2>>"$LOG_FILE" || echo 0)"
  verified="$(node -e "const fs=require('fs');const p=process.argv[1];if(!fs.existsSync(p)){console.log(0);process.exit(0)};const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log(j.verified_added_count||0)" "$result_file" 2>>"$LOG_FILE" || echo 0)"
  still_missing_chunk="$(node -e "const fs=require('fs');const p=process.argv[1];if(!fs.existsSync(p)){console.log(0);process.exit(0)};const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log(j.still_not_in_target_from_this_chunk_count||0)" "$result_file" 2>>"$LOG_FILE" || echo 0)"
  log "wave=$wave attempted=$attempted verified_added=$verified still_missing_in_chunk=$still_missing_chunk"

  printf '{"wave":%s,"remaining_before":%s,"attempted":%s,"verified_added":%s,"still_missing_in_chunk":%s,"timestamp":"%s","result_file":"%s"}\n' \
    "$wave" "$remaining_count" "$attempted" "$verified" "$still_missing_chunk" "$(date -Iseconds)" "$result_file" >>"$SUMMARY_FILE"

  log "wave=$wave sleeping ${WAVE_PAUSE_SEC}s"
  sleep "$WAVE_PAUSE_SEC"

  wave=$((wave + 1))
done

log "Wave invite finished"
log "summary_file=$SUMMARY_FILE"
