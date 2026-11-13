"use client";
import * as React from "react";
import { Dialog as P } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = P.Root;
const DialogTrigger = P.Trigger;
const DialogClose = P.Close;

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <P.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-card p-6 shadow-lg max-h-[90vh] overflow-y-auto",
          className,
        )}
        {...props}
      >
        {/* Nút Đóng luôn nổi ở góc trên khi cuộn hộp thoại dài */}
        <P.Close
          className="sticky top-0 z-20 order-first -mt-2 -mr-2 -mb-12 inline-flex h-8 self-start items-center gap-1 justify-self-end rounded-md border bg-card px-2 py-1 text-sm text-muted-foreground shadow-sm hover:text-foreground"
          aria-label="Đóng"
        >
          <XIcon className="size-4" /> Đóng
        </P.Close>
        {children}
      </P.Content>
    </P.Portal>
  );
}
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 pr-20", className)} {...props} />;
}
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("sticky -bottom-6 z-10 -mx-6 -mb-6 flex flex-col-reverse gap-2 border-t bg-card px-6 py-3 sm:flex-row sm:justify-end", className)} {...props} />;
}
function DialogTitle({ className, ...props }: React.ComponentProps<typeof P.Title>) {
  return <P.Title className={cn("text-lg font-semibold", className)} {...props} />;
}
function DialogDescription({ className, ...props }: React.ComponentProps<typeof P.Description>) {
  return <P.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
