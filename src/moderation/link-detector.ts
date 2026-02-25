import { DetectedLink, IncomingMessage } from '../types';
import { isDomainAllowed, normalizeDomain, stripTrailingPunctuation } from '../utils/domain';

const TEXT_URL_REGEX = /\b((?:https?:\/\/|www\.)[^\s<>()]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:\/[^\s<>()]*)?)/gi;
const HTML_HREF_REGEX = /href\s*=\s*["']([^"']+)["']/gi;
const MEDIA_ATTACHMENT_TYPES = new Set(['image', 'video', 'audio', 'file', 'sticker']);

function normalizeUrlCandidate(rawCandidate: string): string {
  return stripTrailingPunctuation(rawCandidate.trim());
}

function detectFromText(text: string): string[] {
  const out = new Set<string>();

  const normalizedText = text.trim();
  let match: RegExpExecArray | null;

  while ((match = TEXT_URL_REGEX.exec(normalizedText)) !== null) {
    const candidate = normalizeUrlCandidate(match[1]);
    if (candidate) out.add(candidate);
  }

  while ((match = HTML_HREF_REGEX.exec(normalizedText)) !== null) {
    const candidate = normalizeUrlCandidate(match[1]);
    if (candidate) out.add(candidate);
  }

  return [...out];
}

function detectFromAttachmentObject(value: unknown, out: Set<string>, parentAttachmentType?: string): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      detectFromAttachmentObject(item, out, parentAttachmentType);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const currentAttachmentType = typeof record.type === 'string' ? record.type : parentAttachmentType;
  const isMediaAttachment = currentAttachmentType ? MEDIA_ATTACHMENT_TYPES.has(currentAttachmentType) : false;

  for (const [key, nested] of Object.entries(record)) {
    if (typeof nested === 'string' && (key === 'url' || key === 'image_url' || key === 'link')) {
      if (isMediaAttachment && (key === 'url' || key === 'image_url')) {
        continue;
      }

      const candidate = normalizeUrlCandidate(nested);
      if (candidate) out.add(candidate);
      continue;
    }

    detectFromAttachmentObject(nested, out, currentAttachmentType);
  }
}

function toDetectedLink(raw: string, source: DetectedLink['source']): DetectedLink {
  const domain = normalizeDomain(raw);
  return { raw, domain, source };
}

export function extractLinks(message: IncomingMessage): DetectedLink[] {
  const links: DetectedLink[] = [];

  const pushTextLinks = (text: string | null | undefined): void => {
    for (const candidate of detectFromText(text ?? '')) {
      links.push(toDetectedLink(candidate, 'text'));
    }
  };

  pushTextLinks(message.body.text);

  if (message.url) {
    links.push(toDetectedLink(normalizeUrlCandidate(message.url), 'message_url'));
  }

  const attachmentCandidates = new Set<string>();

  for (const attachment of message.body.attachments ?? []) {
    detectFromAttachmentObject(attachment, attachmentCandidates);
  }

  for (const markupElement of message.body.markup ?? []) {
    detectFromAttachmentObject(markupElement, attachmentCandidates);
  }

  const linkedMessage = message.link?.message;
  if (linkedMessage) {
    pushTextLinks(linkedMessage.text);

    for (const attachment of linkedMessage.attachments ?? []) {
      detectFromAttachmentObject(attachment, attachmentCandidates);
    }

    for (const markupElement of linkedMessage.markup ?? []) {
      detectFromAttachmentObject(markupElement, attachmentCandidates);
    }
  }

  for (const candidate of attachmentCandidates) {
    links.push(toDetectedLink(candidate, 'attachment'));
  }

  return links;
}

export function getForbiddenLinks(message: IncomingMessage, whitelist: string[]): DetectedLink[] {
  const links = extractLinks(message);

  if (links.length === 0) {
    return [];
  }

  return links.filter((link) => {
    if (!link.domain) return true;
    return !isDomainAllowed(link.domain, whitelist);
  });
}
