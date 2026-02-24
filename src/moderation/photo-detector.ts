import { IncomingMessage } from '../types';

interface AttachmentLike {
  type?: unknown;
}

function hasImageAttachment(attachments: unknown[] | null | undefined): boolean {
  if (!attachments || attachments.length === 0) {
    return false;
  }

  return attachments.some((attachment) => {
    if (!attachment || typeof attachment !== 'object') {
      return false;
    }

    const typedAttachment = attachment as AttachmentLike;
    return typedAttachment.type === 'image';
  });
}

export function isPhotoMessage(message: IncomingMessage): boolean {
  if (hasImageAttachment(message.body.attachments)) {
    return true;
  }

  const linkedAttachments = message.link?.message?.attachments;
  return hasImageAttachment(linkedAttachments);
}
