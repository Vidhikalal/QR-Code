import * as React from "react"
import { cn } from "@/lib/utils"


function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default" }) {
  return (
    <div
      className="group/native-select relative w-full min-w-0 has-[select:disabled]:opacity-50"
      data-slot="native-select-wrapper"
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          "min-h-11 w-full min-w-0 appearance-none rounded-md border border-solid border-input bg-card text-foreground px-3 py-2 pr-9 font-mono text-base transition-colors disabled:pointer-events-none disabled:cursor-not-allowed data-[size=sm]:min-h-11 data-[size=sm]:py-1",
          "focus-visible:border-ring/70 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
          className
        )}
        {...props}
      />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground opacity-50 select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      ><path d="m6 9 6 6 6-6" /></svg>
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
