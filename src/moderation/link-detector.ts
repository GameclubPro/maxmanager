import { DetectedLink, IncomingMessage } from '../types';
import { isDomainAllowed, normalizeDomain, stripTrailingPunctuation } from '../utils/domain';

const SCHEME_URL_REGEX = /\b([a-z][a-z0-9+.-]{1,31}:\/\/[^\s<>()]+)/gi;
const WWW_URL_REGEX = /\b(www\.[^\s<>()]+)/gi;
const BARE_DOMAIN_REGEX = /(^|[^a-z0-9@_/-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:xn--[a-z0-9-]{2,59}|[a-z]{2,63})(?::\d{2,5})?(?:\/[^\s<>()]*)?)/gi;
const IPV4_WITH_PATH_REGEX = /\b((?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\/[^\s<>()]*)/g;
const HTML_HREF_REGEX = /href\s*=\s*["']([^"']+)["']/gi;
const MEDIA_ATTACHMENT_TYPES = new Set(['image', 'video', 'audio', 'file', 'sticker']);
const MEDIA_ATTACHMENT_URL_KEYS = new Set([
  'url',
  'image_url',
  'preview_url',
  'thumbnail_url',
  'thumb_url',
  'video_url',
  'audio_url',
  'file_url',
  'src',
  'link',
  'href',
  'uri',
  'permalink',
  'message_url',
]);
const MEDIA_ATTACHMENT_TEXT_KEYS = new Set([
  'text',
  'caption',
  'description',
  'title',
  'subtitle',
]);
const FILE_EXTENSION_LIKE_TLDS = new Set([
  'txt', 'doc', 'docx', 'pdf', 'csv', 'xls', 'xlsx', 'ppt', 'pptx',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp',
  'mp3', 'wav', 'ogg', 'mp4', 'avi', 'mkv', 'mov',
  'zip', 'rar', '7z', 'tar', 'gz',
  'json', 'xml', 'yaml', 'yml', 'md',
]);

function countChar(value: string, char: string): number {
  let count = 0;
  for (const item of value) {
    if (item === char) count += 1;
  }
  return count;
}

function stripUnbalancedTrailingPair(value: string, openChar: string, closeChar: string): string {
  let normalized = value;

  while (normalized.endsWith(closeChar) && countChar(normalized, closeChar) > countChar(normalized, openChar)) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function normalizeUrlCandidate(rawCandidate: string): string {
  let normalized = rawCandidate.trim();
  normalized = normalized.replace(/^[<([{"'`]+/g, '');
  normalized = normalized.replace(/[>\])}"'`]+$/g, '');
  normalized = stripUnbalancedTrailingPair(normalized, '(', ')');
  normalized = stripUnbalancedTrailingPair(normalized, '[', ']');
  return stripTrailingPunctuation(normalized);
}

function collectMatches(
  text: string,
  regex: RegExp,
  out: Set<string>,
  validator?: (candidate: string) => boolean,
  captureIndex: number = 1,
): void {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawCandidate = match[captureIndex];
    if (!rawCandidate) continue;

    const candidate = normalizeUrlCandidate(rawCandidate);
    if (!candidate) continue;
    if (validator && !validator(candidate)) continue;
    out.add(candidate);
  }
}

function collectBareDomainMatches(text: string, out: Set<string>): void {
  BARE_DOMAIN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BARE_DOMAIN_REGEX.exec(text)) !== null) {
    const boundary = match[1] ?? '';
    const rawCandidate = match[2];
    if (!rawCandidate) continue;

    // Ignore local parts in emails and filename fragments.
    if (boundary === '@' || boundary === '.') {
      continue;
    }

    const candidate = normalizeUrlCandidate(rawCandidate);
    if (!candidate) continue;

    const startIndex = match.index + boundary.length;
    const endIndex = startIndex + rawCandidate.length;
    const nextChar = text[endIndex] ?? '';

    // Ignore local-part candidate in "name.surname@example.com".
    if (nextChar === '@') {
      continue;
    }

    const normalizedDomain = normalizeDomain(candidate);
    if (!normalizedDomain) continue;

    const labels = normalizedDomain.split('.');
    const tld = labels[labels.length - 1];
    if (FILE_EXTENSION_LIKE_TLDS.has(tld)) {
      continue;
    }

    out.add(candidate);
  }
}

function getCandidateCanonicalKey(candidate: string): string {
  const domain = normalizeDomain(candidate);
  if (!domain) {
    return candidate.toLowerCase();
  }

  try {
    const withProtocol = candidate.includes('://') ? candidate : `http://${candidate}`;
    const parsed = new URL(withProtocol);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${domain}${port}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return `${domain}:${candidate.toLowerCase()}`;
  }
}

function isValidIpv4Candidate(candidate: string): boolean {
  const domain = normalizeDomain(candidate);
  if (!domain) return false;

  const parts = domain.split('.');
  if (parts.length !== 4) return false;

  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function detectFromText(text: string): string[] {
  const out = new Set<string>();

  const normalizedText = text.trim();
  if (!normalizedText) return [];

  collectMatches(normalizedText, SCHEME_URL_REGEX, out);
  collectMatches(normalizedText, WWW_URL_REGEX, out);
  collectBareDomainMatches(normalizedText, out);
  collectMatches(normalizedText, IPV4_WITH_PATH_REGEX, out, isValidIpv4Candidate);
  collectMatches(normalizedText, HTML_HREF_REGEX, out);

  return [...out];
}

function shouldSkipMediaUrlField(currentAttachmentType: string | undefined, key: string): boolean {
  if (!currentAttachmentType || !MEDIA_ATTACHMENT_TYPES.has(currentAttachmentType)) {
    return false;
  }

  return MEDIA_ATTACHMENT_URL_KEYS.has(key.toLowerCase());
}

function shouldScanMediaStringField(currentAttachmentType: string | undefined, key: string): boolean {
  if (!currentAttachmentType || !MEDIA_ATTACHMENT_TYPES.has(currentAttachmentType)) {
    return true;
  }

  return MEDIA_ATTACHMENT_TEXT_KEYS.has(key.toLowerCase());
}

function detectFromAttachmentObject(
  value: unknown,
  out: Set<string>,
  parentAttachmentType?: string,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      detectFromAttachmentObject(item, out, parentAttachmentType, seen);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  if (seen.has(record)) {
    return;
  }
  seen.add(record);

  const currentAttachmentType = typeof record.type === 'string' ? record.type.toLowerCase() : parentAttachmentType;

  for (const [key, nested] of Object.entries(record)) {
    if (typeof nested === 'string') {
      if (shouldSkipMediaUrlField(currentAttachmentType, key)) {
        continue;
      }

      if (!shouldScanMediaStringField(currentAttachmentType, key)) {
        continue;
      }

      for (const candidate of detectFromText(nested)) {
        out.add(candidate);
      }
      continue;
    }

    detectFromAttachmentObject(nested, out, currentAttachmentType, seen);
  }
}

function toDetectedLink(raw: string, source: DetectedLink['source']): DetectedLink {
  const domain = normalizeDomain(raw);
  return { raw, domain, source };
}

export function extractLinks(message: IncomingMessage): DetectedLink[] {
  const links: DetectedLink[] = [];
  const seen = new Set<string>();

  const pushLink = (raw: string, source: DetectedLink['source']): void => {
    const normalizedRaw = normalizeUrlCandidate(raw);
    if (!normalizedRaw) return;

    const key = getCandidateCanonicalKey(normalizedRaw);
    if (seen.has(key)) return;
    seen.add(key);
    links.push(toDetectedLink(normalizedRaw, source));
  };

  const pushTextLinks = (text: string | null | undefined): void => {
    for (const candidate of detectFromText(text ?? '')) {
      pushLink(candidate, 'text');
    }
  };

  pushTextLinks(message.body.text);

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

    detectFromAttachmentObject(linkedMessage, attachmentCandidates);
  }

  for (const candidate of attachmentCandidates) {
    pushLink(candidate, 'attachment');
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
