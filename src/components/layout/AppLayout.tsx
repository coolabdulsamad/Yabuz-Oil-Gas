import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import {
  Bell,
  ChevronDown,
  Fuel,
  LogOut,
  Menu,
  User as UserIcon,
  KeyRound,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { NAV_GROUPS } from "@/lib/nav";
import { LOGIN_PATH } from "@/const";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * YABUZ OIL & GAS — app shell.
 * Deep-navy sidebar + warm paper content area + amber accents.
 * Every nav item is permission-gated: modules a user can't access
 * simply don't exist for them.
 */

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  SALES: "Sales",
};

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-3 px-5 py-5">
      <span className="grid size-10 place-items-center rounded-xl bg-[#F7A026] text-[#22264B]">
        <Fuel className="size-5" strokeWidth={2.4} />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-extrabold tracking-wide text-white">
          YABUZ OIL & GAS
        </span>
        <span className="block text-[11px] font-medium tracking-widest text-[#D7C6AD]/70 uppercase">
          Polar Distributor Suite
        </span>
      </span>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { hasAnyPermission } = useAuth();
  const location = useLocation();

  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-6 yog-sidebar-scroll">
      {NAV_GROUPS.map((group) => {
        const visible = group.items.filter((item) => hasAnyPermission(item.anyOf));
        if (visible.length === 0) return null;
        return (
          <div key={group.label} className="mt-5 first:mt-1">
            <p className="px-3 pb-2 text-[10px] font-bold tracking-[0.18em] text-[#D7C6AD]/50 uppercase">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {visible.map((item) => {
                const active =
                  item.path === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(item.path);
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      onClick={onNavigate}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                        active
                          ? "bg-white/10 text-white"
                          : "text-[#D7C6AD]/60 hover:bg-white/5 hover:text-[#D7C6AD]",
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[#F7A026]" />
                      )}
                      <item.icon
                        className={cn("size-[18px] shrink-0", active && "text-[#F7A026]")}
                        strokeWidth={2.1}
                      />
                      {item.title}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-[#22264B]">
      <Brand />
      <div className="mx-5 h-px bg-white/10" />
      <SidebarNav onNavigate={onNavigate} />
      <div className="border-t border-white/10 px-5 py-3 text-[10.5px] text-[#D7C6AD]/40">
        Authorized distributor — Polar Petrochemicals Ltd
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, logout, isLoggingOut } = useAuth();
  if (!user) return null;
  const initials = user.fullName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 outline-none transition-colors hover:bg-[#22264B]/5">
        <Avatar className="size-9 border-2 border-[#F7A026]/70">
          <AvatarImage src={user.avatarUrl ?? undefined} />
          <AvatarFallback className="bg-[#22264B] text-xs font-bold text-[#F7A026]">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="hidden text-left sm:block">
          <span className="block max-w-[140px] truncate text-[13px] font-semibold leading-tight text-[#22264B]">
            {user.fullName}
          </span>
          <span className="block text-[11px] font-medium leading-tight text-[#22264B]/50">
            {ROLE_BADGE[user.role] ?? user.role}
          </span>
        </span>
        <ChevronDown className="size-4 text-[#22264B]/40" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block text-sm">{user.fullName}</span>
          <span className="text-xs font-normal text-muted-foreground">
            @{user.username} · {user.staffCode ?? "—"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile" className="cursor-pointer">
            <UserIcon className="mr-2 size-4" /> My profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/profile?tab=password" className="cursor-pointer">
            <KeyRound className="mr-2 size-4" /> Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          disabled={isLoggingOut}
          className="cursor-pointer text-red-600 focus:text-red-600"
        >
          <LogOut className="mr-2 size-4" /> {isLoggingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const PAGE_TITLES: Array<[string, string]> = [
  ["/", "Dashboard"],
  ["/approvals", "Approvals"],
  ["/sales", "Sales"],
  ["/payments", "Payments"],
  ["/credit", "Credit Management"],
  ["/deposits", "Advance Deposits"],
  ["/expenses", "Expenses"],
  ["/products", "Products"],
  ["/price-lists", "Price Lists"],
  ["/inventory", "Inventory"],
  ["/purchases", "Purchase Orders"],
  ["/customers", "Customers"],
  ["/users", "Staff Management"],
  ["/reports", "Reports"],
  ["/analytics", "Analytics"],
  ["/chat", "Team Chat"],
  ["/ai", "AI Assistant"],
  ["/permissions", "Roles & Permissions"],
  ["/audit", "Audit Log"],
  ["/settings", "Settings"],
  ["/profile", "My Profile"],
];

export default function AppLayout({ children }: { children?: ReactNode }) {
  const { user, isLoading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: LOGIN_PATH });
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4EFE3]">
        <div className="space-y-3 text-center">
          <Skeleton className="mx-auto size-12 rounded-xl bg-[#22264B]/10" />
          <Skeleton className="h-3 w-40 bg-[#22264B]/10" />
        </div>
      </div>
    );
  }
  if (!user) return null; // redirect in flight

  const title =
    [...PAGE_TITLES]
      .sort((a, b) => b[0].length - a[0].length)
      .find(([p]) => (p === "/" ? location.pathname === "/" : location.pathname.startsWith(p)))?.[1] ??
    "Dashboard";

  return (
    <div className="min-h-screen bg-[#F4EFE3]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] lg:block">
        <Sidebar />
      </aside>

      <div className="lg:pl-[264px]">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[#22264B]/10 bg-[#F4EFE3]/90 px-4 backdrop-blur sm:px-6">
          {/* Mobile sidebar */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button className="grid size-10 place-items-center rounded-lg text-[#22264B] hover:bg-[#22264B]/5 lg:hidden">
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] border-0 p-0">
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <h1 className="text-lg font-extrabold tracking-tight text-[#22264B]">{title}</h1>

          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/approvals"
              className="relative grid size-10 place-items-center rounded-full text-[#22264B] transition-colors hover:bg-[#22264B]/5"
              title="Notifications & approvals"
            >
              <Bell className="size-5" />
            </Link>
            <UserMenu />
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
