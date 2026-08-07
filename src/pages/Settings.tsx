import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Bell,
  Boxes,
  Building2,
  Cloud,
  Images,
  ImagePlus,
  Loader2,
  MessageSquare,
  Receipt,
  Save,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Workflow,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { soundsEnabled, setSoundsEnabled } from "@/lib/sounds";
import { cloudinaryThumb, uploadToCloudinary } from "@/lib/cloudinary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * YABUZ OIL & GAS — settings control center.
 * Tabbed like a proper back office: business identity, receipts, inventory,
 * Cloudinary, AI, team chat, notifications, workflow and system. The server
 * only returns the groups the viewer may edit — SYSTEM requires the
 * settings.system permission (Super Admin), the rest need settings.business.
 * "My preferences" is per-device (this browser only).
 */

type SettingRow = {
  key: string;
  value: unknown;
  group: string;
  description: string | null;
  updatedAt: Date;
};

interface TabDef {
  id: string;
  title: string;
  blurb: string;
  icon: typeof Building2;
  /** key prefixes this tab edits; rows are matched by prefix */
  prefixes: string[];
  /** prefixes to exclude (they belong to another tab) */
  exclude?: string[];
}

const TABS: TabDef[] = [
  {
    id: "business",
    title: "Business",
    blurb: "Company identity — printed on receipts and shown on the login screen.",
    icon: Building2,
    prefixes: ["business."],
    exclude: ["business.receipt_footer"],
  },
  {
    id: "sales",
    title: "Sales & Receipts",
    blurb: "Currency, credit rules and the receipt footnote customers see.",
    icon: Receipt,
    prefixes: ["sales.", "business.receipt_footer"],
  },
  {
    id: "inventory",
    title: "Inventory",
    blurb: "Stock alerts and reorder defaults.",
    icon: Boxes,
    prefixes: ["inventory."],
  },
  {
    id: "cloudinary",
    title: "Cloudinary",
    blurb: "Image & proof-of-payment uploads. Cloud name + unsigned preset are required for uploads.",
    icon: Cloud,
    prefixes: ["cloudinary."],
  },
  {
    id: "ai",
    title: "AI Assistant",
    blurb: "The /ai assistant — enable it and optionally connect your own API key.",
    icon: Sparkles,
    prefixes: ["ai."],
  },
  {
    id: "chat",
    title: "Team Chat",
    blurb: "Switch team chat on/off and control who can create groups or delete messages.",
    icon: MessageSquare,
    prefixes: ["chat."],
  },
  {
    id: "notifications",
    title: "Notifications",
    blurb: "The header bell and notification sounds for the whole company.",
    icon: Bell,
    prefixes: ["notifications."],
  },
  {
    id: "system",
    title: "System",
    blurb: "Core configuration — Super Admin only.",
    icon: Wrench,
    prefixes: ["system."],
  },
];

/** Keys rendered as password inputs (masked). */
const SECRET_KEYS = new Set(["cloudinary.api_key", "cloudinary.api_secret", "ai.api_key"]);

export default function Settings() {
  const listQuery = trpc.settings.list.useQuery();
  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  if (listQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-[#22264B]">Settings</h2>
        <p className="mt-0.5 text-sm text-[#22264B]/60">
          Everything that configures the app — pick a tab. Tabs you don't have permission for will say so.
        </p>
      </div>

      <Tabs defaultValue="business">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-[#22264B]/[0.04] p-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-1.5 text-xs font-bold">
              <t.icon className="size-3.5" /> {t.title}
            </TabsTrigger>
          ))}
          <TabsTrigger value="dashboard" className="gap-1.5 text-xs font-bold">
            <Images className="size-3.5" /> Dashboard
          </TabsTrigger>
          <TabsTrigger value="workflow" className="gap-1.5 text-xs font-bold">
            <Workflow className="size-3.5" /> Workflow
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-1.5 text-xs font-bold">
            <Volume2 className="size-3.5" /> My Preferences
          </TabsTrigger>
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.id} value={t.id}>
            <SettingsTab def={t} rows={rows} />
          </TabsContent>
        ))}
        <TabsContent value="dashboard">
          <DashboardBannerTab />
        </TabsContent>
        <TabsContent value="workflow">
          <WorkflowTab />
        </TabsContent>
        <TabsContent value="preferences">
          <PreferencesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------- One settings tab ------------------------------ */

