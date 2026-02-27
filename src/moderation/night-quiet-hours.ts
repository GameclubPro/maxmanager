interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export interface NightQuietHoursWindow {
  timezone: string;
  localHour: number;
  windowStartTs: number;
  windowEndTs: number;
}

const NIGHT_QUIET_START_HOUR = 23;
const NIGHT_QUIET_END_HOUR = 7;

const CITY_CHAT_TIMEZONE_BY_ID = new Map<number, string>([
  [-69049244448234, 'Europe/Moscow'], // Ростов-на-Дону
  [-69067549505002, 'Europe/Moscow'], // Краснодар
  [-71307153924250, 'Asia/Irkutsk'], // Ангарск
  [-71313986483690, 'Europe/Moscow'], // Волгоград
  [-71336283338218, 'Europe/Moscow'], // Родионовка
  [-71443525791210, 'Asia/Yekaterinburg'], // Уфа
  [-71456471431277, 'Europe/Moscow'], // Казань
  [-71456678709255, 'Europe/Moscow'], // Кубань
  [-71456680806407, 'Asia/Irkutsk'], // Иркутск
  [-71456683034631, 'Europe/Moscow'], // Новороссийск
  [-71489685325831, 'Europe/Moscow'], // Анапа
  [-71489688733703, 'Europe/Moscow'], // Ставрополь
  [-71489692010503, 'Asia/Yekaterinburg'], // Екатеринбург
  [-71489737820167, 'Europe/Moscow'], // Ейск
  [-71489753942023, 'Europe/Moscow'], // Новошахтинск
  [-71489818560519, 'Asia/Chita'], // Чита
  [-71506814142471, 'Asia/Vladivostok'], // Хабаровск
  [-71506932434951, 'Asia/Krasnoyarsk'], // Красноярск
  [-71520449562631, 'Asia/Yekaterinburg'], // Тюмень
  [-71525320394759, 'Europe/Moscow'], // Волгодонск
]);

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = dateTimeFormatterCache.get(timezone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  dateTimeFormatterCache.set(timezone, formatter);
  return formatter;
}

function parseDateTimeParts(timestampMs: number, timezone: string): LocalDateTimeParts {
  const formatter = getDateTimeFormatter(timezone);
  const parts = formatter.formatToParts(new Date(timestampMs));

  const year = Number.parseInt(parts.find((part) => part.type === 'year')?.value ?? '', 10);
  const month = Number.parseInt(parts.find((part) => part.type === 'month')?.value ?? '', 10);
  const day = Number.parseInt(parts.find((part) => part.type === 'day')?.value ?? '', 10);
  const hour = Number.parseInt(parts.find((part) => part.type === 'hour')?.value ?? '', 10);
  const minute = Number.parseInt(parts.find((part) => part.type === 'minute')?.value ?? '', 10);
  const second = Number.parseInt(parts.find((part) => part.type === 'second')?.value ?? '', 10);

  if (![year, month, day, hour, minute, second].every((value) => Number.isFinite(value))) {
    throw new Error(`Failed to parse local date/time parts for timezone ${timezone}`);
  }

  return { year, month, day, hour, minute, second };
}

function resolveOffsetMs(timestampMs: number, timezone: string): number {
  const local = parseDateTimeParts(timestampMs, timezone);
  const localAsUtcTs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    0,
  );

  const roundedInputTs = Math.floor(timestampMs / 1000) * 1000;
  return localAsUtcTs - roundedInputTs;
}

function toUtcTimestamp(parts: LocalDateTimeParts, timezone: string): number {
  const guessUtcTs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  const firstOffset = resolveOffsetMs(guessUtcTs, timezone);
  let resolvedUtcTs = guessUtcTs - firstOffset;

  const secondOffset = resolveOffsetMs(resolvedUtcTs, timezone);
  if (secondOffset !== firstOffset) {
    resolvedUtcTs = guessUtcTs - secondOffset;
  }

  return resolvedUtcTs;
}

function shiftLocalDate(date: LocalDateParts, daysDelta: number): LocalDateParts {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + daysDelta, 12, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function resolveNightQuietHoursWindow(chatId: number, nowTs: number): NightQuietHoursWindow | null {
  const timezone = CITY_CHAT_TIMEZONE_BY_ID.get(chatId);
  if (!timezone) {
    return null;
  }

  let nowLocal: LocalDateTimeParts;
  try {
    nowLocal = parseDateTimeParts(nowTs, timezone);
  } catch {
    return null;
  }

  const isNightQuietHours = nowLocal.hour >= NIGHT_QUIET_START_HOUR || nowLocal.hour < NIGHT_QUIET_END_HOUR;
  if (!isNightQuietHours) {
    return null;
  }

  const currentLocalDate: LocalDateParts = {
    year: nowLocal.year,
    month: nowLocal.month,
    day: nowLocal.day,
  };
  const windowStartDate = nowLocal.hour >= NIGHT_QUIET_START_HOUR
    ? currentLocalDate
    : shiftLocalDate(currentLocalDate, -1);
  const windowEndDate = shiftLocalDate(windowStartDate, 1);

  let windowStartTs: number;
  let windowEndTs: number;
  try {
    windowStartTs = toUtcTimestamp(
      {
        ...windowStartDate,
        hour: NIGHT_QUIET_START_HOUR,
        minute: 0,
        second: 0,
      },
      timezone,
    );
    windowEndTs = toUtcTimestamp(
      {
        ...windowEndDate,
        hour: NIGHT_QUIET_END_HOUR,
        minute: 0,
        second: 0,
      },
      timezone,
    );
  } catch {
    return null;
  }

  return {
    timezone,
    localHour: nowLocal.hour,
    windowStartTs,
    windowEndTs,
  };
}
