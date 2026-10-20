import { describe, expect, it } from 'vitest';
import { findPrivateChats } from '../src/telegram';

describe('findPrivateChats', () => {
  it('略過沒有 message 的更新，而不是拋出例外', () => {
    const updates = [
      { update_id: 1, my_chat_member: { chat: { id: 9, type: 'private' } } },
      { update_id: 2, message: { chat: { id: 42, type: 'private', username: 'me' } } },
    ];
    expect(findPrivateChats(updates).map(chat => chat.id)).toEqual([42]);
  });

  it('排除群組對話，避免把投遞紀錄送進群組', () => {
    const updates = [
      { update_id: 1, message: { chat: { id: -100, type: 'group' } } },
      { update_id: 2, message: { chat: { id: -200, type: 'supergroup' } } },
    ];
    expect(findPrivateChats(updates)).toEqual([]);
  });

  it('列出所有私訊對話（新到舊、不重複），交由使用者選擇', () => {
    const updates = [
      { update_id: 1, message: { chat: { id: 1, type: 'private' } } },
      { update_id: 2, message: { chat: { id: 2, type: 'private' } } },
      { update_id: 3, edited_message: { chat: { id: 1, type: 'private' } } },
    ];
    expect(findPrivateChats(updates).map(chat => chat.id)).toEqual([1, 2]);
  });
});
