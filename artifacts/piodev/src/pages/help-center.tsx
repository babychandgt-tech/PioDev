import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  LifeBuoy, MessageSquare, ImageIcon, Video, Mic, Library,
  CreditCard, Shield, Key, Search, ChevronDown, ChevronUp,
  ArrowLeft, Mail, Instagram,
} from "lucide-react";

const WA_URL = "https://wa.me/6285709557572";
const IG_URL = "https://instagram.com/not.funn_";
const EMAIL = "piocodesai@gmail.com";

function ContactButtons({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 flex-wrap", className)}>
      <a
        href={WA_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-green-500/50 hover:bg-green-500/5 transition-all"
      >
        <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        WhatsApp
      </a>
      <a
        href={IG_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-pink-500/50 hover:bg-pink-500/5 transition-all"
      >
        <Instagram className="w-3.5 h-3.5 text-pink-500" />
        Instagram
      </a>
      <a
        href={`mailto:${EMAIL}`}
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/5 transition-all"
      >
        <Mail className="w-3.5 h-3.5 text-primary" />
        Email
      </a>
    </div>
  );
}

type Faq = { q: string; a: string };
type Category = {
  category: string;
  icon: string;
  order: number;
  faqs: Faq[];
};

const ICON_MAP: Record<string, React.ReactNode> = {
  LifeBuoy: <LifeBuoy className="w-4 h-4" />,
  MessageSquare: <MessageSquare className="w-4 h-4" />,
  ImageIcon: <ImageIcon className="w-4 h-4" />,
  Video: <Video className="w-4 h-4" />,
  Mic: <Mic className="w-4 h-4" />,
  Library: <Library className="w-4 h-4" />,
  CreditCard: <CreditCard className="w-4 h-4" />,
  Shield: <Shield className="w-4 h-4" />,
  Key: <Key className="w-4 h-4" />,
};

function AccordionItem({ faq, isOpen, onToggle }: { faq: Faq; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="border border-border rounded-xl overflow-hidden transition-colors hover:border-border/80">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/30"
      >
        <span className="font-medium text-[15px] text-foreground">{faq.q}</span>
        <span className="shrink-0 text-muted-foreground">
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {isOpen && (
        <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border bg-muted/10">
          <p className="pt-3">{faq.a}</p>
        </div>
      )}
    </div>
  );
}

export default function HelpCenterPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("Semua");
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/help-faqs");
        const data = await r.json();
        if (Array.isArray(data)) {
          setCategories(data.sort((a: Category, b: Category) => a.order - b.order));
        }
      } catch {}
      setIsLoading(false);
    })();
  }, []);

  const toggleItem = (key: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isFiltered = hasInteracted || !!searchQuery.trim();

  const filteredCategories = useMemo(() => {
    if (!isFiltered) return [];
    const q = searchQuery.trim().toLowerCase();
    return categories
      .filter((cat) => activeCategory === "Semua" || cat.category === activeCategory)
      .map((cat) => ({
        ...cat,
        faqs: q
          ? cat.faqs.filter((f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q))
          : cat.faqs,
      }))
      .filter((cat) => cat.faqs.length > 0);
  }, [categories, searchQuery, activeCategory, isFiltered]);

  const totalFaqs = categories.reduce((s, c) => s + c.faqs.length, 0);
  const matchCount = filteredCategories.reduce((s, c) => s + c.faqs.length, 0);

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation(isAuthenticated ? "/chat" : "/")}
            className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Kembali"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="font-semibold text-base">Pusat Bantuan</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">

        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <LifeBuoy className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">Ada yang bisa kami bantu?</h1>
          <p className="text-muted-foreground">
            Temukan jawaban dari {totalFaqs} pertanyaan umum tentang PioCode.
          </p>

          {/* Search */}
          <div className="relative mt-6 max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setActiveCategory("Semua"); setHasInteracted(true); }}
              placeholder="Cari pertanyaan..."
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-muted/30 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 text-sm transition-all placeholder:text-muted-foreground/60"
            />
          </div>

          {/* Contact buttons — always visible right below search */}
          <div className="mt-4">
            <p className="text-sm text-muted-foreground mb-2.5">Belum ketemu jawabannya? Hubungi kami:</p>
            <ContactButtons />
          </div>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-2 justify-center mb-8">
          <button
            onClick={() => { setActiveCategory("Semua"); setSearchQuery(""); setHasInteracted(true); }}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-medium transition-colors border",
              activeCategory === "Semua" && !searchQuery
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-muted-foreground border-border hover:bg-muted hover:text-foreground"
            )}
          >
            Semua
          </button>
          {categories.map((cat) => (
            <button
              key={cat.category}
              onClick={() => { setActiveCategory(cat.category); setSearchQuery(""); setHasInteracted(true); }}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors border",
                activeCategory === cat.category && !searchQuery
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent text-muted-foreground border-border hover:bg-muted hover:text-foreground"
              )}
            >
              <span className="[&>svg]:w-3.5 [&>svg]:h-3.5">{ICON_MAP[cat.icon]}</span>
              {cat.category}
            </button>
          ))}
        </div>

        {/* FAQ list */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : !isFiltered ? (
          /* Default state — nothing selected yet */
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-muted mb-4">
              <Search className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground">Pilih kategori atau cari pertanyaan</p>
            <p className="text-sm text-muted-foreground mt-1">
              Gunakan chip di atas untuk menelusuri topik yang kamu butuhkan.
            </p>
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-muted mb-4">
              <Mail className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground">Tidak ada hasil untuk "{searchQuery}"</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Coba kata kunci lain, atau hubungi tim kami langsung.
            </p>
            <a
              href="mailto:support@piocode.id"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Mail className="w-4 h-4" />
              Hubungi Dukungan
            </a>
          </div>
        ) : (
          <div className="space-y-10">
            {searchQuery && (
              <p className="text-sm text-muted-foreground">
                {matchCount} hasil untuk <span className="font-medium text-foreground">"{searchQuery}"</span>
              </p>
            )}
            {filteredCategories.map((cat) => (
              <section key={cat.category}>
                {(activeCategory === "Semua" || searchQuery) && (
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-primary [&>svg]:w-4 [&>svg]:h-4">{ICON_MAP[cat.icon]}</span>
                    <h2 className="font-semibold text-base text-foreground">{cat.category}</h2>
                    <span className="text-xs text-muted-foreground ml-1">({cat.faqs.length})</span>
                  </div>
                )}
                <div className="space-y-2">
                  {cat.faqs.map((faq, i) => {
                    const key = `${cat.category}-${i}`;
                    return (
                      <AccordionItem
                        key={key}
                        faq={faq}
                        isOpen={openItems.has(key)}
                        onToggle={() => toggleItem(key)}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
