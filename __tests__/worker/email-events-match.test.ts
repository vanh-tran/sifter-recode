import { describe, it, expect } from 'vitest';
import { matchInboundEmailToDispute } from '../../worker/src/jobs/email-events';

describe('matchInboundEmailToDispute', () => {
  it('returns the dispute whose email_thread_id matches the inbound thread', () => {
    const disputes = [
      { id: 'd-1', email_thread_id: 'thread-abc', status: 'sent' },
      { id: 'd-2', email_thread_id: 'thread-xyz', status: 'sent' },
    ];
    const result = matchInboundEmailToDispute(disputes, 'thread-abc');
    expect(result?.id).toBe('d-1');
  });

  it('returns null when no dispute matches', () => {
    const disputes = [{ id: 'd-1', email_thread_id: 'thread-abc', status: 'sent' }];
    expect(matchInboundEmailToDispute(disputes, 'thread-no-match')).toBeNull();
  });

  it('returns null when disputes list is empty', () => {
    expect(matchInboundEmailToDispute([], 'thread-abc')).toBeNull();
  });

  it('does not match a resolved dispute', () => {
    const disputes = [{ id: 'd-1', email_thread_id: 'thread-abc', status: 'resolved' }];
    expect(matchInboundEmailToDispute(disputes, 'thread-abc')).toBeNull();
  });
});
