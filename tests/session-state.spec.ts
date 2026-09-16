import { describe, expect, it } from 'vitest';
import { filter104StorageState, SavedStorageState } from '../src/session-state';

function cookie(name: string, domain: string) {
  return {
    name,
    value: 'secret',
    domain,
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
  };
}

const state: SavedStorageState = {
  cookies: [
    cookie('first-party', '.104.com.tw'),
    cookie('login-subdomain', 'login.104.com.tw'),
    cookie('lookalike', 'not104.com.tw'),
    cookie('third-party', '.facebook.com'),
  ],
  origins: [
    { origin: 'https://www.104.com.tw', localStorage: [] },
    { origin: 'https://signin.104.com.tw', localStorage: [] },
    { origin: 'https://not104.com.tw', localStorage: [] },
    { origin: 'https://www.facebook.com', localStorage: [] },
  ],
};

describe('filter104StorageState', () => {
  it('只保留 104 主網域與子網域 Cookie', () => {
    expect(filter104StorageState(state).cookies).toHaveLength(2);
  });

  it('只保留 104 主網域與子網域 localStorage', () => {
    expect(filter104StorageState(state).origins).toHaveLength(2);
  });

  it('不得以字串尾碼誤收 lookalike 網域 Cookie', () => {
    const domains = filter104StorageState(state).cookies.map(c => c.domain);
    expect(domains).not.toContain('not104.com.tw');
  });

  it('不得以字串尾碼誤收 lookalike 網域 localStorage', () => {
    const origins = filter104StorageState(state).origins.map(o => o.origin);
    expect(origins).not.toContain('https://not104.com.tw');
  });

  it('不得保留第三方追蹤網域', () => {
    const domains = filter104StorageState(state).cookies.map(c => c.domain);
    expect(domains).not.toContain('.facebook.com');
  });
});
