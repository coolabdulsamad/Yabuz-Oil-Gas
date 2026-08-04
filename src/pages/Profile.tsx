import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Building2, KeyRound, Landmark, Save, ShieldCheck } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

/**
 * YABUZ OIL & GAS — my profile.
 * Shows EVERYTHING on the staff record: identity, employment, bank
 * details (used for salary) and contact info. You can edit your own
 * contact/next-of-kin fields; role, employment and bank details are
 * read-only — an Admin changes those from the Staff page.
 * Changing the password signs every session out (including this one).
 */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs tracking-wide text-[#22264B]/50 uppercase">{label}</p>
      <p className="mt-1 font-medium break-words text-[#22264B]">{children || "—"}</p>
    </div>
  );
}

export default function Profile() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [homeAddress, setHomeAddress] = useState(user?.homeAddress ?? "");
  const [nextOfKinName, setNextOfKinName] = useState(user?.nextOfKinName ?? "");
  const [nextOfKinPhone, setNextOfKinPhone] = useState(user?.nextOfKinPhone ?? "");

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
    fullName !== user.fullName ||
    email !== (user.email ?? "") ||
    phone !== (user.phone ?? "") ||
    homeAddress !== (user.homeAddress ?? "") ||
    nextOfKinName !== (user.nextOfKinName ?? "") ||
    nextOfKinPhone !== (user.nextOfKinPhone ?? "");

  const passwordValid =
    currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
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
                <Badge
                  variant="outline"
                  className={
                    user.status === "ACTIVE"
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                      : "border-red-400/40 bg-red-400/10 text-red-300"
                  }
                >
                  {user.status === "ACTIVE" ? "Active" : "Suspended"}
                </Badge>
                <span className="font-mono text-xs text-[#D7C6AD]/80">{user.staffCode}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-4 px-6 py-5 text-sm sm:grid-cols-3">
          <Field label="Username">@{user.username}</Field>
          <Field label="Member since">{formatDate(user.createdAt)}</Field>
          <Field label="Last login">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—"}</Field>
        </div>
      </section>

      {/* Employment (read-only) */}
      <section className="rounded-2xl border border-[#22264B]/10 bg-white">
        <header className="flex items-start gap-3 border-b border-[#22264B]/10 px-6 py-4">
          <span className="rounded-lg bg-[#22264B]/10 p-2 text-[#22264B]">
            <Building2 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-bold text-[#22264B]">Employment</h3>
            <p className="mt-0.5 text-xs text-[#22264B]/55">
              Set by an Admin on the Staff page — read-only here.
            </p>
          </div>
        </header>
        <div className="grid gap-4 px-6 py-5 text-sm sm:grid-cols-3">
          <Field label="Department">{user.department}</Field>
          <Field label="Job title">{user.jobTitle}</Field>
          <Field label="Date employed">{user.dateEmployed ? formatDate(user.dateEmployed) : "—"}</Field>
          <div className="sm:col-span-3">
            <Field label="Staff notes">{user.notes}</Field>
          </div>
        </div>
      </section>

      {/* Bank details (read-only) */}
      <section className="rounded-2xl border border-[#22264B]/10 bg-white">
        <header className="flex items-start gap-3 border-b border-[#22264B]/10 px-6 py-4">
          <span className="rounded-lg bg-emerald-600/10 p-2 text-emerald-700">
            <Landmark className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-bold text-[#22264B]">Bank details</h3>
            <p className="mt-0.5 text-xs text-[#22264B]/55">
              Where your salary is paid. For your security only an Admin can change these (Staff page).
            </p>
          </div>
        </header>
        <div className="grid gap-4 px-6 py-5 text-sm sm:grid-cols-3">
          <Field label="Bank name">{user.bankName}</Field>
          <Field label="Account number">{user.bankAccountNumber}</Field>
          <Field label="Account name">{user.bankAccountName}</Field>
        </div>
        {!user.bankName && (
          <p className="px-6 pb-4 text-xs font-medium text-amber-600">
            No bank details on file yet — ask an Admin to add them so payroll can pay you.
          </p>
        )}
      </section>

      {/* Edit profile */}
      <section className="rounded-2xl border border-[#22264B]/10 bg-white">
        <header className="border-b border-[#22264B]/10 px-6 py-4">
          <h3 className="font-bold text-[#22264B]">Your details — editable</h3>
          <p className="mt-0.5 text-xs text-[#22264B]/55">
            Your name, contact info and next of kin as shown to other staff.
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
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pf-address">Home address</Label>
            <Textarea
              id="pf-address"
              rows={2}
              value={homeAddress}
              onChange={(e) => setHomeAddress(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-nok">Next of kin name</Label>
            <Input
              id="pf-nok"
              value={nextOfKinName}
              onChange={(e) => setNextOfKinName(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-nok-phone">Next of kin phone</Label>
            <Input
              id="pf-nok-phone"
              value={nextOfKinPhone}
              onChange={(e) => setNextOfKinPhone(e.target.value)}
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
                homeAddress: homeAddress.trim() || null,
                nextOfKinName: nextOfKinName.trim() || null,
                nextOfKinPhone: nextOfKinPhone.trim() || null,
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
