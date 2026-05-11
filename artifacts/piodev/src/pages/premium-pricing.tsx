import { useEffect, useState, useCallback, Fragment } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { usePremium } from "@/hooks/use-premium";
import { useTheme } from "@/hooks/use-theme";
import { usePricingConfig, discountedPrice, formatIDR, type TierPricing } from "@/hooks/use-pricing-config";
import { ArrowLeft, Check, Loader2, CreditCard, Sparkles, AlertTriangle, Tag, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function useInlineToast() {
  const [toast, setToast] = useState<string | null>(null);
  const show = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);
  return { toast, show };
}

type Tier = {
  id: "free" | "plus" | "pro";
  name: string;
  badge?: string;
  tagline: string;
  price: string;
  priceSuffix?: string;
  /** Periode singkat yang tampil inline di samping harga utama (mis. "/bulan"). */
  pricePeriod?: string;
  /** Original (pre-discount) price — kalau ada, tampil di-strikethrough di atas harga utama. */
  originalPrice?: string;
  /** Persentase diskon, mis. 50 → "50% OFF". 0 = no discount. */
  discountPercent?: number;
  /** Optional label promo, mis. "Diskon Lebaran". */
  discountLabel?: string;
  features: string[];
  cta: { label: string; disabled?: boolean; onClick?: () => void; primary?: boolean };
  secondaryCta?: { label: string; disabled?: boolean; onClick?: () => void };
  highlight?: boolean;
  comingSoon?: boolean;
};

