'use client';

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function Header({ title, subtitle, action }: HeaderProps) {
  return (
    <div className="bg-brand-surface border-b border-brand-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-brand-primary">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-brand-muted">{subtitle}</p>}
          </div>
          {action && (
            <button
              onClick={action.onClick}
              className="btn-brand-primary inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus"
            >
              {action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

