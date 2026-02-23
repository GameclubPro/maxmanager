export function isQuotaExceeded(currentCount: number, maxPerDay: number): boolean {
  return currentCount > maxPerDay;
}
