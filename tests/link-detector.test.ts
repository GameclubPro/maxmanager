import { describe, expect, it } from 'vitest';
import { getForbiddenLinks } from '../src/moderation/link-detector';
import { IncomingMessage } from '../src/types';

function makeMessage(
  text: string,
  attachments: unknown[] = [],
  link?: IncomingMessage['link'],
): IncomingMessage {
  return {
    sender: { user_id: 10 },
    recipient: { chat_id: 100, chat_type: 'chat' },
    body: {
      mid: 'm1',
      text,
      attachments,
    },
    link,
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

  it('detects tg:// and other non-http scheme links', () => {
    const msg = makeMessage('invite tg://resolve?domain=my_channel');
    const links = getForbiddenLinks(msg, []);
    expect(links.some((item) => item.raw.startsWith('tg://resolve?domain='))).toBe(true);
  });

  it('detects IDN, punycode and ipv4 links without protocol', () => {
    const msg = makeMessage('пример.рф, example.xn--p1ai, 192.168.10.15/admin');
    const links = getForbiddenLinks(msg, []);
    expect(links.some((item) => item.domain === 'xn--e1afmkfd.xn--p1ai')).toBe(true);
    expect(links.some((item) => item.domain === 'example.xn--p1ai')).toBe(true);
    expect(links.some((item) => item.domain === '192.168.10.15')).toBe(true);
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

  it('does not treat image attachment media url as forbidden link', () => {
    const msg = makeMessage('photo only', [{
      type: 'image',
      payload: {
        url: 'https://media.max.ru/photo/123',
        token: 'abc',
        photo_id: 1,
      },
    }]);

    const links = getForbiddenLinks(msg, []);
    expect(links).toHaveLength(0);
  });

  it('detects links in arbitrary attachment string fields', () => {
    const msg = makeMessage('ok', [{
      type: 'widget',
      payload: {
        title: 'Канал: tg://resolve?domain=chat_news',
        description: 'Подробности https://spam.example.org/post',
      },
    }]);

    const links = getForbiddenLinks(msg, []);
    expect(links.some((item) => item.raw.startsWith('tg://resolve?domain=chat_news'))).toBe(true);
    expect(links.some((item) => item.domain === 'spam.example.org')).toBe(true);
  });

  it('ignores media service urls but catches links in media text fields', () => {
    const msg = makeMessage('photo', [{
      type: 'image',
      payload: {
        url: 'https://media.max.ru/photo/123',
        description: 'подписывайся https://promo.example.net',
      },
    }]);

    const links = getForbiddenLinks(msg, []);
    expect(links).toHaveLength(1);
    expect(links[0].domain).toBe('promo.example.net');
  });

  it('normalizes wrapped links and does not keep trailing quotes', () => {
    const msg = makeMessage('<a href="https://max.ru/page">x</a>');
    const links = getForbiddenLinks(msg, []);
    expect(links.every((item) => item.domain === 'max.ru')).toBe(true);
  });

  it('allows whitelisted domains including subdomains', () => {
    const msg = makeMessage('https://blog.allowed.com/post');
    const links = getForbiddenLinks(msg, ['allowed.com']);
    expect(links).toHaveLength(0);
  });

  it('detects links in forwarded messages', () => {
    const msg = makeMessage('outer text', [], {
      type: 'forward',
      message: {
        text: 'repost https://spam.forwarded.example.org',
        attachments: null,
      },
    });

    const links = getForbiddenLinks(msg, []);
    expect(links.some((item) => item.domain === 'spam.forwarded.example.org')).toBe(true);
  });

  it('detects links in forwarded message markup', () => {
    const msg = makeMessage('outer text', [], {
      type: 'forward',
      message: {
        text: null,
        attachments: null,
        markup: [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: [[{ type: 'link', text: 'go', url: 'https://btn.forwarded.example.net' }]],
            },
          },
        ],
      },
    });

    const links = getForbiddenLinks(msg, []);
    expect(links.some((item) => item.domain === 'btn.forwarded.example.net')).toBe(true);
  });
});
