import { Repositories } from '../repos';
import { IncomingMessage } from '../types';
import { extractLinks } from './link-detector';

export type AntiBotSignalType = 'behavior' | 'content' | 'reputation';

export interface AntiBotSignal {
  type: AntiBotSignalType;
  key: string;
  score: number;
  value: number | string | boolean;
}

export interface AntiBotAssessment {
  totalScore: number;
  shouldAct: boolean;
  shouldMute: boolean;
  signals: AntiBotSignal[];
}

interface AntiBotAssessInput {
  chatId: number;
  userId: number;
  message: IncomingMessage;
  nowTs: number;
}

interface RecentTextEvent {
  ts: number;
  signature: string;
}

const BURST_WINDOW_SHORT_MS = 10_000;
const BURST_WINDOW_MEDIUM_MS = 60_000;
const REPEATED_TEXT_WINDOW_MS = 10 * 60 * 1000;
const REPEATED_TEXT_RETENTION_MS = 2 * 60 * 60 * 1000;
const REPUTATION_DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPUTATION_WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const ANTI_BOT_ACT_THRESHOLD = 45;
const ANTI_BOT_MUTE_THRESHOLD = 70;
const ANTI_BOT_MUTE_WITH_HISTORY_THRESHOLD = 55;

const SUSPICIOUS_CONTENT_PATTERNS: Array<{ key: string; regex: RegExp }> = [
  { key: 'money_offer', regex: /(заработок|доход|прибыль|инвест|крипт|трейд|арбитраж)/i },
  { key: 'casino_or_adult', regex: /(казино|ставк|bet|18\+|xxx|интим|onlyfans)/i },
  { key: 'external_contact', regex: /(пиши(те)?\s*(в|на)?\s*(лс|личк|директ)|telegram|whatsapp|t\.me|wa\.me)/i },
];

export class AntiBotRiskScorer {
  private readonly recentTextEvents = new Map<string, RecentTextEvent[]>();

  constructor(private readonly repos: Repositories) {}

  assess(input: AntiBotAssessInput): AntiBotAssessment {
    const signals: AntiBotSignal[] = [];

    this.collectBehaviorSignals(input, signals);
    this.collectContentSignals(input.message, signals);
    this.collectReputationSignals(input.chatId, input.userId, input.nowTs, signals);

    const totalScore = signals.reduce((sum, signal) => sum + signal.score, 0);
    const hasMuteHistory = signals.some((signal) => signal.type === 'reputation' && signal.key === 'mutes_7d');

    return {
      totalScore,
      shouldAct: totalScore >= ANTI_BOT_ACT_THRESHOLD,
      shouldMute: totalScore >= ANTI_BOT_MUTE_THRESHOLD
        || (hasMuteHistory && totalScore >= ANTI_BOT_MUTE_WITH_HISTORY_THRESHOLD),
      signals,
    };
  }

  private collectBehaviorSignals(input: AntiBotAssessInput, signals: AntiBotSignal[]): void {
    const shortBurst = this.repos.messageEvents.countSince(
      input.chatId,
      input.userId,
      input.nowTs - BURST_WINDOW_SHORT_MS,
    ) + 1;
    if (shortBurst >= 6) {
      signals.push({ type: 'behavior', key: 'burst_10s', score: 45, value: shortBurst });
    } else if (shortBurst >= 4) {
      signals.push({ type: 'behavior', key: 'burst_10s', score: 25, value: shortBurst });
    }

    const mediumBurst = this.repos.messageEvents.countSince(
      input.chatId,
      input.userId,
      input.nowTs - BURST_WINDOW_MEDIUM_MS,
    ) + 1;
    if (mediumBurst >= 12) {
      signals.push({ type: 'behavior', key: 'burst_60s', score: 30, value: mediumBurst });
    } else if (mediumBurst >= 8) {
      signals.push({ type: 'behavior', key: 'burst_60s', score: 18, value: mediumBurst });
    }

    const repeatedTextCount = this.trackAndCountRepeatedText(
      input.chatId,
      input.userId,
      input.message,
      input.nowTs,
    );

    if (repeatedTextCount >= 5) {
      signals.push({ type: 'behavior', key: 'repeat_text', score: 35, value: repeatedTextCount });
    } else if (repeatedTextCount >= 3) {
      signals.push({ type: 'behavior', key: 'repeat_text', score: 20, value: repeatedTextCount });
    }
  }

