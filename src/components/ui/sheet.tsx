"use client";
import * as React from "react";
import { Dialog as P } from "radix-ui";
import { cn } from "@/lib/utils";

const Sheet = P.Root;
const SheetTrigger = P.Trigger;
const SheetClose = P.Close;

function SheetContent({ className, children, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <P.Content
        className={cn("fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-lg data-[state=open]:animate-in data-[state=open]:slide-in-from-left", className)}
        {...props}
      >
        {children}
      </P.Content>
    </P.Portal>
  );
}
const SheetTitle = P.Title;

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle };
