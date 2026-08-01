import { useMemo, useState } from "react";
import {
  KeyRound,
  MoreHorizontal,
  Pencil,
  Search,
  UserPlus,
  UserX,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS, type UserRole } from "@contracts/roles";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * YABUZ OIL & GAS — staff management.
 * Directory is hierarchy-filtered server-side: you only see the roles
 * you're allowed to manage (plus yourself).
 */

type StaffRow = {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: "ACTIVE" | "SUSPENDED";
  avatarUrl: string | null;
  staffCode: string | null;
  notes: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

const ROLE_STYLES: Record<UserRole, string> = {
  SUPER_ADMIN: "bg-[#22264B] text-[#F7A026]",
  ADMIN: "bg-[#22264B] text-white",
  MANAGER: "bg-[#F7A026]/15 text-[#8a5a00]",
  SALES: "bg-[#D7C6AD]/40 text-[#22264B]",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface EditorState {
  mode: "create" | "edit";
  user?: StaffRow;
}

export default function Users() {
  const { user: me, hasPermission } = useAuth();
  const canManage = hasPermission("users.manage");
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffRow | null>(null);

  const listQuery = trpc.users.list.useQuery(undefined, { enabled: hasPermission("users.view") });
  const rolesQuery = trpc.users.assignableRoles.useQuery(undefined, { enabled: canManage });

  const invalidate = () => utils.users.list.invalidate();

  const createMutation = trpc.users.create.useMutation({
    onSuccess: (r) => {
      toast.success(`Staff account created — ${r.staffCode}`);
      setEditor(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.users.update.useMutation({
    onSuccess: () => {
      toast.success("Staff account updated.");
      setEditor(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const statusMutation = trpc.users.setStatus.useMutation({
    onSuccess: (_r, v) => {
      toast.success(v.status === "SUSPENDED" ? "Account suspended." : "Account reactivated.");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const resetMutation = trpc.users.resetPassword.useMutation({
    onSuccess: () => {
      toast.success("Password reset. The staff member must log in again.");
      setResetTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const all = listQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.staffCode ?? "").toLowerCase().includes(q),
    );
  }, [listQuery.data, search]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Staff Management</h2>
          <p className="mt-0.5 text-sm text-[#22264B]/60">
            Create accounts, assign roles, suspend access — within your hierarchy.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => setEditor({ mode: "create" })}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            <UserPlus className="mr-2 h-4 w-4" /> Add staff
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#22264B]/40" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, username or staff code…"
          className="border-[#22264B]/15 bg-white pl-9"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[#22264B]/10 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F4EFE3]">
              <TableHead className="text-[#22264B]">Staff member</TableHead>
              <TableHead className="text-[#22264B]">Staff code</TableHead>
              <TableHead className="text-[#22264B]">Role</TableHead>
              <TableHead className="text-[#22264B]">Status</TableHead>
              <TableHead className="text-[#22264B]">Last login</TableHead>
              {canManage && <TableHead className="w-12 text-right text-[#22264B]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: canManage ? 6 : 5 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full max-w-[140px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!listQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canManage ? 6 : 5} className="py-10 text-center text-sm text-[#22264B]/50">
                  No staff found.
                </TableCell>
              </TableRow>
            )}
            {rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9 border border-[#22264B]/10">
                      <AvatarImage src={u.avatarUrl ?? undefined} />
                      <AvatarFallback className="bg-[#22264B] text-xs font-bold text-[#F7A026]">
                        {initials(u.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-[#22264B]">
                        {u.fullName}
                        {u.id === me?.id && (
                          <span className="ml-2 text-xs font-medium text-[#22264B]/50">(you)</span>
                        )}
                      </p>
                      <p className="text-xs text-[#22264B]/55">@{u.username}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-[#22264B]/70">{u.staffCode ?? "—"}</TableCell>
                <TableCell>
                  <Badge className={`${ROLE_STYLES[u.role]} border-0 font-semibold hover:opacity-90`}>
                    {ROLE_LABELS[u.role]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      u.status === "ACTIVE"
                        ? "border-emerald-600/30 bg-emerald-50 text-emerald-700"
                        : "border-red-600/30 bg-red-50 text-red-700"
                    }
                  >
                    {u.status === "ACTIVE" ? "Active" : "Suspended"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-[#22264B]/65">
                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    {u.id !== me?.id && u.role !== "SUPER_ADMIN" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditor({ mode: "edit", user: u })}>
                            <Pencil className="mr-2 h-4 w-4" /> Edit account
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setResetTarget(u)}>
                            <KeyRound className="mr-2 h-4 w-4" /> Reset password
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {u.status === "ACTIVE" ? (
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => statusMutation.mutate({ id: u.id, status: "SUSPENDED" })}
                            >
                              <UserX className="mr-2 h-4 w-4" /> Suspend account
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              className="text-emerald-700"
                              onClick={() => statusMutation.mutate({ id: u.id, status: "ACTIVE" })}
                            >
                              <UserCheck className="mr-2 h-4 w-4" /> Reactivate account
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create / edit dialog */}
      <StaffEditorDialog
        state={editor}
        roles={rolesQuery.data ?? []}
        busy={createMutation.isPending || updateMutation.isPending}
        onClose={() => setEditor(null)}
        onSubmit={(values) => {
          if (editor?.mode === "create") {
            createMutation.mutate({ ...values, password: values.password ?? "" });
          } else if (editor?.user) {
            updateMutation.mutate({
              id: editor.user.id,
              fullName: values.fullName,
              role: values.role,
              email: values.email,
              phone: values.phone,
              notes: values.notes,
            });
          }
        }}
      />

      {/* Reset password dialog */}
      <ResetPasswordDialog
        target={resetTarget}
        busy={resetMutation.isPending}
        onClose={() => setResetTarget(null)}
        onSubmit={(password) => resetTarget && resetMutation.mutate({ id: resetTarget.id, password })}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface FormValues {
  fullName: string;
  username: string;
  role: UserRole;
  password?: string;
  email: string;
  phone: string;
  notes: string;
}

function StaffEditorDialog({
  state,
  roles,
  busy,
  onClose,
  onSubmit,
}: {
  state: EditorState | null;
  roles: UserRole[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: FormValues) => void;
}) {
  const isCreate = state?.mode === "create";
  const u = state?.user;

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<UserRole | "">("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  // Reset the form every time the dialog target changes.
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = state ? `${state.mode}:${state.user?.id ?? "new"}` : null;
  if (key !== lastKey) {
    setLastKey(key);
    setFullName(u?.fullName ?? "");
    setUsername(u?.username ?? "");
    setRole(u?.role ?? "");
    setPassword("");
    setEmail(u?.email ?? "");
    setPhone(u?.phone ?? "");
    setNotes(u?.notes ?? "");
  }

  const valid =
    fullName.trim().length >= 2 &&
    role !== "" &&
    (isCreate ? username.trim().length >= 3 && password.length >= 8 : true);

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">
            {isCreate ? "Add staff member" : `Edit ${u?.fullName}`}
          </DialogTitle>
          <DialogDescription>
            {isCreate
              ? "The account can log in immediately. Share the password securely."
              : "Changing the role signs the staff member out so permissions refresh."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sf-name">Full name</Label>
            <Input id="sf-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Amina Bello" />
          </div>

          {isCreate && (
            <div className="space-y-1.5">
              <Label htmlFor="sf-username">Username</Label>
              <Input id="sf-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. amina" autoComplete="off" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose role" />
              </SelectTrigger>
              <SelectContent>
                {(roles.length > 0 ? roles : (["SALES"] as UserRole[])).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isCreate && (
            <div className="space-y-1.5">
              <Label htmlFor="sf-pass">Initial password</Label>
              <Input id="sf-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" autoComplete="new-password" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="sf-phone">Phone</Label>
            <Input id="sf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sf-email">Email</Label>
            <Input id="sf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sf-notes">Notes</Label>
            <Textarea id="sf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional internal note about this staff member" rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!valid || busy}
            onClick={() =>
              role &&
              onSubmit({ fullName, username, role, password, email, phone, notes })
            }
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            {busy ? "Saving…" : isCreate ? "Create account" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  target,
  busy,
  onClose,
  onSubmit,
}: {
  target: StaffRow | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [lastId, setLastId] = useState<number | null>(null);
  if ((target?.id ?? null) !== lastId) {
    setLastId(target?.id ?? null);
    setPassword("");
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for <strong>{target?.fullName}</strong> (@{target?.username}). They
            will be signed out everywhere immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rp-pass">New password</Label>
          <Input
            id="rp-pass"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            autoComplete="new-password"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={password.length < 8 || busy}
            onClick={() => onSubmit(password)}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            {busy ? "Resetting…" : "Reset password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
