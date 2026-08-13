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

/**
 * A login snapshot needs 104 state only. Keeping unrelated third-party
 * cookies or local storage in auth_state.json has no role in 104 login and
 * unnecessarily broadens the sensitivity of the local session file.
 */
export function filter104StorageState(state: SavedStorageState): SavedStorageState {
  return {
    cookies: state.cookies.filter(cookie => cookieBelongsTo104(cookie.domain)),
    origins: state.origins.filter(origin => originBelongsTo104(origin.origin)),
  };
}
