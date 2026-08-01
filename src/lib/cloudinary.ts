/**
 * YABUZ OIL & GAS — Cloudinary unsigned browser upload.
 * The preset comes from Settings → Integrations; no server round-trip.
 */
export interface CloudinaryUploadResult {
  url: string;
  publicId: string;
}

export async function uploadToCloudinary(
  file: File,
  config: { cloudName: string; uploadPreset: string },
): Promise<CloudinaryUploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", config.uploadPreset);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image upload failed (${res.status}). ${text.slice(0, 120)}`);
  }

  const data = (await res.json()) as { secure_url?: string; public_id?: string };
  if (!data.secure_url) throw new Error("Upload finished but no URL came back.");
  return { url: data.secure_url, publicId: data.public_id ?? "" };
}

/** On-the-fly resized thumbnail via Cloudinary's URL transforms. */
export function cloudinaryThumb(url: string, width = 400): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/w_${width},c_limit,q_auto,f_auto/`);
}
