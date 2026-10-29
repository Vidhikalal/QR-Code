import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-solid font-sans text-base font-semibold no-underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60 aria-invalid:border-destructive motion-safe:active:scale-[0.97] motion-safe:transition-transform motion-safe:duration-120 motion-safe:ease-out',
  {
    variants: {
      variant: {
        default: 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'border-destructive bg-destructive text-primary-foreground hover:bg-destructive/90',
        outline: 'border-primary bg-transparent text-primary hover:bg-primary/10',
        secondary: 'border-border bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'border-transparent bg-transparent text-foreground hover:bg-secondary',
        link: 'border-transparent bg-transparent text-link underline underline-offset-4 hover:text-foreground',
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
