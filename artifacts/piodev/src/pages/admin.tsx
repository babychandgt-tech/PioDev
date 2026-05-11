import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useAdmin, type AdminUser } from "@/hooks/use-admin";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectTrigger, SelectContent, SelectValue, SelectItem,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  LayoutDashboard, Users, ArrowLeft, Search,
  Trash2, RefreshCw,
  Zap, MessageSquare, TrendingUp, Newspaper, Plus,
  Check, Loader2, Tag, AlertCircle,
  MoreHorizontal, Pencil, Eye, ChevronLeft, ChevronRight, ArrowUpDown,
  Copy, ChevronDown, ChevronUp, Cpu, Mail, Send, X, AlertTriangle,
  Gift, Calendar, Clock,
} from "lucide-react";
import { CHAIN_CATEGORIES } from "@/lib/model-chains";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import {
  fetchPricingConfig, invalidatePricingConfig, discountedPrice, formatIDR,
  DEFAULT_PRICING, type PricingConfig,
} from "@/hooks/use-pricing-config";

type Section = "ringkasan" | "pengguna" | "harga" | "changelog" | "model-chain" | "broadcast" | "redeem-codes";

const NAV_ITEMS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "ringkasan",    label: "Ringkasan",      icon: LayoutDashboard },
  { id: "pengguna",     label: "Pengguna",       icon: Users },
  { id: "harga",        label: "Harga & Promo",  icon: Tag },
  { id: "changelog",    label: "What's New",     icon: Newspaper },
  { id: "model-chain",  label: "Model Chain",    icon: Cpu },
  { id: "broadcast",    label: "Broadcast Email", icon: Mail },
  { id: "redeem-codes", label: "Kode Redeem",    icon: Gift },
];

function useToast() {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const show = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);
  return { toast, show };
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
        <div className="text-sm text-muted-foreground leading-tight">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function SectionRingkasan({ stats, dailyUsage }: {
  stats: ReturnType<typeof useAdmin>["stats"];
  dailyUsage: ReturnType<typeof useAdmin>["dailyUsage"];
}) {
  const totalTokenK = stats?.totalTokens
    ? stats.totalTokens >= 1_000_000
      ? `${(stats.totalTokens / 1_000_000).toFixed(2)}M`
      : `${(stats.totalTokens / 1_000).toFixed(1)}K`
    : "—";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">Ringkasan Platform</h2>
        <p className="text-sm text-muted-foreground">Statistik keseluruhan PioCode 2.0</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Users}         label="Total User"      value={stats?.totalUsers ?? "—"}          color="bg-blue-500" />
        <StatCard icon={MessageSquare} label="Percakapan"       value={stats?.totalConversations ?? "—"} color="bg-violet-500" />
        <StatCard icon={TrendingUp}    label="Total Pesan"      value={stats?.totalMessages ?? "—"}      color="bg-green-500" />
        <StatCard icon={Zap}           label="Token Terpakai"   value={totalTokenK}                      color="bg-orange-500" />
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-medium text-foreground text-sm">Penggunaan Token — 7 Hari Terakhir</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Agregat semua user</p>
          </div>
        </div>
        {dailyUsage.every((d) => d.token === 0) ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
            Belum ada data penggunaan dalam 7 hari terakhir.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dailyUsage} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number) => [v.toLocaleString(), "Token"]}
              />
              <Bar dataKey="token" radius={[4, 4, 0, 0]} className="fill-primary" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

const PRESET_DURATIONS = [
  { label: "7 Hari",   days: 7 },
  { label: "14 Hari",  days: 14 },
  { label: "30 Hari",  days: 30 },
  { label: "3 Bulan",  days: 90 },
  { label: "6 Bulan",  days: 180 },
  { label: "1 Tahun",  days: 365 },
];

