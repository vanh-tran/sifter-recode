import { describe, it, expect } from 'vitest';
import { assertTransition, VALID_TRANSITIONS } from '@/lib/disputes/state-machine';

describe('dispute state machine', () => {
  it('allows draft → sent', () => {
    expect(() => assertTransition('draft', 'sent')).not.toThrow();
  });

  it('allows sent → carrier_replied', () => {
    expect(() => assertTransition('sent', 'carrier_replied')).not.toThrow();
  });

  it('allows carrier_replied → resolved', () => {
    expect(() => assertTransition('carrier_replied', 'resolved')).not.toThrow();
  });

  it('allows sent → resolved (direct resolution without reply)', () => {
    expect(() => assertTransition('sent', 'resolved')).not.toThrow();
  });

  it('blocks draft → resolved', () => {
    expect(() => assertTransition('draft', 'resolved')).toThrow(/Invalid transition/);
  });

  it('blocks resolved → sent', () => {
    expect(() => assertTransition('resolved', 'sent')).toThrow(/Invalid transition/);
  });

  it('blocks any transition from resolved', () => {
    expect(() => assertTransition('resolved', 'draft')).toThrow(/Invalid transition/);
    expect(() => assertTransition('resolved', 'carrier_replied')).toThrow(/Invalid transition/);
  });

  it('allows editing draft_letter only in draft status', () => {
    expect(() => assertTransition('draft', 'draft')).not.toThrow(); // self = update
  });
});
