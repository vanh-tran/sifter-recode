'use client';

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface EditFindingModalProps {
  finding: any;
  currency: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditFindingModal({
  finding,
  currency,
  onClose,
  onSuccess,
}: EditFindingModalProps) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expectedAmount, setExpectedAmount] = useState<string>(finding.expected_amount?.toString() || '');
  const [chargedAmount, setChargedAmount] = useState<string>(finding.charged_amount?.toString() || '');
  const [summary, setSummary] = useState(finding.summary || '');
  const [reasoning, setReasoning] = useState(finding.reasoning || '');
  const [proofProvided, setProofProvided] = useState(finding.proof_provided || false);
  const [proofType, setProofType] = useState(finding.proof_type || '');
  const [requiredProofDescription, setRequiredProofDescription] = useState(finding.required_proof_description || '');

  const [calculatedDelta, setCalculatedDelta] = useState<number | null>(null);
  const [calculatedDeltaPercent, setCalculatedDeltaPercent] = useState<number | null>(null);

  useEffect(() => {
    const expected = expectedAmount === '' ? null : parseFloat(expectedAmount);
    const charged = chargedAmount === '' ? null : parseFloat(chargedAmount);

    if (expected !== null && !isNaN(expected) && charged !== null && !isNaN(charged)) {
      const delta = charged - expected;
      setCalculatedDelta(delta);

      if (expected !== 0) {
        setCalculatedDeltaPercent((delta / expected) * 100);
      } else {
        setCalculatedDeltaPercent(null);
      }
    } else {
      setCalculatedDelta(null);
      setCalculatedDeltaPercent(null);
    }
  }, [expectedAmount, chargedAmount]);

  const formatCurrency = (amount: number, currencyCode: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).format(amount);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const updateData: any = {};

      if (expectedAmount !== finding.expected_amount?.toString()) {
        updateData.expected_amount = expectedAmount === '' ? null : parseFloat(expectedAmount);
      }
      if (chargedAmount !== finding.charged_amount?.toString()) {
        updateData.charged_amount = chargedAmount === '' ? null : parseFloat(chargedAmount);
      }
      if (summary !== finding.summary) {
        updateData.summary = summary;
      }
      if (reasoning !== finding.reasoning) {
        updateData.reasoning = reasoning;
      }
      if (proofProvided !== finding.proof_provided) {
        updateData.proof_provided = proofProvided;
      }
      if (proofType !== (finding.proof_type || '')) {
        updateData.proof_type = proofType === '' ? null : proofType;
      }
      if (requiredProofDescription !== (finding.required_proof_description || '')) {
        updateData.required_proof_description = requiredProofDescription === '' ? null : requiredProofDescription;
      }

      if (Object.keys(updateData).length === 0) {
        onClose();
        return;
      }

      const response = await fetch(`/api/findings/${finding.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error('Failed to update finding');
      }

      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onSuccess();
      onClose();
    } catch {
      setError('Failed to update finding');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="mx-4 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-brand-border bg-brand-surface shadow-xl">
        <div className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold text-brand-primary">Edit finding</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-brand-muted hover:text-brand-primary"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-md border border-brand-border bg-brand-destructive-soft p-3 text-sm text-brand-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-brand-primary">
                  Expected Amount ({currency})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={expectedAmount}
                  onChange={(e) => setExpectedAmount(e.target.value)}
                  className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-brand-primary">
                  Charged Amount ({currency})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={chargedAmount}
                  onChange={(e) => setChargedAmount(e.target.value)}
                  className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                  placeholder="0.00"
                />
              </div>
            </div>

            {(calculatedDelta !== null || calculatedDeltaPercent !== null) && (
              <div className="rounded-md border border-brand-border bg-pastel-blue/30 p-3 dark:bg-pastel-blue/10">
                <div className="mb-1 text-sm font-medium text-brand-primary">Calculated values</div>
                <div className="space-y-1 text-sm text-brand-muted">
                  <div>
                    <span className="font-medium text-brand-primary">Delta amount:</span>{' '}
                    {calculatedDelta !== null ? formatCurrency(calculatedDelta, currency) : 'N/A'}
                    {calculatedDelta !== null && calculatedDelta > 0 && (
                      <span className="ml-2 text-pastel-rose-text">(Overcharge)</span>
                    )}
                    {calculatedDelta !== null && calculatedDelta < 0 && (
                      <span className="ml-2 text-pastel-blue-text">(Undercharge)</span>
                    )}
                  </div>
                  {calculatedDeltaPercent !== null && (
                    <div>
                      <span className="font-medium text-brand-primary">Delta percent:</span>{' '}
                      {calculatedDeltaPercent.toFixed(2)}%
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-brand-primary">
                Summary *
              </label>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                required
                className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-brand-primary">
                Reasoning *
              </label>
              <textarea
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                required
                rows={4}
                className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
              />
            </div>

            <div className="border-t border-brand-border pt-4">
              <h3 className="mb-3 text-sm font-medium text-brand-primary">Proof information</h3>

              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="proofProvided"
                    checked={proofProvided}
                    onChange={(e) => setProofProvided(e.target.checked)}
                    className="h-4 w-4 rounded border-brand-border text-[#4f8ef7] focus:ring-[#4f8ef7]"
                  />
                  <label htmlFor="proofProvided" className="ml-2 block text-sm text-brand-primary">
                    Proof provided
                  </label>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-brand-primary">
                    Proof type
                  </label>
                  <input
                    type="text"
                    value={proofType}
                    onChange={(e) => setProofType(e.target.value)}
                    placeholder="e.g., receipt, invoice, bol"
                    className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-brand-primary">
                    Required proof description
                  </label>
                  <textarea
                    value={requiredProofDescription}
                    onChange={(e) => setRequiredProofDescription(e.target.value)}
                    rows={3}
                    placeholder="e.g., BOL must show accessorial code XYZ"
                    className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-brand-border pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-brand-border bg-brand-surface-muted px-4 py-2 text-sm font-medium text-brand-primary hover:bg-brand-background"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn-brand-primary rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
