import { useState } from "react";
import { useNavigate } from "react-router";
import { KeyRound, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { ROLE_LABELS } from "@contracts/roles";
import { formatDate, formatDateTime } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

/**
 * YABUZ OIL & GAS — my profile.
 * Self-service details + password change. Changing the password signs
 * every session out (including this one), so we bounce to /login.
 */
export default function Profile() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const profileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Profile updated.");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const passwordMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Password changed. Please log in again.");
      navigate(LOGIN_PATH, { replace: true });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!user) return null;

  const profileDirty =
    fullName !== user.fullName || email !== (user.email ?? "") || phone !== (user.phone ?? "");

  const passwordValid =
    currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Identity card */}
      <section className="overflow-hidden rounded-2xl border border-[#22264B]/10 bg-white">
        <div className="bg-[#22264B] px-6 py-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 border-2 border-[#F7A026]/60">
              <AvatarImage src={user.avatarUrl ?? undefined} />
              <AvatarFallback className="bg-[#F7A026] text-lg font-black text-[#22264B]">
                {user.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-xl font-black text-white">{user.fullName}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge className="border-0 bg-[#F7A026] font-semibold text-[#22264B] hover:bg-[#F7A026]">
                  {ROLE_LABELS[user.role]}
                </Badge>
                <span className="font-mono text-xs text-[#D7C6AD]/80">{user.staffCode}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-4 px-6 py-5 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#22264B]/50">Username</p>
            <p className="mt-1 font-medium text-[#22264B]">@{user.username}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[#22264B]/50">Member since</p>
            <p className="mt-1 font-medium text-[#22264B]">{formatDate(user.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[#22264B]/50">Last login</p>
            <p className="mt-1 font-medium text-[#22264B]">
              {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—"}
            </p>
          </div>
        </div>
      </section>

      {/* Edit profile */}
      <section className="rounded-2xl border border-[#22264B]/10 bg-white">
        <header className="border-b border-[#22264B]/10 px-6 py-4">
          <h3 className="font-bold text-[#22264B]">Profile details</h3>
          <p className="mt-0.5 text-xs text-[#22264B]/55">
            Your name and contact info as shown to other staff.
          </p>
        </header>
        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pf-name">Full name</Label>
            <Input id="pf-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-email">Email</Label>
            <Input
              id="pf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-phone">Phone</Label>
            <Input
              id="pf-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <footer className="flex justify-end border-t border-[#22264B]/10 px-6 py-3">
          <Button
            disabled={!profileDirty || fullName.trim().length < 3 || profileMutation.isPending}
            onClick={() =>
              profileMutation.mutate({
                fullName: fullName.trim(),
                email: email.trim(),
                phone: phone.trim() || null,
                avatarUrl: user.avatarUrl,
              })
            }
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            <Save className="mr-2 h-4 w-4" />
            {profileMutation.isPending ? "Saving…" : "Save profile"}
          </Button>
        </footer>
      </section>

      {/* Change password */}
      <section className="rounded-2xl border border-[#22264B]/10 bg-white">
        <header className="flex items-start gap-3 border-b border-[#22264B]/10 px-6 py-4">
          <span className="rounded-lg bg-[#F7A026]/15 p-2 text-[#8a5a00]">
            <KeyRound className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-bold text-[#22264B]">Change password</h3>
            <p className="mt-0.5 text-xs text-[#22264B]/55">
              You'll be signed out everywhere and asked to log in again.
            </p>
          </div>
        </header>
        <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pw-cur">Current password</Label>
            <Input
              id="pw-cur"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-new">New password</Label>
            <Input
              id="pw-new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <Input
              id="pw-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
        {newPassword.length > 0 && newPassword !== confirmPassword && (
          <p className="px-6 pb-2 text-xs text-red-600">New passwords don't match.</p>
        )}
        <Separator />
        <footer className="flex items-center justify-between px-6 py-3">
          <p className="flex items-center gap-1.5 text-xs text-[#22264B]/55">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Minimum 8 characters
          </p>
          <Button
            disabled={!passwordValid || passwordMutation.isPending}
            onClick={() => passwordMutation.mutate({ currentPassword, newPassword })}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            {passwordMutation.isPending ? "Changing…" : "Change password"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
