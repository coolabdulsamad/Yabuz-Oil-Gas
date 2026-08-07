import { useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cloudinaryThumb } from "@/lib/cloudinary";
import { ProofUpload, type ProofValue } from "@/components/payments/ProofUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * YABUZ OIL & GAS — expenses & categories.
 * Expenses ride the EXPENSE approval chain (default manager → admin);
 * receipts attach via Cloudinary.
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-amber-600/30 bg-amber-50 text-amber-700",
  APPROVED: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  REJECTED: "border-red-600/30 bg-red-50 text-red-700",
};

/* --------------------------- Record expense dialog --------------------------- */

function RecordExpenseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [formKey, setFormKey] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receipt, setReceipt] = useState<ProofValue | null>(null);

  const sessionKey = open ? 1 : 0;
  if (sessionKey !== formKey) {
    setFormKey(sessionKey);
    if (open) {
      setCategoryId("");
      setAmount("");
      setDescription("");
      setVendor("");
      setPaymentMethod("CASH");
      setExpenseDate(new Date().toISOString().slice(0, 10));
      setReceipt(null);
    }
  }

  const categoriesQuery = trpc.expenses.categories.useQuery(undefined, { enabled: open });
  const createMutation = trpc.expenses.create.useMutation({
    onSuccess: async (r) => {
      toast.success(r.outcome === "APPROVED" ? "Expense approved." : "Expense recorded — waiting for approval.");
      await utils.expenses.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    const amt = Number(amount);
    if (!categoryId) return toast.error("Pick a category.");
    if (!Number.isFinite(amt) || amt <= 0) return toast.error("Enter a valid amount.");
    if (description.trim().length < 3) return toast.error("Describe the expense.");
    if (!expenseDate) return toast.error("Pick the expense date.");
    createMutation.mutate({
      categoryId: Number(categoryId),
      amount: amt,
      description: description.trim(),
      vendor: vendor.trim() || undefined,
      paymentMethod: paymentMethod as "CASH" | "BANK_TRANSFER" | "POS" | "CHEQUE",
      expenseDate,
      receiptUrl: receipt?.url,
      receiptPublicId: receipt?.publicId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record expense</DialogTitle>
          <DialogDescription>Company spending — it counts once the approval chain clears it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Pick…" />
                </SelectTrigger>
                <SelectContent>
                  {(categoriesQuery.data ?? [])
                    .filter((c) => c.isActive)
                    .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (₦)</Label>
              <Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1.5 min-h-16" placeholder="What was this spend for?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vendor (optional)</Label>
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} className="mt-1.5" placeholder="Who was paid?" />
            </div>
            <div>
              <Label>Paid via</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                  <SelectItem value="POS">POS</SelectItem>
                  <SelectItem value="CHEQUE">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Expense date</Label>
              <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block">Receipt (optional)</Label>
            <ProofUpload value={receipt} onChange={(v) => setReceipt(v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#e0901c]" disabled={createMutation.isPending} onClick={submit}>
            {createMutation.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
            Record expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Category editor dialog --------------------------- */

interface EditableCategory {
  id?: number;
  name: string;
  description?: string | null;
  isActive: boolean;
}

function CategoryDialog({ category, onClose }: { category: EditableCategory | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [loaded, setLoaded] = useState<EditableCategory | null>(null);

  if (category !== loaded) {
    setLoaded(category);
    if (category) {
      setName(category.name);
      setDescription(category.description ?? "");
      setIsActive(category.isActive);
    }
  }

  const saveMutation = trpc.expenses.saveCategory.useMutation({
    onSuccess: async () => {
      toast.success("Category saved.");
      await utils.expenses.categories.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={category !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category?.id ? "Edit category" : "New category"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" placeholder="e.g. Transport, Loading, Rent" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1.5 min-h-16" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#e0901c]"
            disabled={name.trim().length < 2 || saveMutation.isPending}
            onClick={() =>
              saveMutation.mutate({ id: category?.id, name: name.trim(), description: description.trim() || undefined, isActive })
            }
          >
            {saveMutation.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Page --------------------------------- */

export default function Expenses() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("expenses.create");
  const canManageCategories = hasPermission("expenses.manage_categories");

  const [tab, setTab] = useState("expenses");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [recordOpen, setRecordOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<EditableCategory | null>(null);
  const [receiptView, setReceiptView] = useState<{ url: string; reference: string } | null>(null);

  const listQuery = trpc.expenses.list.useQuery({
    status: statusFilter === "ALL" ? undefined : (statusFilter as "PENDING" | "APPROVED" | "REJECTED"),
  });
  const categoriesQuery = trpc.expenses.categories.useQuery();
  const rows = listQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Expenses</h2>
          <p className="text-sm text-[#22264B]/55">Company spending with receipts, through the approval chain.</p>
        </div>
        {canCreate && (
          <Button className="bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#e0901c]}" onClick={() => setRecordOpen(true)}>
            <Plus className="mr-1 size-4" /> Record expense
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="mt-4 space-y-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
            </SelectContent>
          </Select>

          <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#22264B]/[0.03]">
                  <TableHead>Reference</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-32 w-full" />
                    </TableCell>
                  </TableRow>
                )}
                {!listQuery.isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-sm text-[#22264B]/50">
                      No expenses recorded yet.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <span className="font-semibold text-[#22264B]">{e.reference}</span>
                      <span className="block text-xs text-[#22264B]/45">by {e.creatorName}</span>
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(e.expenseDate)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/70">{e.categoryName}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="block truncate text-sm" title={e.description}>{e.description}</span>
                      {e.status === "REJECTED" && e.rejectedReason && (
                        <span className="block truncate text-xs text-red-600">{e.rejectedReason}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.vendor ?? "—"}
                      <span className="block text-xs text-[#22264B]/45">
                        {(e.paymentMethod ?? "CASH").toLowerCase().replace("_", " ")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-bold text-[#22264B]">{formatMoney(e.amount)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_STYLES[e.status]}>
                        {e.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {e.receiptUrl ? (
                        <Button variant="outline" size="sm" onClick={() => setReceiptView({ url: e.receiptUrl!, reference: e.reference })}>
                          View
                        </Button>
                      ) : (
                        <span className="text-xs text-[#22264B]/40">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="categories" className="mt-4 space-y-3">
          {canManageCategories && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setCategoryDraft({ name: "", isActive: true })}>
                <Plus className="mr-1 size-4" /> New category
              </Button>
            </div>
          )}
          <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#22264B]/[0.03]">
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Expenses</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageCategories && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoriesQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={canManageCategories ? 5 : 4}>
                      <Skeleton className="h-24 w-full" />
                    </TableCell>
                  </TableRow>
                )}
                {(categoriesQuery.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-semibold text-[#22264B]">{c.name}</TableCell>
                    <TableCell className="max-w-md">
                      <span className="block truncate text-sm text-[#22264B]/70">{c.description ?? "—"}</span>
                    </TableCell>
                    <TableCell className="text-center text-sm">{c.expenseCount}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={c.isActive ? "border-emerald-600/30 bg-emerald-50 text-emerald-700" : "border-[#22264B]/15 bg-[#22264B]/5 text-[#22264B]/45"}>
                        {c.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canManageCategories && (
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => setCategoryDraft(c)}>
                          <Pencil className="mr-1 size-3.5" /> Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!categoriesQuery.isLoading && (categoriesQuery.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canManageCategories ? 5 : 4} className="py-10 text-center text-sm text-[#22264B]/50">
                      No categories yet{canManageCategories ? " — create Transport, Loading, Rent…" : "."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <RecordExpenseDialog open={recordOpen} onClose={() => setRecordOpen(false)} />
      <CategoryDialog category={categoryDraft} onClose={() => setCategoryDraft(null)} />

      <Dialog open={receiptView !== null} onOpenChange={(o) => !o && setReceiptView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Receipt — {receiptView?.reference}</DialogTitle>
            <DialogDescription>{receiptView && formatDateTime(new Date()) && ""}</DialogDescription>
          </DialogHeader>
          {receiptView && (
            <a href={receiptView.url} target="_blank" rel="noreferrer">
              <img src={cloudinaryThumb(receiptView.url, 900)} alt="Receipt" className="max-h-[70vh] w-full rounded-lg object-contain" />
            </a>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
