'use client';

import { useQuery } from '@tanstack/react-query';
import { CarrierCard } from '@/app/components/carriers/CarrierCard';
import type { Carrier } from '@/app/components/carriers/CarrierCard';

interface Props {
  canManage: boolean;
}

export default function CarriersClient({ canManage }: Props) {
  const { data, isLoading, isError } = useQuery<{ carriers: Carrier[] }>({
    queryKey: ['carriers'],
    queryFn: async () => {
      const res = await fetch('/api/carriers');
      if (!res.ok) throw new Error('Failed to fetch carriers');
      return res.json();
    },
  });

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-primary">Carriers</h1>
        <p className="text-sm text-brand-muted mt-1">
          Carriers are auto-detected from your invoices. To merge or rename, contact support.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-brand-surface-muted animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-600">Failed to load carriers. Please refresh.</p>
      )}

      {data?.carriers && data.carriers.length === 0 && (
        <div className="text-center py-16 text-brand-muted">
          <p className="text-lg font-medium">No carriers yet</p>
          <p className="text-sm mt-1">Carriers will appear here once invoices are processed.</p>
        </div>
      )}

      {data?.carriers && data.carriers.length > 0 && (
        <div className="space-y-2">
          {data.carriers.map((carrier) => (
            <CarrierCard key={carrier.id} carrier={carrier} canManage={canManage} />
          ))}
        </div>
      )}
    </main>
  );
}
