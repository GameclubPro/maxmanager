import { describe, expect, it } from 'vitest';
import { getForbiddenLinks } from '../src/moderation/link-detector';
import { IncomingMessage } from '../src/types';

function makeMessage(text: string, attachments: unknown[] = []): IncomingMessage {
  return {
    sender: { user_id: 10 },
    recipient: { chat_id: 100, chat_type: 'chat' },
    body: {
      mid: 'm1',
      text,
      attachments,
    },
  };
}

describe('link detector', () => {
  it('detects plain links', () => {
    const msg = makeMessage('check https://example.com/path');
    const links = getForbiddenLinks(msg, []);
    expect(links.length).toBe(1);
    expect(links[0].domain).toBe('example.com');
  });

  it('detects markdown and html links', () => {
    const markdown = makeMessage('[link](https://one.me) and <a href="https://max.ru">x</a>');
    const links = getForbiddenLinks(markdown, []);
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('detects links in attachments', () => {
    const msg = makeMessage('ok', [{
      type: 'inline_keyboard',
      payload: {
        buttons: [[{ type: 'link', text: 'go', url: 'https://spam.example.org' }]],
      },
    }]);

    const links = getForbiddenLinks(msg, []);
    expect(links.some((item) => item.domain === 'spam.example.org')).toBe(true);
  });

  it('allows whitelisted domains including subdomains', () => {
    const msg = makeMessage('https://blog.allowed.com/post');
    const links = getForbiddenLinks(msg, ['allowed.com']);
    expect(links).toHaveLength(0);
  });
});
