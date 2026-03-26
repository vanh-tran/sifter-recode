import { inngest } from '@/lib/inngest/client';

const placeholder = inngest.createFunction(
  { id: 'pipeline-placeholder', name: 'Pipeline Placeholder', triggers: [{ event: 'sifter/pipeline.health' }] },
  async () => ({ ok: true })
);

export const inngestFunctions = [placeholder];
