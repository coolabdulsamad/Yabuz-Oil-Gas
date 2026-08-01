import { Hammer } from "lucide-react";

/**
 * Temporary placeholder for modules that land in later build steps.
 * Keeps navigation fully explorable from day one.
 */
export default function ModulePlaceholder({ title, step }: { title: string; step: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-2xl border border-dashed border-[#22264B]/20 bg-white/60 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-[#F7A026]/15 text-[#8a5a08]">
        <Hammer className="size-6" />
      </span>
      <h2 className="mt-4 text-xl font-bold text-[#22264B]">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-[#22264B]/55">
        This module is part of <span className="font-semibold text-[#22264B]">{step}</span> in the
        build plan. It will arrive fully featured — forms, tables, approvals and audit logging.
      </p>
    </div>
  );
}
