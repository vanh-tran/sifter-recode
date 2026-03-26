import { describe, it, expect } from 'vitest';
import { nextHistoryId } from '@/lib/email/gmail-poller';

describe('nextHistoryId', () => {
  it('returns max history id from response', () => {
    expect(
      nextHistoryId({
        history: [{ id: '10' }, { id: '25' }],
      })
    ).toBe('25');
  });
});