function SettingsTab({ def, rows }: { def: TabDef; rows: SettingRow[] }) {
  const utils = trpc.useUtils();
  const mine = useMemo(
    () =>
      rows.filter(
        (r) =>
          def.prefixes.some((p) => r.key.startsWith(p)) &&
          !(def.exclude ?? []).some((p) => r.key.startsWith(p)),
      ),
    [rows, def],
  );

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const valueOf = (r: SettingRow) => (r.key in draft ? draft[r.key] : r.value);
  const dirty = mine.some((r) => r.key in draft && draft[r.key] !== r.value);

  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: (r) => {
      toast.success(r.updated > 0 ? `Saved ${r.updated} setting(s).` : "No changes to save.");
      setDraft({});
      utils.settings.list.invalidate();
      utils.settings.publicConfig.invalidate();
      utils.settings.businessIdentity.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const save = () => {
    const values: Record<string, unknown> = {};
    for (const r of mine) {
      if (r.key in draft && draft[r.key] !== r.value) values[r.key] = draft[r.key];
    }
    updateMutation.mutate({ values });
  };

  const Icon = def.icon;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#22264B]/10 bg-white">
      <header className="flex items-start gap-3 border-b border-[#22264B]/10 bg-[#F4EFE3] px-5 py-4">
        <span className="rounded-lg bg-[#22264B] p-2 text-[#F7A026]">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-bold text-[#22264B]">{def.title}</h3>
          <p className="mt-0.5 text-xs text-[#22264B]/60">{def.blurb}</p>
        </div>
      </header>

      {mine.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-[#22264B]/50">
          You don't have permission to view or change these settings.
        </p>
      ) : (
        <>
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            {mine.map((r) => {
              const v = valueOf(r);
              const isBool = typeof r.value === "boolean";
              const isNumber = typeof r.value === "number";
              const isSecret = SECRET_KEYS.has(r.key);
              return (
                <div key={r.key} className={`space-y-1.5 ${isBool ? "sm:col-span-2" : ""}`}>
                  {isBool ? (
                    <label
                      htmlFor={`set-${r.key}`}
                      className="flex items-center justify-between gap-4 rounded-xl border border-[#22264B]/10 px-4 py-3"
                    >
                      <span>
                        <span className="block text-sm font-bold text-[#22264B]">{labelFor(r.key)}</span>
                        {r.description && <span className="block text-xs text-[#22264B]/50">{r.description}</span>}
                      </span>
                      <Switch
                        id={`set-${r.key}`}
                        checked={v === true}
                        onCheckedChange={(on) => setDraft((d) => ({ ...d, [r.key]: on }))}
                      />
                    </label>
                  ) : (
                    <>
                      <Label htmlFor={`set-${r.key}`} className="text-[#22264B]">
                        {labelFor(r.key)}
                      </Label>
                      <Input
                        id={`set-${r.key}`}
                        type={isSecret ? "password" : isNumber ? "number" : "text"}
                        autoComplete="off"
                        value={String(v ?? "")}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [r.key]: isNumber ? Number(e.target.value) || 0 : e.target.value,
                          }))
                        }
                        className="border-[#22264B]/15"
                      />
                      {r.description && <p className="text-xs text-[#22264B]/50">{r.description}</p>}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <footer className="flex justify-end border-t border-[#22264B]/10 px-5 py-3">
            <Button
              onClick={save}
              disabled={!dirty || updateMutation.isPending}
              className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
            >
              {updateMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}

/* --------------------------------- Workflow tab -------------------------------- */

/* --------------------------- Dashboard banner images --------------------------- */

function DashboardBannerTab() {
  const utils = trpc.useUtils();
  const imagesQuery = trpc.settings.bannerImages.useQuery();
  const configQuery = trpc.settings.uploadConfig.useQuery();
  const fileInput = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<string[] | null>(null);
  const [uploading, setUploading] = useState(false);

  // Local edit copy; null = not yet edited (show server list).
  const list = images ?? imagesQuery.data ?? [];
  const dirty = images !== null;

  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: () => {
      toast.success("Banner images saved.");
      setImages(null);
      utils.settings.bannerImages.invalidate();
      utils.settings.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const config = configQuery.data;
    if (!config?.configured) {
      toast.error("Cloudinary isn't configured yet — fill the Cloudinary tab first.");
      return;
    }
    setUploading(true);
    try {
      const up = await uploadToCloudinary(file, config);
      setImages([...list, up.url]);
      toast.success("Image uploaded — remember to save.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-[#22264B]/10 bg-white p-5">
      <div>
        <h3 className="text-sm font-extrabold text-[#22264B]">Dashboard greeting banner</h3>
        <p className="mt-0.5 text-xs text-[#22264B]/55">
          These images rotate behind the "Welcome back" banner on the dashboard (frosted-glass style).
          Upload from your device — images go straight to Cloudinary. Wide landscape images look best.
        </p>
      </div>

      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files)} />

      {imagesQuery.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((url, i) => (
            <div key={url} className="group relative overflow-hidden rounded-xl border border-[#22264B]/10">
              <img src={cloudinaryThumb(url, 400)} alt={`Banner ${i + 1}`} className="h-28 w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                <span className="text-[10px] font-bold text-white">#{i + 1}</span>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="size-6 rounded-full"
                  onClick={() => setImages(list.filter((_, x) => x !== i))}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#22264B]/25 text-sm text-[#22264B]/55 transition hover:border-[#F7A026] hover:text-[#22264B]"
          >
            {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
            <span className="text-xs font-semibold">{uploading ? "Uploading…" : "Add image"}</span>
          </button>
        </div>
      )}

      {list.length === 0 && !imagesQuery.isLoading && (
        <p className="text-xs text-amber-700">
          No images — the built-in oil-themed defaults will show until you add your own.
        </p>
      )}

      <div className="flex justify-end">
        <Button
          className="bg-[#22264B] hover:bg-[#22264B]/90"
          disabled={!dirty || updateMutation.isPending}
          onClick={() => updateMutation.mutate({ values: { "dashboard.banner_images": list } })}
        >
          {updateMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          {updateMutation.isPending ? "Saving…" : "Save banner images"}
        </Button>
      </div>
    </div>
  );
}

function WorkflowTab() {
  const flowsQuery = trpc.approvals.flows.useQuery();
  const flows = flowsQuery.data ?? [];

  return (
    <section className="overflow-hidden rounded-2xl border border-[#22264B]/10 bg-white">
      <header className="flex items-start gap-3 border-b border-[#22264B]/10 bg-[#F4EFE3] px-5 py-4">
        <span className="rounded-lg bg-[#22264B] p-2 text-[#F7A026]">
          <Workflow className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-bold text-[#22264B]">Approval workflow</h3>
          <p className="mt-0.5 text-xs text-[#22264B]/60">
            Every sensitive action — sales, payments, deposits, refunds, expenses, credit limits, products,
            price lists, stock and purchases — goes through an approval chain you configure here.
          </p>
        </div>
      </header>
      <div className="px-5 py-5">
        {flowsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {flows.map((f) => (
              <div key={f.entityType} className="flex items-center justify-between rounded-xl border border-[#22264B]/10 px-4 py-2.5">
                <span className="text-sm font-bold text-[#22264B]">{labelFor(`x.${f.entityType.toLowerCase()}`)}</span>
                <span className="text-xs text-[#22264B]/55">
                  {f.steps.length > 0 ? f.steps.map((s) => labelFor(`x.${s.toLowerCase()}`)).join(" → ") : "No approval needed"}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button asChild className="bg-[#22264B] text-white hover:bg-[#22264B]/90">
            <Link to="/approvals">
              <Workflow className="mr-2 size-4" /> Open workflow editor
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- My preferences tab ----------------------------- */

function PreferencesTab() {
  const [sound, setSound] = useState(soundsEnabled());

  return (
    <section className="overflow-hidden rounded-2xl border border-[#22264B]/10 bg-white">
      <header className="flex items-start gap-3 border-b border-[#22264B]/10 bg-[#F4EFE3] px-5 py-4">
        <span className="rounded-lg bg-[#22264B] p-2 text-[#F7A026]">
          <Volume2 className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-bold text-[#22264B]">My preferences</h3>
          <p className="mt-0.5 text-xs text-[#22264B]/60">
            Personal settings for this browser only — they don't affect other staff.
          </p>
        </div>
      </header>
      <div className="px-5 py-5">
        <label className="flex max-w-xl items-center justify-between gap-4 rounded-xl border border-[#22264B]/10 px-4 py-3">
          <span className="flex items-start gap-3">
            {sound ? <Volume2 className="mt-0.5 size-4 text-[#22264B]" /> : <VolumeX className="mt-0.5 size-4 text-[#22264B]/40" />}
            <span>
              <span className="block text-sm font-bold text-[#22264B]">Sounds for messages & notifications</span>
              <span className="block text-xs text-[#22264B]/50">
                Pop when you send a chat message, when a message arrives, and when a new notification lands in the bell.
              </span>
            </span>
          </span>
          <Switch
            checked={sound}
            onCheckedChange={(on) => {
              setSound(on);
              setSoundsEnabled(on);
              toast.success(on ? "Sounds on." : "Sounds muted for this browser.");
            }}
          />
        </label>
      </div>
    </section>
  );
}

/** "business.name" → "Name"; "APPROVAL_CHAIN" → "Approval chain". */
function labelFor(key: string): string {
  const leaf = key.split(".").pop() ?? key;
  return leaf
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
