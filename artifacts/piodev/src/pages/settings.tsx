import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { User, Lock, Check, Eye, EyeOff, Sun, Moon, Menu, X, BarChart2, Sparkles, Star, Zap, ImageIcon, Clapperboard, ChevronRight, Shield, Mail, Mic, Wallet, CreditCard, Server, Key, ArrowDownLeft, MessageSquare, Plus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useChat } from "@/hooks/use-chat";
import { ChatSidebar } from "@/components/chat-sidebar";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useShowTokenUsage, useTokenUsageData } from "@/hooks/use-token-usage";
import { usePersonalization } from "@/hooks/use-personalization";

type Section = "profil" | "personalisasi" | "penggunaan" | "billing";

const navItems: { id: Section; label: string; icon: typeof User }[] = [
  { id: "profil", label: "Profil", icon: User },
  { id: "personalisasi", label: "Personalisasi", icon: Sparkles },
  { id: "penggunaan", label: "Penggunaan", icon: BarChart2 },
  { id: "billing", label: "Billing", icon: Wallet },
];

type BillingSummary = {
  balance_idr: number;
  tier: string;
  is_premium: boolean;
  is_admin: boolean;
  this_month: {
    total_spent: number;
    total_in: number;
    by_category: Record<string, number>;
  };
  recent_transactions: { id: string; amount_idr: number; type: string; metadata: any; created_at: string }[];
  pricing: { idr_per_token_num: number; idr_per_token_den: number; image_idr: number; video_idr: number };
};

function getTxLabel(type: string): { label: string; icon: typeof User } {
  if (type?.includes("usage_chat"))    return { label: "Chat AI", icon: MessageSquare };
  if (type?.includes("usage_image"))   return { label: "Generate Gambar", icon: ImageIcon };
  if (type?.includes("usage_video"))   return { label: "Generate Video", icon: Clapperboard };
  if (type?.includes("usage_voice"))   return { label: "Voice Studio", icon: Mic };
  if (type?.includes("usage_hosting")) return { label: "Hosting", icon: Server };
  if (type?.includes("usage_api"))     return { label: "API Eksternal", icon: Key };
  if (type === "top_up")               return { label: "Top Up Saldo", icon: ArrowDownLeft };
  if (type?.includes("bonus_plus_trial")) return { label: "Bonus Trial Plus", icon: Star };
  if (type?.includes("bonus_plus"))    return { label: "Bonus Upgrade Plus", icon: Star };
  if (type?.includes("bonus_pro"))     return { label: "Bonus Upgrade Pro", icon: Star };
  if (type?.includes("bonus"))         return { label: "Bonus Kredit", icon: Star };
  if (type?.includes("admin_credit_add"))    return { label: "Kredit dari Admin", icon: Shield };
  if (type?.includes("admin_credit_deduct")) return { label: "Koreksi Admin", icon: Shield };
  return { label: type ?? "Transaksi", icon: CreditCard };
}

