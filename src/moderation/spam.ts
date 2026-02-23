export function isSpamTriggered(messageCountInWindow: number, threshold: number): boolean {
  return messageCountInWindow >= threshold;
}
