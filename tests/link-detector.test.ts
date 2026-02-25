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

  it('detects punycode and ipv4 links with path without protocol', () => {
    const msg = makeMessage('example.xn--p1ai, 192.168.10.15/admin');
    const links = getForbiddenLinks(msg, []);
    expect(links.some((item) => item.domain === 'example.xn--p1ai')).toBe(true);
    expect(links.some((item) => item.domain === '192.168.10.15')).toBe(true);
  });

  it('detects IDN with explicit protocol', () => {
    const msg = makeMessage('https://пример.рф/страница');
    const links = getForbiddenLinks(msg, []);
    expect(links.some((item) => item.domain === 'xn--e1afmkfd.xn--p1ai')).toBe(true);
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

  it('ignores technical media link fields', () => {
    const msg = makeMessage('photo', [{
      type: 'image',
      payload: {
        url: 'https://media.max.ru/photo/123',
        link: 'https://max.ru/messages/123',
        permalink: 'https://max.ru/messages/123',
      },
    }]);

    const links = getForbiddenLinks(msg, []);
    expect(links).toHaveLength(0);
  });

  it('ignores top-level message url metadata', () => {
    const msg = makeMessage('обычный текст без ссылок') as IncomingMessage;
    msg.url = 'https://max.ru/messages/123';

    const links = getForbiddenLinks(msg, []);
    expect(links).toHaveLength(0);
  });

  it('does not flag forwarded photo with only technical fields', () => {
    const msg = makeMessage('outer text', [], {
      type: 'forward',
      message: {
        text: null,
        attachments: [
          {
            type: 'image',
            payload: {
              url: 'https://media.max.ru/photo/123',
              link: 'https://max.ru/messages/123',
            },
          },
        ],
      },
    });

    const links = getForbiddenLinks(msg, []);
    expect(links).toHaveLength(0);
  });

  it('does not flag forwarded message with technical linked message url', () => {
    const msg = makeMessage('outer text', [], {
      type: 'forward',
      message: {
        text: 'пересланный текст без ссылки',
        attachments: null,
        url: 'https://max.ru/messages/abc123',
      } as unknown as IncomingMessage['link']['message'],
    });

    const links = getForbiddenLinks(msg, []);
    expect(links).toHaveLength(0);
  });

  it('normalizes wrapped links and does not keep trailing quotes', () => {
    const msg = makeMessage('<a href="https://max.ru/page">x</a>');
    const links = getForbiddenLinks(msg, []);
    expect(links.every((item) => item.domain === 'max.ru')).toBe(true);
  });

  it('does not treat email address as link', () => {
    const msg = makeMessage('email: ivan.petrov@example.com');
    const links = getForbiddenLinks(msg, []);
    expect(links).toHaveLength(0);
  });

  it('does not treat russian abbreviations with dots as links', () => {
    const msg = makeMessage('г.Москва, ул.Ленина');
    const links = getForbiddenLinks(msg, []);
    expect(links).toHaveLength(0);
  });

  it('does not treat file-like names as links', () => {
    const msg = makeMessage('файл report.final.doc загружен');
    const links = getForbiddenLinks(msg, []);
    expect(links).toHaveLength(0);
  });

  it('does not treat bare ipv4 without path as link', () => {
    const msg = makeMessage('локальный адрес 127.0.0.1');
    const links = getForbiddenLinks(msg, []);
    expect(links).toHaveLength(0);
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
