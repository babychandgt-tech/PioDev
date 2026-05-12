import { Link, useLocation } from "wouter";
import { motion, useInView, type Variants } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  ArrowRight,
  MessageSquare,
  ImageIcon,
  Video,
  AudioWaveform,
  Key,
  Plus,
  Crown,
  Check,
} from "lucide-react";
import { Logo } from "@/components/logo";
import {
  usePricingConfig,
  discountedPrice,
  formatIDR,
  type TierPricing,
} from "@/hooks/use-pricing-config";

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const pricing = usePricingConfig();

  useEffect(() => {
    if (isAuthenticated) setLocation("/chat");
  }, [isAuthenticated]);

  const features = [
    { icon: <MessageSquare className="w-6 h-6" />, label: "AI Chat" },
    { icon: <ImageIcon className="w-6 h-6" />, label: "Buat Gambar" },
    { icon: <Video className="w-6 h-6" />, label: "Buat Video" },
    { icon: <AudioWaveform className="w-6 h-6" />, label: "Voice Studio" },
    { icon: <Key className="w-6 h-6" />, label: "APIKeys" },
    { icon: <Plus className="w-6 h-6" />, label: "Dan masih banyak lagi" },
  ];

  return (
    <div className="min-h-screen bg-[hsl(240,12%,4%)] text-white overflow-x-hidden relative">
      {/* Ambient blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-60 -left-40 w-[700px] h-[700px] rounded-full bg-primary/10 blur-[140px]" />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full bg-indigo-500/8 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full bg-violet-500/8 blur-[120px]" />
      </div>

      {/* Subtle noise texture */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.015] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <Logo size={32} />
          <span className="font-bold text-lg tracking-tight">PioCode</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/bantuan">
            <button className="px-4 py-1.5 rounded-lg text-sm font-medium text-white/60 hover:text-white transition-colors">
              Bantuan
            </button>
          </Link>
          <Link href="/login">
            <button className="px-4 py-1.5 rounded-lg text-sm font-medium text-white/70 hover:text-white transition-colors">
              Masuk
            </button>
          </Link>
          <Link href="/register">
            <button className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-white transition-colors shadow-lg shadow-primary/20">
              Daftar Gratis
            </button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <ScrollSection className="relative z-10 max-w-4xl mx-auto px-6 sm:px-10 pt-20 pb-32 text-center">
        <motion.div variants={staggerContainer}>
          <motion.h1
            variants={itemVar}
            className="text-5xl sm:text-6xl font-bold leading-[1.05] tracking-tight mb-5"
          >
            Satu AI buat
            <br />
            <TypingHeroPhrase />
          </motion.h1>

          <motion.p
            variants={itemVar}
            className="text-lg text-white/50 max-w-xl mx-auto mb-8 leading-relaxed"
          >
            Chat, gambar, video, suara, sampe baca dokumen — semua dalam satu
            tempat, mulai dari gratis.
          </motion.p>

          <motion.div
            variants={itemVar}
            className="flex items-center justify-center gap-3"
          >
            <Link href="/register">
              <button className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-white rounded-xl font-semibold text-sm shadow-xl shadow-primary/25 hover:-translate-y-0.5 transition-all group">
                Coba gratis sekarang
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </Link>
          </motion.div>
        </motion.div>
      </ScrollSection>

      {/* Feature strip — single dark card with icons + labels */}
      <ScrollSection className="relative z-10 max-w-5xl mx-auto px-6 sm:px-10 pb-32">
        <motion.div
          variants={itemVar}
          className="rounded-2xl border border-white/[0.08] bg-[hsl(240,12%,8%)] p-6 sm:p-8"
        >
          <div className="flex items-center justify-center gap-2 mb-6 text-white/80 text-sm font-semibold">
            <Sparkles className="w-4 h-4 text-primary" />
            Satu Platform, Berbagai Fitur
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <motion.div
            variants={staggerContainer}
            className="grid grid-cols-3 sm:grid-cols-6 gap-4 sm:gap-2"
          >
            {features.map((f) => (
              <motion.div key={f.label} variants={itemVar}>
                <FeatureItem icon={f.icon} label={f.label} />
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </ScrollSection>

      {/* Pricing teaser */}
      <ScrollSection className="relative z-10 max-w-5xl mx-auto px-6 sm:px-10 pb-24">
        <motion.div variants={itemVar} className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
            Mulai gratis. Upgrade kalau butuh.
          </h2>
          <p className="text-white/50 text-base">
            Tanpa kartu kredit. Bisa cancel kapan aja.
          </p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          <motion.div variants={itemVar}>
            <PricingCard
              tier="Free"
              priceLabel="Rp 0"
              features={["60K token/hari", "7 gambar/hari", "Akses chat dasar"]}
            />
          </motion.div>
          <motion.div variants={itemVar}>
            <PricingCard
              tier="Plus"
              priceLabel={formatIDR(discountedPrice(pricing.plus))}
              originalPrice={
                pricing.plus.discount_percent > 0
                  ? formatIDR(pricing.plus.price_idr)
                  : undefined
              }
              discountLabel={pricing.plus.discount_label}
              highlighted
              features={[
                "200K token/hari",
                "25 gambar + 12 video/bln",
                "Semua model premium",
              ]}
            />
          </motion.div>
          <motion.div variants={itemVar}>
            <PricingCard
              tier="Pro"
              priceLabel={formatIDR(discountedPrice(pricing.pro))}
              originalPrice={
                pricing.pro.discount_percent > 0
                  ? formatIDR(pricing.pro.price_idr)
                  : undefined
              }
              discountLabel={pricing.pro.discount_label}
              features={[
                "360K token/hari",
                "40 gambar + 20 video/bln",
                "Frontier models (Qwen3-Max)",
              ]}
            />
          </motion.div>
        </motion.div>
      </ScrollSection>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8 text-center">
        <div className="flex items-center justify-center gap-2 text-white/40 text-sm">
          <Logo size={18} />
          <span className="font-semibold text-white/70">PioCode</span>
          <span className="text-white/30">— Semua dalam satu tempat</span>
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────── Scroll-aware section wrapper ────────────────────
const sectionVar: Variants = {
  hidden: { opacity: 0, y: 40 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
};

const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const itemVar: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

function ScrollSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const inView = useInView(ref, { amount: 0.2 });
  return (
    <motion.section
      ref={ref}
      variants={sectionVar}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
      className={className}
    >
      {children}
    </motion.section>
  );
}

// ─────────────────────────── Hero typing phrase ──────────────────────────────
const HERO_PHRASES = [
  "ngobrolin idemu.",
  "bikin gambar AI.",
  "edit video pendek.",
  "voice clone-mu.",
];

function TypingHeroPhrase() {
  const [idx, setIdx] = useState(0);
  const current = HERO_PHRASES[idx];
  const total = current.length;

  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<"typing" | "holding" | "deleting" | "pausing">("typing");

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      if (count < total) {
        t = setTimeout(() => setCount((c) => c + 1), 70);
      } else {
        t = setTimeout(() => setPhase("holding"), 0);
      }
    } else if (phase === "holding") {
      t = setTimeout(() => setPhase("deleting"), 1800);
    } else if (phase === "deleting") {
      if (count > 0) {
        t = setTimeout(() => setCount((c) => c - 1), 28);
      } else {
        t = setTimeout(() => setPhase("pausing"), 0);
      }
    } else {
      t = setTimeout(() => {
        setIdx((i) => (i + 1) % HERO_PHRASES.length);
        setPhase("typing");
      }, 350);
    }
    return () => clearTimeout(t);
  }, [phase, count, total]);

  const visible = current.slice(0, count);

  return (
    <span className="inline-flex items-baseline">
      <span className="bg-gradient-to-r from-primary via-indigo-400 to-violet-400 bg-clip-text text-transparent">
        {visible || "\u00A0"}
      </span>
      <motion.span
        className="inline-block ml-1 w-[4px] h-[0.85em] align-middle bg-primary translate-y-[0.05em]"
        animate={{ opacity: [1, 1, 0, 0] }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      />
    </span>
  );
}

// ─────────────────────────── Feature Item (icon + label only) ────────────────
function FeatureItem({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-3 text-white/85">
      <div className="text-white/90">{icon}</div>
      <div className="text-xs sm:text-sm text-white/70 text-center">
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────── Pricing card ────────────────────────────────────
function PricingCard({
  tier,
  priceLabel,
  originalPrice,
  discountLabel,
  features,
  highlighted,
}: {
  tier: string;
  priceLabel: string;
  originalPrice?: string;
  discountLabel?: string;
  features: string[];
  highlighted?: boolean;
}) {
  return (
    <Link href="/premium">
      <div
        className={`group relative overflow-hidden rounded-2xl border p-6 cursor-pointer transition-all hover:-translate-y-0.5 h-full flex flex-col ${
          highlighted
            ? "border-primary/40 bg-gradient-to-br from-primary/10 to-indigo-500/5 hover:border-primary/60"
            : "border-white/[0.07] bg-[hsl(240,10%,7%)] hover:border-white/15 hover:bg-[hsl(240,10%,9%)]"
        }`}
      >
        {highlighted && (
          <div className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-white text-[10px] font-bold uppercase tracking-wider">
            <Crown className="w-2.5 h-2.5" />
            Populer
          </div>
        )}
        <div className="text-sm font-semibold text-white/60 mb-1">{tier}</div>

        {originalPrice && (
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs text-white/40 line-through">
              {originalPrice}
            </span>
            {discountLabel && (
              <span className="text-[10px] font-bold text-primary bg-primary/15 px-1.5 py-0.5 rounded">
                {discountLabel}
              </span>
            )}
          </div>
        )}

        <div className="flex items-baseline gap-1 mb-4">
          <span className="text-3xl font-bold text-white">{priceLabel}</span>
          {priceLabel !== "Rp 0" && (
            <span className="text-xs text-white/40">/bln</span>
          )}
        </div>
        <ul className="space-y-2 flex-1">
          {features.map((f, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-xs text-white/70"
            >
              <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
              {f}
            </li>
          ))}
        </ul>
        <div className="mt-5 text-xs font-semibold text-primary group-hover:text-white transition-colors flex items-center gap-1">
          Lihat detail
          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </Link>
  );
}
