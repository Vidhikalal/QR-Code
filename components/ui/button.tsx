import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-solid font-mono text-base font-bold no-underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring/60 disabled:pointer-events-none disabled:opacity-60 aria-invalid:border-destructive motion-safe:active:scale-[0.97] motion-safe:transition-[background-color,border-color,color,transform] motion-safe:duration-160 motion-safe:ease-out',
  {
    variants: {
      variant: {
        default: 'border-2 border-primary/60 bg-primary/5 text-primary hover:border-primary hover:bg-primary hover:text-primary-foreground',
        destructive: 'border-destructive/60 bg-destructive/5 text-destructive hover:border-destructive hover:bg-destructive hover:text-destructive-foreground',
        outline: 'rounded-sm border-border bg-transparent text-foreground hover:border-primary/60 hover:text-primary',
        secondary: 'border-border bg-secondary text-secondary-foreground hover:border-primary/60 hover:bg-primary hover:text-primary-foreground',
        ghost: 'border-transparent bg-transparent text-foreground hover:text-primary',
        link: 'border-transparent bg-transparent text-link underline underline-offset-[0.18em] hover:text-primary',
      },
      size: {
        default: 'min-h-11 min-w-11 px-4 py-2',
        sm: 'min-h-11 min-w-11 px-3 py-2 text-sm',
        lg: 'min-h-12 min-w-12 px-6 py-3',
        icon: 'size-11 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
export { Button, buttonVariants };
