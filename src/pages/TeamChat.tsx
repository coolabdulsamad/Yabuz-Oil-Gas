import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  Check,
  ChevronLeft,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  Trash2,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { RefChipList, type EntityRef } from "@/components/chat/RefChips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * YABUZ OIL & GAS — team chat
 * Direct & group conversations between staff. The "Yabuz Team" group always
 * exists with every active staff member. Messages can carry an entity
 * reference card (product / sale / customer) via the @-picker.
 */

const ROLE_TINT: Record<string, string> = {
  SUPER_ADMIN: "bg-purple-100 text-purple-700",
  ADMIN: "bg-[#22264B] text-white",
  MANAGER: "bg-[#F7A026]/15 text-[#9a6212]",
  SALES: "bg-emerald-100 text-emerald-700",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function timeLabel(d: Date | string) {
  const date = new Date(d);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

function dayLabel(d: Date | string) {
  const date = new Date(d);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" });
}

/* ------------------------------ new chat dialog ------------------------------ */

function NewChatDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: number) => void;
}) {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("direct");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [groupName, setGroupName] = useState("");

  const staff = trpc.chat.staff.useQuery(undefined, { enabled: open });
  const createDirect = trpc.chat.createDirect.useMutation({
    onSuccess: async (r) => {
      await utils.chat.conversations.invalidate();
      onCreated(r.conversationId);
      reset();
    },
    onError: (e) => toast.error(e.message),
  });
  const createGroup = trpc.chat.createGroup.useMutation({
    onSuccess: async (r) => {
      await utils.chat.conversations.invalidate();
      toast.success("Group created");
      onCreated(r.conversationId);
      reset();
    },
    onError: (e) => toast.error(e.message),
  });

  const reset = () => {
    setSearch("");
    setSelected([]);
    setGroupName("");
    onClose();
  };

  const filtered = (staff.data ?? []).filter((s) =>
    s.fullName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : reset())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a conversation</DialogTitle>
          <DialogDescription>Message a colleague directly, or create a group.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="direct">Direct message</TabsTrigger>
            <TabsTrigger value="group">New group</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#22264B]/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff…"
            className="pl-9"
          />
        </div>
        {tab === "group" && (
          <Input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name (e.g. Morning shift)"
          />
        )}
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[#22264B]/10 p-1">
          {staff.isLoading && <Skeleton className="h-10 w-full" />}
          {filtered.map((s) => {
            const isSelected = selected.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  if (tab === "direct") {
                    createDirect.mutate({ userId: s.id });
                  } else {
                    setSelected((prev) =>
                      prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                    );
                  }
                }}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-[#22264B]/5"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-[#22264B] text-[11px] text-white">
                    {initials(s.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#22264B]">{s.fullName}</p>
                  <p className="text-[11px] text-[#22264B]/50">{s.role.replace(/_/g, " ")}</p>
                </div>
                {tab === "group" && isSelected && <Check className="h-4 w-4 text-[#F7A026]" />}
              </button>
            );
          })}
          {staff.data && filtered.length === 0 && (
            <p className="py-6 text-center text-xs text-[#22264B]/40">No staff match "{search}".</p>
          )}
        </div>
        {tab === "group" && (
          <DialogFooter>
            <Button variant="outline" onClick={reset}>
              Cancel
            </Button>
            <Button
              disabled={selected.length === 0 || groupName.trim().length < 2 || createGroup.isPending}
              onClick={() => createGroup.mutate({ name: groupName.trim(), memberIds: selected })}
              className="bg-[#22264B] hover:bg-[#22264B]/90"
            >
              {createGroup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create group ({selected.length})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ entity picker ------------------------------ */

function EntityPicker({
  onPick,
}: {
  onPick: (ref: { type: EntityRef["type"]; id: number; label: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = trpc.chat.searchEntities.useQuery(
    { query },
    { enabled: open && query.trim().length > 0 },
  );

  const pick = (type: EntityRef["type"], id: number, label: string) => {
    onPick({ type, id, label });
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" title="Attach a product, sale or customer">
          <AtSign className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products, customers, sale #…"
          className="mb-2"
        />
        {!query.trim() && (
          <p className="px-2 py-4 text-center text-xs text-[#22264B]/40">
            Type to search products, customers or sale order numbers.
          </p>
        )}
        {search.isFetching && query.trim() && (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-[#22264B]/40" />
          </div>
        )}
        {search.data && (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {search.data.products.length > 0 && (
              <div>
                <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-[#22264B]/40">Products</p>
                {search.data.products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick("PRODUCT", p.id, p.label)}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[#22264B]/5"
                  >
                    <p className="truncate text-xs font-semibold text-[#22264B]">{p.label}</p>
                    <p className="text-[10px] text-[#22264B]/50">{p.sub}</p>
                  </button>
                ))}
              </div>
            )}
            {search.data.customers.length > 0 && (
              <div>
                <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-[#22264B]/40">Customers</p>
                {search.data.customers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pick("CUSTOMER", c.id, c.label)}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[#22264B]/5"
                  >
                    <p className="truncate text-xs font-semibold text-[#22264B]">{c.label}</p>
                    <p className="text-[10px] text-[#22264B]/50">{c.sub}</p>
                  </button>
                ))}
              </div>
            )}
            {search.data.sales.length > 0 && (
              <div>
                <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-[#22264B]/40">Sales</p>
                {search.data.sales.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pick("SALE", s.id, s.label)}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[#22264B]/5"
                  >
                    <p className="truncate text-xs font-semibold text-[#22264B]">{s.label}</p>
                    <p className="text-[10px] text-[#22264B]/50">{s.sub}</p>
                  </button>
                ))}
              </div>
            )}
            {search.data.products.length === 0 &&
              search.data.customers.length === 0 &&
              search.data.sales.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-[#22264B]/40">No matches for "{query}".</p>
              )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------ main page ------------------------------ */

export default function TeamChat() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const utils = trpc.useUtils();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pendingRef, setPendingRef] = useState<{ type: EntityRef["type"]; id: number; label: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMarkedRef = useRef(0);

  const conversations = trpc.chat.conversations.useQuery(undefined, {
    refetchInterval: 5000,
  });

  // auto-select the first conversation once loaded (desktop only — mobile lands on the list)
  useEffect(() => {
    if (
      activeId === null &&
      conversations.data &&
      conversations.data.length > 0 &&
      window.matchMedia("(min-width: 768px)").matches
    ) {
      setActiveId(conversations.data[0].id);
    }
  }, [conversations.data, activeId]);

  const active = useMemo(
    () => conversations.data?.find((c) => c.id === activeId) ?? null,
    [conversations.data, activeId],
  );

  const messages = trpc.chat.messages.useQuery(
    { conversationId: activeId ?? 0 },
    { enabled: activeId !== null, refetchInterval: 3000 },
  );

  const markRead = trpc.chat.markRead.useMutation();
  const sendMessage = trpc.chat.send.useMutation({
    onSuccess: async () => {
      setBody("");
      setPendingRef(null);
      await Promise.all([utils.chat.messages.invalidate(), utils.chat.conversations.invalidate()]);
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMessage = trpc.chat.deleteMessage.useMutation({
    onSuccess: async () => {
      await utils.chat.messages.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // scroll to bottom + mark read on new messages
  const rows = messages.data ?? [];
  const lastId = rows.length > 0 ? rows[rows.length - 1].id : 0;
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (activeId !== null && lastId > 0 && lastId > lastMarkedRef.current) {
      lastMarkedRef.current = lastId;
      markRead.mutate({ conversationId: activeId, messageId: lastId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, activeId]);

  const doSend = () => {
    if (activeId === null) return;
    const text = body.trim();
    if (!text && !pendingRef) return;
    sendMessage.mutate({
      conversationId: activeId,
      body: text || undefined,
      referenceType: pendingRef?.type,
      referenceId: pendingRef?.id,
    });
  };

  const totalUnread = (conversations.data ?? []).reduce((s, c) => s + c.unread, 0);

  return (
    <div className="flex h-[calc(100vh-7.5rem)] gap-4">
      {/* ---------------- conversation list ---------------- */}
      <aside
        className={`w-full flex-col rounded-2xl border border-[#22264B]/10 bg-white shadow-sm md:flex md:max-w-[300px] ${
          activeId !== null ? "hidden" : "flex"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#22264B]/10 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-[#22264B]">Team Chat</h2>
            <p className="text-[11px] text-[#22264B]/50">
              {totalUnread > 0 ? `${totalUnread} unread` : "All caught up"}
            </p>
          </div>
          <Button size="sm" onClick={() => setNewChatOpen(true)} className="bg-[#F7A026] text-[#22264B] hover:bg-[#F7A026]/90">
            <Plus className="mr-1 h-4 w-4" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.isLoading && (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}
          {(conversations.data ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setActiveId(c.id);
                lastMarkedRef.current = 0;
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                c.id === activeId ? "bg-[#22264B] text-white" : "hover:bg-[#22264B]/5"
              }`}
            >
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback
                  className={`text-[11px] ${c.id === activeId ? "bg-[#F7A026] text-[#22264B]" : "bg-[#22264B] text-white"}`}
                >
                  {c.type === "GROUP" ? <UsersIcon className="h-4 w-4" /> : initials(c.title)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] font-bold">{c.title}</p>
                  {c.lastMessage && (
                    <span className={`shrink-0 text-[10px] ${c.id === activeId ? "text-white/60" : "text-[#22264B]/40"}`}>
                      {timeLabel(c.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-[11px] ${c.id === activeId ? "text-white/70" : "text-[#22264B]/50"}`}>
                    {c.lastMessage
                      ? `${c.type === "GROUP" && c.lastMessage.senderName ? `${c.lastMessage.senderName.split(" ")[0]}: ` : ""}${c.lastMessage.preview}`
                      : "No messages yet"}
                  </p>
                  {c.unread > 0 && c.id !== activeId && (
                    <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[#F7A026] px-1 text-[10px] font-bold text-[#22264B]">
                      {c.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
          {conversations.data?.length === 0 && (
            <p className="py-10 text-center text-xs text-[#22264B]/40">No conversations yet — start one!</p>
          )}
        </div>
      </aside>

      {/* ---------------- thread ---------------- */}
      <section
        className={`min-w-0 flex-1 flex-col rounded-2xl border border-[#22264B]/10 bg-white shadow-sm md:flex ${
          activeId !== null ? "flex" : "hidden"
        }`}
      >
        {active ? (
          <>
            <div className="flex items-center gap-3 border-b border-[#22264B]/10 px-5 py-3">
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="grid size-8 place-items-center rounded-lg text-[#22264B]/60 hover:bg-[#22264B]/5 md:hidden"
                title="Back to conversations"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-[#22264B] text-[11px] text-white">
                  {active.type === "GROUP" ? <UsersIcon className="h-4 w-4" /> : initials(active.title)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#22264B]">
                  {active.title}
                  {active.isTeamGroup && (
                    <Badge className="ml-2 border-[#F7A026]/40 bg-[#F7A026]/10 text-[10px] text-[#9a6212]">Everyone</Badge>
                  )}
                </p>
                <p className="text-[11px] text-[#22264B]/50">
                  {active.members.length} member{active.members.length === 1 ? "" : "s"}
                  {active.type === "GROUP" &&
                    ` — ${active.members
                      .slice(0, 4)
                      .map((m) => m.fullName.split(" ")[0])
                      .join(", ")}${active.members.length > 4 ? ` +${active.members.length - 4}` : ""}`}
                </p>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto bg-[#F4EFE3]/50 px-5 py-4">
              {messages.isLoading && (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-2/3" />
                  ))}
                </div>
              )}
              {rows.map((m, idx) => {
                const prev = idx > 0 ? rows[idx - 1] : null;
                const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                const showSender = active.type === "GROUP" && !m.mine && (!prev || prev.senderId !== m.senderId || newDay);
                return (
                  <div key={m.id}>
                    {newDay && (
                      <div className="my-3 flex items-center gap-3">
                        <div className="h-px flex-1 bg-[#22264B]/10" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#22264B]/40">
                          {dayLabel(m.createdAt)}
                        </span>
                        <div className="h-px flex-1 bg-[#22264B]/10" />
                      </div>
                    )}
                    <div className={`group flex ${m.mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
                          m.mine
                            ? "rounded-br-sm bg-[#22264B] text-white"
                            : "rounded-bl-sm border border-[#22264B]/10 bg-white"
                        }`}
                      >
                        {showSender && (
                          <p className="mb-0.5 text-[10px] font-bold text-[#9a6212]">
                            {m.senderName} · <span className="font-normal">{m.senderRole.replace(/_/g, " ")}</span>
                          </p>
                        )}
                        {m.deleted ? (
                          <p className={`text-[13px] italic ${m.mine ? "text-white/50" : "text-[#22264B]/40"}`}>
                            This message was deleted
                          </p>
                        ) : (
                          <>
                            {m.body && <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{m.body}</p>}
                            {m.referenceType && m.referenceId && m.referenceLabel && (
                              <RefChipList
                                references={[{ type: m.referenceType, id: m.referenceId, label: m.referenceLabel }]}
                              />
                            )}
                          </>
                        )}
                        <div className={`mt-0.5 flex items-center justify-end gap-2 ${m.mine ? "text-white/50" : "text-[#22264B]/35"}`}>
                          <span className="text-[9px]">
                            {new Date(m.createdAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {(m.mine || user?.role === "ADMIN" || user?.role === "SUPER_ADMIN" || user?.role === "MANAGER") &&
                            !m.deleted && (
                              <button
                                type="button"
                                title="Delete message"
                                onClick={() => deleteMessage.mutate({ id: m.id })}
                                className="opacity-0 transition group-hover:opacity-100 hover:text-red-500"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {messages.data?.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center text-[#22264B]/30">
                  <MessageSquare className="mb-2 h-10 w-10" />
                  <p className="text-sm">No messages yet — say hello!</p>
                </div>
              )}
            </div>

            {/* ---------------- composer ---------------- */}
            <div className="border-t border-[#22264B]/10 p-3">
              {pendingRef && (
                <div className="mb-2 flex items-center gap-2">
                  <RefChipList references={[pendingRef]} />
                  <button
                    type="button"
                    onClick={() => setPendingRef(null)}
                    className="rounded-full p-1 text-[#22264B]/40 hover:bg-[#22264B]/5 hover:text-red-500"
                    title="Remove reference"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <EntityPicker onPick={(ref) => setPendingRef(ref)} />
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      doSend();
                    }
                  }}
                  placeholder={`Message ${active.title}…`}
                  rows={1}
                  className="max-h-32 min-h-[40px] flex-1 resize-none"
                />
                <Button
                  onClick={doSend}
                  disabled={sendMessage.isPending || (!body.trim() && !pendingRef)}
                  className="bg-[#22264B] hover:bg-[#22264B]/90"
                  size="icon"
                >
                  {sendMessage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="mt-1.5 text-[10px] text-[#22264B]/35">
                Enter to send · Shift+Enter for a new line · @ to attach a product, sale or customer
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-[#22264B]/30">
            <MessageSquare className="mb-3 h-12 w-12" />
            <p className="text-sm font-semibold">Pick a conversation to start chatting</p>
          </div>
        )}
      </section>

      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onCreated={(id) => setActiveId(id)}
      />
    </div>
  );
}
