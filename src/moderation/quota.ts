export function isQuotaExceeded(currentCount: number, maxPerDay: number): boolean {
  if (maxPerDay <= 0) {
    return false;
  }

  return currentCount > maxPerDay;
}
