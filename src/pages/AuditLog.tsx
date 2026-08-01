"use client";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  ScrollText,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * YABUZ OIL & GAS — audit log viewer (audit.view)
 * The full activity trail: every login, permission change, setting update,
 * approval and business action — filterable, with before → after snapshots.
 */

const ROLE_TINT: Record<string, string> = {
  SUPER_ADMIN: "border-purple-600/30 bg-purple-50 text-purple-700",
  ADMIN: "border-[#22264B]/30 bg-[#22264B]/5 text-[#22264B]",
  MANAGER: "border-[#F7A026]/40 bg-[#F7A026]/10 text-[#9a6212]",
  SALES: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
};

const ACTION_TINT = (action: string) => {
  if (action.includes("failed") || action.includes("delete") || action.includes("reject"))
    return "border-red-600/30 bg-red-50 text-red-700";
  if (action.includes("login")) return "border-sky-600/30 bg-sky-50 text-sky-700";
  if (action.includes("create") || action.includes("approve") || action.includes("confirm"))
    return "border-emerald-600/30 bg-emerald-50 text-emerald-700";
  if (action.includes("update") || action.includes("edit") || action.includes("override") || action.includes("permission"))
    return "border-[#F7A026]/40 bg-[#F7A026]/10 text-[#9a6212]";
  return "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/70";
};

