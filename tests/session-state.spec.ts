import { filter104StorageState, SavedStorageState } from '../src/session-state';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run(): void {
  const state: SavedStorageState = {
    cookies: [
      { name: 'first-party', value: 'secret', domain: '.104.com.tw', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' },
      { name: 'login-subdomain', value: 'secret', domain: 'login.104.com.tw', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' },
      { name: 'lookalike', value: 'secret', domain: 'not104.com.tw', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' },
      { name: 'third-party', value: 'secret', domain: '.facebook.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' },
    ],
    origins: [
      { origin: 'https://www.104.com.tw', localStorage: [] },
      { origin: 'https://signin.104.com.tw', localStorage: [] },
      { origin: 'https://not104.com.tw', localStorage: [] },
      { origin: 'https://www.facebook.com', localStorage: [] },
    ],
  };

  console.log('[1/2] Session 快照保留 104 主網域與子網域');
  const filtered = filter104StorageState(state);
  assert(filtered.cookies.length === 2, '應只保留 104 主網域與子網域 Cookie');
  assert(filtered.origins.length === 2, '應只保留 104 主網域與子網域 localStorage');

  console.log('[2/2] 不得以字串尾碼誤收非 104 網域');
  assert(!filtered.cookies.some(cookie => cookie.domain === 'not104.com.tw'), '不得保留 lookalike 網域 Cookie');
  assert(!filtered.origins.some(origin => origin.origin === 'https://not104.com.tw'), '不得保留 lookalike 網域 localStorage');
}

try {
  run();
  console.log('PASS: 104 Session 最小化快照測試完成');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
