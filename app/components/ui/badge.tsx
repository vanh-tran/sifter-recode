import * as React from 'react';

import { cn } from '@/lib/utils';

const Badge = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors',
      className
    )}
    {...props}
  />
));
Badge.displayName = 'Badge';

/** Dot indicator for status badges. Use with badge-in-progress, badge-blocked, badge-completed. */
const BadgeIndicator = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & {
    variant?: 'in-progress' | 'blocked' | 'completed';
  }
>(({ className, variant = 'in-progress', ...props }, ref) => (
  <span
    ref={ref}
    aria-hidden="true"
    className={cn(
      'size-1.5 shrink-0 rounded-full',
      variant === 'in-progress' && 'bg-brand-warning',
      variant === 'blocked' && 'bg-brand-destructive',
      variant === 'completed' && 'bg-brand-success',
      className
    )}
    {...props}
  />
));
BadgeIndicator.displayName = 'BadgeIndicator';

export { Badge, BadgeIndicator };
