"use client";
import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/app/auth/actions";

export function UserMenu({ name, email, avatarUrl, roles }: { name: string; email: string; avatarUrl: string | null; roles: string[] }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent outline-none" aria-label="Tài khoản">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="size-8 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials || "?"}</span>
        )}
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-40 truncate text-sm font-medium">{name}</span>
          <span className="block max-w-40 truncate text-xs text-muted-foreground">{roles.join(", ") || "Chưa có vai trò"}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="truncate">{name}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/tai-khoan">
            <UserRound /> Tài khoản của tôi
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut /> Đăng xuất
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
