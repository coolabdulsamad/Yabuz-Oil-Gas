import { useState } from "react";
import { Link } from "react-router";
import { Building2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { PURCHASE_STATUSES } from "@contracts/constants";

/**
 * YABUZ OIL & GAS — purchasing.
 * Purchase orders to Polar (PENDING → APPROVED → RECEIVED) plus the
 * supplier directory, as two tabs.
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-amber-600/30 bg-amber-50 text-amber-700",
  APPROVED: "border-sky-600/30 bg-sky-50 text-sky-700",
  PARTIALLY_RECEIVED: "border-violet-600/30 bg-violet-50 text-violet-700",
  RECEIVED: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export default function Purchases() {
  const { hasPermission } = useAuth();
  const canManageSuppliers = hasPermission("inventory.manage_suppliers");
  const [createOpen, setCreateOpen] = useState(false);
  const [status, setStatus] = useState<string>("all");

  const listQuery = trpc.purchases.list.useQuery({
    status: status === "all" ? undefined : (status as (typeof PURCHASE_STATUSES)[number]),
  });
  const rows = listQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Purchases & Suppliers</h2>
          <p className="text-sm text-[#22264B]/55">
            Order stock from Polar Petrochemicals and track deliveries.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
        >
          <Plus className="size-4" /> New Purchase Order
        </Button>
      </div>

      <Tabs defaultValue="orders">
        <TabsList className="bg-[#22264B]/5">
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <Label className="text-xs text-[#22264B]/50">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {PURCHASE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s] ?? s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#22264B]/[0.03]">
                  <TableHead>Reference</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-24 w-full" />
                    </TableCell>
                  </TableRow>
                )}
                {!listQuery.isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-sm text-[#22264B]/50">
                      No purchase orders yet — create one to restock from Polar.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-bold text-[#22264B]">{po.reference}</TableCell>
                    <TableCell className="text-sm">{po.supplierName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_STYLES[po.status] ?? ""}>
                        {STATUS_LABELS[po.status] ?? po.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">{po.lineCount}</TableCell>
                    <TableCell className="text-right text-sm">
                      {formatQty(po.receivedQty)} / {formatQty(po.totalQty)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatMoney(po.totalCost)}</TableCell>
                    <TableCell className="text-sm">{po.expectedAt ? formatDate(po.expectedAt) : "—"}</TableCell>
                    <TableCell className="text-sm">{formatDateTime(po.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/purchases/${po.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4">
          <SuppliersTab canManage={canManageSuppliers} />
        </TabsContent>
      </Tabs>

      <CreatePODialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

/* ---------------------------- CREATE PO DIALOG ---------------------------- */

interface POLine {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
}

function CreatePODialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [formKey, setFormKey] = useState("closed");
  const [supplierId, setSupplierId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<POLine[]>([]);
  const [lineSeq, setLineSeq] = useState(1);

  const sessionKey = open ? "open" : "closed";
  if (sessionKey !== formKey) {
    setFormKey(sessionKey);
    setSupplierId("");
    setExpectedAt("");
    setNotes("");
    setLines([{ key: 0, productId: "", quantity: "", unitCost: "" }]);
    setLineSeq(1);
  }

  const utils = trpc.useUtils();
  const suppliersQuery = trpc.inventory.listSuppliers.useQuery(undefined, { enabled: open });
  const productsQuery = trpc.products.list.useQuery({ status: "ACTIVE" }, { enabled: open });
  const supplierRows = (suppliersQuery.data ?? []).filter((s) => s.isActive);
  const productRows = productsQuery.data ?? [];

  const create = trpc.purchases.create.useMutation({
    onSuccess: () => {
      toast.success("Purchase order created.");
      utils.purchases.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateLine = (key: number, patch: Partial<POLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pickProduct = (key: number, productId: string) => {
    const p = productRows.find((x) => String(x.id) === productId);
    updateLine(key, {
      productId,
      // Pre-fill the unit cost from the product's current producer price.
      unitCost: p && p.costCartonPrice != null ? String(p.costCartonPrice) : "",
    });
  };

  const addLine = () => {
    setLines((prev) => [...prev, { key: lineSeq, productId: "", quantity: "", unitCost: "" }]);
    setLineSeq((s) => s + 1);
  };

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  const valid =
    supplierId !== "" &&
    lines.length > 0 &&
    lines.every((l) => l.productId !== "" && Number(l.quantity) > 0 && Number(l.unitCost) >= 0 && l.unitCost !== "");

  const submit = () => {
    if (!valid) return;
    create.mutate({
      supplierId: Number(supplierId),
      expectedAt: expectedAt || "",
      notes: notes.trim(),
      items: lines.map((l) => ({
        productId: Number(l.productId),
        quantity: Number(l.quantity),
        unitCost: Number(l.unitCost),
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">New Purchase Order</DialogTitle>
          <DialogDescription>
            Order stock from a supplier. Receiving the order adds it to inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose supplier" />
                </SelectTrigger>
                <SelectContent>
                  {supplierRows.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                Expected delivery <span className="text-[#22264B]/40">(optional)</span>
              </Label>
              <Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Order lines</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="size-3.5" /> Add line
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((l) => {
                const lineTotal = (Number(l.quantity) || 0) * (Number(l.unitCost) || 0);
                return (
                  <div key={l.key} className="flex items-center gap-2">
                    <Select value={l.productId} onValueChange={(v) => pickProduct(l.key, v)}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Product" />
                      </SelectTrigger>
                      <SelectContent>
                        {productRows.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name} ({p.sku})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={l.quantity}
                      onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                      placeholder="Qty"
                      className="w-24"
                    />
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={l.unitCost}
                      onChange={(e) => updateLine(l.key, { unitCost: e.target.value })}
                      placeholder="Unit cost ₦"
                      className="w-32"
                    />
                    <span className="w-24 text-right text-sm font-semibold text-[#22264B]">
                      {formatMoney(lineTotal)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="text-right text-sm font-bold text-[#22264B]">Total: {formatMoney(total)}</p>
          </div>

          <div className="space-y-1.5">
            <Label>
              Notes <span className="text-[#22264B]/40">(optional)</span>
            </Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || create.isPending}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            {create.isPending ? "Creating…" : "Create Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ SUPPLIERS TAB ------------------------------ */

interface SupplierForm {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

const EMPTY_SUPPLIER: SupplierForm = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
};

function SuppliersTab({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ id: number | null; form: SupplierForm } | null>(null);

  const suppliersQuery = trpc.inventory.listSuppliers.useQuery();
  const rows = (suppliersQuery.data ?? []).filter((s) =>
    search.trim() ? s.name.toLowerCase().includes(search.trim().toLowerCase()) : true,
  );

  const create = trpc.inventory.createSupplier.useMutation({
    onSuccess: () => {
      toast.success("Supplier created.");
      utils.inventory.listSuppliers.invalidate();
      setEditor(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.inventory.updateSupplier.useMutation({
    onSuccess: () => {
      toast.success("Supplier updated.");
      utils.inventory.listSuppliers.invalidate();
      setEditor(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const setActive = trpc.inventory.setSupplierActive.useMutation({
    onSuccess: () => utils.inventory.listSuppliers.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const saving = create.isPending || update.isPending;

  const submit = () => {
    if (!editor) return;
    if (editor.id === null) {
      create.mutate(editor.form);
    } else {
      update.mutate({ id: editor.id, data: editor.form });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/40" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers…" className="pl-9" />
        </div>
        {canManage && (
          <Button
            onClick={() => setEditor({ id: null, form: EMPTY_SUPPLIER })}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            <Building2 className="size-4" /> Add Supplier
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Supplier</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliersQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!suppliersQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-[#22264B]/50">
                  No suppliers found.
                </TableCell>
              </TableRow>
            )}
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <span className="font-semibold text-[#22264B]">{s.name}</span>
                  {s.address && <span className="block max-w-64 truncate text-xs text-[#22264B]/45">{s.address}</span>}
                </TableCell>
                <TableCell className="text-sm">{s.contactPerson ?? "—"}</TableCell>
                <TableCell className="text-sm">{s.phone ?? "—"}</TableCell>
                <TableCell className="text-sm">{s.email ?? "—"}</TableCell>
                <TableCell className="text-right text-sm">{s.productCount}</TableCell>
                <TableCell>
                  {s.isActive ? (
                    <Badge variant="outline" className="border-emerald-600/30 bg-emerald-50 text-emerald-700">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50">Inactive</Badge>
                  )}
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditor({
                            id: s.id,
                            form: {
                              name: s.name,
                              contactPerson: s.contactPerson ?? "",
                              phone: s.phone ?? "",
                              email: s.email ?? "",
                              address: s.address ?? "",
                              notes: s.notes ?? "",
                            },
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setActive.mutate({ id: s.id, isActive: !s.isActive })}
                      >
                        {s.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editor !== null} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#22264B]">
              {editor?.id === null ? "Add Supplier" : "Edit Supplier"}
            </DialogTitle>
            <DialogDescription>
              Supplier records feed purchase orders and product sourcing.
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Name</Label>
                <Input
                  value={editor.form.name}
                  onChange={(e) => setEditor({ ...editor, form: { ...editor.form, name: e.target.value } })}
                  placeholder="e.g. POLAR PETROCHEMICALS LIMITED"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Contact person</Label>
                <Input
                  value={editor.form.contactPerson}
                  onChange={(e) => setEditor({ ...editor, form: { ...editor.form, contactPerson: e.target.value } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={editor.form.phone}
                  onChange={(e) => setEditor({ ...editor, form: { ...editor.form, phone: e.target.value } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editor.form.email}
                  onChange={(e) => setEditor({ ...editor, form: { ...editor.form, email: e.target.value } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input
                  value={editor.form.address}
                  onChange={(e) => setEditor({ ...editor, form: { ...editor.form, address: e.target.value } })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  value={editor.form.notes}
                  onChange={(e) => setEditor({ ...editor, form: { ...editor.form, notes: e.target.value } })}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!editor || editor.form.name.trim().length < 2 || saving}
              className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
            >
              {saving ? "Saving…" : "Save Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
