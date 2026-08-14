import type { BrowserContext } from 'playwright';

export type SavedStorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

function is104Hostname(hostname: string): boolean {
  return hostname === '104.com.tw' || hostname.endsWith('.104.com.tw');
}

function cookieBelongsTo104(domain: string): boolean {
  return is104Hostname(domain.replace(/^\./, '').toLowerCase());
}

function originBelongsTo104(origin: string): boolean {
  try {
    return is104Hostname(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Cloudflare cookies are ephemeral and tied to TLS sessions; importing stale ones causes immediate 403 blocks. */
function isCloudflareEphemeralCookie(name: string): boolean {
  return name.startsWith('__cf') || name.startsWith('cf_') || name === '_cfuvid';
}

/**
 * A login snapshot needs 104 authentication state only.
 * Ephemeral WAF cookies (like Cloudflare tokens) and unrelated third-party cookies are stripped.
 */
export function filter104StorageState(state: SavedStorageState): SavedStorageState {
  return {
    cookies: state.cookies.filter(
      cookie => cookieBelongsTo104(cookie.domain) && !isCloudflareEphemeralCookie(cookie.name)
    ),
    origins: state.origins.filter(origin => originBelongsTo104(origin.origin)),
  };
}
