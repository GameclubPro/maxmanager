export function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.!?;:]+$/g, '');
}

export function normalizeDomain(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/\.+$/, '');
  if (!raw) return null;

  try {
    const withProtocol = raw.includes('://') ? raw : `http://${raw}`;
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (!hostname) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function isDomainAllowed(domain: string, whitelist: string[]): boolean {
  const normalizedDomain = domain.toLowerCase();
  return whitelist.some((allowed) => {
    const normalizedAllowed = allowed.toLowerCase();
    return normalizedDomain === normalizedAllowed || normalizedDomain.endsWith(`.${normalizedAllowed}`);
  });
}
