'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle, AlertTriangle, Upload } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

export interface RateSheet {
  id: string;
  filename: string;
  effective_date: string | null;
  status: 'current' | 'superseded';
}

export interface Carrier {
  id: string;
  name: string;
  scac: string | null;
  billing_email: string | null;
  billing_email_confirmed: boolean;
  invoice_count: number;
  rate_sheets: RateSheet[];
}

interface CarrierCardProps {
  carrier: Carrier;
  canManage: boolean;
}

export function CarrierCard({ carrier, canManage }: CarrierCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [billingEmail, setBillingEmail] = useState(carrier.billing_email ?? '');
  const [dragOver, setDragOver] = useState(false);
  const queryClient = useQueryClient();

  const updateEmail = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch(`/api/carriers/${carrier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_email: email }),
      });
      if (!res.ok) throw new Error('Failed to update email');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['carriers'] }),
  });

  const uploadRateSheet = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/carriers/${carrier.id}/rate-sheets`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['carriers'] }),
  });

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      uploadRateSheet.mutate(file);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadRateSheet.mutate(file);
  }

  const hasCurrentSheet = carrier.rate_sheets.some((s) => s.status === 'current');

  return (
    <div className="border border-brand-border rounded-lg bg-brand-surface overflow-hidden">
      <button
        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-brand-surface-muted transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary font-semibold text-sm uppercase">
          {carrier.name.charAt(0)}
        </div>

        <div className="flex-1 min-w-0">
          <span className="font-medium text-brand-primary truncate block">{carrier.name}</span>
          {carrier.scac && (
            <span className="text-xs text-brand-muted">{carrier.scac}</span>
          )}
        </div>

        <div className="text-sm text-brand-muted w-20 text-right hidden sm:block">
          {carrier.invoice_count} invoice{carrier.invoice_count !== 1 ? 's' : ''}
        </div>

        <div className="flex items-center gap-1.5 w-56 text-sm hidden md:flex">
          {carrier.billing_email ? (
            <>
              <span className="truncate text-brand-primary">{carrier.billing_email}</span>
              {carrier.billing_email_confirmed ? (
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0" />
              )}
            </>
          ) : (
            <span className="text-brand-muted italic">No email</span>
          )}
        </div>

        <div className="w-24 text-right hidden sm:block">
          <span
            className={cn(
              'inline-block px-2 py-0.5 rounded text-xs font-medium',
              hasCurrentSheet
                ? 'bg-green-100 text-green-700'
                : 'bg-orange-100 text-orange-700'
            )}
          >
            {hasCurrentSheet ? 'Current' : 'Missing'}
          </span>
        </div>

        <div className="flex-shrink-0 text-brand-muted ml-2">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-brand-border px-4 py-4 space-y-5 bg-brand-surface-muted/30">
          {canManage && (
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                Billing Email
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  placeholder="billing@carrier.com"
                  className="flex-1 rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
                />
                <button
                  onClick={() => updateEmail.mutate(billingEmail)}
                  disabled={updateEmail.isPending || billingEmail === carrier.billing_email}
                  className="px-4 py-2 rounded-md bg-brand-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
                >
                  {updateEmail.isPending ? 'Saving\u2026' : 'Save'}
                </button>
              </div>
              {updateEmail.isError && (
                <p className="text-xs text-red-600 mt-1">Failed to save email.</p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-brand-muted mb-2 uppercase tracking-wide">
              Rate Sheets
            </p>
            {carrier.rate_sheets.length === 0 ? (
              <p className="text-sm text-brand-muted italic">No rate sheets uploaded.</p>
            ) : (
              <ul className="space-y-1">
                {carrier.rate_sheets.map((sheet) => (
                  <li key={sheet.id} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        'inline-block px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0',
                        sheet.status === 'current'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      )}
                    >
                      {sheet.status === 'current' ? 'Current' : 'Superseded'}
                    </span>
                    <span className="truncate text-brand-primary">{sheet.filename}</span>
                    {sheet.effective_date && (
                      <span className="text-brand-muted flex-shrink-0">
                        eff. {sheet.effective_date}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canManage && (
            <div>
              <p className="text-xs font-medium text-brand-muted mb-2 uppercase tracking-wide">
                Upload Rate Sheet
              </p>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={cn(
                  'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
                  dragOver
                    ? 'border-brand-primary bg-brand-primary/5'
                    : 'border-brand-border hover:border-brand-primary/50'
                )}
              >
                <Upload className="w-6 h-6 mx-auto text-brand-muted mb-2" />
                <p className="text-sm text-brand-muted">
                  Drag &amp; drop a PDF rate sheet here, or{' '}
                  <label className="text-brand-primary cursor-pointer underline">
                    browse
                    <input
                      type="file"
                      accept="application/pdf"
                      className="sr-only"
                      onChange={handleFileInput}
                    />
                  </label>
                </p>
                {uploadRateSheet.isPending && (
                  <p className="text-xs text-brand-muted mt-2">Uploading\u2026</p>
                )}
                {uploadRateSheet.isError && (
                  <p className="text-xs text-red-600 mt-2">Upload failed. Please try again.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
