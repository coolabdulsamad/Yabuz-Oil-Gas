import { useMemo, useState } from "react";
import { Building2, Cloud, Save, Wrench } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * YABUZ OIL & GAS — application settings.
 * Grouped forms; the server only returns groups the viewer may edit
 * (business/integrations → settings.business, system → Super Admin).
 */

type SettingRow = {
  key: string;
  value: unknown;
  group: string;
  description: string | null;
  updatedAt: Date;
};

const GROUP_META: Record<string, { title: string; blurb: string; icon: typeof Building2 }> = {
  BUSINESS: {
    title: "Business profile",
    blurb: "Company identity used on receipts, the login screen and reports.",
    icon: Building2,
  },
  INTEGRATIONS: {
    title: "Integrations",
    blurb: "Cloudinary powers product image uploads (arrives with the Products module).",
    icon: Cloud,
  },
  SYSTEM: {
    title: "System",
    blurb: "Core configuration — visible to the Super Admin only.",
    icon: Wrench,
  },
};

export default function Settings() {
  const listQuery = trpc.settings.list.useQuery();

  const groups = useMemo(() => {
    const rows = listQuery.data ?? [];
    const map = new Map<string, SettingRow[]>();
    for (const row of rows) {
      const list = map.get(row.group) ?? [];
      list.push(row);
      map.set(row.group, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [listQuery.data]);

  if (listQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black tracking-tight text-[#22264B]">Settings</h2>
        <p className="mt-0.5 text-sm text-[#22264B]/60">
          Business profile, currency and integrations. Approval chains arrive with the workflow
          module.
        </p>
      </div>

      {groups.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#22264B]/20 bg-white/60 px-6 py-14 text-center text-sm text-[#22264B]/50">
          You don't have permission to change any settings.
        </div>
      )}

      {groups.map(([group, rows]) => (
        <SettingsGroup key={group} group={group} rows={rows} />
      ))}
    </div>
  );
}

function SettingsGroup({ group, rows }: { group: string; rows: SettingRow[] }) {
  const utils = trpc.useUtils();
  const meta = GROUP_META[group] ?? {
    title: group,
    blurb: "",
    icon: Wrench,
  };
  const Icon = meta.icon;

  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, String(r.value ?? "")])),
  );

  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: (r) => {
      toast.success(r.updated > 0 ? `Saved ${r.updated} setting(s).` : "No changes to save.");
      utils.settings.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const dirty = rows.some((r) => String(r.value ?? "") !== (draft[r.key] ?? ""));

  const save = () => {
    const values: Record<string, unknown> = {};
    for (const r of rows) {
      const raw = draft[r.key] ?? "";
      // Numeric settings (e.g. session hours) go back as numbers.
      values[r.key] = typeof r.value === "number" ? Number(raw) || 0 : raw;
    }
    updateMutation.mutate({ values });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-[#22264B]/10 bg-white">
      <header className="flex items-start gap-3 border-b border-[#22264B]/10 bg-[#F4EFE3] px-5 py-4">
        <span className="rounded-lg bg-[#22264B] p-2 text-[#F7A026]">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-bold text-[#22264B]">{meta.title}</h3>
          <p className="mt-0.5 text-xs text-[#22264B]/60">{meta.blurb}</p>
        </div>
      </header>

      <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} className="space-y-1.5">
            <Label htmlFor={`set-${r.key}`} className="text-[#22264B]">
              {labelFor(r.key)}
            </Label>
            <Input
              id={`set-${r.key}`}
              type={typeof r.value === "number" ? "number" : "text"}
              value={draft[r.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
              className="border-[#22264B]/15"
            />
            {r.description && <p className="text-xs text-[#22264B]/50">{r.description}</p>}
          </div>
        ))}
      </div>

      <footer className="flex justify-end border-t border-[#22264B]/10 px-5 py-3">
        <Button
          onClick={save}
          disabled={!dirty || updateMutation.isPending}
          className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
        >
          <Save className="mr-2 h-4 w-4" />
          {updateMutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </footer>
    </section>
  );
}

/** "business.name" → "Name"; "sales.currency_symbol" → "Currency symbol". */
function labelFor(key: string): string {
  const leaf = key.split(".").pop() ?? key;
  return leaf
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
