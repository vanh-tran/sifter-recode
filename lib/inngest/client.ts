import { Inngest } from 'inngest';
import type { SifterEvents } from './types';

export const inngest = new Inngest<{ id: 'sifter'; events: SifterEvents }>({
  id: 'sifter',
});
