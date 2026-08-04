import { useState } from "react";
import { Check, Loader2, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
 * YABUZ OIL & GAS — approvals inbox & workflow configuration.
 * "Waiting on me": requests whose current step matches the caller's role.
 * "Workflow chains": Admin/Super Admin set who signs off per entity type.
 */

const REQUEST_STATUS_STYLES: Record<string, string> = {
  PENDING: "border-amber-600/30 bg-amber-50 text-amber-700",
  APPROVED: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  REJECTED: "border-red-600/30 bg-red-50 text-red-700",
  CANCELLED: "border-[#22264B]/15 bg-[#22264B]/5 text-[#22264B]/45",
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  SALE_CREATE: "Sale",
  SALE_CANCEL: "Sale cancellation",
  PAYMENT_RECORD: "Payment",
  DEPOSIT_RECORD: "Deposit",
  DEPOSIT_REFUND: "Deposit refund",
  EXPENSE_CREATE: "Expense",
  PRODUCT_CREATE: "New product",
  PRODUCT_EDIT: "Product edit",
  PRODUCT_DELETE: "Product delete",
  PRICE_LIST_PUBLISH: "Price list",
  STOCK_ADJUSTMENT: "Stock adjustment",
  STOCK_COUNT_APPLY: "Stock count",
  PURCHASE_ORDER: "Purchase order",
  CUSTOMER_CREDIT_LIMIT: "Credit limit",
};

const FLOW_LABELS: Record<string, string> = {
  SALE: "Sales",
  PAYMENT: "Payments",
  DEPOSIT: "Deposits",
  EXPENSE: "Expenses",
  PRODUCT: "Products",
  PRICE_LIST: "Price lists",
  STOCK_ADJUSTMENT: "Stock adjustments",
  STOCK_COUNT: "Stock counts",
  PURCHASE_ORDER: "Purchase orders",
  CUSTOMER_CREDIT: "Customer credit",
  SALE_RETURN: "Sales returns",
  SALE_EXCHANGE: "Sales exchanges",
};

interface RequestRow {
  id: number;
  requestType: string;
  status: string;
  summary: string;
  currentStep: number;
  totalSteps: number;
  createdAt: Date | string;
  requesterName?: string | null;
}

function RequestTable({
  rows,
  loading,
  showRequester,
  emptyText,
  onOpen,
}: {
  rows: RequestRow[];
  loading: boolean;
  showRequester?: boolean;
  emptyText: string;
  onOpen: (id: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-[#22264B]/[0.03]">
            <TableHead>Type</TableHead>
            <TableHead>Summary</TableHead>
            {showRequester && <TableHead>Requested by</TableHead>}
            <TableHead>Progress</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={showRequester ? 7 : 6}>
                <Skeleton className="h-24 w-full" />
              </TableCell>
            </TableRow>
          )}
          {!loading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={showRequester ? 7 : 6} className="py-10 text-center text-sm text-[#22264B]/50">
                {emptyText}
              </TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Badge variant="outline" className="border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/70">
                  {REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType}
                </Badge>
              </TableCell>
              <TableCell className="max-w-md">
                <span className="block truncate text-sm font-semibold text-[#22264B]">{r.summary}</span>
              </TableCell>
              {showRequester && <TableCell className="text-sm">{r.requesterName ?? "—"}</TableCell>}
              <TableCell className="text-sm text-[#22264B]/60">
                Step {r.currentStep} of {r.totalSteps}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={REQUEST_STATUS_STYLES[r.status]}>
                  {r.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-[#22264B]/60">{formatDateTime(r.createdAt)}</TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" onClick={() => onOpen(r.id)}>
                  Review
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------- Review dialog ------------------------- */

interface SalePayloadItem {
  product: string;
  sku: string;
  soldAsUnits: boolean;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
}

function PayloadView({ payload }: { payload: Record<string, unknown> }) {
  const items = Array.isArray(payload.items) ? (payload.items as SalePayloadItem[]) : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        {Object.entries(payload)
          .filter(([k, v]) => k !== "items" && k !== "notes" && v !== null && v !== undefined && v !== "")
          .map(([k, v]) => (
            <div key={k} className="rounded-lg bg-[#22264B]/[0.03] px-3 py-2">
              <span className="block text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">{k}</span>
              <span className="font-semibold text-[#22264B]">
                {typeof v === "number" && /total|price|amount|subtotal/i.test(k) ? formatMoney(v) : String(v)}
              </span>
            </div>
          ))}
      </div>
      {items && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[#22264B]/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#22264B]/[0.03]">
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    <span className="block text-sm font-semibold text-[#22264B]">{i.product}</span>
                    <span className="block text-xs text-[#22264B]/45">{i.sku} · {i.soldAsUnits ? "units" : "packs"}</span>
                  </TableCell>
                  <TableCell className="text-right text-sm">{formatQty(i.quantity)}</TableCell>
                  <TableCell className="text-right text-sm">{formatMoney(i.unitPrice)}</TableCell>
                  <TableCell className="text-right text-sm font-bold">{formatMoney(i.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {typeof payload.notes === "string" && payload.notes.trim() !== "" && (
        <p className="rounded-lg bg-[#22264B]/[0.03] px-3 py-2 text-sm text-[#22264B]/70">
          {payload.notes.replace(/\[mode:[A-Z_]+\]\s?/, "")}
        </p>
      )}
    </div>
  );
}

function ReviewDialog({ requestId, onClose }: { requestId: number | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [note, setNote] = useState("");
  const query = trpc.approvals.getById.useQuery({ id: requestId! }, { enabled: requestId !== null });
  const actMutation = trpc.approvals.act.useMutation({
    onSuccess: async (_r, vars) => {
      toast.success(vars.action === "APPROVE" ? "Approved." : "Rejected.");
      setNote("");
      await utils.approvals.pendingForMe.invalidate();
      await utils.approvals.myRequests.invalidate();
      await utils.approvals.all.invalidate();
      await utils.sales.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const data = query.data;
  return (
    <Dialog open={requestId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{data ? (REQUEST_TYPE_LABELS[data.request.requestType] ?? data.request.requestType) : "Approval request"}</DialogTitle>
          <DialogDescription>{data?.request.summary}</DialogDescription>
        </DialogHeader>
        {query.isLoading && <Skeleton className="h-48 w-full" />}
        {data && (
          <div className="space-y-4">
            <PayloadView payload={data.request.payload} />

            {/* Chain timeline */}
            <div className="space-y-2">
              <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Approval chain</p>
              {data.steps.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-lg border border-[#22264B]/10 px-3 py-2">
                  <span
                    className={`flex size-7 items-center justify-center rounded-full text-xs font-black ${
                      s.status === "APPROVED"
                        ? "bg-emerald-100 text-emerald-700"
                        : s.status === "REJECTED"
                          ? "bg-red-100 text-red-700"
                          : s.status === "PENDING"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-[#22264B]/5 text-[#22264B]/40"
                    }`}
                  >
                    {s.status === "APPROVED" ? <Check className="size-4" /> : s.status === "REJECTED" ? <X className="size-4" /> : s.stepOrder}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#22264B]">{s.role}</p>
                    <p className="text-xs text-[#22264B]/50">
                      {s.status === "APPROVED" || s.status === "REJECTED"
                        ? `${s.status === "APPROVED" ? "Approved" : "Rejected"} by ${s.reviewerName ?? "—"} ${s.actedAt ? `· ${formatDateTime(s.actedAt)}` : ""}`
                        : s.status === "PENDING"
                          ? "Waiting for review"
                          : s.status === "SKIPPED"
                            ? "Skipped"
                            : "Not reached yet"}
                      {s.reviewNote ? ` — “${s.reviewNote}”` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {data.canAct && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="review-note">Note (required to reject)</Label>
                  <Textarea id="review-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional comment for approval; required when rejecting." />
                </div>
                <DialogFooter className="gap-2">
                  <Button
                    variant="destructive"
                    disabled={actMutation.isPending || note.trim().length < 3}
                    onClick={() => actMutation.mutate({ requestId: data.request.id, action: "REJECT", note: note.trim() })}
                  >
                    {actMutation.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <X className="mr-1 size-4" />}
                    Reject
                  </Button>
                  <Button
                    className="bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                    disabled={actMutation.isPending}
                    onClick={() => actMutation.mutate({ requestId: data.request.id, action: "APPROVE", note: note.trim() || undefined })}
                  >
                    {actMutation.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Check className="mr-1 size-4" />}
                    Approve
                  </Button>
                </DialogFooter>
              </>
            )}
            {!data.canAct && data.request.status === "PENDING" && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {data.isRequester
                  ? "Your request is waiting for review."
                  : "This step is waiting on another role."}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------- Workflow chains tab ------------------------- */

function FlowEditor() {
  const utils = trpc.useUtils();
  const flowsQuery = trpc.approvals.flows.useQuery();
  const [drafts, setDrafts] = useState<Record<string, { steps: string[]; isActive: boolean }>>({});
  const setFlowMutation = trpc.approvals.setFlow.useMutation({
    onSuccess: async () => {
      toast.success("Workflow updated.");
      setDrafts({});
      await utils.approvals.flows.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const flows = flowsQuery.data ?? [];
  const valueFor = (entityType: string, steps: string[], isActive: boolean) =>
    drafts[entityType] ?? { steps, isActive };

  const toggleRole = (entityType: string, current: { steps: string[]; isActive: boolean }, role: string) => {
    const has = current.steps.includes(role);
    const next = has ? current.steps.filter((r) => r !== role) : [...current.steps, role];
    // Keep chain order MANAGER → ADMIN.
    next.sort((a, b) => (a === b ? 0 : a === "MANAGER" ? -1 : b === "MANAGER" ? 1 : 0));
    setDrafts((d) => ({ ...d, [entityType]: { ...current, steps: next } }));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-[#22264B]/[0.03]">
            <TableHead>Entity</TableHead>
            <TableHead>Chain (in order)</TableHead>
            <TableHead>Active</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {flowsQuery.isLoading && (
            <TableRow>
              <TableCell colSpan={4}>
                <Skeleton className="h-32 w-full" />
              </TableCell>
            </TableRow>
          )}
          {flows.map((f) => {
            const v = valueFor(f.entityType, f.steps, f.isActive);
            const dirty = drafts[f.entityType] !== undefined;
            return (
              <TableRow key={f.id}>
                <TableCell className="font-semibold text-[#22264B]">{FLOW_LABELS[f.entityType] ?? f.entityType}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    {(["MANAGER", "ADMIN"] as const).map((role) => (
                      <Button
                        key={role}
                        type="button"
                        variant="outline"
                        size="sm"
                        className={v.steps.includes(role) ? "border-[#F7A026] bg-[#F7A026]/10 font-bold text-[#22264B]" : "text-[#22264B]/50"}
                        onClick={() => toggleRole(f.entityType, v, role)}
                      >
                        {v.steps.includes(role) && <Check className="mr-1 size-3.5" />}
                        {role === "MANAGER" ? "Manager" : "Admin"}
                      </Button>
                    ))}
                    <span className="text-xs text-[#22264B]/45">
                      {v.steps.length === 0 ? "No approval — takes effect immediately" : v.steps.join(" → ")}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={v.isActive}
                    onCheckedChange={(checked) => setDrafts((d) => ({ ...d, [f.entityType]: { ...v, isActive: checked } }))}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    className="bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#e0901c]"
                    disabled={!dirty || setFlowMutation.isPending}
                    onClick={() =>
                      setFlowMutation.mutate({
                        entityType: f.entityType as never,
                        steps: v.steps as ("MANAGER" | "ADMIN")[],
                        isActive: v.isActive,
                      })
                    }
                  >
                    Save
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------ Page ------------------------------ */

export default function Approvals() {
  const { hasPermission } = useAuth();
  const canViewAll = hasPermission("approvals.view_all");
  const canEditFlows = hasPermission("settings.workflow");

  const [tab, setTab] = useState("waiting");
  const [myStatus, setMyStatus] = useState<string>("ALL");
  const [openId, setOpenId] = useState<number | null>(null);

  const pendingQuery = trpc.approvals.pendingForMe.useQuery();
  const myQuery = trpc.approvals.myRequests.useQuery(
    myStatus === "ALL" ? undefined : { status: myStatus as "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" },
  );
  const allQuery = trpc.approvals.all.useQuery(undefined, { enabled: canViewAll && tab === "all" });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-[#22264B]">Approvals</h2>
        <p className="text-sm text-[#22264B]/55">
          Review what's waiting on you, track your own requests, and shape the sign-off chains.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="waiting">
            Waiting on me
            {(pendingQuery.data?.length ?? 0) > 0 && (
              <span className="ml-2 rounded-full bg-[#F7A026] px-2 py-0.5 text-xs font-black text-[#22264B]">
                {pendingQuery.data!.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="mine">My requests</TabsTrigger>
          {canViewAll && <TabsTrigger value="all">All requests</TabsTrigger>}
          {canEditFlows && (
            <TabsTrigger value="flows">
              <Settings2 className="mr-1 size-3.5" /> Workflow chains
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="waiting" className="mt-4">
          <RequestTable
            rows={pendingQuery.data ?? []}
            loading={pendingQuery.isLoading}
            showRequester
            emptyText="Nothing waiting on you — all caught up. 🎉"
            onOpen={setOpenId}
          />
        </TabsContent>

        <TabsContent value="mine" className="mt-4 space-y-3">
          <Select value={myStatus} onValueChange={setMyStatus}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["ALL", "PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => (
                <SelectItem key={s} value={s}>{s === "ALL" ? "All statuses" : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <RequestTable
            rows={myQuery.data ?? []}
            loading={myQuery.isLoading}
            emptyText="You haven't raised any requests yet."
            onOpen={setOpenId}
          />
        </TabsContent>

        {canViewAll && (
          <TabsContent value="all" className="mt-4">
            <RequestTable
              rows={allQuery.data ?? []}
              loading={allQuery.isLoading}
              showRequester
              emptyText="No requests in the system yet."
              onOpen={setOpenId}
            />
          </TabsContent>
        )}

        {canEditFlows && (
          <TabsContent value="flows" className="mt-4 space-y-3">
            <p className="text-sm text-[#22264B]/55">
              Choose who must sign off for each entity type, in order. With no roles selected, actions take effect immediately without approval.
            </p>
            <FlowEditor />
          </TabsContent>
        )}
      </Tabs>

      <ReviewDialog requestId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
