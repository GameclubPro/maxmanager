import { describe, expect, it, vi } from 'vitest';
import { SqliteDatabase } from '../src/db/sqlite';
import { AntiBotRiskScorer } from '../src/moderation/anti-bot';
import { createRepositories } from '../src/repos';
import { BotConfig, IncomingMessage } from '../src/types';

const config: BotConfig = {
  botToken: 'test',
  timezone: 'Europe/Moscow',
  dailyMessageLimit: 0,
  photoLimitPerHour: 1,
  maxTextLength: 1200,
  spamWindowSec: 10,
  spamThreshold: 3,
  strikeDecayHours: 24,
  muteHours: 1,
  banHours: 24,
  noticeInChat: true,
  databasePath: ':memory:',
  cleanupIntervalSec: 300,
};

function makeMessage(mid: string, text: string): IncomingMessage {
  return {
    sender: { user_id: 20, name: 'Иван' },
    recipient: { chat_id: 10, chat_type: 'chat' },
    body: {
      mid,
      text,
      attachments: null,
    },
  };
}

describe('anti-bot risk scorer', () => {
  it('combines behavior and content signals into mute-level risk', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const scorer = new AntiBotRiskScorer(repos);
    const now = 1_700_000_000_000;

    for (let i = 0; i < 5; i += 1) {
      repos.messageEvents.add(10, 20, now - i * 1_000);
    }

    const assessment = scorer.assess({
      chatId: 10,
      userId: 20,
      message: makeMessage(
        'm1',
        'Быстрый заработок!!! пиши в лс, есть прибыль и крипт предложения',
      ),
      nowTs: now,
    });

    expect(assessment.shouldAct).toBe(true);
    expect(assessment.shouldMute).toBe(true);
    expect(assessment.signals.some((signal) => signal.type === 'behavior')).toBe(true);
    expect(assessment.signals.some((signal) => signal.type === 'content')).toBe(true);

    db.close();
  });

  it('adds reputation signals based on moderation history', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const scorer = new AntiBotRiskScorer(repos);
    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now - 60_000);

    repos.moderationActions.record({ chatId: 10, userId: 20, action: 'warn', reason: 'spam' });
    repos.moderationActions.record({ chatId: 10, userId: 20, action: 'warn', reason: 'link' });
    repos.moderationActions.record({ chatId: 10, userId: 20, action: 'delete_message', reason: 'quota' });
    repos.moderationActions.record({ chatId: 10, userId: 20, action: 'delete_message', reason: 'spam' });
    repos.moderationActions.record({ chatId: 10, userId: 20, action: 'delete_message', reason: 'text_length' });
    repos.moderationActions.record({ chatId: 10, userId: 20, action: 'mute', reason: 'spam' });

    nowSpy.mockRestore();

    const assessment = scorer.assess({
      chatId: 10,
      userId: 20,
      message: makeMessage('m2', 'обычный текст без спама'),
      nowTs: now,
    });

    const reputationSignals = assessment.signals.filter((signal) => signal.type === 'reputation');
    expect(reputationSignals.length).toBeGreaterThan(0);
    expect(reputationSignals.some((signal) => signal.key === 'warns_24h')).toBe(true);
    expect(reputationSignals.some((signal) => signal.key === 'mutes_7d')).toBe(true);

    db.close();
  });
});