function JsonBlock({ title, data, tint }: { title: string; data: unknown; tint: string }) {
  if (data === null || data === undefined) return null;
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#22264B]/45">{title}</p>
      <pre
        className={`max-h-72 overflow-auto rounded-xl border p-3 text-[11px] leading-relaxed ${tint}`}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function DetailDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const detail = trpc.audit.getById.useQuery({ id: id ?? 0 }, { enabled: id !== null });

  return (
    <Dialog open={id !== null} onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-[#F7A026]" />
            Audit entry #{id}
          </DialogTitle>
          <DialogDescription>Full detail of this activity, including data snapshots.</DialogDescription>
        </DialogHeader>
        {detail.isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[#22264B]/40" />
          </div>
        )}
        {detail.data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#22264B]/45">Actor</p>
                <p className="font-semibold text-[#22264B]">{detail.data.actorName}</p>
                <Badge className={`mt-0.5 text-[10px] ${ROLE_TINT[detail.data.actorRole] ?? ""}`}>
                  {detail.data.actorRole.replace(/_/g, " ")}
                </Badge>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#22264B]/45">Action</p>
                <Badge className={`text-[11px] ${ACTION_TINT(detail.data.action)}`}>{detail.data.action}</Badge>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#22264B]/45">Entity</p>
                <p className="font-semibold text-[#22264B]">
                  {detail.data.entityType}
                  {detail.data.entityId ? ` · ${detail.data.entityId}` : ""}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#22264B]/45">Time</p>
                <p className="font-semibold text-[#22264B]">{formatDateTime(detail.data.createdAt)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#22264B]/45">IP address</p>
                <p className="font-mono text-[12px] text-[#22264B]">{detail.data.ipAddress ?? "—"}</p>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#22264B]/45">Device</p>
                <p className="truncate text-[11px] text-[#22264B]/70" title={detail.data.userAgent ?? ""}>
                  {detail.data.userAgent ?? "—"}
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-[#F4EFE3] p-3 text-[13px] text-[#22264B]">
              {detail.data.description}
            </div>
            {(detail.data.beforeData || detail.data.afterData) && (
              <div className="flex flex-col gap-3 sm:flex-row">
                <JsonBlock
                  title="Before"
                  data={detail.data.beforeData}
                  tint="border-red-600/20 bg-red-50/60 text-red-900"
                />
                <JsonBlock
                  title="After"
                  data={detail.data.afterData}
                  tint="border-emerald-600/20 bg-emerald-50/60 text-emerald-900"
                />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AuditLog() {
  useAuth({ redirectOnUnauthenticated: true });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("ALL");
  const [entityType, setEntityType] = useState("ALL");
  const [actorId, setActorId] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);

  const meta = trpc.audit.meta.useQuery();
  const list = trpc.audit.list.useQuery({
    page,
    pageSize: 25,
    search: search.trim() || undefined,
    action: action === "ALL" ? undefined : action,
    entityType: entityType === "ALL" ? undefined : entityType,
    actorId: actorId === "ALL" ? undefined : Number(actorId),
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const hasFilters =
    search.trim() !== "" || action !== "ALL" || entityType !== "ALL" || actorId !== "ALL" || dateFrom !== "" || dateTo !== "";
  const clearFilters = () => {
    setSearch("");
    setAction("ALL");
    setEntityType("ALL");
    setActorId("ALL");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const stats = meta.data?.stats;
  const statCards = [
    { label: "Total events", value: stats?.total ?? 0 },
    { label: "Today", value: stats?.today ?? 0 },
    { label: "Active actors", value: stats?.actors ?? 0 },
    { label: "Failed logins", value: stats?.failedLogins ?? 0, warn: (stats?.failedLogins ?? 0) > 0 },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[#22264B]">Audit Log</h1>
        <p className="text-[13px] text-[#22264B]/55">
          Every action in the system — who, what, when, and exactly what changed.
        </p>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-2xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#22264B]/45">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold ${s.warn ? "text-red-600" : "text-[#22264B]"}`}>
              {meta.isLoading ? "…" : s.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#22264B]/10 bg-white p-3 shadow-sm">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#22264B]/40" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search description, actor, entity…"
            className="pl-9"
          />
        </div>
        <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All actions</SelectItem>
            {(meta.data?.actions ?? []).map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={entityType} onValueChange={(v) => { setEntityType(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Entity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All entities</SelectItem>
            {(meta.data?.entityTypes ?? []).map((e) => (
              <SelectItem key={e} value={e}>{e}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actorId} onValueChange={(v) => { setActorId(v); setPage(1); }}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Actor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All actors</SelectItem>
            {(meta.data?.actors ?? []).map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-[150px]" />
        <span className="text-xs text-[#22264B]/40">to</span>
        <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-[150px]" />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-2xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead className="w-[150px]">Time</TableHead>
              <TableHead className="w-[190px]">Actor</TableHead>
              <TableHead className="w-[190px]">Action</TableHead>
              <TableHead className="w-[150px]">Entity</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading &&
              [1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {list.data?.items.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer hover:bg-[#F7A026]/5"
                onClick={() => setDetailId(row.id)}
              >
                <TableCell className="text-[12px] text-[#22264B]/60">{formatDateTime(row.createdAt)}</TableCell>
                <TableCell>
                  <p className="text-[13px] font-semibold text-[#22264B]">{row.actorName}</p>
                  <Badge className={`mt-0.5 text-[9px] ${ROLE_TINT[row.actorRole] ?? ""}`}>
                    {row.actorRole.replace(/_/g, " ")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={`font-mono text-[10px] ${ACTION_TINT(row.action)}`}>{row.action}</Badge>
                </TableCell>
                <TableCell className="text-[12px] text-[#22264B]/70">
                  {row.entityType}
                  {row.entityId ? <span className="text-[#22264B]/40"> · {row.entityId}</span> : null}
                </TableCell>
                <TableCell className="max-w-[320px] truncate text-[13px] text-[#22264B]/80" title={row.description}>
                  {row.description.includes("Failed login") && (
                    <ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-red-500" />
                  )}
                  {row.description}
                </TableCell>
                <TableCell>
                  <Eye className="h-4 w-4 text-[#22264B]/30" />
                </TableCell>
              </TableRow>
            ))}
            {list.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-[#22264B]/40">
                  No audit entries match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* pagination */}
        {list.data && list.data.pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-[#22264B]/10 px-4 py-3">
            <p className="text-[12px] text-[#22264B]/50">
              Page {list.data.page} of {list.data.pageCount} · {list.data.total.toLocaleString()} entries
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= list.data.pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <DetailDialog id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
