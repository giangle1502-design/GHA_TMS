import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:size-4 [&>svg~*]:pl-7", {
  variants: {
    variant: {
      default: "bg-card",
      info: "border-primary/30 bg-primary/5",
      warning: "border-warning/50 bg-warning/10",
      destructive: "border-destructive/40 bg-destructive/5 text-destructive",
      success: "border-success/40 bg-success/10",
    },
  },
  defaultVariants: { variant: "default" },
});

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-1 font-medium", className)} {...props} />;
}
function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
