import { describe, expect, it } from 'vitest';
import { isPhotoMessage } from '../src/moderation/photo-detector';
import { IncomingMessage } from '../src/types';

function makeMessage(args: {
  attachments?: unknown[] | null;
  linkedAttachments?: unknown[] | null;
} = {}): IncomingMessage {
  const attachments = args.attachments ?? null;
  const linkedAttachments = args.linkedAttachments ?? null;

  return {
    sender: { user_id: 10 },
    recipient: { chat_id: 100, chat_type: 'chat' },
    body: {
      mid: 'm1',
      text: null,
      attachments,
    },
    link: linkedAttachments
      ? {
        message: {
          attachments: linkedAttachments,
        },
      }
      : null,
  };
}

describe('photo detector', () => {
  it('detects image in direct message attachments', () => {
    const message = makeMessage({
      attachments: [{ type: 'image', payload: { photo_id: 1 } }],
    });

    expect(isPhotoMessage(message)).toBe(true);
  });

  it('ignores non-image attachments', () => {
    const message = makeMessage({
      attachments: [{ type: 'video' }, { type: 'file' }],
    });

    expect(isPhotoMessage(message)).toBe(false);
  });

  it('detects image in forwarded linked message attachments', () => {
    const message = makeMessage({
      linkedAttachments: [{ type: 'image', payload: { photo_id: 55 } }],
    });

    expect(isPhotoMessage(message)).toBe(true);
  });
});
