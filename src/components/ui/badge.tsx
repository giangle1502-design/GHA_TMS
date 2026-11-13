import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-tone-green/15 text-[oklch(0.42_0.11_155)]",
        warning: "border-transparent bg-tone-amber/20 text-[oklch(0.47_0.12_65)]",
        destructive: "border-transparent bg-tone-red/12 text-[oklch(0.5_0.19_25)]",
        info: "border-transparent bg-tone-blue/12 text-[oklch(0.45_0.17_260)]",
        purple: "border-transparent bg-tone-purple/12 text-[oklch(0.45_0.18_295)]",
        teal: "border-transparent bg-tone-teal/15 text-[oklch(0.43_0.09_195)]",
        muted: "border-transparent bg-tone-gray/15 text-[oklch(0.45_0.02_257)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