export default function PremiumPricingPage() {
  const { user, isAdmin } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [, setLocation] = useLocation();
  const { status, isLoading, claimTrial } = usePremium(user?.id);
  const { toast, show: showToast } = useInlineToast();
  // Pricing config dari server (dinamis, bisa di-edit admin) — harus dipanggil
  // sebelum early-return apa pun supaya hook order tetap stabil tiap render.
  const pricing = usePricingConfig();

  const [trialModalOpen, setTrialModalOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const handleBuy = useCallback((tierName: "Plus" | "Pro") => {
    showToast(`Payment gateway untuk paket ${tierName} segera hadir. Tunggu update ya!`);
  }, [showToast]);

  const handleOpenTrialModal = useCallback(() => setTrialModalOpen(true), []);
  const handleCloseTrialModal = useCallback(() => {
    if (!claiming) setTrialModalOpen(false);
  }, [claiming]);

  const handleConfirmTrial = useCallback(async () => {
    setClaiming(true);
    try {
      const result = await claimTrial();
      if ("ok" in result && result.ok) {
        const bonusMsg = result.bonus_granted
          ? ` Bonus saldo Rp ${result.bonus_amount_idr.toLocaleString("id-ID")} udah masuk.`
          : "";
        showToast(`Berhasil! Plus aktif sampai 1 bulan ke depan.${bonusMsg}`);
        setTrialModalOpen(false);
      } else {
        const err = result as { error: string; message: string };
        showToast(err.message || "Gagal klaim uji coba. Coba lagi.");
        // Kalau errornya 'trial_already_claimed' atau 'already_premium', tutup modal
        if (err.error === "trial_already_claimed" || err.error === "already_premium" || err.error === "admin_bypass") {
          setTrialModalOpen(false);
        }
      }
    } catch {
      showToast("Gagal klaim uji coba. Cek koneksi internet kamu.");
    } finally {
      setClaiming(false);
    }
  }, [claimTrial, showToast]);

  useEffect(() => {
    if (!user) setLocation("/login");
  }, [user, setLocation]);

  if (!user) return null;

  if (isLoading || !status) {
    return (
      <div className={cn("min-h-dvh bg-background flex items-center justify-center", isDark ? "dark" : "")}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const userTier = status.tier ?? (status.isPremium ? "plus" : "free");
  const isPlusActive = userTier === "plus" && !isAdmin;
  const isProActive  = userTier === "pro"  && !isAdmin;
  const isPremium = status.isPremium || isAdmin;
  const trialClaimed = !!status.trialClaimedAt;
  // Tombol trial cuma untuk user free yang belum pernah klaim & bukan admin
  const showTrialButton = !isAdmin && !isPlusActive && !isProActive;

  const buildPriceProps = (t: TierPricing) => {
    const finalPrice = discountedPrice(t);
    const hasDiscount = t.discount_percent > 0 && finalPrice !== t.price_idr;
    return {
      price: formatIDR(finalPrice),
      originalPrice: hasDiscount ? formatIDR(t.price_idr) : undefined,
      discountPercent: hasDiscount ? t.discount_percent : 0,
      discountLabel: hasDiscount ? (t.discount_label || "") : "",
    };
  };
  const plusPrice = buildPriceProps(pricing.plus);
  const proPrice = buildPriceProps(pricing.pro);

  const tiers: Tier[] = [
    {
      id: "free",
      name: "Gratis",
      tagline: "Coba dulu — gratis selamanya",
      price: "Rp 0",
      priceSuffix: "selamanya",
      features: [
        "60.000 token per hari",
        "Akses model dasar",
        "7 gambar AI per hari",
        "3 video AI per bulan",
        "10 voice AI per bulan (TTS, clone, design)",
        "Pustaka: 10 file (10 MB/file) · 100 hal/bulan",
        "API key developer (Flash, Turbo, Qwen3-8B)",
        "Saldo kredit Rp 7.500 bonus daftar",
        "Hosting 1 project · Nano 256MB · Rp 30/jam",
      ],
      cta: !isPremium
        ? { label: "Paket Saat Ini", disabled: true }
        : { label: "Paket Dasar", disabled: true },
    },
    {
      id: "plus",
      name: "Plus",
      badge: "Populer",
      tagline: "Volume gede buat power user individual",
      ...plusPrice,
      pricePeriod: "/bulan",
      highlight: true,
      features: [
        "200.000 token per hari",
        "Semua model Plus & Pro",
        "25 gambar AI per hari",
        "12 video AI per bulan",
        "60 voice AI per bulan (TTS, clone, design)",
        "Pustaka: 20 file (20 MB/file) · 1.000 hal/bulan",
        "API key — semua model Plus",
        "Hosting 3 project · Micro 512MB · Rp 60/jam",
        "Custom domain hosting",
        "Bonus saldo Rp 45.000 (satu kali, saat upgrade)",
      ],
      cta: isAdmin
        ? { label: "Admin · Bypass", disabled: true }
        : isPlusActive
        ? { label: "Paket Aktif", disabled: true }
        : isProActive
        ? { label: "Sudah Pakai Pro", disabled: true }
        : { label: "Pilih & Beli Sekarang", primary: true, onClick: () => handleBuy("Plus") },
      secondaryCta: !showTrialButton
        ? undefined
        : trialClaimed
        ? { label: "Uji Coba Sudah Diklaim", disabled: true }
        : { label: "Ambil Gratis Uji Coba 1 Bulan", onClick: handleOpenTrialModal },
    },
    {
      id: "pro",
      name: "Pro",
      badge: "Baru",
      tagline: "Untuk developer & creator pro",
      ...proPrice,
      pricePeriod: "/bulan",
      features: [
        "360.000 token per hari",
        "Semua model Pro (frontier)",
        "40 gambar AI per hari",
        "20 video AI per bulan",
        "200 voice AI per bulan (TTS, clone, design)",
        "Pustaka: 35 file (30 MB/file) · 5.000 hal/bulan",
        "API key — semua model Pro",
        "Hosting 5 project · Small 1GB · Rp 120/jam",
        "Custom domain hosting",
        "Bonus saldo Rp 100.000 (satu kali, saat upgrade)",
      ],
      cta: isAdmin
        ? { label: "Admin · Bypass", disabled: true }
        : isProActive
        ? { label: "Paket Aktif", disabled: true }
        : { label: "Pilih & Beli Sekarang", onClick: () => handleBuy("Pro") },
    },
  ];

  return (
    <div className={cn("min-h-dvh bg-background text-foreground flex flex-col", isDark ? "dark" : "")}>
      <header className="sticky top-0 z-10 backdrop-blur-md bg-background/80 border-b border-border">
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-4">
          <button
            onClick={() => setLocation("/chat")}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="Kembali"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="font-semibold text-sm">Paket & Harga</span>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Paket yang tumbuh bersamamu
          </h1>
          <p className="text-sm text-muted-foreground mt-3 max-w-xl mx-auto">
            Mulai gratis. Upgrade kapan pun butuh kapasitas lebih besar.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 items-stretch">
          {tiers.map((t) => (
            <TierCard key={t.id} tier={t} />
          ))}
        </div>

        {/* Comparison table — detail fitur per tier */}
        <ComparisonTable userTier={userTier} isAdmin={isAdmin} />
      </main>

      {/* Toast — payment gateway segera hadir */}
      <div
        className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 pointer-events-none",
          toast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3",
        )}
        role="status"
        aria-live="polite"
      >
        {toast && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-foreground text-background shadow-lg max-w-[90vw]">
            <CreditCard className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">{toast}</span>
          </div>
        )}
      </div>

      {/* Modal konfirmasi klaim uji coba Plus */}
      {trialModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={handleCloseTrialModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="trial-modal-title"
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleCloseTrialModal}
              disabled={claiming}
              className="absolute top-4 right-4 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              aria-label="Tutup"
            >
              <XIcon className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-primary">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 id="trial-modal-title" className="text-lg font-semibold text-foreground leading-tight">
                  Uji Coba Plus 1 Bulan
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Gratis, tanpa kartu kredit.</p>
              </div>
            </div>

            <ul className="space-y-2.5 mb-5 text-sm text-foreground">
              <li className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" strokeWidth={2.5} />
                <span>Akses semua fitur Plus selama <strong>30 hari</strong></span>
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" strokeWidth={2.5} />
                <span>Bonus saldo <strong>Rp 45.000</strong> langsung masuk</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" strokeWidth={2.5} />
                <span>Otomatis kembali ke Free saat masa uji coba habis</span>
              </li>
            </ul>

            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 mb-5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                Uji coba <strong>cuma bisa diklaim sekali per akun</strong> dan tidak bisa dibatalkan. Pastikan kamu pakai email yang aktif.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCloseTrialModal}
                disabled={claiming}
                className="flex-1 h-10 rounded-lg text-sm font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmTrial}
                disabled={claiming}
                className="flex-1 h-10 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                data-testid="button-confirm-trial"
              >
                {claiming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Memproses…</span>
                  </>
                ) : (
                  <span>Aktifkan Sekarang</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  // Per-tier color tokens
  const isPlus = tier.id === "plus";
  const isPro = tier.id === "pro";

  const cardClasses = isPlus
    ? "border-primary/50 bg-gradient-to-b from-primary/[0.06] to-transparent shadow-lg shadow-primary/10"
    : isPro
    ? "border-amber-500/40 dark:border-amber-400/30 bg-gradient-to-b from-amber-500/[0.04] to-transparent"
    : "border-border";

  const badgeClasses = isPlus
    ? "bg-primary text-primary-foreground"
    : isPro
    ? "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400"
    : "bg-muted text-muted-foreground";

  const checkClasses = isPlus
    ? "text-primary"
    : isPro
    ? "text-amber-600 dark:text-amber-400"
    : "text-foreground/60";

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-5 sm:p-6 flex flex-col transition-shadow",
        cardClasses,
        tier.comingSoon && "opacity-80",
      )}
      data-testid={`card-tier-${tier.id}`}
    >
      {/* Name + badge */}
      <div className="flex items-center gap-2 mb-1.5 min-h-[24px]">
        <h3 className={cn(
          "text-base sm:text-lg font-semibold",
          isPlus ? "text-primary" : isPro ? "text-amber-600 dark:text-amber-400" : "text-foreground",
        )}>
          {tier.name}
        </h3>
        {tier.badge && (
          <span
            className={cn(
              "text-[10px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wide",
              badgeClasses,
            )}
          >
            {tier.badge}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-5">{tier.tagline}</p>

      {/* Price */}
      <div className="mb-5">
        {!!tier.discountPercent && tier.discountPercent > 0 && tier.originalPrice && (
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground line-through tabular-nums">
              {tier.originalPrice}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 uppercase tracking-wide">
              <Tag className="w-2.5 h-2.5" strokeWidth={3} />
              {tier.discountPercent}% OFF
            </span>
          </div>
        )}
        {tier.discountLabel && !!tier.discountPercent && tier.discountPercent > 0 && (
          <div className="mb-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 tracking-wide">
              🎉 {tier.discountLabel}
            </span>
          </div>
        )}
        <div className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight leading-none tabular-nums flex items-baseline gap-0.5">
          <span>{tier.price}</span>
          {tier.pricePeriod && (
            <span className="text-sm font-medium text-muted-foreground">
              {tier.pricePeriod}
            </span>
          )}
        </div>
        {tier.priceSuffix && (
          <p className="text-xs text-muted-foreground mt-1.5">{tier.priceSuffix}</p>
        )}
      </div>

      {/* CTA */}
      <button
        onClick={tier.cta.onClick}
        disabled={tier.cta.disabled}
        data-testid={`button-cta-${tier.id}`}
        className={cn(
          "w-full h-10 rounded-lg text-sm font-medium transition-all px-3",
          tier.cta.primary
            ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm shadow-primary/20"
            : isPlus
            ? "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
            : isPro
            ? "border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15"
            : "border border-border bg-background text-foreground hover:bg-muted",
          tier.cta.disabled && "cursor-not-allowed opacity-60 hover:bg-background",
        )}
      >
        <span className="truncate block">{tier.cta.label}</span>
      </button>

      {/* Secondary CTA (mis. uji coba gratis) */}
      {tier.secondaryCta && (
        <button
          onClick={tier.secondaryCta.onClick}
          disabled={tier.secondaryCta.disabled}
          data-testid={`button-secondary-cta-${tier.id}`}
          className={cn(
            "w-full h-10 rounded-lg text-sm font-medium transition-all px-3 mt-2",
            "border border-dashed border-primary/40 bg-transparent text-primary hover:bg-primary/10",
            tier.secondaryCta.disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
          )}
        >
          <span className="truncate block">{tier.secondaryCta.label}</span>
        </button>
      )}

      <div className="mb-6" />

      {/* Features */}
      <ul className="space-y-2.5 flex-1">
        {tier.features.slice(0, 5).map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
            <Check className={cn("w-3.5 h-3.5 shrink-0 mt-0.5", checkClasses)} strokeWidth={2.5} />
            <span>{f}</span>
          </li>
        ))}
        {tier.features.length > 5 && (
          <li>
            <button
              onClick={() => {
                document.getElementById("comparison-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={cn(
                "flex items-center gap-1 text-xs font-medium mt-1 hover:underline underline-offset-2 transition-colors",
                isPlus ? "text-primary" : isPro ? "text-amber-600 dark:text-amber-400" : "text-foreground/60 hover:text-foreground",
              )}
            >
              + {tier.features.length - 5} lainnya — lihat tabel perbandingan
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

type Cell = string | { yes: true } | { no: true };
type Row = { label: string; free: Cell; plus: Cell; pro: Cell };

const COMPARISON_GROUPS: Array<{ title: string; rows: Row[] }> = [
  {
    title: "Chat & Token",
    rows: [
      { label: "Token harian", free: "60.000", plus: "200.000", pro: "360.000" },
      { label: "Akses model premium (Plus, Coder)", free: { no: true }, plus: { yes: true }, pro: { yes: true } },
      { label: "Mode thinking & web search", free: { yes: true }, plus: { yes: true }, pro: { yes: true } },
    ],
  },
  {
    title: "Image, Video & Voice",
    rows: [
      { label: "Gambar AI per hari", free: "7", plus: "25", pro: "40" },
      { label: "Video AI per bulan", free: "3", plus: "12", pro: "20" },
      { label: "Voice AI per bulan (TTS + clone + design)", free: "10", plus: "60", pro: "200" },
      { label: "Voice cloning & voice design", free: { yes: true }, plus: { yes: true }, pro: { yes: true } },
      { label: "Galeri Studio (riwayat video & voice)", free: { yes: true }, plus: { yes: true }, pro: { yes: true } },
    ],
  },
  {
    title: "Pustaka (Knowledge Base)",
    rows: [
      { label: "Ukuran maksimum per file", free: "10 MB", plus: "20 MB", pro: "30 MB" },
      { label: "Jumlah file maksimum", free: "10", plus: "20", pro: "35" },
      { label: "Halaman parsing per bulan", free: "100", plus: "1.000", pro: "5.000" },
      { label: "Attach dokumen ke chat", free: { yes: true }, plus: { yes: true }, pro: { yes: true } },
    ],
  },
  {
    title: "Developer & API",
    rows: [
      { label: "API key (BYOK)", free: "3 model terbatas", plus: { yes: true }, pro: { yes: true } },
      { label: "Model via API", free: "Flash, Turbo, Qwen3-8B", plus: "Semua model Plus", pro: "Semua model Pro" },
      { label: "Image & video via API", free: { no: true }, plus: { yes: true }, pro: { yes: true } },
      { label: "Saldo IDR untuk pemakaian API", free: "Rp 7.500 bonus daftar", plus: { yes: true }, pro: { yes: true } },
      { label: "Bonus saldo upgrade (satu kali)", free: "—", plus: "Rp 45.000", pro: "Rp 100.000" },
    ],
  },
  {
    title: "Hosting",
    rows: [
      { label: "Proyek aktif", free: "1", plus: "3", pro: "5" },
      { label: "Memory per proyek", free: "256 MB (Nano)", plus: "512 MB (Micro)", pro: "1 GB (Small)" },
      { label: "Biaya hosting", free: "Rp 30 / jam", plus: "Rp 60 / jam", pro: "Rp 120 / jam" },
      { label: "Custom domain", free: { no: true }, plus: { yes: true }, pro: { yes: true } },
      { label: "Auto-deploy dari GitHub", free: { yes: true }, plus: { yes: true }, pro: { yes: true } },
    ],
  },
  {
    title: "Lainnya",
    rows: [
      { label: "Personalisasi & custom system prompt", free: { yes: true }, plus: { yes: true }, pro: { yes: true } },
      { label: "Dukungan email", free: { yes: true }, plus: { yes: true }, pro: { yes: true } },
      { label: "Uji coba gratis 1 bulan (sekali per akun)", free: "—", plus: { yes: true }, pro: { no: true } },
    ],
  },
];

function ComparisonTable({ userTier, isAdmin }: { userTier: "free" | "plus" | "pro"; isAdmin: boolean }) {
  const activeTier = isAdmin ? null : userTier;
  const headerCell = (id: "free" | "plus" | "pro", label: string, color: string) => (
    <th
      scope="col"
      className={cn(
        "px-3 py-3 text-center text-xs font-semibold border-l border-border",
        color,
        activeTier === id && "bg-muted/40",
      )}
    >
      <div className="flex flex-col items-center gap-0.5">
        <span>{label}</span>
        {activeTier === id && (
          <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            Paket Kamu
          </span>
        )}
      </div>
    </th>
  );

  return (
    <section id="comparison-table" className="mt-16 sm:mt-20" aria-labelledby="comparison-heading">
      <div className="text-center mb-8">
        <h2 id="comparison-heading" className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Bandingin lengkap
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          Detail semua fitur yang kamu dapet di tiap paket.
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Fitur
              </th>
              {headerCell("free", "Gratis", "text-foreground")}
              {headerCell("plus", "Plus", "text-primary")}
              {headerCell("pro", "Pro", "text-amber-600 dark:text-amber-400")}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_GROUPS.map((group, gi) => (
              <Fragment key={gi}>
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-2 bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-t border-border"
                  >
                    {group.title}
                  </td>
                </tr>
                {group.rows.map((row, ri) => (
                  <tr key={ri} className="border-t border-border/60">
                    <th scope="row" className="px-4 py-3 text-left font-normal text-foreground/90 align-top">
                      {row.label}
                    </th>
                    <CompCell value={row.free} active={activeTier === "free"} />
                    <CompCell value={row.plus} active={activeTier === "plus"} />
                    <CompCell value={row.pro} active={activeTier === "pro"} />
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-4">
        Admin punya akses unlimited ke semua fitur. Limit akan reset otomatis sesuai jadwal (token harian, video bulanan).
      </p>
    </section>
  );
}

function CompCell({ value, active }: { value: Cell; active: boolean }) {
  const base = cn(
    "px-3 py-3 text-center text-xs sm:text-sm border-l border-border align-middle",
    active && "bg-muted/40",
  );
  if (typeof value === "string") {
    return <td className={cn(base, "text-foreground/90")}>{value}</td>;
  }
  if ("yes" in value) {
    return (
      <td className={base}>
        <Check className="w-4 h-4 inline text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
      </td>
    );
  }
  return (
    <td className={cn(base, "text-muted-foreground/50")}>
      <XIcon className="w-4 h-4 inline" />
    </td>
  );
}
