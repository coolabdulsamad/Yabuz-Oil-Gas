import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Fuel, Loader2, Lock, User as UserIcon, Eye, EyeOff } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * YABUZ OIL & GAS — staff login.
 * Split screen: navy brand panel + warm paper form panel.
 */
export default function Login() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/", { replace: true });
    },
    onError: (err) => setError(err.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    loginMutation.mutate({ username: username.trim(), password });
  };

  return (
    <div className="flex min-h-screen bg-[#F4EFE3]">
      {/* Brand panel */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[#22264B] p-12 lg:flex">
        {/* oversized ghost typography */}
        <div className="pointer-events-none absolute -bottom-10 -right-6 select-none text-[11rem] font-black leading-none text-white/[0.04]">
          YABUZ
        </div>
        <div className="pointer-events-none absolute -top-16 right-10 size-72 rounded-full bg-[#F7A026]/10 blur-2xl" />

        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-[#F7A026] text-[#22264B]">
            <Fuel className="size-6" strokeWidth={2.4} />
          </span>
          <span className="text-lg font-extrabold tracking-wide text-white">YABUZ OIL & GAS</span>
        </div>

        <div className="relative space-y-6">
          <h1 className="max-w-md text-4xl font-black leading-[1.05] text-white xl:text-5xl">
            Every carton, keg & drum — accounted for.
          </h1>
          <p className="max-w-sm text-[15px] leading-relaxed text-[#D7C6AD]/80">
            The complete distribution suite for Yabuz Oil & Gas Ltd: inventory, sales with
            approval workflows, customer credit, advance deposits and full audit trails —
            built for Polar Petrochemicals distributors.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {["Inventory", "Sales Approvals", "Credit & Deposits", "Audit Trail"].map((t) => (
              <span
                key={t}
                className="rounded-full border border-[#D7C6AD]/25 px-3.5 py-1.5 text-xs font-semibold text-[#D7C6AD]"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-[#D7C6AD]/50">
          Authorized distributor — Polar Petrochemicals Limited
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-[#22264B] text-[#F7A026]">
              <Fuel className="size-5" strokeWidth={2.4} />
            </span>
            <span className="text-base font-extrabold text-[#22264B]">YABUZ OIL & GAS</span>
          </div>

          <h2 className="text-2xl font-black tracking-tight text-[#22264B]">Staff sign in</h2>
          <p className="mt-1.5 text-sm text-[#22264B]/55">
            Enter your staff username and password to continue.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-[13px] font-semibold text-[#22264B]">
                Username
              </Label>
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/35" />
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. manager"
                  autoComplete="username"
                  required
                  className="h-12 rounded-xl border-[#22264B]/15 bg-white pl-10 text-[15px] focus-visible:ring-[#F7A026]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-[13px] font-semibold text-[#22264B]">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/35" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="h-12 rounded-xl border-[#22264B]/15 bg-white pl-10 pr-11 text-[15px] focus-visible:ring-[#F7A026]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#22264B]/40 hover:text-[#22264B]"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loginMutation.isPending}
              className="h-12 w-full rounded-xl bg-[#22264B] text-[15px] font-bold text-white hover:bg-[#22264B]/90"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs leading-relaxed text-[#22264B]/45">
            Access is limited to authorized staff. Every action is recorded in the audit log.
          </p>
        </div>
      </div>
    </div>
  );
}