function formatRupiah(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function EditUserDialog({
  user, isSelf, onClose, onSaved, updateRole, updatePremium, updateCredit,
}: {
  user: AdminUser | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (msg: string, ok: boolean) => void;
  updateRole: (id: string, role: "user" | "admin") => Promise<void>;
  updatePremium: (id: string, is_premium: boolean, opts?: { days?: number; tier?: "plus" | "pro" }) => Promise<void>;
  updateCredit: (id: string, opts: { mode: "set" | "add"; amount_idr: number; note?: string }) => Promise<{ ok: boolean; balance_idr: number; delta: number }>;
}) {
  const [role, setRole] = useState<"user" | "admin">("user");
  const [tier, setTier] = useState<"free" | "plus" | "pro">("free");
  const [presetDays, setPresetDays] = useState<number>(30);
  const [useCustomDays, setUseCustomDays] = useState(false);
  const [customDaysVal, setCustomDaysVal] = useState("");
  const [customDaysUnit, setCustomDaysUnit] = useState<"hari" | "bulan">("hari");
  const [balanceMode, setBalanceMode] = useState<"add" | "set">("add");
  const [balanceAmount, setBalanceAmount] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-init form tiap kali user-nya beda.
  useEffect(() => {
    if (!user) return;
    setRole(user.role);
    setTier(user.tier);
    setPresetDays(30);
    setUseCustomDays(false);
    setCustomDaysVal("");
    setCustomDaysUnit("hari");
    setBalanceMode("add");
    setBalanceAmount("");
  }, [user?.id]);

  if (!user) return null;

  const effectiveDays = useCustomDays
    ? Math.round(Number(customDaysVal) * (customDaysUnit === "bulan" ? 30 : 1))
    : presetDays;
  const balanceVal = balanceAmount.trim() === "" ? null : Math.round(Number(balanceAmount));

  const tierWillChange = tier !== user.tier;
  const roleWillChange = role !== user.role;
  const balanceWillChange = balanceVal !== null && Number.isFinite(balanceVal) && balanceVal !== 0
    || (balanceMode === "set" && balanceVal !== null && Number.isFinite(balanceVal));

  const tierUpgradingToPaid = tierWillChange && tier !== "free";
  const daysValid = !tierUpgradingToPaid || (effectiveDays > 0 && Number.isFinite(effectiveDays));

  const dirty = roleWillChange || tierWillChange || balanceWillChange;
  const canSave = dirty && daysValid && !saving;

  async function handleSave() {
    if (!user || saving) return;
    setSaving(true);
    const messages: string[] = [];
    try {
      if (roleWillChange) {
        if (isSelf) throw new Error("Tidak bisa mengubah role akun sendiri.");
        await updateRole(user.id, role);
        messages.push(role === "admin" ? "jadi Admin" : "jadi User");
      }
      if (tierWillChange) {
        if (isSelf) throw new Error("Tidak bisa mengubah tier akun sendiri.");
        if (tier === "free") {
          await updatePremium(user.id, false);
          messages.push("premium dicabut");
        } else {
          await updatePremium(user.id, true, { days: effectiveDays, tier });
          messages.push(`${tier === "pro" ? "Pro" : "Plus"} ${effectiveDays} hari`);
        }
      }
      if (balanceWillChange && balanceVal !== null) {
        const result = await updateCredit(user.id, {
          mode: balanceMode,
          amount_idr: balanceVal,
        });
        if (result.delta !== 0) {
          const sign = result.delta > 0 ? "+" : "";
          messages.push(`saldo ${sign}${formatRupiah(result.delta)}`);
        }
      }
      if (messages.length === 0) {
        onSaved("Tidak ada perubahan.", true);
      } else {
        onSaved(`✓ ${user.email}: ${messages.join(" · ")}.`, true);
      }
      onClose();
    } catch (e: any) {
      onSaved(e?.message || "Gagal menyimpan perubahan.", false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Edit Pengguna</DialogTitle>
          <p className="text-xs text-muted-foreground truncate mt-1">
            {user.full_name ? `${user.full_name} · ` : ""}{user.email}
          </p>
        </DialogHeader>

        <div className="space-y-6 py-1 max-h-[60vh] overflow-y-auto pr-1">
          {/* ── Role ─────────────────────────────────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Role</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {(["user", "admin"] as const).map((r) => {
                const active = role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    disabled={isSelf}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-foreground border-primary/40 font-medium"
                        : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                      isSelf && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {r === "admin" ? "Admin" : "User"}
                  </button>
                );
              })}
            </div>
            {isSelf && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Tidak bisa mengubah role akun sendiri.
              </p>
            )}
          </section>

          {/* ── Tier ─────────────────────────────────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Tier Premium</h3>
            <div className="grid grid-cols-3 gap-1.5">
              {(["free", "plus", "pro"] as const).map((t) => {
                const active = tier === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTier(t)}
                    disabled={isSelf}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm transition-colors capitalize",
                      active
                        ? "bg-primary/10 text-foreground border-primary/40 font-medium"
                        : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                      isSelf && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>

            {/* Durasi muncul cuma kalau tier-nya berubah ke Plus/Pro */}
            {tierUpgradingToPaid && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-muted-foreground">Durasi</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {PRESET_DURATIONS.map((p) => (
                    <button
                      key={p.days}
                      type="button"
                      onClick={() => { setPresetDays(p.days); setUseCustomDays(false); }}
                      className={cn(
                        "rounded-md border px-2 py-1.5 text-xs transition-colors",
                        !useCustomDays && presetDays === p.days
                          ? "bg-primary/10 text-foreground border-primary/40 font-medium"
                          : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setUseCustomDays(true)}
                  className={cn(
                    "w-full text-left text-[11px] px-2.5 py-1.5 rounded-md border transition-colors",
                    useCustomDays
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-dashed border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  Atau durasi kustom
                </button>
                {useCustomDays && (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={1}
                      placeholder="Jumlah"
                      value={customDaysVal}
                      onChange={(e) => setCustomDaysVal(e.target.value)}
                      className="flex-1 h-8 text-sm"
                    />
                    <div className="flex rounded-md border border-border overflow-hidden">
                      {(["hari", "bulan"] as const).map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => setCustomDaysUnit(u)}
                          className={cn(
                            "px-2.5 text-xs transition-colors",
                            customDaysUnit === u
                              ? "bg-primary/15 text-foreground font-medium"
                              : "text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {effectiveDays > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Aktif sampai{" "}
                    <span className="text-foreground">
                      {new Date(Date.now() + effectiveDays * 86_400_000).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ── Saldo ────────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Saldo</h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                Saldo sekarang: <span className="text-foreground">{formatRupiah(user.credit_balance_idr)}</span>
              </span>
            </div>
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {([
                { id: "add", label: "Tambah / Kurangi" },
                { id: "set", label: "Set Eksak" },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setBalanceMode(m.id)}
                  className={cn(
                    "flex-1 px-3 py-1.5 transition-colors",
                    balanceMode === m.id
                      ? "bg-primary/10 text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-muted-foreground w-6">Rp</span>
              <Input
                type="number"
                placeholder={balanceMode === "add" ? "Boleh negatif untuk kurangi" : "Saldo baru"}
                value={balanceAmount}
                onChange={(e) => setBalanceAmount(e.target.value)}
                className="flex-1 h-9 tabular-nums"
              />
            </div>
            {balanceVal !== null && Number.isFinite(balanceVal) && balanceVal !== 0 && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Saldo akan jadi{" "}
                <span className="text-foreground tabular-nums">
                  {balanceMode === "add"
                    ? formatRupiah(Math.max(0, user.credit_balance_idr + balanceVal))
                    : formatRupiah(Math.max(0, balanceVal))}
                </span>
              </p>
            )}
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Batal</Button>
          <Button
            size="sm"
            disabled={!canSave}
            onClick={handleSave}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
            Simpan Perubahan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── DETAIL ROW (helper kecil buat baris label/value yg konsisten) ────────────
function DetailRow({
  label, value, mono, valueClassName,
}: { label: string; value: React.ReactNode; mono?: boolean; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn(
        "text-sm text-foreground text-right min-w-0 truncate",
        mono && "font-mono text-xs",
        valueClassName,
      )}>
        {value}
      </span>
    </div>
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

function UserDetailSheet({
  user, isSelf, onClose, onEdit, onDelete,
}: {
  user: AdminUser | null;
  isSelf: boolean;
  onClose: () => void;
  onEdit: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!user) return null;

  const exp = expiresStatus(user);
  const initial = (user.full_name || user.email).trim().charAt(0).toUpperCase();

  async function copyId() {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(user.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /**/ }
  }

  return (
    <Sheet open={!!user} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">Detail Pengguna</SheetTitle>
        </SheetHeader>

        {/* ── Identitas ───────────────────────────────────────────────────── */}
        <div className="mt-5 flex items-start gap-3 pb-5 border-b border-border">
          <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center text-lg font-semibold shrink-0">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-foreground truncate">
              {user.full_name || "Tanpa nama"}
            </div>
            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <Badge variant={user.role === "admin" ? "default" : "secondary"} className="shrink-0">
                {user.role === "admin" ? "Admin" : "User"}
              </Badge>
              {user.is_premium && (
                <Badge className={cn(
                  "shrink-0 border",
                  user.tier === "pro"
                    ? "bg-amber-600/15 text-amber-700 dark:text-amber-300 border-amber-600/25"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
                )}>
                  {user.tier === "pro" ? "Pro" : "Plus"}
                </Badge>
              )}
              {user.trial_claimed_at ? (
                <Badge variant="outline" className="shrink-0 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                  Trial diklaim
                </Badge>
              ) : (
                <Badge variant="outline" className="shrink-0 text-muted-foreground">
                  Belum klaim trial
                </Badge>
              )}
              {isSelf && (
                <Badge variant="outline" className="shrink-0 border-primary/40 text-primary">
                  Ini kamu
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* ── Akses & Premium ─────────────────────────────────────────────── */}
        <div className="mt-5 pb-5 border-b border-border">
          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Akses & Premium
          </h3>
          <DetailRow label="Role" value={user.role === "admin" ? "Admin" : "User"} />
          <DetailRow
            label="Tier"
            value={user.tier === "free" ? "Free" : user.tier === "pro" ? "Pro" : "Plus"}
          />
          <DetailRow
            label="Status Premium"
            value={
              user.is_premium ? (
                <span>
                  Aktif
                  {exp.tone !== "none" && (
                    <span className={cn(
                      "ml-2 text-xs",
                      exp.tone === "expired" && "text-destructive",
                      exp.tone === "soon" && "text-amber-600 dark:text-amber-400",
                      exp.tone === "active" && "text-muted-foreground",
                    )}>
                      ({exp.label})
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">Tidak aktif</span>
              )
            }
          />
          {user.is_premium && user.premium_expires_at && (
            <DetailRow label="Expires" value={fmtDate(user.premium_expires_at)} />
          )}
        </div>

        {/* ── Saldo & Trial ───────────────────────────────────────────────── */}
        <div className="mt-5 pb-5 border-b border-border">
          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Saldo & Trial
          </h3>
          <DetailRow
            label="Saldo Sekarang"
            value={formatRupiah(user.credit_balance_idr)}
            valueClassName={user.credit_balance_idr > 0 ? "font-semibold tabular-nums" : "text-muted-foreground tabular-nums"}
          />
          <DetailRow
            label="Klaim Trial"
            value={
              user.trial_claimed_at
                ? <span className="text-emerald-600 dark:text-emerald-400">✓ {fmtDate(user.trial_claimed_at)}</span>
                : <span className="text-muted-foreground">Belum diklaim</span>
            }
          />
        </div>

        {/* ── Aktivitas ───────────────────────────────────────────────────── */}
        <div className="mt-5 pb-5 border-b border-border">
          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Aktivitas
          </h3>
          <DetailRow label="Bergabung" value={fmtDateTime(user.created_at)} />
          <DetailRow label="Login Terakhir" value={fmtDateTime(user.last_sign_in_at)} />
        </div>

        {/* ── Identifier ──────────────────────────────────────────────────── */}
        <div className="mt-5 pb-5 border-b border-border">
          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Identifier
          </h3>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] font-mono text-muted-foreground bg-muted/40 rounded px-2 py-1.5 truncate">
              {user.id}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={copyId}
              className="h-8 px-2 shrink-0"
              aria-label="Salin ID"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {/* ── Aksi ────────────────────────────────────────────────────────── */}
        <div className="mt-5 flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            onClick={() => { onClose(); onEdit(user); }}
          >
            <Pencil className="w-3.5 h-3.5 mr-1.5" />
            Edit Pengguna
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isSelf}
            onClick={() => { if (!isSelf) { onClose(); onDelete(user); } }}
            className="text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Hapus
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type TierFilter = "all" | "free" | "plus" | "pro";
type RoleFilter = "all" | "user" | "admin";
type StatusFilter = "all" | "active" | "expiring" | "expired";
type SortKey = "newest" | "oldest" | "lastSignIn" | "balanceDesc" | "balanceAsc" | "expiresAsc";

const PAGE_SIZE = 20;
const EXPIRING_DAYS_THRESHOLD = 7;

function expiresStatus(u: AdminUser): { label: string; tone: "active" | "soon" | "expired" | "none" } {
  if (!u.is_premium || !u.premium_expires_at) return { label: "—", tone: "none" };
  const ms = new Date(u.premium_expires_at).getTime() - Date.now();
  const days = Math.ceil(ms / 86_400_000);
  if (days < 0) return { label: `Expired ${-days}h lalu`, tone: "expired" };
  if (days <= EXPIRING_DAYS_THRESHOLD) return { label: `${days}h lagi`, tone: "soon" };
  if (days < 60) return { label: `${days}h lagi`, tone: "active" };
  return { label: `${Math.round(days / 30)}bln lagi`, tone: "active" };
}

function SectionPengguna({
  users, isLoading, error, currentUserId, onView, onEdit, onDelete,
}: {
  users: AdminUser[];
  isLoading: boolean;
  error: string | null;
  currentUserId?: string;
  onView: (u: AdminUser) => void;
  onEdit: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
}) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [page, setPage] = useState(1);

  // Reset ke halaman 1 setiap filter/sort/search berubah.
  useEffect(() => { setPage(1); }, [search, tierFilter, roleFilter, statusFilter, sortKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = users.filter((u) => {
      if (q && !u.email.toLowerCase().includes(q) && !u.full_name.toLowerCase().includes(q)) return false;
      if (tierFilter !== "all" && u.tier !== tierFilter) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter !== "all") {
        const s = expiresStatus(u);
        if (statusFilter === "active" && s.tone !== "active") return false;
        if (statusFilter === "expiring" && s.tone !== "soon") return false;
        if (statusFilter === "expired" && s.tone !== "expired") return false;
      }
      return true;
    });

    const t = (s: string | null) => (s ? new Date(s).getTime() : 0);
    switch (sortKey) {
      case "newest":      arr.sort((a, b) => t(b.created_at) - t(a.created_at)); break;
      case "oldest":      arr.sort((a, b) => t(a.created_at) - t(b.created_at)); break;
      case "lastSignIn":  arr.sort((a, b) => t(b.last_sign_in_at) - t(a.last_sign_in_at)); break;
      case "balanceDesc": arr.sort((a, b) => b.credit_balance_idr - a.credit_balance_idr); break;
      case "balanceAsc":  arr.sort((a, b) => a.credit_balance_idr - b.credit_balance_idr); break;
      case "expiresAsc":  arr.sort((a, b) => {
        const ax = a.is_premium && a.premium_expires_at ? t(a.premium_expires_at) : Number.POSITIVE_INFINITY;
        const bx = b.is_premium && b.premium_expires_at ? t(b.premium_expires_at) : Number.POSITIVE_INFINITY;
        return ax - bx;
      }); break;
    }
    return arr;
  }, [users, search, tierFilter, roleFilter, statusFilter, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const activeFilterCount = (tierFilter !== "all" ? 1 : 0)
    + (roleFilter !== "all" ? 1 : 0)
    + (statusFilter !== "all" ? 1 : 0);

  function clearFilters() {
    setTierFilter("all");
    setRoleFilter("all");
    setStatusFilter("all");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground mb-1">Manajemen Pengguna</h2>
          <p className="text-sm text-muted-foreground">
            {filtered.length === users.length
              ? `${users.length} pengguna terdaftar`
              : `${filtered.length} dari ${users.length} pengguna`}
          </p>
        </div>
      </div>

      {/* ── Search + Filters bar ──────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Cari email atau nama..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as TierFilter)}>
            <SelectTrigger className="h-9 w-[120px] text-xs">
              <SelectValue placeholder="Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Tier</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="plus">Plus</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
            </SelectContent>
          </Select>

          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleFilter)}>
            <SelectTrigger className="h-9 w-[120px] text-xs">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Role</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="expiring">Hampir Habis (≤7h)</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs">
                Reset filter
              </Button>
            )}
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Urutkan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Terbaru</SelectItem>
                <SelectItem value="oldest">Terlama</SelectItem>
                <SelectItem value="lastSignIn">Login Terakhir</SelectItem>
                <SelectItem value="balanceDesc">Saldo Tertinggi</SelectItem>
                <SelectItem value="balanceAsc">Saldo Terendah</SelectItem>
                <SelectItem value="expiresAsc">Expires Terdekat</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm px-4 py-3">
          {error}
          <div className="text-xs opacity-75 mt-1">Pastikan sudah menjalankan migration SQL di Supabase.</div>
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Pengguna</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role / Tier</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Saldo</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Expires</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Bergabung</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">Login Terakhir</th>
                <th className="w-12 px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-14 text-muted-foreground text-sm">Memuat data...</td></tr>
              ) : pageItems.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-14 text-muted-foreground text-sm">
                  {search || activeFilterCount > 0 ? "Tidak ada hasil yang cocok." : "Belum ada pengguna."}
                </td></tr>
              ) : (
                pageItems.map((u) => {
                  const exp = expiresStatus(u);
                  const isSelf = u.id === currentUserId;
                  return (
                    <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 min-w-0">
                        <div className="font-medium text-foreground truncate leading-tight">{u.email}</div>
                        {u.full_name && <div className="text-xs text-muted-foreground mt-0.5 truncate">{u.full_name}</div>}
                        {isSelf && <div className="text-xs text-primary mt-0.5">Ini kamu</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant={u.role === "admin" ? "default" : "secondary"} className="shrink-0">
                            {u.role === "admin" ? "Admin" : "User"}
                          </Badge>
                          {u.is_premium && (
                            <Badge className={cn(
                              "shrink-0 border hover:opacity-90",
                              u.tier === "pro"
                                ? "bg-amber-600/15 text-amber-700 dark:text-amber-300 border-amber-600/25"
                                : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
                            )}>
                              {u.tier === "pro" ? "Pro" : "Plus"}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell whitespace-nowrap">
                        <span className={cn(
                          "text-sm",
                          u.credit_balance_idr > 0 ? "text-foreground font-medium" : "text-muted-foreground",
                        )}>
                          {formatRupiah(u.credit_balance_idr)}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap">
                        {exp.tone === "none" ? (
                          <span className="text-muted-foreground text-sm">—</span>
                        ) : (
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full border inline-block",
                            exp.tone === "active" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
                            exp.tone === "soon"   && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
                            exp.tone === "expired" && "bg-destructive/10 text-destructive border-destructive/20",
                          )}>
                            {exp.label}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-sm hidden lg:table-cell whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-sm hidden xl:table-cell whitespace-nowrap">
                        {u.last_sign_in_at
                          ? new Date(u.last_sign_in_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
                          : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label="Aksi pengguna"
                                className="p-2.5 sm:p-1.5 rounded-md hover:bg-muted active:bg-muted transition-colors text-muted-foreground touch-manipulation"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={() => onView(u)} className="cursor-pointer">
                                <Eye className="w-3.5 h-3.5 mr-2" />
                                Detail Pengguna
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onEdit(u)} className="cursor-pointer">
                                <Pencil className="w-3.5 h-3.5 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => !isSelf && onDelete(u)}
                                disabled={isSelf}
                                className="cursor-pointer text-destructive focus:text-destructive"
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-2" />
                                Hapus
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination footer ─────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border bg-muted/20 text-xs text-muted-foreground">
            <div className="tabular-nums">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} dari {filtered.length}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Halaman sebelumnya"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 tabular-nums">
                Hal. {safePage} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Halaman berikutnya"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type ChangelogEntry = {
  id: number; title: string; description: string;
  tag: "new" | "improvement" | "fix" | "removed"; created_at: string;
};

const TAG_LABELS = { new: "Baru", improvement: "Peningkatan", fix: "Perbaikan", removed: "Dihapus" };
const TAG_COLORS: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-500 border-blue-500/20",
  improvement: "bg-green-500/15 text-green-600 border-green-500/20",
  fix: "bg-orange-500/15 text-orange-500 border-orange-500/20",
  removed: "bg-red-500/15 text-red-500 border-red-500/20",
};

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" };
}

function SectionHarga({ showToast }: { showToast: (msg: string, ok: boolean) => void }) {
  const [config, setConfig] = useState<PricingConfig>(DEFAULT_PRICING);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchPricingConfig(true).then((v) => {
      if (alive) {
        setConfig(v);
        setIsLoading(false);
      }
    });
    return () => { alive = false; };
  }, []);

  function updateTier(tier: "plus" | "pro", patch: Partial<PricingConfig["plus"]>) {
    setConfig((prev) => ({
      ...prev,
      [tier]: { ...prev[tier], ...patch },
    }));
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const r = await fetch("/api/admin/pricing-config", {
        method: "PUT",
        headers: await authHeader(),
        body: JSON.stringify(config),
      });
      const d = await r.json();
      if (!r.ok) {
        const hint = d.hint ? ` ${d.hint}` : "";
        throw new Error((d.error || "Gagal simpan") + hint);
      }
      invalidatePricingConfig();
      setConfig(d.value);
      showToast("Harga berhasil disimpan.", true);
    } catch (e: any) {
      showToast(e.message ?? "Gagal simpan", false);
    } finally {
      setIsSaving(false);
    }
  }

  function handleReset() {
    setConfig(DEFAULT_PRICING);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">Harga & Promo</h2>
        <p className="text-sm text-muted-foreground">
          Atur harga paket Plus & Pro plus diskon promo. Perubahan langsung tampil di halaman pricing.
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex gap-3 text-xs text-foreground/80">
        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div>
          Kalau muncul error <strong>"app_config tidak ada"</strong> saat simpan, jalankan dulu file{" "}
          <code className="px-1.5 py-0.5 rounded bg-muted font-mono">server/app-config-migration.sql</code>{" "}
          di Supabase SQL editor (cuma sekali).
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <>
          <PricingTierEditor
            tierName="Plus"
            color="text-primary"
            value={config.plus}
            onChange={(p) => updateTier("plus", p)}
          />
          <PricingTierEditor
            tierName="Pro"
            color="text-amber-600 dark:text-amber-400"
            value={config.pro}
            onChange={(p) => updateTier("pro", p)}
          />

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-pricing">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              Simpan perubahan
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={isSaving} data-testid="button-reset-pricing">
              Reset ke default
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function PricingTierEditor({
  tierName, color, value, onChange,
}: {
  tierName: string;
  color: string;
  value: PricingConfig["plus"];
  onChange: (patch: Partial<PricingConfig["plus"]>) => void;
}) {
  const finalPrice = discountedPrice(value);
  const hasDiscount = value.discount_percent > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className={cn("text-base font-semibold", color)}>Paket {tierName}</h3>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Preview</div>
          <div className="text-sm font-bold text-foreground tabular-nums">
            {hasDiscount ? (
              <>
                <span className="text-xs text-muted-foreground line-through mr-2">
                  {formatIDR(value.price_idr)}
                </span>
                {formatIDR(finalPrice)}
              </>
            ) : (
              formatIDR(finalPrice)
            )}
            <span className="text-xs text-muted-foreground font-normal"> /bln</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground block mb-1.5">
            Harga normal (Rp / bulan)
          </span>
          <Input
            type="number"
            min={0}
            max={10000000}
            step={1000}
            value={value.price_idr}
            onChange={(e) => onChange({ price_idr: Number(e.target.value) || 0 })}
            data-testid={`input-price-${tierName.toLowerCase()}`}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground block mb-1.5">
            Diskon (%) — 0 = nonaktif
          </span>
          <Input
            type="number"
            min={0}
            max={99}
            step={1}
            value={value.discount_percent}
            onChange={(e) => onChange({ discount_percent: Number(e.target.value) || 0 })}
            data-testid={`input-discount-${tierName.toLowerCase()}`}
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-muted-foreground block mb-1.5">
          Label promo (opsional, tampil di bawah harga)
        </span>
        <Input
          type="text"
          maxLength={60}
          placeholder="mis. Diskon Lebaran 2026"
          value={value.discount_label}
          onChange={(e) => onChange({ discount_label: e.target.value })}
          disabled={!hasDiscount}
          data-testid={`input-label-${tierName.toLowerCase()}`}
        />
        {!hasDiscount && (
          <span className="text-[11px] text-muted-foreground/70 mt-1 block">
            Aktifin diskon dulu untuk pakai label.
          </span>
        )}
      </label>
    </div>
  );
}

function SectionChangelog({ showToast }: { showToast: (msg: string, ok: boolean) => void }) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", tag: "new" });

  const load = useCallback(async () => {
    setIsFetching(true);
    const r = await fetch("/api/changelog");
    const data = await r.json();
    setEntries(Array.isArray(data) ? data : []);
    setIsFetching(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = ((fd.get("title") as string) ?? "").trim();
    const description = ((fd.get("description") as string) ?? "").trim();
    const tag = (fd.get("tag") as string) ?? form.tag ?? "new";
    if (!title || !description) {
      showToast("Title dan deskripsi wajib diisi.", false); return;
    }
    setIsSaving(true);
    try {
      const r = await fetch("/api/admin/changelog", {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({ title, description, tag }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      setForm({ title: "", description: "", tag: "new" });
      showToast("Entry berhasil ditambahkan.", true);
      load();
    } catch (e: any) {
      showToast(e.message, false);
    } finally { setIsSaving(false); }
  }

  async function handleDelete(id: number) {
    try {
      const r = await fetch(`/api/admin/changelog/${id}`, { method: "DELETE", headers: await authHeader() });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      showToast("Entry dihapus.", true);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e: any) { showToast(e.message, false); }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">What's New</h2>
        <p className="text-sm text-muted-foreground">Kelola entri changelog yang ditampilkan ke pengguna.</p>
      </div>

      {/* Add form */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-medium text-foreground mb-4">Tambah Entri Baru</h3>
        <form onSubmit={handleAdd} className="space-y-3">
          <Input
            name="title"
            placeholder="Judul singkat, misal: Fitur Web Search ditingkatkan"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="text-sm"
          />
          <textarea
            name="description"
            placeholder="Deskripsi lebih detail tentang update ini..."
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 resize-none"
          />
          <div className="flex items-center gap-2">
            <select
              name="tag"
              value={form.tag}
              onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="new">Baru</option>
              <option value="improvement">Peningkatan</option>
              <option value="fix">Perbaikan</option>
              <option value="removed">Dihapus</option>
            </select>
            <Button type="submit" disabled={isSaving} size="sm" className="gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              {isSaving ? "Menyimpan..." : "Tambah"}
            </Button>
          </div>
        </form>
      </div>

      {/* Entry list */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Entri yang Dipublish ({entries.length})</h3>
        {isFetching ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-xl border border-border p-4 animate-pulse">
                <div className="h-4 bg-muted rounded w-1/3 mb-2" />
                <div className="h-3 bg-muted rounded w-full" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Belum ada entri. Tambahkan update pertama di atas!
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", TAG_COLORS[entry.tag])}>
                      {TAG_LABELS[entry.tag as keyof typeof TAG_LABELS]}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{formatDate(entry.created_at)}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{entry.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{entry.description}</p>
                </div>
                <button
                  onClick={() => handleDelete(entry.id)}
                  className="p-1.5 text-muted-foreground hover:text-red-500 rounded-md hover:bg-red-500/10 transition-colors shrink-0"
                  title="Hapus"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; badge: string; num: string }> = {
  violet: { bg: "bg-violet-500/10", text: "text-violet-600 dark:text-violet-400", border: "border-violet-200 dark:border-violet-800", badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300", num: "bg-violet-500" },
  blue:   { bg: "bg-blue-500/10",   text: "text-blue-600 dark:text-blue-400",     border: "border-blue-200 dark:border-blue-800",     badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",     num: "bg-blue-500" },
  green:  { bg: "bg-green-500/10",  text: "text-green-600 dark:text-green-400",   border: "border-green-200 dark:border-green-800",   badge: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",   num: "bg-green-500" },
  orange: { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400", border: "border-orange-200 dark:border-orange-800", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", num: "bg-orange-500" },
  sky:    { bg: "bg-sky-500/10",    text: "text-sky-600 dark:text-sky-400",       border: "border-sky-200 dark:border-sky-800",       badge: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",           num: "bg-sky-500" },
  pink:   { bg: "bg-pink-500/10",   text: "text-pink-600 dark:text-pink-400",     border: "border-pink-200 dark:border-pink-800",     badge: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",       num: "bg-pink-500" },
  rose:   { bg: "bg-rose-500/10",   text: "text-rose-600 dark:text-rose-400",     border: "border-rose-200 dark:border-rose-800",     badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",       num: "bg-rose-500" },
  amber:  { bg: "bg-amber-500/10",  text: "text-amber-600 dark:text-amber-400",   border: "border-amber-200 dark:border-amber-800",   badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",   num: "bg-amber-500" },
};

function ChainCard({ cat }: { cat: typeof CHAIN_CATEGORIES[number] }) {
  const [expanded, setExpanded] = useState(false);
  const c = COLOR_MAP[cat.color] ?? COLOR_MAP.violet;
  const PREVIEW = 5;
  const shown = expanded ? cat.models : cat.models.slice(0, PREVIEW);

  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", c.border)}>
      {/* Header */}
      <div className={cn("px-5 py-4 flex items-start justify-between gap-3", c.bg)}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-semibold text-sm", c.text)}>{cat.label}</span>
            <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", c.badge)}>
              {cat.badge}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{cat.description}</p>
        </div>
        <div className={cn("shrink-0 text-xs font-bold text-white rounded-full w-8 h-8 flex items-center justify-center", c.num)}>
          {cat.models.length}
        </div>
      </div>

      {/* Model list */}
      <div className="px-5 py-3 space-y-1.5">
        {shown.map((model, idx) => (
          <div key={model} className="flex items-center gap-2.5">
            <span className={cn(
              "shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white",
              idx === 0 ? c.num : "bg-muted-foreground/30"
            )}>
              {idx + 1}
            </span>
            <code className={cn(
              "text-xs font-mono truncate",
              idx === 0 ? cn("font-semibold", c.text) : "text-muted-foreground"
            )}>
              {model}
            </code>
            {idx === 0 && (
              <span className={cn("shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide", c.badge)}>
                Utama
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Expand/collapse */}
      {cat.models.length > PREVIEW && (
        <button
          onClick={() => setExpanded(v => !v)}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-t transition-colors",
            c.border,
            c.text,
            "hover:opacity-80"
          )}
        >
          {expanded ? (
            <><ChevronUp className="w-3.5 h-3.5" />Sembunyikan</>
          ) : (
            <><ChevronDown className="w-3.5 h-3.5" />+{cat.models.length - PREVIEW} model lainnya</>
          )}
        </button>
      )}
    </div>
  );
}

function SectionModelChain() {
  const totalModels = CHAIN_CATEGORIES.reduce((s, c) => s + c.models.length, 0);
  const totalChains = CHAIN_CATEGORIES.length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground mb-1">Model Chain</h2>
          <p className="text-sm text-muted-foreground">
            Daftar model yang digunakan per kategori — urutan dari atas = prioritas tertinggi (dicoba pertama).
            Jika model pertama gagal, sistem otomatis fallback ke model berikutnya.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-bold text-foreground tabular-nums">{totalModels}</div>
          <div className="text-xs text-muted-foreground">{totalChains} chain</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CHAIN_CATEGORIES.map(cat => (
          <ChainCard key={cat.id} cat={cat} />
        ))}
      </div>

      <div className="rounded-xl border border-border bg-muted/40 px-5 py-4 text-xs text-muted-foreground leading-relaxed">
        <strong className="text-foreground">Cara kerja fallback:</strong> Setiap request mencoba model pertama di chain.
        Jika API mengembalikan error (rate limit, model down, quota habis), sistem langsung lanjut ke model berikutnya
        secara otomatis — tanpa user tahu. Proses ini terus berulang sampai ada model yang berhasil merespons
        atau semua model di chain sudah dicoba.
      </div>
    </div>
  );
}

// ── SectionBroadcast ──────────────────────────────────────────────────────────
type BroadcastLog = {
  id: string;
  created_at: string;
  subject: string;
  body: string;
  target_mode: string;
  target_tiers: string[] | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  errors: string[] | null;
};

const PLACEHOLDERS = [
  { key: "{{nama}}",    label: "Nama",    desc: "Nama lengkap pengguna",                  example: "Ahmad Fauzi" },
  { key: "{{email}}",   label: "Email",   desc: "Alamat email pengguna",                  example: "contoh@email.com" },
  { key: "{{tier}}",    label: "Tier",    desc: "Paket aktif pengguna",                   example: "Free / Plus / Pro" },
  { key: "{{saldo}}",   label: "Saldo",   desc: "Saldo kredit pengguna saat ini",         example: "Rp 50.000" },
  { key: "{{hari}}",    label: "Hari",    desc: "Nama hari dalam Bahasa Indonesia",       example: "Senin" },
  { key: "{{tanggal}}", label: "Tanggal", desc: "Tanggal saat email dikirim (2 digit)",   example: "11" },
  { key: "{{bulan}}",   label: "Bulan",   desc: "Nama bulan dalam Bahasa Indonesia",      example: "Mei" },
  { key: "{{tahun}}",   label: "Tahun",   desc: "Tahun saat email dikirim",               example: "2026" },
];

const BULAN_PREVIEW = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const HARI_PREVIEW  = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];

function resolvePreview(text: string): string {
  const now = new Date();
  return text
    .replace(/\{\{nama\}\}/gi, "Ahmad")
    .replace(/\{\{email\}\}/gi, "contoh@email.com")
    .replace(/\{\{tier\}\}/gi, "Free")
    .replace(/\{\{saldo\}\}/gi, "Rp 50.000")
    .replace(/\{\{hari\}\}/gi, HARI_PREVIEW[now.getDay()])
    .replace(/\{\{tanggal\}\}/gi, String(now.getDate()).padStart(2, "0"))
    .replace(/\{\{bulan\}\}/gi, BULAN_PREVIEW[now.getMonth()])
    .replace(/\{\{tahun\}\}/gi, String(now.getFullYear()));
}

function buildPreviewHtml(subject: string, bodyText: string): string {
  const safeSubj = resolvePreview(subject) || "Subject email...";
  const safeBody = resolvePreview(bodyText) || "Isi email akan tampil di sini...";
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeSubj}</title></head>
<body style="margin:0;padding:0;background:#eef0fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef0fb;padding:32px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(71,77,235,0.10);">
      <tr><td style="background:linear-gradient(135deg,#2d2b8f 0%,#474deb 100%);padding:26px 36px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><span style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">PioCode</span></td>
          <td align="right"><span style="font-size:10px;color:rgba(255,255,255,0.55);letter-spacing:1px;text-transform:uppercase;font-weight:600;">Pemberitahuan</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:36px 36px 24px;">
        <h2 style="margin:0 0 20px;font-size:21px;font-weight:700;color:#0f172a;line-height:1.3;">${safeSubj}</h2>
        <div style="font-size:15px;color:#475569;line-height:1.85;">${safeBody.replace(/\n/g, "<br>")}</div>
      </td></tr>
      <tr><td style="padding:0 36px 32px;">
        <a href="https://pio.codes" style="display:inline-block;padding:11px 26px;background:#474deb;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;letter-spacing:-0.1px;">Buka PioCode &rarr;</a>
      </td></tr>
      <tr><td style="padding:18px 36px 22px;border-top:1px solid #e8ecf8;background:#f8f9fd;">
        <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.7;">Kamu menerima email ini karena terdaftar di PioCode. Jika tidak ingin menerima email semacam ini, hubungi <a href="mailto:noreply@pio.codes" style="color:#474deb;text-decoration:none;">noreply@pio.codes</a>.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function SectionBroadcast({ showToast }: { showToast: (msg: string, ok?: boolean) => void }) {
  const [activeTab, setActiveTab] = useState<"tulis" | "riwayat">("tulis");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<"all" | "select" | "custom">("all");
  const [customEmails, setCustomEmails] = useState("");
  const [selectedTiers, setSelectedTiers] = useState<Set<string>>(new Set());
  const [users, setUsers] = useState<{ id: string; email: string; full_name: string; tier: string }[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showList, setShowList] = useState(false);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; total: number; errors: string[] } | null>(null);
  const [smtpMissing, setSmtpMissing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [logs, setLogs] = useState<BroadcastLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setUsersLoading(true);
    authHeader().then((h) =>
      fetch("/api/admin/users", { headers: h })
        .then((r) => r.json())
        .then((d) => {
          setUsers((d.users ?? []).map((u: any) => ({
            id: u.id, email: u.email ?? "", full_name: u.full_name ?? "", tier: u.tier,
          })));
        })
        .finally(() => setUsersLoading(false))
    );
  }, []);

  const loadLogs = useCallback(() => {
    setLogsLoading(true);
    authHeader().then((h) =>
      fetch("/api/admin/broadcast-logs", { headers: h })
        .then(async (r) => {
          const text = await r.text();
          try {
            const d = JSON.parse(text);
            if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
            setLogs(d.logs ?? []);
          } catch (e: any) {
            console.error("[broadcast-logs] parse error:", text.slice(0, 300));
            throw e;
          }
        })
        .catch((e: any) => showToast(`Gagal memuat riwayat: ${e.message}`, false))
        .finally(() => setLogsLoading(false))
    );
  }, [showToast]);

  useEffect(() => {
    if (activeTab === "riwayat") loadLogs();
  }, [activeTab, loadLogs]);

  const filtered = users.filter((u) =>
    !search || u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const tierFiltered = selectedTiers.size === 0
    ? users
    : users.filter((u) => selectedTiers.has(u.tier));

  const parsedCustomEmails = customEmails
    .split(/[\n,]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));

  const recipientCount = target === "all"
    ? (usersLoading ? "..." : tierFiltered.length)
    : target === "custom"
    ? parsedCustomEmails.length
    : selected.size;

  function toggleUser(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((u) => u.id)));
  }
  function toggleTier(tier: string) {
    setSelectedTiers((prev) => { const n = new Set(prev); n.has(tier) ? n.delete(tier) : n.add(tier); return n; });
  }

  function insertPlaceholder(ph: string) {
    const el = bodyRef.current;
    if (!el) { setBody((prev) => prev + ph); return; }
    const start = el.selectionStart;
    const end   = el.selectionEnd;
    const next  = body.slice(0, start) + ph + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + ph.length, start + ph.length);
    });
  }

  async function handleSend() {
    setConfirmOpen(false);
    setSending(true);
    setResult(null);
    setSmtpMissing(false);
    try {
      const r = await fetch("/api/admin/broadcast-email", {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          userIds: target === "custom" ? undefined : target === "all" ? "all" : Array.from(selected),
          tiers: target === "all" && selectedTiers.size > 0 ? Array.from(selectedTiers) : undefined,
          customEmails: target === "custom" ? parsedCustomEmails : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.smtp_missing) setSmtpMissing(true);
        else showToast(data.error ?? "Gagal mengirim email.", false);
        return;
      }
      setResult(data);
      showToast(`Email terkirim ke ${data.sent} pengguna.`, true);
    } catch (e: any) {
      showToast(e.message, false);
    } finally {
      setSending(false);
    }
  }

  const tierBadgeColor: Record<string, string> = {
    free: "bg-muted text-muted-foreground",
    plus: "bg-blue-500/10 text-blue-600",
    pro:  "bg-violet-500/10 text-violet-600",
  };
  const tierActivePill: Record<string, string> = {
    free: "bg-zinc-700 text-white border-zinc-700",
    plus: "bg-blue-500 text-white border-blue-500",
    pro:  "bg-violet-500 text-white border-violet-500",
  };

  const canSend = !sending && !!subject.trim() && !!body.trim() &&
    (target !== "select" || selected.size > 0) &&
    (target !== "custom" || parsedCustomEmails.length > 0);

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-1 bg-muted/60 rounded-xl p-1">
          {(["tulis", "riwayat"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "tulis" ? <Send className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
              {tab === "tulis" ? "Tulis Email" : "Riwayat"}
              {tab === "riwayat" && logs.length > 0 && (
                <span className="bg-muted text-muted-foreground text-[10px] px-1.5 rounded-full">{logs.length}</span>
              )}
            </button>
          ))}
        </div>

        {activeTab === "tulis" && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={!subject.trim() && !body.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-accent transition-colors disabled:opacity-40"
            >
              <Mail className="w-4 h-4" />
              Preview
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={!canSend}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? "Mengirim..." : `Kirim ke ${recipientCount} penerima`}
            </button>
          </div>
        )}
        {activeTab === "riwayat" && (
          <button onClick={loadLogs} disabled={logsLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50">
            <RefreshCw className={cn("w-3 h-3", logsLoading && "animate-spin")} /> Refresh
          </button>
        )}
      </div>

      {/* ── Alerts ── */}
      {smtpMissing && (
        <div className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 flex gap-3 items-start">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-xs flex-1">
            <span className="font-semibold text-amber-800 dark:text-amber-300">SMTP belum dikonfigurasi. </span>
            <span className="text-amber-700 dark:text-amber-400">Tambahkan secret:{" "}
              {["SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASS","SMTP_FROM"].map((k) => (
                <code key={k} className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded mx-0.5">{k}</code>
              ))}
            </span>
          </div>
          <button onClick={() => setSmtpMissing(false)} className="shrink-0 text-amber-500 hover:text-amber-700"><X className="w-4 h-4" /></button>
        </div>
      )}
      {result && (
        <div className={cn(
          "shrink-0 rounded-xl border px-4 py-3 flex gap-3 items-center",
          result.failed === 0 ? "border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800"
                               : "border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800"
        )}>
          <Check className={cn("w-4 h-4 shrink-0", result.failed === 0 ? "text-green-600" : "text-amber-500")} />
          <p className={cn("text-xs flex-1 font-medium", result.failed === 0 ? "text-green-800 dark:text-green-300" : "text-amber-800 dark:text-amber-300")}>
            Selesai — <strong>{result.sent}</strong> berhasil, <strong>{result.failed}</strong> gagal dari <strong>{result.total}</strong> penerima
            {result.errors?.length > 0 && <span className="opacity-70"> · {result.errors[0]}</span>}
          </p>
          <button onClick={() => setResult(null)} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ══ TAB: TULIS ══ */}
      {activeTab === "tulis" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-3 pb-4">

            {/* Subject */}
            <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-1.5 shrink-0">
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <Input
                placeholder="Contoh: Update terbaru PioCode 🚀"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="text-sm h-9"
              />
            </div>

            {/* Penerima */}
            <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-2.5 shrink-0">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Penerima</label>
                {target === "select" && selected.size > 0 && (
                  <span className="text-xs text-primary font-medium">{selected.size} dipilih</span>
                )}
              </div>
              <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                {(["all","select","custom"] as const).map((t, i) => (
                  <button
                    key={t}
                    onClick={() => setTarget(t)}
                    className={cn(
                      "flex-1 py-1.5 font-medium transition-colors",
                      i > 0 && "border-l border-border",
                      target === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {t === "all" ? "Semua" : t === "select" ? "Pilih Manual" : "Email Custom"}
                  </button>
                ))}
              </div>

              {target === "all" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setSelectedTiers(new Set())}
                      className={cn("text-xs px-2.5 py-1 rounded-full border font-medium transition-colors",
                        selectedTiers.size === 0 ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-accent"
                      )}
                    >
                      Semua ({usersLoading ? "…" : users.length})
                    </button>
                    {(["free","plus","pro"] as const).map((tier) => (
                      <button key={tier} onClick={() => toggleTier(tier)}
                        className={cn("text-xs px-2.5 py-1 rounded-full border font-medium capitalize transition-colors",
                          selectedTiers.has(tier) ? tierActivePill[tier] : "border-border text-muted-foreground hover:bg-accent"
                        )}
                      >
                        {tier} ({usersLoading ? "…" : users.filter((u) => u.tier === tier).length})
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {selectedTiers.size === 0
                      ? `${usersLoading ? "…" : users.length} penerima — semua tier`
                      : `${tierFiltered.length} penerima — tier ${Array.from(selectedTiers).join(", ")}`}
                  </p>
                </div>
              )}

              {target === "custom" && (
                <div className="space-y-1.5">
                  <textarea
                    placeholder={"test@example.com\nuser@gmail.com, another@email.com"}
                    value={customEmails}
                    onChange={(e) => setCustomEmails(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 resize-none font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {parsedCustomEmails.length > 0
                      ? `${parsedCustomEmails.length} alamat email terdeteksi`
                      : "Pisahkan dengan koma atau enter"}
                  </p>
                </div>
              )}

              {target === "select" && (
                <div className="space-y-1.5">
                  <button onClick={() => setShowList((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-xs"
                  >
                    <span className="text-muted-foreground">
                      {selected.size > 0 ? `${selected.size} pengguna dipilih` : "Klik untuk pilih pengguna"}
                    </span>
                    {showList ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
                  </button>
                  {showList && (
                    <div className="space-y-1.5">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                        <input type="text" placeholder="Cari email atau nama..." value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-input bg-background text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                        />
                      </div>
                      {usersLoading ? (
                        <div className="flex items-center justify-center py-3 text-muted-foreground text-xs gap-2">
                          <Loader2 className="w-3 h-3 animate-spin" /> Memuat...
                        </div>
                      ) : (
                        <div className="rounded-lg border border-border overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/40 cursor-pointer hover:bg-muted/70 transition-colors" onClick={toggleAll}>
                            <div className={cn("w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors",
                              selected.size > 0 && selected.size === filtered.length ? "bg-primary border-primary text-primary-foreground" : "border-border"
                            )}>
                              {selected.size > 0 && selected.size === filtered.length && <Check className="w-2 h-2" />}
                            </div>
                            <span className="text-xs text-muted-foreground flex-1">{selected.size > 0 ? `${selected.size} dipilih` : "Pilih semua"} ({filtered.length})</span>
                            <button onClick={(e) => { e.stopPropagation(); setShowList(false); }} className="text-muted-foreground hover:text-foreground p-0.5 rounded">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="max-h-32 overflow-y-auto divide-y divide-border">
                            {filtered.length === 0 ? (
                              <div className="py-4 text-center text-xs text-muted-foreground">Tidak ditemukan.</div>
                            ) : filtered.map((u) => (
                              <div key={u.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent transition-colors" onClick={() => toggleUser(u.id)}>
                                <div className={cn("w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors",
                                  selected.has(u.id) ? "bg-primary border-primary text-primary-foreground" : "border-border"
                                )}>
                                  {selected.has(u.id) && <Check className="w-2 h-2" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs truncate">{u.full_name || u.email}</div>
                                  {u.full_name && <div className="text-[10px] text-muted-foreground truncate">{u.email}</div>}
                                </div>
                                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0", tierBadgeColor[u.tier] ?? tierBadgeColor.free)}>{u.tier}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Body + placeholder chips */}
            <div className="rounded-xl border border-border bg-card px-4 py-3 flex flex-col gap-2 flex-1 min-h-0">
              <label className="text-xs font-medium text-muted-foreground shrink-0">Isi Email</label>
              <textarea
                ref={bodyRef}
                placeholder={"Halo {{nama}}!\n\nKami ingin memberitahu kamu bahwa..."}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="flex-1 min-h-[220px] w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 resize-none font-mono"
              />
              {/* Placeholder chips */}
              <div className="shrink-0 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground">Klik untuk sisipkan placeholder:</p>
                  <button onClick={() => setShowGuide((v) => !v)} className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                    {showGuide ? "Tutup panduan" : "Lihat panduan"} <ChevronDown className={cn("w-2.5 h-2.5 transition-transform", showGuide && "rotate-180")} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map((ph) => (
                    <button key={ph.key} onClick={() => insertPlaceholder(ph.key)}
                      className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-primary/8 hover:bg-primary/15 text-primary border border-primary/20 transition-colors"
                    >
                      {ph.key}
                    </button>
                  ))}
                </div>
                {showGuide && (
                  <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5 mt-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Panduan Placeholder</p>
                    {PLACEHOLDERS.map((ph) => (
                      <div key={ph.key} className="flex items-start gap-2 text-[11px]">
                        <code className="font-mono text-primary bg-primary/8 px-1.5 py-0.5 rounded shrink-0">{ph.key}</code>
                        <span className="text-muted-foreground flex-1">{ph.desc} <span className="text-foreground/50">(contoh: {ph.example})</span></span>
                      </div>
                    ))}
                    <p className="text-[10px] text-muted-foreground/70 pt-1 border-t border-border mt-2">Preview menggunakan nilai contoh. Nilai asli diambil dari data masing-masing pengguna saat email dikirim.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl w-full p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Mail className="w-4 h-4 text-muted-foreground" />
              Preview Email
              <span className="text-xs font-normal text-muted-foreground ml-1 italic">Placeholder ditampilkan dengan nilai contoh</span>
            </DialogTitle>
          </DialogHeader>
          <iframe
            key={previewOpen ? subject + body : "closed"}
            srcDoc={buildPreviewHtml(subject, body)}
            sandbox="allow-same-origin"
            className="w-full border-0 bg-[#f0f0f1]"
            style={{ height: "70vh" }}
            title="Email Preview"
          />
        </DialogContent>
      </Dialog>

      {/* ══ TAB: RIWAYAT ══ */}
      {activeTab === "riwayat" && (
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-border bg-card">
          {logsLoading ? (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Memuat riwayat...
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <Mail className="w-8 h-8 opacity-30" />
              <p className="text-sm">Belum ada broadcast yang terkirim.</p>
              <p className="text-xs opacity-60">Buat tabel <code className="font-mono">broadcast_logs</code> di Supabase jika belum.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {logs.map((log) => {
                const isExpanded = expandedLog === log.id;
                const allOk = log.failed_count === 0;
                const d = new Date(log.created_at);
                const dateStr = d.toLocaleDateString("id-ID", { day:"2-digit", month:"short", year:"numeric" });
                const timeStr = d.toLocaleTimeString("id-ID", { hour:"2-digit", minute:"2-digit" });
                const targetLabel = log.target_mode === "all" ? "Semua pengguna"
                  : log.target_mode === "tiers" ? `Tier: ${(log.target_tiers ?? []).join(", ")}`
                  : "Pilihan manual";
                return (
                  <div key={log.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", allOk ? "bg-green-500" : "bg-amber-400")} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground truncate">{log.subject}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{dateStr} · {timeStr}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="text-[11px] text-muted-foreground">{targetLabel}</span>
                          <span className="text-[10px] text-muted-foreground">·</span>
                          <span className="text-[11px] text-green-600 font-medium">{log.sent_count} terkirim</span>
                          {log.failed_count > 0 && (
                            <>
                              <span className="text-[10px] text-muted-foreground">·</span>
                              <span className="text-[11px] text-amber-500 font-medium">{log.failed_count} gagal</span>
                            </>
                          )}
                          <span className="text-[10px] text-muted-foreground">·</span>
                          <span className="text-[11px] text-muted-foreground">{log.recipient_count} total penerima</span>
                        </div>
                        {(log.errors && log.errors.length > 0) && (
                          <button onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                            className="text-[11px] text-amber-500 hover:underline mt-1 flex items-center gap-0.5"
                          >
                            Lihat {log.errors.length} error <ChevronDown className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-180")} />
                          </button>
                        )}
                        {isExpanded && log.errors && (
                          <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-3 py-2 space-y-1">
                            {log.errors.map((e, i) => (
                              <p key={i} className="text-[11px] font-mono text-amber-700 dark:text-amber-300">{e}</p>
                            ))}
                          </div>
                        )}
                        <button
                          className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground mt-1 flex items-center gap-0.5"
                          onClick={() => setExpandedLog(expandedLog === log.id + "_body" ? null : log.id + "_body")}
                        >
                          {expandedLog === log.id + "_body" ? "Sembunyikan isi" : "Lihat isi email"} <ChevronDown className={cn("w-3 h-3 transition-transform", expandedLog === log.id + "_body" && "rotate-180")} />
                        </button>
                        {expandedLog === log.id + "_body" && (
                          <div className="mt-2 rounded-lg bg-muted/50 border border-border px-3 py-2">
                            <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{log.body}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Confirm dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kirim broadcast email?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Email <strong className="text-foreground">&ldquo;{subject}&rdquo;</strong> akan dikirim ke{" "}
                  <strong className="text-foreground">{recipientCount} penerima</strong>.
                </p>
                <p>Placeholder seperti <code className="font-mono text-xs bg-muted px-1 rounded">{"{{nama}}"}</code> akan otomatis diisi per penerima.</p>
                <p className="text-amber-600 dark:text-amber-400">Email yang sudah dikirim tidak bisa ditarik kembali.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleSend}>Ya, Kirim Sekarang</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── SectionRedeemCodes ────────────────────────────────────────────────────────
type RedeemCode = {
  id: string; code: string; description: string | null;
  credit_amount_idr: number; max_redemptions: number | null;
  current_redemptions: number; expires_at: string | null;
  created_by: string | null; created_at: string; is_active: boolean;
  grant_tier: "plus" | "pro" | null;
  tier_duration_days: number | null;
  grant_tier_bonus: boolean;
};

type Redemption = {
  id: string; redeemed_at: string; credit_amount_idr: number;
  grant_tier: string | null; user_id: string;
  full_name: string | null; email: string | null;
};

type CodeForm = {
  code: string; description: string; credit_amount_idr: string;
  max_redemptions: string; expires_at: string;
  grant_tier: "" | "plus" | "pro";
  tier_duration_days: string;
  grant_tier_bonus: boolean;
};

const EMPTY_FORM: CodeForm = {
  code: "", description: "", credit_amount_idr: "", max_redemptions: "", expires_at: "",
  grant_tier: "", tier_duration_days: "30", grant_tier_bonus: false,
};

function genRandomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function SectionRedeemCodes({ showToast }: { showToast: (msg: string, ok: boolean) => void }) {
  const [codes, setCodes] = useState<RedeemCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CodeForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<RedeemCode | null>(null);
  const [editForm, setEditForm] = useState<CodeForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [viewingCode, setViewingCode] = useState<RedeemCode | null>(null);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [redemptionsLoading, setRedemptionsLoading] = useState(false);

  async function loadCodes(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const h = await authHeader();
      const r = await fetch("/api/admin/redeem-codes", { headers: h });
      const d = await r.json();
      setCodes(d.codes ?? []);
      setLastUpdated(new Date());
    } catch (e) {
      console.error("[loadCodes]", e);
    } finally {
      if (!silent) setLoading(false);
      else setRefreshing(false);
    }
  }

  useEffect(() => {
    loadCodes();
    const interval = setInterval(() => loadCodes(true), 10_000);
    return () => clearInterval(interval);
  }, []);

  async function handleCreate() {
    if (!form.code.trim()) return;
    const creditAmt = Number(form.credit_amount_idr || 0);
    if (creditAmt === 0 && !form.grant_tier) {
      showToast("Masukkan kredit atau pilih tier yang akan diberikan.", false); return;
    }
    setCreating(true);
    try {
      const h = await authHeader();
      const r = await fetch("/api/admin/redeem-codes", {
        method: "POST", headers: h,
        body: JSON.stringify({
          code: form.code.trim(),
          description: form.description.trim() || undefined,
          credit_amount_idr: creditAmt,
          max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
          expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
          grant_tier: form.grant_tier || null,
          tier_duration_days: form.grant_tier ? Number(form.tier_duration_days || 30) : null,
          grant_tier_bonus: form.grant_tier ? form.grant_tier_bonus : false,
        }),
      });
      const d = await r.json();
      if (!r.ok) { showToast(d.error ?? "Gagal buat kode.", false); return; }
      showToast(`Kode "${form.code.toUpperCase()}" berhasil dibuat.`, true);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await loadCodes();
    } catch (e: any) {
      showToast(e.message ?? "Terjadi kesalahan.", false);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(rc: RedeemCode) {
    setEditForm({
      code: rc.code,
      description: rc.description ?? "",
      credit_amount_idr: String(rc.credit_amount_idr),
      max_redemptions: rc.max_redemptions != null ? String(rc.max_redemptions) : "",
      expires_at: rc.expires_at ? rc.expires_at.slice(0, 16) : "",
      grant_tier: (rc.grant_tier as "" | "plus" | "pro") ?? "",
      tier_duration_days: String(rc.tier_duration_days ?? 30),
      grant_tier_bonus: rc.grant_tier_bonus ?? false,
    });
    setEditingCode(rc);
  }

  async function handleSaveEdit() {
    if (!editingCode || !editForm.code.trim()) return;
    const creditAmt = Number(editForm.credit_amount_idr || 0);
    if (creditAmt < 0) { showToast("Kredit tidak boleh negatif.", false); return; }
    if (creditAmt === 0 && !editForm.grant_tier) {
      showToast("Kode harus memberikan kredit atau tier.", false); return;
    }
    setSaving(true);
    try {
      const h = await authHeader();
      const r = await fetch(`/api/admin/redeem-codes/${editingCode.id}`, {
        method: "PATCH", headers: h,
        body: JSON.stringify({
          code: editForm.code.trim(),
          description: editForm.description.trim() || null,
          credit_amount_idr: creditAmt,
          max_redemptions: editForm.max_redemptions ? Number(editForm.max_redemptions) : null,
          expires_at: editForm.expires_at ? new Date(editForm.expires_at).toISOString() : null,
          grant_tier: editForm.grant_tier || null,
          tier_duration_days: editForm.grant_tier ? Number(editForm.tier_duration_days || 30) : null,
          grant_tier_bonus: editForm.grant_tier ? editForm.grant_tier_bonus : false,
        }),
      });
      const d = await r.json();
      if (!r.ok) { showToast(d.error ?? "Gagal menyimpan.", false); return; }
      showToast("Kode berhasil diperbarui.", true);
      setEditingCode(null);
      await loadCodes();
    } catch (e: any) {
      showToast(e.message ?? "Terjadi kesalahan.", false);
    } finally {
      setSaving(false);
    }
  }

  async function openViewRedemptions(rc: RedeemCode) {
    setViewingCode(rc);
    setRedemptions([]);
    setRedemptionsLoading(true);
    try {
      const h = await authHeader();
      const r = await fetch(`/api/admin/redeem-codes/${rc.id}/redemptions`, { headers: h });
      const d = await r.json();
      setRedemptions(d.redemptions ?? []);
    } catch (e) {
      console.error("[openViewRedemptions]", e);
    } finally {
      setRedemptionsLoading(false);
    }
  }

  async function handleToggleActive(rc: RedeemCode) {
    setTogglingId(rc.id);
    const h = await authHeader();
    await fetch(`/api/admin/redeem-codes/${rc.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ is_active: !rc.is_active }),
    });
    setTogglingId(null);
    await loadCodes();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setConfirmDeleteId(null);
    const h = await authHeader();
    await fetch(`/api/admin/redeem-codes/${id}`, { method: "DELETE", headers: h });
    setDeletingId(null);
    await loadCodes();
    showToast("Kode berhasil dihapus.", true);
  }

  function getStatus(rc: RedeemCode): { label: string; color: string } {
    if (!rc.is_active) return { label: "Nonaktif", color: "bg-muted text-muted-foreground" };
    if (rc.expires_at && new Date(rc.expires_at) < new Date()) return { label: "Kedaluwarsa", color: "bg-amber-500/10 text-amber-600" };
    if (rc.max_redemptions !== null && rc.current_redemptions >= rc.max_redemptions) return { label: "Habis", color: "bg-rose-500/10 text-rose-600" };
    return { label: "Aktif", color: "bg-green-500/10 text-green-600" };
  }

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—";

  function TierFormFields({ f, setF }: { f: CodeForm; setF: (fn: (prev: CodeForm) => CodeForm) => void }) {
    return (
      <>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Grant Tier <span className="opacity-60">(opsional)</span></label>
          <Select value={f.grant_tier} onValueChange={(v) => setF((p) => ({ ...p, grant_tier: v as CodeForm["grant_tier"] }))}>
            <SelectTrigger className="text-sm"><SelectValue placeholder="Tidak ada" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tidak ada (kredit saja)</SelectItem>
              <SelectItem value="plus">Plus</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {f.grant_tier && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Durasi (hari)</label>
              <Input
                type="number" placeholder="30" min={1}
                value={f.tier_duration_days}
                onChange={(e) => setF((p) => ({ ...p, tier_duration_days: e.target.value }))}
                className="text-sm"
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-2.5 p-3 rounded-lg bg-muted/40 border border-border">
              <input
                id="grant_tier_bonus"
                type="checkbox"
                checked={f.grant_tier_bonus}
                onChange={(e) => setF((p) => ({ ...p, grant_tier_bonus: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="grant_tier_bonus" className="text-xs text-muted-foreground cursor-pointer">
                <span className="font-medium text-foreground">Beri bonus upgrade</span>
                {" "}— kredit bonus tier sekali (idempotent): Plus Rp 45.000 / Pro Rp 100.000
              </label>
            </div>
          </>
        )}
      </>
    );
  }

  function CodePreview({ f }: { f: CodeForm }) {
    if (!f.code) return null;
    const credit = Number(f.credit_amount_idr || 0);
    const hasContent = credit > 0 || f.grant_tier;
    if (!hasContent) return null;
    return (
      <div className="sm:col-span-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5 text-xs text-muted-foreground">
        Kode <code className="font-mono font-semibold text-foreground">{f.code}</code> akan memberikan
        {credit > 0 && <> <strong className="text-green-600">{formatIDR(credit)}</strong> kredit</>}
        {credit > 0 && f.grant_tier && " +"}
        {f.grant_tier && (
          <> akses <strong className={f.grant_tier === "pro" ? "text-purple-600" : "text-blue-600"}>{f.grant_tier === "pro" ? "Pro" : "Plus"}</strong> selama {f.tier_duration_days || 30} hari</>
        )}
        {f.max_redemptions ? ` ke maks ${f.max_redemptions} pengguna` : " ke pengguna tak terbatas"}
        {f.expires_at ? ` hingga ${new Date(f.expires_at).toLocaleDateString("id-ID")}` : ""}.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground leading-tight">Kode Redeem</h2>
            <span className="flex items-center gap-1 text-[10px] text-green-500 font-medium">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
              Live
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Buat & kelola kode untuk membagikan kredit atau akses tier kepada pengguna.
            {lastUpdated && (
              <span className="ml-1.5">
                · Diperbarui {lastUpdated.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                {refreshing && <span className="ml-1 opacity-60">(memperbarui...)</span>}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => loadCodes(true)}
            disabled={refreshing || loading}
            className="p-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
            title="Refresh sekarang"
          >
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          </button>
          <button
            onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Buat Kode
          </button>
        </div>
      </div>

      {/* ── Create Dialog ── */}
      <Dialog open={showCreate} onOpenChange={(o) => { if (!creating) setShowCreate(o); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-primary" /> Buat Kode Baru
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Kode */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Kode *</label>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="WELCOME2025"
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, "") }))}
                    className="text-sm font-mono tracking-wider"
                  />
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, code: genRandomCode() }))}
                    className="px-2 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs whitespace-nowrap"
                    title="Generate acak"
                  >
                    Acak
                  </button>
                </div>
              </div>
              {/* Kredit */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Kredit (IDR) <span className="opacity-60">(0 jika tier-only)</span></label>
                <Input
                  type="number" placeholder="50000" min={0}
                  value={form.credit_amount_idr}
                  onChange={(e) => setForm((f) => ({ ...f, credit_amount_idr: e.target.value }))}
                  className="text-sm"
                />
              </div>
              {/* Maks pengguna */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Maks Pengguna <span className="opacity-60">(kosong = ∞)</span></label>
                <Input
                  type="number" placeholder="100" min={1}
                  value={form.max_redemptions}
                  onChange={(e) => setForm((f) => ({ ...f, max_redemptions: e.target.value }))}
                  className="text-sm"
                />
              </div>
              {/* Kedaluwarsa */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Kedaluwarsa <span className="opacity-60">(opsional)</span>
                </label>
                <Input
                  type="datetime-local"
                  value={form.expires_at}
                  onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                  className="text-sm"
                />
              </div>
              {/* Tier fields */}
              <TierFormFields f={form} setF={setForm} />
              {/* Deskripsi */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Deskripsi internal <span className="opacity-60">(tidak dilihat user)</span></label>
                <Input
                  placeholder="Misal: Kampanye Ramadan 2025"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <CodePreview f={form} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button onClick={() => setShowCreate(false)} disabled={creating}
              className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-accent transition-colors disabled:opacity-50">
              Batal
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !form.code.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Simpan Kode
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ── */}
      <Dialog open={!!editingCode} onOpenChange={(o) => { if (!saving && !o) setEditingCode(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-primary" /> Edit Kode
              {editingCode && <code className="ml-1 font-mono text-sm text-muted-foreground">{editingCode.code}</code>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Kode *</label>
                <Input
                  placeholder="WELCOME2025"
                  value={editForm.code}
                  onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, "") }))}
                  className="text-sm font-mono tracking-wider"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Kredit (IDR)</label>
                <Input
                  type="number" placeholder="50000" min={0}
                  value={editForm.credit_amount_idr}
                  onChange={(e) => setEditForm((f) => ({ ...f, credit_amount_idr: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Maks Pengguna <span className="opacity-60">(kosong = ∞)</span></label>
                <Input
                  type="number" placeholder="100" min={1}
                  value={editForm.max_redemptions}
                  onChange={(e) => setEditForm((f) => ({ ...f, max_redemptions: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Kedaluwarsa
                </label>
                <Input
                  type="datetime-local"
                  value={editForm.expires_at}
                  onChange={(e) => setEditForm((f) => ({ ...f, expires_at: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <TierFormFields f={editForm} setF={setEditForm} />
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Deskripsi internal</label>
                <Input
                  placeholder="Misal: Kampanye Ramadan 2025"
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <CodePreview f={editForm} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button onClick={() => setEditingCode(null)} disabled={saving}
              className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-accent transition-colors disabled:opacity-50">
              Batal
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={saving || !editForm.code.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Simpan Perubahan
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Redemptions Modal ── */}
      <Dialog open={!!viewingCode} onOpenChange={(o) => { if (!o) setViewingCode(null); }}>
        <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-primary" /> Siapa yang Memakai
              {viewingCode && <code className="ml-1 font-mono text-sm text-muted-foreground">{viewingCode.code}</code>}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-1 px-1">
            {redemptionsLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Memuat...
              </div>
            ) : redemptions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Users className="w-8 h-8 opacity-20" />
                <p className="text-sm">Belum ada yang memakai kode ini.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm min-w-[400px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Pengguna</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Kredit</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Tier</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Waktu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {redemptions.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-xs">{r.full_name ?? "—"}</p>
                          <p className="text-[11px] text-muted-foreground">{r.email ?? r.user_id.slice(0, 12) + "..."}</p>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-green-600 text-xs whitespace-nowrap">
                          {r.credit_amount_idr > 0 ? formatIDR(r.credit_amount_idr) : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.grant_tier ? (
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-semibold",
                              r.grant_tier === "pro" ? "bg-purple-500/10 text-purple-600" : "bg-blue-500/10 text-blue-600"
                            )}>
                              {r.grant_tier === "pro" ? "Pro" : "Plus"}
                            </span>
                          ) : <span className="text-muted-foreground/50 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-[11px] whitespace-nowrap">{fmtDate(r.redeemed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <DialogFooter>
            <p className="text-xs text-muted-foreground mr-auto">
              {!redemptionsLoading && `${redemptions.length} pengguna`}
            </p>
            <button onClick={() => setViewingCode(null)}
              className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-accent transition-colors">
              Tutup
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── List ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Memuat...
        </div>
      ) : codes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Gift className="w-10 h-10 opacity-20" />
          <p className="text-sm">Belum ada kode redeem. Klik &quot;Buat Kode&quot; untuk mulai.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Kode</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Kredit / Tier</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Dipakai</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden sm:table-cell">Kedaluwarsa</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {codes.map((rc) => {
                const status = getStatus(rc);
                return (
                  <tr key={rc.id} className="hover:bg-muted/20 transition-colors">
                    {/* Kode */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <code className="font-mono font-semibold tracking-wider text-sm">{rc.code}</code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(rc.code); showToast("Kode disalin!", true); }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Salin kode"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      {rc.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 max-w-[180px] truncate">{rc.description}</p>
                      )}
                    </td>
                    {/* Kredit / Tier */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        {rc.credit_amount_idr > 0 && (
                          <span className="font-semibold text-green-600 whitespace-nowrap text-xs">{formatIDR(rc.credit_amount_idr)}</span>
                        )}
                        {rc.grant_tier && (
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full font-semibold w-fit",
                            rc.grant_tier === "pro" ? "bg-purple-500/10 text-purple-600" : "bg-blue-500/10 text-blue-600"
                          )}>
                            {rc.grant_tier === "pro" ? "Pro" : "Plus"} {rc.tier_duration_days ?? 30}h
                          </span>
                        )}
                        {rc.credit_amount_idr === 0 && !rc.grant_tier && (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </div>
                    </td>
                    {/* Dipakai — clickable jika ada */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openViewRedemptions(rc)}
                        className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors group"
                        title="Lihat siapa yang memakai"
                      >
                        <span className="group-hover:underline">
                          {rc.current_redemptions}
                          <span className="text-muted-foreground/50">/{rc.max_redemptions !== null ? rc.max_redemptions : "∞"}</span>
                        </span>
                        {rc.current_redemptions > 0 && <Eye className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
                      </button>
                    </td>
                    {/* Kedaluwarsa (hidden on mobile) */}
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap hidden sm:table-cell">
                      <div className="flex items-center gap-1">
                        {rc.expires_at ? <><Clock className="w-3 h-3 shrink-0" />{fmtDate(rc.expires_at)}</> : "—"}
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium", status.color)}>
                        {status.label}
                      </span>
                    </td>
                    {/* Aksi */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end flex-wrap">
                        {/* Edit */}
                        <button
                          onClick={() => openEdit(rc)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title="Edit kode"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {/* Toggle aktif */}
                        <button
                          onClick={() => handleToggleActive(rc)}
                          disabled={togglingId === rc.id}
                          className={cn(
                            "text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors whitespace-nowrap",
                            rc.is_active
                              ? "border-border text-muted-foreground hover:bg-accent"
                              : "border-primary/30 text-primary hover:bg-primary/10"
                          )}
                        >
                          {togglingId === rc.id
                            ? <Loader2 className="w-3 h-3 animate-spin inline" />
                            : rc.is_active ? "Nonaktifkan" : "Aktifkan"
                          }
                        </button>
                        {/* Hapus */}
                        {confirmDeleteId === rc.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(rc.id)}
                              disabled={deletingId === rc.id}
                              className="text-xs px-2 py-1 rounded-lg bg-rose-500 text-white hover:bg-rose-600 transition-colors font-medium"
                            >
                              {deletingId === rc.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Hapus?"}
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)} className="text-xs px-2 py-1 rounded-lg border border-border hover:bg-accent transition-colors">
                              Batal
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(rc.id)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                            title="Hapus kode"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { user, isAdmin, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const {
    users, stats, dailyUsage, isLoading, error,
    fetchUsers, fetchStats, fetchDailyUsage,
    updateRole, updatePremium, updateCredit, deleteUser,
  } = useAdmin();

  const [activeSection, setActiveSection] = useState<Section>("ringkasan");
  const [toDelete, setToDelete] = useState<AdminUser | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [viewingUser, setViewingUser] = useState<AdminUser | null>(null);
  const { toast, show: showToast } = useToast();

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) setLocation("/chat");
  }, [authLoading, user, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchUsers();
    fetchStats();
    fetchDailyUsage();
  }, [isAdmin]);

  // Saat list user di-refetch, sync ulang `editingUser` dari data terbaru
  // supaya nilai "Saldo sekarang" / tier yg ditampilin dialog selalu fresh.
  useEffect(() => {
    if (!editingUser) return;
    const fresh = users.find((u) => u.id === editingUser.id);
    if (fresh && fresh !== editingUser) setEditingUser(fresh);
  }, [users]);

  async function handleDelete() {
    if (!toDelete) return;
    setDeletingId(toDelete.id);
    try {
      await deleteUser(toDelete.id);
      showToast(`${toDelete.email} berhasil dihapus.`, true);
    } catch (e: any) {
      showToast(e.message, false);
    } finally {
      setDeletingId(null);
      setToDelete(null);
    }
  }

  function handleRefresh() {
    fetchUsers();
    fetchStats();
    fetchDailyUsage();
  }

  if (authLoading || !isAdmin) return null;

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">

      {/* ── Sidebar (desktop) ───────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-sidebar">
        {/* Brand */}
        <div className="px-4 py-4 flex items-center gap-2 border-b border-sidebar-border">
          <Logo size={28} />
          <div>
            <div className="text-sm font-semibold text-sidebar-foreground leading-tight">PioCode Admin</div>
            <div className="text-[10px] text-sidebar-foreground/50">Dashboard</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left",
                activeSection === id
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-2 py-3 border-t border-sidebar-border space-y-0.5">
          <button
            onClick={handleRefresh}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <RefreshCw className="w-4 h-4 shrink-0" />
            Refresh data
          </button>
          <button
            onClick={() => setLocation("/chat")}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            Kembali ke Chat
          </button>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={() => setLocation("/chat")} className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span className="font-semibold text-sm">Admin Dashboard</span>
          </div>
          <button onClick={handleRefresh} className="p-1.5 rounded-md hover:bg-muted transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </header>

        {/* Desktop content header */}
        <div className="hidden md:flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {NAV_ITEMS.find(n => n.id === activeSection)?.label}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {user?.email}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {/* Scrollable content */}
        <main className={cn(
          "flex-1 overflow-y-auto px-4 md:px-6 py-6",
          activeSection === "broadcast" && "flex flex-col overflow-hidden"
        )}>
          {activeSection === "ringkasan" && (
            <SectionRingkasan stats={stats} dailyUsage={dailyUsage} />
          )}
          {activeSection === "pengguna" && (
            <SectionPengguna
              users={users}
              isLoading={isLoading}
              error={error}
              currentUserId={user?.id}
              onView={setViewingUser}
              onEdit={setEditingUser}
              onDelete={setToDelete}
            />
          )}
          {activeSection === "harga" && (
            <SectionHarga showToast={showToast} />
          )}
          {activeSection === "changelog" && (
            <SectionChangelog showToast={showToast} />
          )}
          {activeSection === "model-chain" && (
            <SectionModelChain />
          )}
          {activeSection === "broadcast" && (
            <SectionBroadcast showToast={showToast} />
          )}
          {activeSection === "redeem-codes" && (
            <SectionRedeemCodes showToast={showToast} />
          )}
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="md:hidden flex border-t border-border bg-background shrink-0">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                activeSection === id
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="w-5 h-5" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Detail user (read-only side panel) ────────────────────────────── */}
      <UserDetailSheet
        user={viewingUser}
        isSelf={viewingUser?.id === user?.id}
        onClose={() => setViewingUser(null)}
        onEdit={setEditingUser}
        onDelete={setToDelete}
      />

      {/* ── Edit user (role / tier / saldo) ───────────────────────────────── */}
      <EditUserDialog
        key={editingUser?.id ?? "none"}
        user={editingUser}
        isSelf={editingUser?.id === user?.id}
        onClose={() => setEditingUser(null)}
        onSaved={(msg, ok) => showToast(msg, ok)}
        updateRole={updateRole}
        updatePremium={updatePremium}
        updateCredit={updateCredit}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus pengguna ini?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{toDelete?.email}</strong> akan dihapus permanen beserta semua datanya.
              Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={!!deletingId}
            >
              {deletingId ? "Menghapus..." : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={cn(
          "fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full text-sm font-medium shadow-lg",
          toast.ok ? "bg-green-600 text-white" : "bg-destructive text-destructive-foreground"
        )}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
