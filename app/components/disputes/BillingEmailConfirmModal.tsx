'use client';

import { useState } from 'react';
import { Mail, AlertCircle } from 'lucide-react';

interface BillingEmailConfirmModalProps {
  carrierName: string;
  billingEmail: string;
  onConfirm: (confirmedEmail: string) => void;
  onClose: () => void;
}

export default function BillingEmailConfirmModal({
  carrierName,
  billingEmail,
  onConfirm,
  onClose,
}: BillingEmailConfirmModalProps) {
  const [email, setEmail] = useState(billingEmail);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-amber-50 rounded-full">
            <AlertCircle className="w-5 h-5 text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Confirm Billing Email</h3>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Before sending to <strong>{carrierName}</strong> for the first time, please confirm
          the billing email address is correct. This will be saved for future disputes with
          this carrier.
        </p>

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Carrier Billing Email
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="billing@carrier.com"
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Edit if the extracted address is incorrect.
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(email)}
            disabled={!email.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Mail className="w-4 h-4" />
            Confirm &amp; Send
          </button>
        </div>
      </div>
    </div>
  );
}
