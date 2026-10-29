import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Entrance } from '@/components/motion';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative w-full rounded-lg border border-solid border-border px-4 py-3 text-sm leading-relaxed', {
  variants: { variant: { default: 'bg-card text-card-foreground', destructive: 'bg-card text-destructive' } },
  defaultVariants: { variant: 'default' },
});
export function Alert({ className, variant, asChild = false, ...props }: ComponentProps<'div'> & VariantProps<typeof alertVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'div';
  return <Entrance><Comp data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} /></Entrance>;
}
