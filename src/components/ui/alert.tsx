import { cn } from '../../lib/utils';
import type { HTMLAttributes } from 'react';

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-md border border-muted bg-muted/60 px-4 py-3 text-sm text-muted-foreground', className)} {...props} />;
}
