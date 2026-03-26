'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { findingTypeToLabel } from '@/lib/finding-type-labels';

export default function FindingTagFilter() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tag = searchParams.get('tag');
  if (!tag) return null;

  const clear = () => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete('tag');
    const q = p.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  };

  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-sm text-brand-muted">Filtered by:</span>
      <span className="inline-flex items-center gap-1 rounded-full border border-brand-border bg-brand-surface-muted px-3 py-1 text-sm">
        {findingTypeToLabel(tag)}
        <button
          type="button"
          onClick={clear}
          className="ml-1 text-brand-muted hover:text-brand-primary"
          aria-label="Clear tag filter"
        >
          ×
        </button>
      </span>
    </div>
  );
}
