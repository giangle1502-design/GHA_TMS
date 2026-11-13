"use client";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Brand } from "@/components/layout/brand";
import type { NavGroup } from "@/lib/navigation";

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Mở menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col bg-sidebar text-sidebar-foreground">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <Brand />
        <SidebarNav groups={groups} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
