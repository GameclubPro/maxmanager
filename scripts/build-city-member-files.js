#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = process.cwd();
const INPUT_DIRS = ['.', 'data'];
const OUTPUT_DIR = path.join(ROOT_DIR, 'data', 'city_member_ids');
const RUN_TIMESTAMP = formatTimestamp(new Date());

const CITY_MARKERS = [
  '_all_chats_',
  '_all_other_chats_',
  '_selected_other_chats_',
];

const BLOCKED_PREFIXES = [
  'add_',
  'still_missing_',
  '_smoke',
  '_probe',
  'refresh_',
  'clean_',
  'common_ids_',
  'unique_',
  'remaining_',
  'probe_',
  'bot_admin_',
  'live_metrics_',
  'wave_',
];

const BLOCKED_SUBSTRINGS = [
  '_result',
  '_export_',
  '_check_',
];

function formatTimestamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function normalizeId(value) {
  const normalized = typeof value === 'number'
    ? Math.trunc(value)
    : Number(String(value).trim());
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function dedupeValidIds(values) {
  const unique = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = normalizeId(value);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function parseTxtIds(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return dedupeValidIds(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
}

function isSourceJsonFile(fileName) {
  if (!fileName.endsWith('.json')) {
    return false;
  }
  if (!fileName.includes('no_bots_no_admins')) {
    return false;
  }
  if (!CITY_MARKERS.some((marker) => fileName.includes(marker))) {
    return false;
  }
  if (BLOCKED_PREFIXES.some((prefix) => fileName.startsWith(prefix))) {
    return false;
  }
  if (BLOCKED_SUBSTRINGS.some((chunk) => fileName.includes(chunk))) {
    return false;
  }
  return true;
}

function extractCitySlug(fileName) {
  let selectedIndex = -1;

  for (const marker of CITY_MARKERS) {
    const markerIndex = fileName.indexOf(marker);
    if (markerIndex <= 0) {
      continue;
    }
    if (selectedIndex === -1 || markerIndex < selectedIndex) {
      selectedIndex = markerIndex;
    }
  }

  if (selectedIndex <= 0) {
    return null;
  }

  return fileName.slice(0, selectedIndex);
}

function pushIfStringAndTxt(value, acc) {
  if (typeof value !== 'string') {
    return;
  }
  if (!value.toLowerCase().endsWith('.txt')) {
    return;
  }
  acc.push(value);
}

function collectTxtPathsFromObject(input, acc) {
  if (!input || typeof input !== 'object') {
    return;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      collectTxtPathsFromObject(item, acc);
    }
    return;
  }

  for (const value of Object.values(input)) {
    if (typeof value === 'string') {
      pushIfStringAndTxt(value, acc);
      continue;
    }
    collectTxtPathsFromObject(value, acc);
  }
}

function resolveTxtPathCandidates(value, jsonFilePath) {
  const candidates = [];
  if (path.isAbsolute(value)) {
    candidates.push(value);
  }
  candidates.push(path.resolve(ROOT_DIR, value));
  candidates.push(path.resolve(path.dirname(jsonFilePath), value));
  return candidates;
}

function findRelatedTxtFiles(payload, jsonFilePath) {
  const collectedValues = [];

  pushIfStringAndTxt(payload?.result_file_txt, collectedValues);
  pushIfStringAndTxt(payload?.output_txt_file, collectedValues);
  collectTxtPathsFromObject(payload?.files, collectedValues);

  const baseName = `${path.basename(jsonFilePath, '.json')}.txt`;
  collectedValues.push(baseName);
  collectedValues.push(path.join(path.dirname(jsonFilePath), baseName));
  collectedValues.push(path.join('data', baseName));

  const unique = [];
  const seen = new Set();

  for (const value of collectedValues) {
    for (const resolvedPath of resolveTxtPathCandidates(value, jsonFilePath)) {
      if (seen.has(resolvedPath)) {
        continue;
      }
      seen.add(resolvedPath);
      unique.push(resolvedPath);
    }
  }

  return unique;
}

function loadIdsFromJsonSource(jsonFilePath) {
  const raw = fs.readFileSync(jsonFilePath, 'utf8');
  const payload = JSON.parse(raw);

  const usedFiles = [path.relative(ROOT_DIR, jsonFilePath)];
  let ids = dedupeValidIds(Array.isArray(payload?.ids) ? payload.ids : []);

  if (!ids.length) {
    for (const txtCandidate of findRelatedTxtFiles(payload, jsonFilePath)) {
      const txtIds = parseTxtIds(txtCandidate);
      if (!txtIds.length) {
        continue;
      }
      ids = txtIds;
      usedFiles.push(path.relative(ROOT_DIR, txtCandidate));
      break;
    }
  }

  return { ids, usedFiles };
}

function collectSourceFiles() {
  const results = [];

  for (const dir of INPUT_DIRS) {
    const absDir = path.resolve(ROOT_DIR, dir);
    if (!fs.existsSync(absDir)) {
      continue;
    }

    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (!isSourceJsonFile(entry.name)) {
        continue;
      }
      const city = extractCitySlug(entry.name);
      if (!city) {
        continue;
      }

      results.push({
        city,
        jsonFilePath: path.join(absDir, entry.name),
      });
    }
  }

  results.sort((a, b) => a.jsonFilePath.localeCompare(b.jsonFilePath));
  return results;
}

function writeCityOutput(city, ids, sources) {
  const sortedIds = [...ids].sort((a, b) => a - b);
  const jsonPath = path.join(OUTPUT_DIR, `${city}_all_chats_member_ids_no_bots_no_admins.json`);
  const txtPath = path.join(OUTPUT_DIR, `${city}_all_chats_member_ids_no_bots_no_admins.txt`);

  const jsonPayload = {
    generated_at: new Date().toISOString(),
    city,
    source_files_count: sources.length,
    source_files: sources,
    ids_count: sortedIds.length,
    ids: sortedIds,
  };

  fs.writeFileSync(jsonPath, `${JSON.stringify(jsonPayload, null, 2)}\n`);
  fs.writeFileSync(txtPath, `${sortedIds.join('\n')}\n`);

  return {
    city,
    ids_count: sortedIds.length,
    source_files_count: sources.length,
    json_file: path.relative(ROOT_DIR, jsonPath),
    txt_file: path.relative(ROOT_DIR, txtPath),
  };
}

function main() {
  const sourceFiles = collectSourceFiles();
  if (!sourceFiles.length) {
    console.log('[info] no source json files with no_bots_no_admins found');
    return;
  }

  const cityMap = new Map();
  const warnings = [];

  for (const source of sourceFiles) {
    try {
      const loaded = loadIdsFromJsonSource(source.jsonFilePath);
      if (!loaded.ids.length) {
        warnings.push({
          source: path.relative(ROOT_DIR, source.jsonFilePath),
          message: 'no ids found in json.ids and related txt files',
        });
        continue;
      }

      if (!cityMap.has(source.city)) {
        cityMap.set(source.city, {
          ids: new Set(),
          sources: [],
        });
      }

      const entry = cityMap.get(source.city);
      for (const id of loaded.ids) {
        entry.ids.add(id);
      }

      entry.sources.push({
        source: path.relative(ROOT_DIR, source.jsonFilePath),
        ids_loaded: loaded.ids.length,
        ids_origin_files: loaded.usedFiles,
      });
    } catch (error) {
      warnings.push({
        source: path.relative(ROOT_DIR, source.jsonFilePath),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const citySummaries = [];
  const cityNames = [...cityMap.keys()].sort((a, b) => a.localeCompare(b));
  for (const city of cityNames) {
    const entry = cityMap.get(city);
    const citySummary = writeCityOutput(city, entry.ids, entry.sources);
    citySummaries.push(citySummary);
    console.log(
      `[city] ${city}: ${citySummary.ids_count} ids from ${citySummary.source_files_count} source file(s)`,
    );
  }

  const summary = {
    generated_at: new Date().toISOString(),
    run_timestamp: RUN_TIMESTAMP,
    source_files_scanned: sourceFiles.length,
    cities_generated: citySummaries.length,
    output_dir: path.relative(ROOT_DIR, OUTPUT_DIR),
    cities: citySummaries,
    warnings,
  };

  const summaryPath = path.join(OUTPUT_DIR, `build_city_member_files_${RUN_TIMESTAMP}.json`);
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`[done] city files generated: ${citySummaries.length}`);
  console.log(`[done] summary: ${path.relative(ROOT_DIR, summaryPath)}`);
  if (warnings.length) {
    console.log(`[warn] warnings: ${warnings.length}`);
  }
}

main();
