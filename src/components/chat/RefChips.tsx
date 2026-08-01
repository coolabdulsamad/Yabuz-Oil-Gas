import { Link } from "react-router";
import {
  Package,
  ShoppingCart,
  Users,
  Wallet,
  Truck,
  Boxes,
  Receipt,
  type LucideIcon,
} from "lucide-react";

/**
 * YABUZ OIL & GAS — entity reference chips
 * Shared by Team Chat and the AI Assistant: a message can carry references
 * to business entities (product, sale, customer…) rendered as deep-linking
 * chips under the message body.
 */

export interface EntityRef {
  type: "PRODUCT" | "SALE" | "CUSTOMER" | "PAYMENT" | "PURCHASE" | "STOCK" | "EXPENSE";
  id: number;
  label: string;
}

const REF_STYLE: Record<EntityRef["type"], { icon: LucideIcon; href: (id: number) => string; tint: string }> = {
  PRODUCT: { icon: Package, href: (id) => `/products/${id}`, tint: "border-[#22264B]/25 bg-[#22264B]/5 text-[#22264B]" },
  SALE: { icon: ShoppingCart, href: (id) => `/sales/${id}`, tint: "border-[#F7A026]/40 bg-[#F7A026]/10 text-[#9a6212]" },
  CUSTOMER: { icon: Users, href: (id) => `/customers/${id}`, tint: "border-emerald-600/30 bg-emerald-50 text-emerald-700" },
  PAYMENT: { icon: Wallet, href: () => `/payments`, tint: "border-sky-600/30 bg-sky-50 text-sky-700" },
  PURCHASE: { icon: Truck, href: (id) => `/purchases/${id}`, tint: "border-purple-600/30 bg-purple-50 text-purple-700" },
  STOCK: { icon: Boxes, href: () => `/inventory`, tint: "border-[#22264B]/25 bg-[#22264B]/5 text-[#22264B]" },
  EXPENSE: { icon: Receipt, href: () => `/expenses`, tint: "border-red-600/30 bg-red-50 text-red-700" },
};

export function RefChip({ reference }: { reference: EntityRef }) {
  const style = REF_STYLE[reference.type] ?? REF_STYLE.PRODUCT;
  const Icon = style.icon;
  return (
    <Link
      to={style.href(reference.id)}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:opacity-75 ${style.tint}`}
      title={`Open ${reference.type.toLowerCase()}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{reference.label}</span>
    </Link>
  );
}

export function RefChipList({ references }: { references: EntityRef[] }) {
  if (!references || references.length === 0) return null;
  const seen = new Set<string>();
  const unique = references.filter((r) => {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {unique.map((r) => (
        <RefChip key={`${r.type}-${r.id}`} reference={r} />
      ))}
    </div>
  );
}

/** Tiny markdown-lite renderer for assistant messages: **bold**, bullets, numbered lists. */
export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: { type: "bullet" | "number" | "para"; items: string[] }[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-•]\s+/.test(trimmed)) {
      const last = blocks[blocks.length - 1];
      const item = trimmed.replace(/^[-•]\s+/, "");
      if (last?.type === "bullet") last.items.push(item);
      else blocks.push({ type: "bullet", items: [item] });
    } else if (/^\d+[.)]\s+/.test(trimmed)) {
      const last = blocks[blocks.length - 1];
      const item = trimmed.replace(/^\d+[.)]\s+/, "");
      if (last?.type === "number") last.items.push(item);
      else blocks.push({ type: "number", items: [item] });
    } else {
      blocks.push({ type: "para", items: [trimmed] });
    }
  }

  const renderInline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="font-bold text-[#22264B]">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  };

  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-[#3a3d5c]">
      {blocks.map((b, i) => {
        if (b.type === "bullet") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "number") {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        if (b.items[0] === "") return <div key={i} className="h-1" />;
        return <p key={i}>{renderInline(b.items[0])}</p>;
      })}
    </div>
  );
}
