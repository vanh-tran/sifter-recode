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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">
              Edit Finding
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Amount ({currency})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={expectedAmount}
                  onChange={(e) => setExpectedAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Charged Amount ({currency})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={chargedAmount}
                  onChange={(e) => setChargedAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="0.00"
                />
              </div>
            </div>

            {(calculatedDelta !== null || calculatedDeltaPercent !== null) && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="text-sm font-medium text-blue-900 mb-1">Calculated Values:</div>
                <div className="text-sm text-blue-800 space-y-1">
                  <div>
                    <span className="font-medium">Delta Amount:</span>{' '}
                    {calculatedDelta !== null ? formatCurrency(calculatedDelta, currency) : 'N/A'}
                    {calculatedDelta !== null && calculatedDelta > 0 && (
                      <span className="text-red-600 ml-2">(Overcharge)</span>
                    )}
                    {calculatedDelta !== null && calculatedDelta < 0 && (
                      <span className="text-blue-600 ml-2">(Undercharge)</span>
                    )}
                  </div>
                  {calculatedDeltaPercent !== null && (
                    <div>
                      <span className="font-medium">Delta Percent:</span>{' '}
                      {calculatedDeltaPercent.toFixed(2)}%
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Summary *
              </label>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reasoning *
              </label>
              <textarea
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                required
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-medium text-gray-900 mb-3">Proof Information</h3>

              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="proofProvided"
                    checked={proofProvided}
                    onChange={(e) => setProofProvided(e.target.checked)}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <label htmlFor="proofProvided" className="ml-2 block text-sm text-gray-700">
                    Proof Provided
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Proof Type
                  </label>
                  <input
                    type="text"
                    value={proofType}
                    onChange={(e) => setProofType(e.target.value)}
                    placeholder="e.g., receipt, invoice, bol"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Required Proof Description
                  </label>
                  <textarea
                    value={requiredProofDescription}
                    onChange={(e) => setRequiredProofDescription(e.target.value)}
                    rows={3}
                    placeholder="e.g., BOL must show accessorial code XYZ"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
