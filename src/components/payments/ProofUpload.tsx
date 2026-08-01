import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { cloudinaryThumb, uploadToCloudinary, type CloudinaryUploadResult } from "@/lib/cloudinary";
import { Button } from "@/components/ui/button";

/**
 * YABUZ OIL & GAS — proof/receipt image picker.
 * Uploads straight to Cloudinary (unsigned preset from Settings → Integrations)
 * and hands the resulting URL + public id back to the parent form.
 */

export interface ProofValue {
  url: string;
  publicId: string;
}

export function ProofUpload({
  value,
  onChange,
  required,
}: {
  value: ProofValue | null;
  onChange: (v: CloudinaryUploadResult | null) => void;
  required?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const configQuery = trpc.settings.uploadConfig.useQuery();

  const handleFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const config = configQuery.data;
    if (!config?.configured) {
      toast.error("Cloudinary isn't configured yet — ask an admin to fill Settings → Integrations.");
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadToCloudinary(file, config);
      onChange(uploaded);
      toast.success("Proof uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div>
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files)} />
      {value ? (
        <div className="relative w-fit">
          <a href={value.url} target="_blank" rel="noreferrer">
            <img
              src={cloudinaryThumb(value.url, 300)}
              alt="Payment proof"
              className="h-28 w-28 rounded-lg border border-[#22264B]/10 object-cover"
            />
          </a>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute -right-2 -top-2 size-6 rounded-full"
            onClick={() => onChange(null)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="flex h-28 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#22264B]/25 text-sm text-[#22264B]/55 transition hover:border-[#F7A026] hover:text-[#22264B]"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          {uploading ? "Uploading…" : `Attach proof${required ? " (required)" : " (optional for cash)"}`}
        </button>
      )}
    </div>
  );
}
