import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatMoney, formatQty } from "@/lib/format";
import { uploadToCloudinary, cloudinaryThumb } from "@/lib/cloudinary";
import { ProductFormDialog, type EditableProduct } from "@/components/products/ProductFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * YABUZ OIL & GAS — product detail.
 * Gallery (Cloudinary), pack config, dual pricing with margins, stock
 * snapshot. Cost prices only render for prices.view_cost holders.
 */
export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const { hasPermission } = useAuth();
  const utils = trpc.useUtils();

  const [editor, setEditor] = useState<EditableProduct | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const query = trpc.products.getById.useQuery({ id: productId });
  const uploadConfigQuery = trpc.products.uploadConfig.useQuery();

  const refresh = () => {
    utils.products.getById.invalidate({ id: productId });
    utils.products.list.invalidate();
  };

  const statusMutation = trpc.products.setStatus.useMutation({
    onSuccess: (_r, v) => {
      toast.success(v.status === "ACTIVE" ? "Product activated." : "Product deactivated.");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const discontinueMutation = trpc.products.discontinue.useMutation({
    onSuccess: () => {
      toast.success("Product discontinued.");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const addImageMutation = trpc.products.addImage.useMutation();
  const removeImageMutation = trpc.products.removeImage.useMutation({
    onSuccess: () => {
      toast.success("Image removed.");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const setPrimaryMutation = trpc.products.setPrimaryImage.useMutation({
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e.message),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  const p = query.data;
  if (!p) {
    return (
      <div className="rounded-2xl border border-dashed border-[#22264B]/20 bg-white/60 px-6 py-14 text-center text-sm text-[#22264B]/50">
        Product not found.
      </div>
    );
  }

  const canEdit = hasPermission("products.edit");
  const canDelete = hasPermission("products.delete");
  const canViewCost = p.canViewCost;
  const images = p.images ?? [];
  const primary = images.find((i) => i.isPrimary) ?? images[0];

  const margin =
    canViewCost && p.sellCartonPrice != null && p.costCartonPrice != null
      ? p.sellCartonPrice - p.costCartonPrice
      : null;
  const low = p.currentStock <= p.reorderLevel;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const config = uploadConfigQuery.data;
    if (!config?.configured) {
      toast.error("Cloudinary isn't configured yet — ask an admin to fill Settings → Integrations.");
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadToCloudinary(file, config);
        await addImageMutation.mutateAsync({ productId, url: uploaded.url, publicId: uploaded.publicId });
      }
      toast.success(files.length === 1 ? "Image added." : `${files.length} images added.`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const editable: EditableProduct = {
    id: p.id,
    name: p.name,
    description: p.description,
    categoryId: p.categoryId,
    packType: p.packType,
    packDescription: p.packDescription,
    unitsPerPack: p.unitsPerPack,
    unitLabel: p.unitLabel,
    volumePerUnit: p.volumePerUnit,
    costCartonPrice: p.costCartonPrice ?? 0,
    costUnitPrice: p.costUnitPrice ?? 0,
    sellCartonPrice: p.sellCartonPrice ?? 0,
    sellUnitPrice: p.sellUnitPrice ?? 0,
    allowUnitSales: p.allowUnitSales,
    reorderLevel: p.reorderLevel,
    storeLocation: p.storeLocation,
    barcode: p.barcode,
  };

  return (
    <div className="space-y-5">
      {/* Breadcrumb + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/products"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#22264B]/60 hover:text-[#22264B]"
        >
          <ArrowLeft className="h-4 w-4" /> All products
        </Link>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <>
              {p.status !== "DISCONTINUED" && (
                <Button
                  variant="outline"
                  className="border-[#22264B]/20"
                  disabled={statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate({
                      id: productId,
                      status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                    })
                  }
                >
                  {p.status === "ACTIVE" ? "Deactivate" : "Activate"}
                </Button>
              )}
              <Button
                onClick={() => setEditor(editable)}
                className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
              >
                <Pencil className="mr-2 h-4 w-4" /> Edit product
              </Button>
            </>
          )}
          {canDelete && p.status !== "DISCONTINUED" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="border-red-600/30 text-red-600 hover:bg-red-50">
                  Discontinue
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Discontinue this product?</AlertDialogTitle>
                  <AlertDialogDescription>
                    "{p.name}" will be hidden from selling screens. Its sales and stock history is
                    kept forever — this can't delete that history.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => discontinueMutation.mutate({ id: productId })}
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    Discontinue
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Gallery */}
        <section className="space-y-3 lg:col-span-2">
          <div className="overflow-hidden rounded-2xl border border-[#22264B]/10 bg-white">
            {primary ? (
              <img
                src={cloudinaryThumb(primary.url, 800)}
                alt={p.name}
                className="aspect-square w-full object-cover"
              />
            ) : (
              <div className="flex aspect-square w-full flex-col items-center justify-center bg-[#F4EFE3] text-[#22264B]/30">
                <ImagePlus className="h-10 w-10" />
                <p className="mt-2 text-sm">No photo yet</p>
              </div>
            )}
          </div>

          {(images.length > 1 || canEdit) && (
            <div className="flex flex-wrap gap-2">
              {images.map((img) => (
                <div
                  key={img.id}
                  className={`group relative h-20 w-20 overflow-hidden rounded-xl border-2 ${
                    img.isPrimary ? "border-[#F7A026]" : "border-transparent"
                  }`}
                >
                  <img src={cloudinaryThumb(img.url, 200)} alt="" className="h-full w-full object-cover" />
                  {canEdit && (
                    <div className="absolute inset-0 flex items-center justify-center gap-1 bg-[#22264B]/70 opacity-0 transition-opacity group-hover:opacity-100">
                      {!img.isPrimary && (
                        <button
                          title="Make primary"
                          onClick={() => setPrimaryMutation.mutate({ imageId: img.id })}
                          className="rounded-md bg-white/90 p-1 text-[#22264B]"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        title="Remove"
                        onClick={() => removeImageMutation.mutate({ imageId: img.id })}
                        className="rounded-md bg-white/90 p-1 text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {canEdit && (
                <button
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className="flex h-20 w-20 flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#22264B]/25 text-[#22264B]/50 transition-colors hover:border-[#F7A026] hover:text-[#F7A026] disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  <span className="mt-1 text-[10px] font-medium">{uploading ? "Uploading" : "Add"}</span>
                </button>
              )}
            </div>
          )}

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {canEdit && uploadConfigQuery.data && !uploadConfigQuery.data.configured && (
            <p className="rounded-xl border border-[#F7A026]/40 bg-[#F7A026]/10 px-3 py-2 text-xs text-[#8a5a00]">
              Cloudinary isn't configured — an admin can add the cloud name & upload preset in
              Settings → Integrations.
            </p>
          )}
        </section>

        {/* Details */}
        <section className="space-y-5 lg:col-span-3">
          <div className="rounded-2xl border border-[#22264B]/10 bg-white p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-[#22264B]/15 font-mono text-[10px] text-[#22264B]/60">
                {p.sku}
              </Badge>
              <Badge className="border-0 bg-[#22264B] text-white hover:bg-[#22264B]">{p.categoryName}</Badge>
              <Badge
                variant="outline"
                className={
                  p.status === "ACTIVE"
                    ? "border-emerald-600/30 bg-emerald-50 text-emerald-700"
                    : p.status === "INACTIVE"
                      ? "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/60"
                      : "border-red-600/30 bg-red-50 text-red-700"
                }
              >
                {p.status === "DISCONTINUED" ? "Discontinued" : p.status === "INACTIVE" ? "Inactive" : "Active"}
              </Badge>
            </div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-[#22264B]">{p.name}</h2>
            {p.description && <p className="mt-2 text-sm text-[#22264B]/65">{p.description}</p>}

            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Pack" value={`${formatQty(p.unitsPerPack)} ${p.unitLabel.toLowerCase()} / ${p.packType.toLowerCase()}`} />
              <Stat label="Pack description" value={p.packDescription} />
              <Stat
                label="Volume / unit"
                value={p.volumePerUnit != null ? `${formatQty(p.volumePerUnit)} L/Kg` : "—"}
              />
              <Stat label="Store location" value={p.storeLocation ?? "—"} />
            </div>
            {p.supplierName && (
              <p className="mt-4 text-xs text-[#22264B]/55">
                Supplier: <strong className="text-[#22264B]">{p.supplierName}</strong>
              </p>
            )}
          </div>

          {/* Pricing */}
          <div className="rounded-2xl border border-[#22264B]/10 bg-white p-6">
            <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[#22264B]/70">Pricing</h3>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Sell / pack"
                value={p.sellCartonPrice != null ? formatMoney(p.sellCartonPrice) : "—"}
                strong
              />
              <Stat
                label="Sell / unit"
                value={
                  p.allowUnitSales
                    ? p.sellUnitPrice != null
                      ? formatMoney(p.sellUnitPrice)
                      : "—"
                    : "Pack only"
                }
              />
              {canViewCost && (
                <>
                  <Stat label="Cost / pack" value={formatMoney(p.costCartonPrice)} />
                  <Stat
                    label="Margin / pack"
                    value={margin !== null ? formatMoney(margin) : "—"}
                    tone={margin !== null && margin < 0 ? "bad" : "good"}
                  />
                </>
              )}
            </div>
            {!canViewCost && (
              <p className="mt-3 text-xs text-[#22264B]/45">
                Cost prices and margins are hidden for your role.
              </p>
            )}
          </div>

          {/* Stock snapshot */}
          <div className="rounded-2xl border border-[#22264B]/10 bg-white p-6">
            <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[#22264B]/70">Stock</h3>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat
                label="Current balance"
                value={`${formatQty(p.currentStock)} ${p.packType.toLowerCase()}${p.currentStock === 1 ? "" : "s"}`}
                tone={low ? "warn" : "default"}
                strong
              />
              <Stat label="Alert level" value={`${formatQty(p.reorderLevel)} packs`} />
              {canViewCost && (
                <Stat
                  label="Stock value (cost)"
                  value={formatMoney((p.costCartonPrice ?? 0) * p.currentStock)}
                />
              )}
            </div>
            {low && (
              <p className="mt-3 rounded-xl bg-[#F7A026]/10 px-3 py-2 text-xs font-medium text-[#8a5a00]">
                Stock is at or below the alert level — consider a supply from Polar.
              </p>
            )}
            <Separator className="my-4" />
            <p className="text-xs text-[#22264B]/50">
              Stock movements, adjustments and counts live in the Inventory module (next step).
            </p>
          </div>
        </section>
      </div>

      <ProductFormDialog
        product={editor}
        canEditPrices={hasPermission("prices.manage")}
        onClose={() => setEditor(undefined)}
        onSaved={refresh}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  strong,
  tone = "default",
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const color =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-red-600"
        : tone === "warn"
          ? "text-[#F7A026]"
          : "text-[#22264B]";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[#22264B]/45">{label}</p>
      <p className={`mt-1 ${strong ? "text-lg font-black" : "font-semibold"} ${color}`}>{value}</p>
    </div>
  );
}