  private collectContentSignals(message: IncomingMessage, signals: AntiBotSignal[]): void {
    const combinedText = this.getCombinedText(message);
    const linksCount = extractLinks(message).length;

    if (linksCount >= 4) {
      signals.push({ type: 'content', key: 'links_count', score: 30, value: linksCount });
    } else if (linksCount >= 2) {
      signals.push({ type: 'content', key: 'links_count', score: 18, value: linksCount });
    }

    if (!combinedText) {
      return;
    }

    const matchedPatterns = SUSPICIOUS_CONTENT_PATTERNS
      .filter((pattern) => pattern.regex.test(combinedText))
      .map((pattern) => pattern.key);

    if (matchedPatterns.length >= 2) {
      signals.push({
        type: 'content',
        key: 'suspicious_patterns',
        score: 30,
        value: matchedPatterns.join(','),
      });
    } else if (matchedPatterns.length === 1) {
      signals.push({
        type: 'content',
        key: 'suspicious_patterns',
        score: 18,
        value: matchedPatterns[0],
      });
    }

    if (/([!?])\1{5,}/u.test(combinedText) || /(.)\1{10,}/u.test(combinedText)) {
      signals.push({ type: 'content', key: 'repeating_chars', score: 8, value: true });
    }

    const tokens = combinedText.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    if (tokens.length >= 10) {
      const uniqueRatio = new Set(tokens).size / tokens.length;
      if (uniqueRatio < 0.45) {
        signals.push({
          type: 'content',
          key: 'low_token_diversity',
          score: 12,
          value: Number(uniqueRatio.toFixed(2)),
        });
      }
    }
  }

  private collectReputationSignals(chatId: number, userId: number, nowTs: number, signals: AntiBotSignal[]): void {
    const daySince = nowTs - REPUTATION_DAY_WINDOW_MS;
    const weekSince = nowTs - REPUTATION_WEEK_WINDOW_MS;

    const warns24h = this.repos.moderationActions.countByActionSince(chatId, userId, 'warn', daySince);
    if (warns24h >= 2) {
      signals.push({
        type: 'reputation',
        key: 'warns_24h',
        score: Math.min(24, warns24h * 6),
        value: warns24h,
      });
    } else if (warns24h === 1) {
      signals.push({ type: 'reputation', key: 'warns_24h', score: 6, value: warns24h });
    }

    const deletes24h = this.repos.moderationActions.countByActionSince(chatId, userId, 'delete_message', daySince);
    if (deletes24h >= 3) {
      signals.push({
        type: 'reputation',
        key: 'deletes_24h',
        score: Math.min(20, deletes24h * 3),
        value: deletes24h,
      });
    }

    const mutes7d = this.repos.moderationActions.countByActionSince(chatId, userId, 'mute', weekSince);
    if (mutes7d >= 1) {
      signals.push({
        type: 'reputation',
        key: 'mutes_7d',
        score: Math.min(40, mutes7d * 20),
        value: mutes7d,
      });
    }

    const kicks7d = this.repos.moderationActions.countByActionSince(chatId, userId, 'kick_temp', weekSince)
      + this.repos.moderationActions.countByActionSince(chatId, userId, 'kick', weekSince)
      + this.repos.moderationActions.countByActionSince(chatId, userId, 'kick_auto', weekSince)
      + this.repos.moderationActions.countByActionSince(chatId, userId, 'ban', weekSince)
      + this.repos.moderationActions.countByActionSince(chatId, userId, 'ban_fallback', weekSince);

    if (kicks7d > 0) {
      signals.push({
        type: 'reputation',
        key: 'kicks_or_bans_7d',
        score: 30,
        value: kicks7d,
      });
    }
  }

  private trackAndCountRepeatedText(chatId: number, userId: number, message: IncomingMessage, nowTs: number): number {
    const key = `${chatId}:${userId}`;
    const previous = this.recentTextEvents.get(key) ?? [];
    const retentionSince = nowTs - REPEATED_TEXT_RETENTION_MS;
    const retained = previous.filter((event) => event.ts >= retentionSince);

    const signature = this.buildMessageSignature(message);
    if (!signature) {
      if (retained.length > 0) {
        this.recentTextEvents.set(key, retained);
      } else {
        this.recentTextEvents.delete(key);
      }
      return 0;
    }

    const repeatedSince = nowTs - REPEATED_TEXT_WINDOW_MS;
    const repeatCount = retained.filter((event) => event.signature === signature && event.ts >= repeatedSince).length + 1;

    retained.push({ ts: nowTs, signature });
    this.recentTextEvents.set(key, retained);

    return repeatCount;
  }

  private buildMessageSignature(message: IncomingMessage): string | null {
    const text = this.getCombinedText(message);
    if (!text) return null;

    const normalized = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (normalized.length < 6) {
      return null;
    }

    return normalized.slice(0, 180);
  }

  private getCombinedText(message: IncomingMessage): string {
    const parts = [message.body.text, message.link?.message?.text]
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      .map((value) => value.trim());

    return parts.join(' ').trim();
  }
}
