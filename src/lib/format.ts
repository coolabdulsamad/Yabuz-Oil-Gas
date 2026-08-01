/** Money + number formatting helpers (₦ Naira). */
export function formatMoney(value: number | null | undefined): string {
  const v = Number(value ?? 0);
  return `₦${v.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatQty(value: number | null | undefined): string {
  const v = Number(value ?? 0);
  return v.toLocaleString("en-NG", { maximumFractionDigits: 3 });
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
