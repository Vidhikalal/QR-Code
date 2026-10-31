import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Native labels preserve implicit associations and checkbox/radio activation.
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="label" className={cn('font-mono text-sm font-medium leading-normal has-[input[type=checkbox]]:inline-flex has-[input[type=checkbox]]:min-h-11 has-[input[type=checkbox]]:items-center has-[input[type=checkbox]]:gap-2 has-[input[type=radio]]:inline-flex has-[input[type=radio]]:min-h-11 has-[input[type=radio]]:items-center has-[input[type=radio]]:gap-2 has-[:disabled]:opacity-60', className)} {...props} />;
}
