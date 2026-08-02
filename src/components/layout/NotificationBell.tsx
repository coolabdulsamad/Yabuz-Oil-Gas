import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Bell, CheckCheck, CheckSquare, Info, MessageSquare, Wallet } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { playSound } from "@/lib/sounds";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * YABUZ OIL & GAS — header notification bell.
 * Polls the notifications feed, pops a sound when a new one lands,
 * shows unread count, and navigates to the linked page on click.
 */

const TYPE_ICON: Record<string, typeof Bell> = {
  CHAT: MessageSquare,
  APPROVAL_REQUEST: CheckSquare,
  APPROVAL_RESULT: CheckSquare,
  PAYMENT: Wallet,
};

function timeAgo(d: Date | string) {
  const date = new Date(d);
  const secs = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

export function NotificationBell() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const unreadQuery = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const listQuery = trpc.notifications.list.useQuery(undefined, {
    refetchInterval: 20000,
  });

  const unread = unreadQuery.data?.count ?? 0;

  // Pop a sound whenever the unread count goes up.
  const prevUnread = useRef<number | null>(null);
  useEffect(() => {
    if (prevUnread.current !== null && unread > prevUnread.current) {
      playSound("notify");
    }
    prevUnread.current = unread;
  }, [unread]);

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.unreadCount.invalidate();
      utils.notifications.list.invalidate();
    },
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.unreadCount.invalidate();
      utils.notifications.list.invalidate();
    },
  });

  const openItem = (n: { id: number; link: string | null; isRead: boolean }) => {
    if (!n.isRead) markRead.mutate({ id: n.id });
    if (n.link) navigate(n.link);
  };

  const items = listQuery.data?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative grid size-10 place-items-center rounded-full text-[#22264B] transition-colors hover:bg-[#22264B]/5"
          title="Notifications"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#F7A026] px-1 text-[10px] font-black text-[#22264B] shadow">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-[#22264B]/10 px-4 py-2.5">
          <p className="text-sm font-bold text-[#22264B]">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-[#22264B]/60"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="mr-1 size-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 && (
            <p className="px-4 py-10 text-center text-xs text-[#22264B]/45">
              No notifications yet — approvals and chat messages will show up here.
            </p>
          )}
          {items.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Info;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                className={`flex w-full items-start gap-3 border-b border-[#22264B]/5 px-4 py-3 text-left transition hover:bg-[#22264B]/[0.04] ${
                  n.isRead ? "opacity-60" : ""
                }`}
              >
                <span
                  className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${
                    n.isRead ? "bg-[#22264B]/5 text-[#22264B]/50" : "bg-[#F7A026]/15 text-[#9a6212]"
                  }`}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-[13px] ${n.isRead ? "font-medium" : "font-bold"} text-[#22264B]`}>
                      {n.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-[#22264B]/40">{timeAgo(n.createdAt)}</span>
                  </span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-[#22264B]/55">{n.body}</span>}
                </span>
                {!n.isRead && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#F7A026]" />}
              </button>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
