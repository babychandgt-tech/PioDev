import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  LifeBuoy, MessageSquare, ImageIcon, Video, Mic, Library,
  CreditCard, Shield, Key, Search, ChevronDown, ChevronUp,
  ArrowLeft, Mail,
} from "lucide-react";

type Faq = { q: string; a: string };
type Category = {
  category: string;
  icon: string;
  order: number;
  faqs: Faq[];
};

const ICON_MAP: Record<string, React.ReactNode> = {
  LifeBuoy: <LifeBuoy className="w-5 h-5" />,
  MessageSquare: <MessageSquare className="w-5 h-5" />,
  ImageIcon: <ImageIcon className="w-5 h-5" />,
  Video: <Video className="w-5 h-5" />,
  Mic: <Mic className="w-5 h-5" />,
  Library: <Library className="w-5 h-5" />,
  CreditCard: <CreditCard className="w-5 h-5" />,
  Shield: <Shield className="w-5 h-5" />,
  Key: <Key className="w-5 h-5" />,
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

  const filteredCategories = useMemo(() => {
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
  }, [categories, searchQuery, activeCategory]);

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
              onChange={(e) => { setSearchQuery(e.target.value); setActiveCategory("Semua"); }}
              placeholder="Cari pertanyaan..."
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-muted/30 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 text-sm transition-all placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        {/* Category chips */}
        {!searchQuery && (
          <div className="flex flex-wrap gap-2 justify-center mb-8">
            <button
              onClick={() => setActiveCategory("Semua")}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium transition-colors border",
                activeCategory === "Semua"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent text-muted-foreground border-border hover:bg-muted hover:text-foreground"
              )}
            >
              Semua
            </button>
            {categories.map((cat) => (
              <button
                key={cat.category}
                onClick={() => setActiveCategory(cat.category)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors border",
                  activeCategory === cat.category
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                )}
              >
                <span className="[&>svg]:w-3.5 [&>svg]:h-3.5">{ICON_MAP[cat.icon]}</span>
                {cat.category}
              </button>
            ))}
          </div>
        )}

        {/* FAQ list */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="text-center py-20">
            <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-medium text-foreground">Tidak ada hasil untuk "{searchQuery}"</p>
            <p className="text-sm text-muted-foreground mt-1">Coba kata kunci lain atau pilih kategori berbeda.</p>
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

        {/* Contact footer */}
        <div className="mt-16 rounded-2xl border border-border bg-muted/20 p-8 text-center">
          <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold text-lg mb-1">Masih ada pertanyaan?</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Tidak menemukan jawaban yang kamu cari? Tim kami siap membantu.
          </p>
          <a
            href="mailto:support@piocode.id"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Mail className="w-4 h-4" />
            Hubungi Dukungan
          </a>
        </div>
      </div>
    </div>
  );
}
