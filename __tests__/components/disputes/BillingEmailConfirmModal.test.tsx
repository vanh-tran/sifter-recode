// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BillingEmailConfirmModal from '@/app/components/disputes/BillingEmailConfirmModal';
import React from 'react';

afterEach(() => { cleanup(); });

describe('BillingEmailConfirmModal', () => {
  const defaultProps = {
    carrierName: 'FastFreight Inc.',
    billingEmail: 'billing@fastfreight.com',
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders carrier name and email', () => {
    render(React.createElement(BillingEmailConfirmModal, defaultProps));
    expect(screen.getByText(/FastFreight Inc./)).toBeInTheDocument();
    expect(screen.getByDisplayValue('billing@fastfreight.com')).toBeInTheDocument();
  });

  it('calls onConfirm with current email on Confirm & Send click', () => {
    const onConfirm = vi.fn();
    render(React.createElement(BillingEmailConfirmModal, { ...defaultProps, onConfirm }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & send/i }));
    expect(onConfirm).toHaveBeenCalledWith('billing@fastfreight.com');
  });

  it('calls onConfirm with edited email', () => {
    const onConfirm = vi.fn();
    render(React.createElement(BillingEmailConfirmModal, { ...defaultProps, onConfirm }));
    const input = screen.getByDisplayValue('billing@fastfreight.com');
    fireEvent.change(input, { target: { value: 'ar@fastfreight.com' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm & send/i }));
    expect(onConfirm).toHaveBeenCalledWith('ar@fastfreight.com');
  });

  it('calls onClose on Cancel', () => {
    const onClose = vi.fn();
    render(React.createElement(BillingEmailConfirmModal, { ...defaultProps, onClose }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables Confirm & Send when email is empty', () => {
    render(React.createElement(BillingEmailConfirmModal, { ...defaultProps, billingEmail: '' }));
    expect(screen.getByRole('button', { name: /confirm & send/i })).toBeDisabled();
  });
});
