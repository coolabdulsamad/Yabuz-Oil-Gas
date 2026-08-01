import { useMemo, useState } from "react";
import { ShieldCheck, UserCog } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { ROLE_LABELS, type UserRole } from "@contracts/roles";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { cn } from "@/lib/utils";

/**
 * YABUZ OIL & GAS — roles & permissions.
 * Tab 1: the role matrix — what each role can do (Super Admin is immutable).
 * Tab 2: per-user overrides — grant or revoke one key for one person,
 *        on top of their role. Overrides sign the user out to take effect.
 */

type OverrideMode = "inherit" | "grant" | "revoke";

export default function Permissions() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-[#22264B]">Roles & Permissions</h2>
        <p className="mt-0.5 text-sm text-[#22264B]/60">
          Control exactly what each role can do — and make exceptions for individual people.
        </p>
      </div>

      <Tabs defaultValue="roles">
        <TabsList className="bg-[#22264B]/5">
          <TabsTrigger value="roles">
            <ShieldCheck className="mr-2 h-4 w-4" /> Role permissions
          </TabsTrigger>
          <TabsTrigger value="overrides">
            <UserCog className="mr-2 h-4 w-4" /> User overrides
          </TabsTrigger>
        </TabsList>
        <TabsContent value="roles" className="mt-5">
          <RoleMatrix />
        </TabsContent>
        <TabsContent value="overrides" className="mt-5">
          <UserOverrides />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================ ROLE MATRIX ============================ */

function RoleMatrix() {
  const utils = trpc.useUtils();
  const matrixQuery = trpc.access.roleMatrix.useQuery();
  const toggleMutation = trpc.access.setRolePermission.useMutation({
    onSuccess: () => utils.access.roleMatrix.invalidate(),
    onError: (e) => {
      toast.error(e.message);
      utils.access.roleMatrix.invalidate();
    },
  });

  const groups = useMemo(() => {
    const defs = matrixQuery.data?.permissions ?? [];
    const map = new Map<string, typeof defs>();
    for (const def of defs) {
      const list = map.get(def.group) ?? [];
      list.push(def);
      map.set(def.group, list);
    }
    return [...map.entries()];
  }, [matrixQuery.data]);

  if (matrixQuery.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  const data = matrixQuery.data!;
  const editable = data.editableRoles as UserRole[];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#F7A026]/40 bg-[#F7A026]/10 px-4 py-3 text-sm text-[#22264B]">
        <strong>Super Admin</strong> always has every permission and can't be edited — that's the
        developer safety net. Changes below apply to everyone in the role on their next action.
      </div>

      {groups.map(([group, defs]) => (
        <section key={group} className="overflow-hidden rounded-2xl border border-[#22264B]/10 bg-white">
          <header className="border-b border-[#22264B]/10 bg-[#F4EFE3] px-5 py-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[#22264B]">{group}</h3>
          </header>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[#22264B]">Permission</TableHead>
                {editable.map((role) => (
                  <TableHead key={role} className="w-28 text-center text-[#22264B]">
                    {ROLE_LABELS[role]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {defs.map((def) => (
                <TableRow key={def.key}>
                  <TableCell>
                    <p className="font-medium text-[#22264B]">{def.label}</p>
                    <p className="mt-0.5 text-xs text-[#22264B]/55">{def.description}</p>
                  </TableCell>
                  {editable.map((role) => {
                    const on = data.matrix[role]?.[def.key] ?? false;
                    const pending =
                      toggleMutation.isPending &&
                      toggleMutation.variables?.role === role &&
                      toggleMutation.variables?.permissionKey === def.key;
                    return (
                      <TableCell key={role} className="text-center">
                        <Switch
                          checked={on}
                          disabled={pending || toggleMutation.isPending}
                          onCheckedChange={(allowed) =>
                            toggleMutation.mutate({ role, permissionKey: def.key, allowed })
                          }
                          className="data-[state=checked]:bg-[#F7A026]"
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}

/* ========================== USER OVERRIDES ========================== */

function UserOverrides() {
  const utils = trpc.useUtils();
  const [userId, setUserId] = useState<number | null>(null);

  const staffQuery = trpc.users.list.useQuery();
  const matrixQuery = trpc.access.roleMatrix.useQuery();
  const accessQuery = trpc.access.userAccess.useQuery(
    { userId: userId! },
    { enabled: userId !== null },
  );

  const overrideMutation = trpc.access.setUserOverride.useMutation({
    onSuccess: (_r, v) => {
      toast.success(
        v.allowed === null
          ? "Override cleared — role default restored."
          : v.allowed
            ? "Permission granted for this user only."
            : "Permission revoked for this user only.",
      );
      utils.access.userAccess.invalidate({ userId: v.userId });
    },
    onError: (e) => toast.error(e.message),
  });

  const candidates = (staffQuery.data ?? []).filter((u) => u.role !== "SUPER_ADMIN");

  const groups = useMemo(() => {
    if (!accessQuery.data) return [];
    const roleBase = new Set(accessQuery.data.roleBase);
    const overrides = new Map(accessQuery.data.overrides.map((o) => [o.permissionKey, o.allowed]));

    // The permission catalog is shared with the role matrix tab.
    const defs = matrixQuery.data?.permissions ?? [];
    const map = new Map<string, { def: (typeof defs)[number]; state: OverrideMode; effective: boolean; roleOn: boolean }[]>();
    for (const def of defs) {
      const roleOn = roleBase.has(def.key);
      const ov = overrides.get(def.key);
      const state: OverrideMode = ov === undefined ? "inherit" : ov ? "grant" : "revoke";
      const effective = ov ?? roleOn;
      const list = map.get(def.group) ?? [];
      list.push({ def, state, effective, roleOn });
      map.set(def.group, list);
    }
    return [...map.entries()];
  }, [accessQuery.data, matrixQuery.data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm space-y-1.5">
          <p className="text-sm font-medium text-[#22264B]">Staff member</p>
          <Select
            value={userId !== null ? String(userId) : ""}
            onValueChange={(v) => setUserId(Number(v))}
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Choose someone to customize…" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.fullName} — {ROLE_LABELS[u.role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {accessQuery.data && (
          <div className="flex items-center gap-3 rounded-xl border border-[#22264B]/10 bg-white px-4 py-2.5">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-[#22264B] text-xs font-bold text-[#F7A026]">
                {accessQuery.data.user.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-semibold text-[#22264B]">{accessQuery.data.user.fullName}</p>
              <p className="text-xs text-[#22264B]/55">
                @{accessQuery.data.user.username} · {ROLE_LABELS[accessQuery.data.user.role as UserRole]} ·{" "}
                {accessQuery.data.user.staffCode}
              </p>
            </div>
          </div>
        )}
      </div>

      {userId === null && (
        <div className="rounded-2xl border border-dashed border-[#22264B]/20 bg-white/60 px-6 py-14 text-center text-sm text-[#22264B]/50">
          Pick a staff member above to grant or revoke individual permissions on top of their role.
        </div>
      )}

      {accessQuery.isLoading && userId !== null && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {accessQuery.data && (
        <div className="space-y-6">
          <div className="rounded-xl border border-[#22264B]/10 bg-[#F4EFE3] px-4 py-3 text-sm text-[#22264B]/80">
            <strong>Inherit</strong> follows the role default. <strong>Grant</strong> gives this
            person a permission their role lacks. <strong>Revoke</strong> takes one away. Any change
            signs them out so it takes effect immediately.
          </div>

          {groups.map(([group, rows]) => (
            <section
              key={group}
              className="overflow-hidden rounded-2xl border border-[#22264B]/10 bg-white"
            >
              <header className="border-b border-[#22264B]/10 bg-[#F4EFE3] px-5 py-3">
                <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[#22264B]">{group}</h3>
              </header>
              <div className="divide-y divide-[#22264B]/5">
                {rows.map(({ def, state, effective, roleOn }) => (
                  <div
                    key={def.key}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-[#22264B]">{def.label}</p>
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-0 text-[11px]",
                            effective
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700",
                          )}
                        >
                          {effective ? "Allowed" : "Blocked"}
                        </Badge>
                        {state !== "inherit" && (
                          <Badge className="border-0 bg-[#F7A026]/15 text-[11px] text-[#8a5a00] hover:bg-[#F7A026]/20">
                            {state === "grant" ? "Override: granted" : "Override: revoked"}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-[#22264B]/55">
                        {def.description} · Role default: {roleOn ? "on" : "off"}
                      </p>
                    </div>
                    <div className="flex overflow-hidden rounded-lg border border-[#22264B]/15 text-xs font-semibold">
                      {(
                        [
                          ["inherit", "Inherit"],
                          ["grant", "Grant"],
                          ["revoke", "Revoke"],
                        ] as [OverrideMode, string][]
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          disabled={overrideMutation.isPending}
                          onClick={() =>
                            accessQuery.data &&
                            overrideMutation.mutate({
                              userId: accessQuery.data.user.id,
                              permissionKey: def.key,
                              allowed: mode === "inherit" ? null : mode === "grant",
                            })
                          }
                          className={cn(
                            "px-3 py-1.5 transition-colors disabled:opacity-50",
                            state === mode
                              ? mode === "grant"
                                ? "bg-emerald-600 text-white"
                                : mode === "revoke"
                                  ? "bg-red-600 text-white"
                                  : "bg-[#22264B] text-white"
                              : "bg-white text-[#22264B]/60 hover:bg-[#22264B]/5",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
