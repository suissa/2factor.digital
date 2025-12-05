import { cn } from '../../lib/utils';
import type { HTMLAttributes } from 'react';

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground', className)} {...props} />;
}