export default function Settings() {
  const [, navigate] = useLocation();
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { show: showTokenUsage, toggle: toggleTokenUsage } = useShowTokenUsage();

  const { chats, activeChat, createNewChat, selectChat, deleteChat, deleteAllChats, updateChatTitle } = useChat(user?.id);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>("profil");

  const { data: persona, save: savePersona, isSaving: personaSaving } = usePersonalization();

  // Load token usage langsung dari Supabase
  const { todayUsage, weekUsage, monthUsage, daily7, isLoading: statsLoading } = useTokenUsageData(user?.id);

  // Usage summary untuk section Plus
  type UsageSummary = {
    isPremium: boolean; isAdmin: boolean; premiumExpiresAt: string | null;
    tier?: "free" | "plus" | "pro";
    token: { used: number; limit: number };
    image: { used: number; limit: number };
    video: { credits: number; max: number };
    voice: { credits: number; max: number };
  };
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [usageSummaryLoading, setUsageSummaryLoading] = useState(false);

  useEffect(() => {
    if (activeSection !== "penggunaan") return;
    let cancelled = false;
    setUsageSummaryLoading(true);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/me/usage-summary", {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!cancelled && res.ok) setUsageSummary(await res.json());
      if (!cancelled) setUsageSummaryLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeSection]);

  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [billingSummaryLoading, setBillingSummaryLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  useEffect(() => {
    if (activeSection !== "billing") return;
    let cancelled = false;
    setBillingSummaryLoading(true);
    setBillingError(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/me/billing-summary", {
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        });
        if (!cancelled) {
          if (res.ok) setBillingSummary(await res.json());
          else setBillingError("Gagal memuat data billing. Coba beberapa saat lagi.");
        }
      } catch {
        if (!cancelled) setBillingError("Koneksi gagal. Periksa koneksi internet kamu.");
      } finally {
        if (!cancelled) setBillingSummaryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeSection]);

  const [name, setName] = useState(user?.name || "");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError, setNameError] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState("");

  if (!user) return null;

  const handleSaveName = async () => {
    if (!name.trim()) { setNameError("Nama tidak boleh kosong."); return; }
    setNameSaving(true); setNameError(""); setNameSuccess(false);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name.trim() } });
    setNameSaving(false);
    if (error) { setNameError("Gagal menyimpan. Coba lagi."); }
    else { setNameSuccess(true); setTimeout(() => setNameSuccess(false), 3000); }
  };

  const handleSavePassword = async () => {
    if (!newPassword) { setPwError("Password baru tidak boleh kosong."); return; }
    if (newPassword.length < 6) { setPwError("Password minimal 6 karakter."); return; }
    if (newPassword !== confirmPassword) { setPwError("Konfirmasi password tidak cocok."); return; }
    setPwSaving(true); setPwError(""); setPwSuccess(false);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);
    if (error) { setPwError("Gagal mengubah password. Coba lagi."); }
    else {
      setPwSuccess(true);
      setNewPassword(""); setConfirmPassword("");
      setTimeout(() => setPwSuccess(false), 3000);
    }
  };

  const sidebarProps = {
    user,
    chats,
    activeChatId: activeChat?.id,
    createNewChat: () => { createNewChat(); navigate("/chat"); },
    selectChat: (id: string) => { selectChat(id); navigate("/chat"); },
    deleteChat,
    updateChatTitle,
    logout,
    isAdmin,
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans">

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobileSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 md:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-72 bg-sidebar border-r border-sidebar-border z-50 flex flex-col md:hidden shadow-2xl"
            >
              <div className="flex items-center justify-end p-2 border-b border-sidebar-border">
                <button
                  onClick={() => setIsMobileSidebarOpen(false)}
                  className="p-2 text-sidebar-foreground/60 hover:text-sidebar-foreground rounded-lg hover:bg-sidebar-accent/50 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ChatSidebar {...sidebarProps} createNewChat={() => { createNewChat(); navigate("/chat"); setIsMobileSidebarOpen(false); }} selectChat={(id) => { selectChat(id); navigate("/chat"); setIsMobileSidebarOpen(false); }} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <AnimatePresence initial={false}>
        {isDesktopSidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 288, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 250 }}
            className="hidden md:flex flex-col bg-sidebar border-r border-sidebar-border overflow-hidden shrink-0"
          >
            <ChatSidebar {...sidebarProps} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Panel + Content */}
      <div className="flex flex-1 min-w-0 overflow-hidden">

        {/* Settings Nav — hidden on mobile, shown as side panel on desktop */}
        <div className="hidden md:flex w-48 shrink-0 border-r border-border flex-col bg-sidebar/30 overflow-y-auto">
          <div className="p-5 pb-3">
            <h1 className="text-xl font-bold text-foreground">Pengaturan</h1>
          </div>
          <nav className="px-3 py-2 space-y-0.5">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors text-left",
                  activeSection === id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Top Bar */}
          <header className="h-14 flex items-center justify-between px-4 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-10">
            <div className="flex items-center gap-2">
              {/* Mobile: hamburger */}
              <button
                onClick={() => setIsMobileSidebarOpen(true)}
                className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
              {/* Desktop: toggle sidebar */}
              <button
                onClick={() => setIsDesktopSidebarOpen(!isDesktopSidebarOpen)}
                className="hidden md:flex p-2 -ml-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
              {/* Mobile: show title in header */}
              <span className="md:hidden text-sm font-semibold text-foreground">Pengaturan</span>
            </div>
            <button
              onClick={toggleTheme}
              className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </header>

          {/* Mobile: horizontal tab navigation */}
          <div className="md:hidden flex border-b border-border bg-background">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2",
                  activeSection === id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-4 sm:px-8 py-8">

              {activeSection === "profil" && (
                <div className="space-y-6">
                  {/* Page heading (desktop only) */}
                  <div className="hidden md:block">
                    <h2 className="text-lg font-semibold text-foreground mb-1">Profil & Akun</h2>
                    <p className="text-sm text-muted-foreground">Informasi akun, keamanan, dan pengelolaan data kamu.</p>
                  </div>

                  {/* Hero: avatar + identitas */}
                  <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <div className="flex items-center gap-4">
                      <div className="relative shrink-0">
                        <div className="w-16 h-16 sm:w-[68px] sm:h-[68px] rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground flex items-center justify-center text-xl font-bold select-none shadow-sm">
                          {name.trim()
                            ? name.trim().split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
                            : user.initials}
                        </div>
                        {isAdmin && (
                          <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-primary text-primary-foreground border-2 border-card">
                            ADMIN
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold text-foreground truncate">{name || user.name}</p>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          <Mail className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{user.email}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card: Informasi Profil */}
                  <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold text-foreground">Informasi Profil</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-5">Nama yang ditampilkan di aplikasi.</p>

                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Nama lengkap</label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => { setName(e.target.value); setNameError(""); setNameSuccess(false); }}
                          className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition"
                          placeholder="Nama kamu"
                        />
                        {nameError && <p className="text-xs text-red-500 mt-1.5">{nameError}</p>}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                        <input
                          type="email"
                          value={user.email || ""}
                          disabled
                          className="w-full px-4 py-2.5 rounded-xl border border-border bg-muted/60 text-muted-foreground text-sm cursor-not-allowed"
                        />
                        <p className="text-xs text-muted-foreground mt-1.5">Email tidak dapat diubah.</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <button
                          onClick={handleSaveName}
                          disabled={nameSaving || name.trim() === user.name}
                          className={cn(
                            "px-5 py-2 rounded-xl text-sm font-medium transition-all",
                            nameSaving || name.trim() === user.name
                              ? "bg-muted text-muted-foreground cursor-not-allowed"
                              : "bg-primary text-primary-foreground hover:bg-primary/90"
                          )}
                        >
                          {nameSaving ? "Menyimpan..." : "Simpan perubahan"}
                        </button>
                        {nameSuccess && (
                          <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                            <Check className="w-4 h-4" />
                            Nama berhasil diperbarui
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card: Keamanan Akun */}
                  <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold text-foreground">Keamanan Akun</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-5">Perbarui password untuk menjaga akunmu tetap aman.</p>

                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Password baru</label>
                        <div className="relative">
                          <input
                            type={showNew ? "text" : "password"}
                            value={newPassword}
                            onChange={(e) => { setNewPassword(e.target.value); setPwError(""); setPwSuccess(false); }}
                            className="w-full px-4 py-2.5 pr-11 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition"
                            placeholder="Minimal 6 karakter"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNew(!showNew)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Konfirmasi password baru</label>
                        <div className="relative">
                          <input
                            type={showConfirm ? "text" : "password"}
                            value={confirmPassword}
                            onChange={(e) => { setConfirmPassword(e.target.value); setPwError(""); setPwSuccess(false); }}
                            className="w-full px-4 py-2.5 pr-11 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition"
                            placeholder="Ulangi password baru"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirm(!showConfirm)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {pwError && <p className="text-xs text-red-500">{pwError}</p>}

                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <button
                          onClick={handleSavePassword}
                          disabled={pwSaving || !newPassword || !confirmPassword}
                          className={cn(
                            "inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all",
                            pwSaving || !newPassword || !confirmPassword
                              ? "bg-muted text-muted-foreground cursor-not-allowed"
                              : "bg-primary text-primary-foreground hover:bg-primary/90"
                          )}
                        >
                          <Lock className="w-4 h-4" />
                          {pwSaving ? "Menyimpan..." : "Perbarui password"}
                        </button>
                        {pwSuccess && (
                          <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                            <Check className="w-4 h-4" />
                            Password berhasil diubah
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Hapus semua chat */}
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <p className="text-sm text-muted-foreground">Hapus semua percakapan</p>
                    {!confirmDeleteAll ? (
                      <button
                        onClick={() => setConfirmDeleteAll(true)}
                        disabled={chats.length === 0}
                        className="text-sm font-medium text-red-500 hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                      >
                        Hapus
                      </button>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setConfirmDeleteAll(false)}
                          className="text-sm text-muted-foreground hover:text-foreground"
                        >
                          Batal
                        </button>
                        <button
                          onClick={async () => {
                            setIsDeletingAll(true);
                            await deleteAllChats();
                            setIsDeletingAll(false);
                            setConfirmDeleteAll(false);
                          }}
                          disabled={isDeletingAll}
                          className="text-sm font-medium text-red-500 hover:underline disabled:opacity-60"
                        >
                          {isDeletingAll ? "Menghapus..." : "Ya, hapus"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeSection === "personalisasi" && (
                <div className="space-y-6">
                  {/* Page heading */}
                  <div className="hidden md:block">
                    <h2 className="text-lg font-semibold text-foreground mb-1">Personalisasi</h2>
                    <p className="text-sm text-muted-foreground">Atur cara Pioo 2.0 ngobrol denganmu. Tersimpan otomatis.</p>
                  </div>

                  {/* Card: Tentang Kamu */}
                  <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold text-foreground">Tentang Kamu</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-5">Biar AI bisa nyambung sama konteksmu.</p>

                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Nama panggilan</label>
                        <input
                          type="text"
                          value={persona.nickname}
                          onChange={(e) => savePersona({ nickname: e.target.value })}
                          placeholder="Misal: Pio, Budi, Alex"
                          className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition"
                        />
                      </div>

                      <div className="grid sm:grid-cols-2 gap-5">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">Role / Pekerjaan</label>
                          <input
                            type="text"
                            value={persona.role}
                            onChange={(e) => savePersona({ role: e.target.value })}
                            placeholder="Frontend Developer"
                            className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">Tech stack</label>
                          <input
                            type="text"
                            value={persona.stack}
                            onChange={(e) => savePersona({ stack: e.target.value })}
                            placeholder="React, TypeScript"
                            className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">Level pengalaman</label>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            { value: "junior", label: "Junior" },
                            { value: "mid", label: "Mid" },
                            { value: "senior", label: "Senior" },
                          ] as const).map(({ value, label }) => (
                            <button
                              key={value}
                              onClick={() => savePersona({ level: value })}
                              className={cn(
                                "py-2.5 rounded-xl border text-sm font-medium transition-all",
                                persona.level === value
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card: Gaya Jawaban */}
                  <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold text-foreground">Gaya Jawaban</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-5">Bahasa, gaya, dan tone yang dipakai AI saat menjawab.</p>

                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">Bahasa</label>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            { value: "indonesia", label: "Indonesia" },
                            { value: "english", label: "English" },
                            { value: "mixed", label: "Campur" },
                          ] as const).map(({ value, label }) => (
                            <button
                              key={value}
                              onClick={() => savePersona({ language: value })}
                              className={cn(
                                "py-2.5 rounded-xl border text-sm font-medium transition-all",
                                persona.language === value
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">Panjang jawaban</label>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { value: "concise", label: "Ringkas", desc: "Langsung ke poin" },
                            { value: "detailed", label: "Detail", desc: "Penjelasan lengkap" },
                          ] as const).map(({ value, label, desc }) => (
                            <button
                              key={value}
                              onClick={() => savePersona({ answerStyle: value })}
                              className={cn(
                                "py-3 px-4 rounded-xl border text-left transition-all",
                                persona.answerStyle === value
                                  ? "border-primary bg-primary/10"
                                  : "border-border bg-background hover:border-primary/40"
                              )}
                            >
                              <p className={cn("text-sm font-medium", persona.answerStyle === value ? "text-primary" : "text-foreground")}>{label}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">Tone</label>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            { value: "casual", label: "Santai" },
                            { value: "formal", label: "Formal" },
                            { value: "humor", label: "Humor" },
                          ] as const).map(({ value, label }) => (
                            <button
                              key={value}
                              onClick={() => savePersona({ tone: value })}
                              className={cn(
                                "py-2.5 rounded-xl border text-sm font-medium transition-all",
                                persona.tone === value
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Status simpan */}
                  <div className="flex items-center gap-2 px-1">
                    <span className={cn(
                      "inline-block w-1.5 h-1.5 rounded-full transition-colors",
                      personaSaving ? "bg-amber-500 animate-pulse" : "bg-green-500"
                    )} />
                    <p className="text-xs text-muted-foreground">
                      {personaSaving ? "Menyimpan..." : "Tersimpan. Berlaku mulai pesan berikutnya."}
                    </p>
                  </div>
                </div>
              )}

              {activeSection === "billing" && (
                <div className="space-y-6">
                  <div className="hidden md:block">
                    <h2 className="text-lg font-semibold text-foreground mb-1">Billing & Saldo</h2>
                    <p className="text-sm text-muted-foreground">Pantau saldo kredit dan riwayat pengeluaran kamu.</p>
                  </div>

                  {billingSummaryLoading ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                      <span className="inline-block w-2 h-2 rounded-full bg-primary/40 animate-pulse mr-2" />
                      Memuat data...
                    </div>
                  ) : billingError || !billingSummary ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                      <CreditCard className="w-8 h-8 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">{billingError ?? "Data tidak tersedia."}</p>
                      <button
                        onClick={() => setActiveSection("profil" as Section)}
                        className="text-xs text-primary hover:underline"
                      >
                        Kembali ke Profil
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Saldo card */}
                      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1.5">Saldo Kredit</p>
                            <p className="text-3xl sm:text-4xl font-bold text-foreground tabular-nums">
                              Rp {billingSummary.balance_idr.toLocaleString("id-ID")}
                            </p>
                            <p className="text-xs text-muted-foreground mt-2">
                              Berlaku untuk akses via API Key eksternal & Hosting
                            </p>
                          </div>
                          <button
                            disabled
                            title="Segera hadir"
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 text-primary text-xs font-semibold opacity-50 cursor-not-allowed"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Top Up
                          </button>
                        </div>
                        <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wide",
                            billingSummary.is_admin ? "bg-red-500/10 text-red-500" :
                            billingSummary.tier === "pro" ? "bg-purple-500/10 text-purple-600 dark:text-purple-400" :
                            billingSummary.tier === "plus" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" :
                            "bg-muted text-muted-foreground"
                          )}>
                            {billingSummary.is_admin ? "Admin" : billingSummary.tier}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Bulan ini:{" "}
                            <span className="text-foreground font-medium">
                              Rp {billingSummary.this_month.total_spent.toLocaleString("id-ID")}
                            </span>{" "}
                            terpakai
                            {billingSummary.this_month.total_in > 0 && (
                              <>
                                {" "}·{" "}
                                <span className="text-green-500 font-medium">
                                  +Rp {billingSummary.this_month.total_in.toLocaleString("id-ID")}
                                </span>{" "}
                                masuk
                              </>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Breakdown kategori bulan ini */}
                      {billingSummary.this_month.total_spent > 0 && (
                        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-4">
                          <h3 className="text-sm font-semibold text-foreground">Pengeluaran bulan ini</h3>
                          {(
                            [
                              { key: "chat",    label: "Chat AI",      icon: MessageSquare, color: "bg-blue-500" },
                              { key: "image",   label: "Gambar",       icon: ImageIcon,     color: "bg-purple-500" },
                              { key: "video",   label: "Video",        icon: Clapperboard,  color: "bg-rose-500" },
                              { key: "voice",   label: "Voice Studio", icon: Mic,           color: "bg-orange-500" },
                              { key: "hosting", label: "Hosting",      icon: Server,        color: "bg-emerald-500" },
                              { key: "api",     label: "API",          icon: Key,           color: "bg-cyan-500" },
                            ] as const
                          )
                            .filter(({ key }) => (billingSummary.this_month.by_category[key] ?? 0) > 0)
                            .map(({ key, label, icon: Icon, color }) => {
                              const amount = billingSummary.this_month.by_category[key] ?? 0;
                              const pct = Math.round((amount / billingSummary.this_month.total_spent) * 100);
                              return (
                                <div key={key} className="space-y-1.5">
                                  <div className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                      <span className="text-foreground font-medium">{label}</span>
                                      <span className="text-xs text-muted-foreground">{pct}%</span>
                                    </div>
                                    <span className="text-foreground font-medium tabular-nums text-xs sm:text-sm shrink-0">
                                      Rp {amount.toLocaleString("id-ID")}
                                    </span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}

                      {/* Riwayat transaksi */}
                      <div className="rounded-2xl border border-border bg-card overflow-hidden">
                        <div className="px-5 py-4 border-b border-border">
                          <h3 className="text-sm font-semibold text-foreground">Riwayat transaksi</h3>
                        </div>
                        {billingSummary.recent_transactions.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                            <CreditCard className="w-8 h-8 text-muted-foreground/40" />
                            <p className="text-sm text-muted-foreground">Belum ada transaksi</p>
                          </div>
                        ) : (
                          <div className="divide-y divide-border">
                            {billingSummary.recent_transactions.map((tx) => {
                              const isCredit = tx.amount_idr >= 0;
                              const { label, icon: TxIcon } = getTxLabel(tx.type);
                              return (
                                <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5">
                                  <div className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                    isCredit ? "bg-green-500/10" : "bg-muted"
                                  )}>
                                    <TxIcon className={cn("w-3.5 h-3.5", isCredit ? "text-green-500" : "text-muted-foreground")} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{label}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {new Date(tx.created_at).toLocaleDateString("id-ID", {
                                        day: "numeric", month: "short", year: "numeric",
                                        hour: "2-digit", minute: "2-digit",
                                      })}
                                    </p>
                                  </div>
                                  <span className={cn(
                                    "text-sm font-semibold tabular-nums shrink-0",
                                    isCredit ? "text-green-500" : "text-foreground"
                                  )}>
                                    {isCredit ? "+" : "−"}Rp {Math.abs(tx.amount_idr).toLocaleString("id-ID")}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Tarif penggunaan */}
                      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-foreground mb-3">Tarif penggunaan</h3>
                        <div className="space-y-2.5">
                          {[
                            {
                              label: "API Key — Chat",
                              desc: "Akses via API key eksternal",
                              value: `${billingSummary.pricing.idr_per_token_den} token = Rp ${billingSummary.pricing.idr_per_token_num}`,
                            },
                            {
                              label: "API Key — Gambar",
                              desc: "Generate gambar via API",
                              value: `Rp ${billingSummary.pricing.image_idr.toLocaleString("id-ID")} / gambar`,
                            },
                            {
                              label: "Hosting — Nano",
                              desc: "256MB RAM, 0.25 vCPU",
                              value: "Rp 30 / jam",
                            },
                            {
                              label: "Hosting — Micro",
                              desc: "512MB RAM, 0.5 vCPU",
                              value: "Rp 60 / jam",
                            },
                            {
                              label: "Hosting — Small",
                              desc: "1GB RAM, 1 vCPU",
                              value: "Rp 120 / jam",
                            },
                          ].map(({ label, desc, value }) => (
                            <div key={label} className="flex items-start justify-between gap-3 text-sm">
                              <div>
                                <span className="text-foreground font-medium">{label}</span>
                                <p className="text-xs text-muted-foreground">{desc}</p>
                              </div>
                              <span className="text-foreground tabular-nums shrink-0">{value}</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-border">
                          Fitur Chat, Gambar, Video, dan Voice di web menggunakan kuota bulanan — tidak memotong saldo kredit ini.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeSection === "penggunaan" && (
                <div className="space-y-6">
                  {/* Page heading */}
                  <div className="hidden md:block">
                    <h2 className="text-lg font-semibold text-foreground mb-1">Penggunaan</h2>
                    <p className="text-sm text-muted-foreground">Status akun, sisa kuota, dan riwayat pemakaian.</p>
                  </div>

                  {usageSummaryLoading || !usageSummary ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                      <span className="inline-block w-2 h-2 rounded-full bg-primary/40 animate-pulse mr-2" />
                      Memuat data...
                    </div>
                  ) : (
                    <>
                      {/* Status tier */}
                      <div className={cn(
                        "rounded-2xl border p-5 sm:p-6",
                        usageSummary.isPremium
                          ? "border-amber-500/25 bg-amber-500/5"
                          : "border-border bg-card"
                      )}>
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={cn(
                              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                              usageSummary.isPremium ? "bg-amber-500/15" : "bg-muted"
                            )}>
                              <Star className={cn("w-5 h-5", usageSummary.isPremium ? "text-amber-500 fill-amber-500/30" : "text-muted-foreground")} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-foreground">
                                  {usageSummary.isAdmin
                                    ? "Admin"
                                    : usageSummary.tier === "pro"
                                    ? "Pro Aktif"
                                    : usageSummary.isPremium
                                    ? "Plus Aktif"
                                    : "Free"}
                                </span>
                                {usageSummary.isPremium && !usageSummary.isAdmin && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold tracking-wide">
                                    {usageSummary.tier === "pro" ? "PRO" : "PLUS"}
                                  </span>
                                )}
                              </div>
                              {usageSummary.isPremium && usageSummary.premiumExpiresAt && !usageSummary.isAdmin ? (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                  Berakhir {new Date(usageSummary.premiumExpiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                                </p>
                              ) : !usageSummary.isPremium ? (
                                <p className="text-xs text-muted-foreground mt-0.5">Upgrade buat kuota lebih besar</p>
                              ) : null}
                            </div>
                          </div>
                          {!usageSummary.isPremium && (
                            <button
                              onClick={() => navigate("/premium")}
                              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
                            >
                              Upgrade
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Kuota Hari Ini */}
                      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
                        <h3 className="text-sm font-semibold text-foreground">Sisa kuota</h3>

                        {[
                          {
                            icon: Zap,
                            label: "Token chat",
                            sub: "Reset tiap hari",
                            used: usageSummary.token.used,
                            limit: usageSummary.token.limit,
                            display: `${usageSummary.token.used.toLocaleString("id-ID")} / ${usageSummary.token.limit >= 9_999_000 ? "∞" : (usageSummary.token.limit / 1000).toFixed(0) + "K"}`,
                          },
                          {
                            icon: ImageIcon,
                            label: "Gambar",
                            sub: "Reset tiap hari",
                            used: usageSummary.image.used,
                            limit: usageSummary.image.limit,
                            display: `${usageSummary.image.used} / ${usageSummary.image.limit >= 9999 ? "∞" : usageSummary.image.limit}`,
                          },
                          {
                            icon: Clapperboard,
                            label: "Kredit video",
                            sub: "Reset tiap bulan",
                            used: usageSummary.video.max - usageSummary.video.credits,
                            limit: Math.max(usageSummary.video.max, 1),
                            display: `${usageSummary.video.credits}/${usageSummary.video.max >= 999 ? "∞" : usageSummary.video.max}`,
                          },
                          {
                            icon: Mic,
                            label: "Kredit voice",
                            sub: "Reset tiap bulan",
                            used: usageSummary.voice.max - usageSummary.voice.credits,
                            limit: Math.max(usageSummary.voice.max, 1),
                            display: `${usageSummary.voice.credits}/${usageSummary.voice.max >= 999 ? "∞" : usageSummary.voice.max}`,
                          },
                        ].map(({ icon: Icon, label, sub, used, limit, display }) => (
                          <div key={label} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <div className="flex items-center gap-2 min-w-0">
                                <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span className="text-foreground font-medium">{label}</span>
                                <span className="text-xs text-muted-foreground hidden sm:inline">· {sub}</span>
                              </div>
                              <span className="text-foreground tabular-nums font-medium text-xs sm:text-sm shrink-0">{display}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn("h-full rounded-full transition-all", usageSummary.isPremium ? "bg-amber-500" : "bg-primary")}
                                style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Riwayat 7 hari */}
                      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-semibold text-foreground">7 hari terakhir</h3>
                          {weekUsage.totalTokens > 0 && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {weekUsage.totalTokens.toLocaleString("id-ID")} token · {weekUsage.messages} pesan
                            </span>
                          )}
                        </div>

                        {statsLoading ? (
                          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                            <span className="inline-block w-2 h-2 rounded-full bg-primary/40 animate-pulse mr-2" />
                            Memuat...
                          </div>
                        ) : daily7.every(d => d.usage.totalTokens === 0) ? (
                          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                            Belum ada data minggu ini
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(() => {
                              const max = Math.max(...daily7.map(d => d.usage.totalTokens), 1);
                              return daily7.map(({ date, usage }) => {
                                const pct = Math.round((usage.totalTokens / max) * 100);
                                const label = new Date(date + "T00:00:00").toLocaleDateString("id-ID", { weekday: "short", day: "numeric" });
                                return (
                                  <div key={date} className="flex items-center gap-3">
                                    <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
                                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-primary/70 rounded-full transition-all"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <span className="text-xs text-muted-foreground tabular-nums w-16 text-right shrink-0">
                                      {usage.totalTokens > 0 ? usage.totalTokens.toLocaleString("id-ID") : "—"}
                                    </span>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        )}
                      </div>

                      {/* Preferensi tampilan */}
                      <div className="flex items-center justify-between gap-3 px-1 pt-2">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">Tampilkan token per pesan</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Munculkan hitungan token di bawah respons AI.</p>
                        </div>
                        <button
                          onClick={toggleTokenUsage}
                          className={cn(
                            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none",
                            showTokenUsage ? "bg-primary" : "bg-input"
                          )}
                        >
                          <span className={cn(
                            "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform",
                            showTokenUsage ? "translate-x-5" : "translate-x-0"
                          )} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
