import { useEffect, useRef, useState } from "react";
import { Bot, ChevronLeft, Loader2, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { MarkdownLite, RefChipList } from "@/components/chat/RefChips";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * YABUZ OIL & GAS — AI assistant
 * A private chat with the business-data assistant. Every answer is computed
 * from live company data (permission-aware) — when an LLM key is configured
 * in Settings → Integrations the replies are additionally polished by the
 * configured model; otherwise the built-in data engine answers directly.
 */

const SUGGESTIONS = [
  "Sales today",
  "Which products are low on stock?",
  "Who owes us money?",
  "What is the price of Polar Elite 4LTS?",
  "Best sellers this month",
  "Payments received this week",
];

export default function AiChat() {
  useAuth({ redirectOnUnauthenticated: true });
  const utils = trpc.useUtils();
  const [activeId, setActiveId] = useState<number | null>(null);
  /** Mobile: show the (empty) thread pane when starting a fresh conversation. */
  const [composing, setComposing] = useState(false);
  const threadVisible = activeId !== null || composing;
  const [question, setQuestion] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const status = trpc.ai.status.useQuery();
  const conversations = trpc.ai.conversations.useQuery();

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

  const messages = trpc.ai.messages.useQuery(
    { conversationId: activeId ?? 0 },
    { enabled: activeId !== null },
  );

  const ask = trpc.ai.ask.useMutation({
    onSuccess: async (r) => {
      setQuestion("");
      if (activeId !== r.conversationId) setActiveId(r.conversationId);
      await Promise.all([utils.ai.messages.invalidate(), utils.ai.conversations.invalidate()]);
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = trpc.ai.remove.useMutation({
    onSuccess: async (_r, vars) => {
      if (vars.id === activeId) setActiveId(null);
      await utils.ai.conversations.invalidate();
      toast.success("Conversation deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = messages.data ?? [];
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [rows.length, ask.isPending]);

  const doAsk = (text?: string) => {
    const q = (text ?? question).trim();
    if (!q || ask.isPending) return;
    ask.mutate({ conversationId: activeId ?? undefined, question: q });
  };

  const active = conversations.data?.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex h-[calc(100vh-7.5rem)] gap-4">
      {/* ---------------- conversation list ---------------- */}
      <aside
        className={`w-full flex-col rounded-2xl border border-[#22264B]/10 bg-white shadow-sm md:flex md:max-w-[280px] ${
          threadVisible ? "hidden" : "flex"
        }`}
      >
        <div className="border-b border-[#22264B]/10 px-4 py-3">
          <Button
            onClick={() => { setActiveId(null); setComposing(true); }}
            className="w-full bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#F7A026]/90"
          >
            <Plus className="mr-1 h-4 w-4" /> New conversation
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.isLoading && (
            <div className="space-y-2 p-2">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {(conversations.data ?? []).map((c) => (
            <div
              key={c.id}
              className={`group flex items-start gap-2 rounded-xl px-3 py-2.5 transition ${
                c.id === activeId ? "bg-[#22264B] text-white" : "hover:bg-[#22264B]/5"
              }`}
            >
              <button type="button" onClick={() => setActiveId(c.id)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-[13px] font-bold">{c.title}</p>
                {c.preview && (
                  <p className={`truncate text-[11px] ${c.id === activeId ? "text-white/60" : "text-[#22264B]/45"}`}>
                    {c.preview}
                  </p>
                )}
              </button>
              <button
                type="button"
                title="Delete conversation"
                onClick={() => remove.mutate({ id: c.id })}
                className={`mt-0.5 opacity-0 transition group-hover:opacity-100 ${
                  c.id === activeId ? "text-white/50 hover:text-red-300" : "text-[#22264B]/30 hover:text-red-500"
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {conversations.data?.length === 0 && (
            <p className="py-8 text-center text-xs text-[#22264B]/40">Your conversations will appear here.</p>
          )}
        </div>
      </aside>

      {/* ---------------- thread ---------------- */}
      <section
        className={`min-w-0 flex-1 flex-col rounded-2xl border border-[#22264B]/10 bg-white shadow-sm md:flex ${
          threadVisible ? "flex" : "hidden"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#22264B]/10 px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { setActiveId(null); setComposing(false); }}
              className="grid size-8 place-items-center rounded-lg text-[#22264B]/60 hover:bg-[#22264B]/5 md:hidden"
              title="Back to conversations"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#22264B]">
              <Sparkles className="h-4 w-4 text-[#F7A026]" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#22264B]">{active?.title ?? "AI Assistant"}</p>
              <p className="text-[11px] text-[#22264B]/50">Answers from live company data — products, sales, customers, stock</p>
            </div>
          </div>
          {status.data && (
            <Badge
              className={
                status.data.llmConfigured
                  ? "border-emerald-600/30 bg-emerald-50 text-emerald-700"
                  : "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/60"
              }
            >
              {status.data.llmConfigured ? `AI-enhanced · ${status.data.model}` : "Built-in data engine"}
            </Badge>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-[#F4EFE3]/50 px-5 py-5">
          {activeId === null || rows.length === 0 ? (
            <div className="mx-auto mt-10 max-w-lg text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-[#22264B]">
                <Bot className="h-8 w-8 text-[#F7A026]" />
              </div>
              <h3 className="text-lg font-bold text-[#22264B]">Ask me anything about the business</h3>
              <p className="mt-1 text-[13px] text-[#22264B]/55">
                I read the live database — stock levels, prices, sales, customer balances, payments and expenses —
                and I only show what your permissions allow.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => doAsk(s)}
                    disabled={ask.isPending}
                    className="rounded-full border border-[#22264B]/15 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#22264B] transition hover:border-[#F7A026] hover:bg-[#F7A026]/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            rows.map((m) =>
              m.role === "USER" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[#22264B] px-4 py-2.5 text-white">
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{m.content}</p>
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-start">
                  <div className="flex max-w-[85%] gap-2.5">
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#22264B]">
                      <Sparkles className="h-3.5 w-3.5 text-[#F7A026]" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm border border-[#22264B]/10 bg-white px-4 py-3 shadow-sm">
                      <MarkdownLite text={m.content} />
                      <RefChipList references={m.references} />
                    </div>
                  </div>
                </div>
              ),
            )
          )}
          {ask.isPending && (
            <div className="flex justify-start">
              <div className="flex max-w-[85%] gap-2.5">
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#22264B]">
                  <Sparkles className="h-3.5 w-3.5 text-[#F7A026]" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-[#22264B]/10 bg-white px-4 py-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#22264B]/50" />
                  <span className="text-[12px] text-[#22264B]/50">Checking the books…</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[#22264B]/10 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  doAsk();
                }
              }}
              placeholder="Ask about stock, prices, sales, customers…"
              rows={1}
              className="max-h-32 min-h-[40px] flex-1 resize-none"
            />
            <Button
              onClick={() => doAsk()}
              disabled={ask.isPending || !question.trim()}
              className="bg-[#22264B] hover:bg-[#22264B]/90"
              size="icon"
            >
              {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] text-[#22264B]/35">
            Enter to send · Answers are computed from live data — figures are always current
          </p>
        </div>
      </section>
    </div>
  );
}
