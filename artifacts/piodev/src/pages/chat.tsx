import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Menu, Plus,
  Send, Square, Terminal, Cpu, Lightbulb, Code,
  Sun, Moon, X, ImageIcon, FileText, Check, Copy, ArrowDown, RotateCcw,
  Globe, Brain, ChevronDown, Sparkles, Download,
  MoreHorizontal, Star, Pencil, Trash2, Gift, Lock,
  AudioLines, Library,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useChat } from "@/hooks/use-chat";
import { useShowTokenUsage, useTokenUsageData } from "@/hooks/use-token-usage";
import { usePremium } from "@/hooks/use-premium";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { ChatSidebar } from "@/components/chat-sidebar";
import { PustakaPickerDialog } from "@/components/pustaka-picker-dialog";
import { VoiceModeOverlay } from "@/components/voice-mode-overlay";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const FREE_DAILY_LIMIT = 60_000;
const PLUS_DAILY_LIMIT = 200_000;
const PRO_DAILY_LIMIT  = 360_000;
const PREMIUM_BANNER_DISMISSED_KEY = "pioo_premium_banner_dismissed";

function tierLimit(tier: "free" | "plus" | "pro" | undefined, isAdmin: boolean): number {
  if (isAdmin) return 9_999_999;
  if (tier === "pro")  return PRO_DAILY_LIMIT;
  if (tier === "plus") return PLUS_DAILY_LIMIT;
  return FREE_DAILY_LIMIT;
}

function tierLimitLabel(tier: "free" | "plus" | "pro" | undefined, isAdmin: boolean): string {
  if (isAdmin) return "∞";
  if (tier === "pro")  return "360K";
  if (tier === "plus") return "200K";
  return "60K";
}
const STARRED_KEY = "piodev_starred_chats";
const loadStarred = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(STARRED_KEY) || "[]")); } catch { return new Set(); }
};
const saveStarred = (s: Set<string>) => localStorage.setItem(STARRED_KEY, JSON.stringify([...s]));

const SUGGESTIONS = [
  { icon: Cpu, text: "Jelaskan konsep ini" },
  { icon: Terminal, text: "Bantu debug kode saya" },
  { icon: Code, text: "Buatkan fungsi untuk saya" },
  { icon: Lightbulb, text: "Review kode saya" },
];

function formatMessageTime(d: Date | string | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  const time = date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  if (isYesterday) return `Kemarin ${time}`;
  const dateStr = date.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  return `${dateStr} ${time}`;
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={cn(
        "flex items-center gap-1 text-xs transition-colors",
        copied ? "text-green-500" : "text-muted-foreground/50 hover:text-muted-foreground",
        className
      )}
      title="Copy message"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        <Brain className="w-3.5 h-3.5" />
        <span>{isOpen ? "Sembunyikan pemikiran" : "Tampilkan pemikiran"}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && (
        <div className="mt-2 px-3 py-2.5 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { isAuthenticated, user, logout, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { show: showTokenUsage } = useShowTokenUsage();
  const { todayUsage } = useTokenUsageData(user?.id);
  const { status: premiumStatus } = usePremium(user?.id);
  const [, setLocation] = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [input, setInput] = useState("");
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isPustakaPickerOpen, setIsPustakaPickerOpen] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [modelTier, setModelTier] = useState<"plus" | "mini" | "coder">(() => {
    return (localStorage.getItem("pioo-model-tier") as "plus" | "mini" | "coder") || "plus";
  });
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [isChatMenuOpen, setIsChatMenuOpen] = useState(false);
  const chatMenuRef = useRef<HTMLDivElement>(null);
  const [starredIds, setStarredIds] = useState<Set<string>>(loadStarred);
  const [isRenamingHeader, setIsRenamingHeader] = useState(false);
  const [renameTitleInput, setRenameTitleInput] = useState("");
  const [pendingDeleteHeader, setPendingDeleteHeader] = useState(false);
  const renameTitleRef = useRef<HTMLInputElement>(null);
  const setModelTierPersist = (tier: "plus" | "mini" | "coder") => {
    setModelTier(tier);
    localStorage.setItem("pioo-model-tier", tier);
    setIsModelDropdownOpen(false);
  };
  const [imageGenEnabled, setImageGenEnabled] = useState(false);
  const [imageGenQuota, setImageGenQuota] = useState<{ remaining: number; limit: number } | null>(null);

  // Multi-attachment state
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);

  // Voice mode (telponan dengan AI) — fullscreen overlay
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const {
    chats,
    activeChat,
    isTyping,
    isLoading: isChatLoading,
    createNewChat,
    selectChat,
    deleteChat,
    updateChatTitle,
    sendMessage,
    stopGeneration,
    regenerateLastMessage,
  } = useChat(user?.id);

  useEffect(() => {
    if (!isAuthenticated) setLocation("/");
  }, [isAuthenticated, setLocation]);

  // ⌘K / Ctrl+K → chat baru
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        createNewChat();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createNewChat]);

  // Tutup model dropdown saat klik di luar
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
      if (chatMenuRef.current && !chatMenuRef.current.contains(e.target as Node)) {
        setIsChatMenuOpen(false);
        setPendingDeleteHeader(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus input rename saat mode rename aktif
  useEffect(() => {
    if (isRenamingHeader) renameTitleRef.current?.focus();
  }, [isRenamingHeader]);

  const toggleStarHeader = () => {
    if (!activeChat?.id) return;
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(activeChat.id)) next.delete(activeChat.id);
      else next.add(activeChat.id);
      saveStarred(next);
      return next;
    });
    setIsChatMenuOpen(false);
  };

  const startRenameHeader = () => {
    if (!activeChat) return;
    setRenameTitleInput(activeChat.title);
    setIsRenamingHeader(true);
    setIsChatMenuOpen(false);
  };

  const confirmRenameHeader = () => {
    if (activeChat?.id && renameTitleInput.trim()) {
      updateChatTitle(activeChat.id, renameTitleInput.trim());
    }
    setIsRenamingHeader(false);
  };

  const exportChat = () => {
    if (!activeChat) return;
    const lines = activeChat.messages.map((m) =>
      `[${m.role === "user" ? "Kamu" : "Pioo 2.0"}]\n${m.content}`
    ).join("\n\n---\n\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeChat.title.slice(0, 40)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setIsChatMenuOpen(false);
  };

  const confirmDeleteHeader = () => {
    if (activeChat?.id) deleteChat(activeChat.id);
    setPendingDeleteHeader(false);
    setIsChatMenuOpen(false);
  };

  // Auto-scroll ke bawah saat ada pesan baru / isTyping
  useEffect(() => {
    if (!showScrollBtn) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeChat?.messages, isTyping]);

  // Scroll to bottom button visibility
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 200);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollBtn(false);
  };

  // Reset scroll button saat ganti chat
  useEffect(() => {
    setShowScrollBtn(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, [activeChat?.id]);

  // Close attach menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setIsAttachMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Paksa model mini untuk user Free (non-premium, non-admin)
  useEffect(() => {
    if (premiumStatus !== undefined && !isAdmin && !premiumStatus?.isPremium) {
      if (modelTier !== "mini") {
        setModelTier("mini");
        localStorage.setItem("pioo-model-tier", "mini");
      }
    }
  }, [premiumStatus, isAdmin, modelTier]);

  // Fetch kuota image gen harian
  useEffect(() => {
    if (!user?.id) return;
    const fetchQuota = async () => {
      try {
        const { data: { session } } = await (await import("@/lib/supabase")).supabase.auth.getSession();
        const token = session?.access_token ?? "";
        const res = await fetch("/api/image-gen-quota", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setImageGenQuota({ remaining: data.remaining, limit: data.limit });
        }
      } catch {}
    };
    fetchQuota();
  }, [user?.id]);

  const handleInputInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const addImage = (dataUrl: string) => {
    setAttachedImages((prev) => [...prev, dataUrl]);
    setIsAttachMenuOpen(false);
  };

  const addFile = (name: string, content: string) => {
    setAttachedFiles((prev) => [...prev, { name, content }]);
    setIsAttachMenuOpen(false);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => addImage(ev.target?.result as string);
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  // Ekstensi yang bisa langsung dibaca client sebagai text/code
  const TEXT_EXT_RE = /\.(md|mdx|txt|log|js|mjs|cjs|ts|jsx|tsx|json|jsonc|json5|yaml|yml|html|htm|css|scss|sass|less|sh|bash|zsh|fish|ps1|sql|rs|go|java|cpp|cxx|cc|c|h|hpp|hh|rb|php|swift|kt|kts|dart|py|pyi|csv|tsv|toml|ini|env|conf|cfg|properties|xml|vue|svelte|astro|lua|r|jl|ex|exs|elm|hs|nim|zig|gd|sol|tf|tfvars|dockerfile|makefile|gradle|graphql|gql|prisma)$/i;
  const BINARY_EXT_RE = /\.(pdf|docx)$/i;

  const isTextLikeFile = (file: File) => {
    if (file.type.startsWith("text/")) return true;
    if (file.type === "application/json" || file.type === "application/xml") return true;
    if (TEXT_EXT_RE.test(file.name)) return true;
    return false;
  };

  const parseBinaryFileOnServer = async (file: File) => {
    const { data: { session } } = await (await import("@/lib/supabase")).supabase.auth.getSession();
    const token = session?.access_token ?? "";
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/parse-file", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Gagal baca ${file.name}`);
    }
    const data = await res.json();
    return data.content as string;
  };

  const ingestFile = async (file: File) => {
    try {
      if (isTextLikeFile(file)) {
        const text = await file.text();
        addFile(file.name, text);
        return;
      }
      if (BINARY_EXT_RE.test(file.name) || file.type === "application/pdf") {
        const placeholder = `(memproses ${file.name}…)`;
        addFile(file.name, placeholder);
        const content = await parseBinaryFileOnServer(file);
        setAttachedFiles((prev) =>
          prev.map((f) => (f.name === file.name && f.content === placeholder ? { name: file.name, content } : f)),
        );
        return;
      }
      toast({ title: "Tipe file belum didukung", description: file.name, variant: "destructive" });
    } catch (e: any) {
      setAttachedFiles((prev) => prev.filter((f) => f.name !== file.name));
      toast({ title: "Gagal baca file", description: e?.message || String(e), variant: "destructive" });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => { ingestFile(file); });
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);

    // Semua item gambar dari clipboard
    const imageItems = items.filter((i) => i.type.startsWith("image/"));
    if (imageItems.length > 0) {
      e.preventDefault();
      imageItems.forEach((item) => {
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => addImage(ev.target?.result as string);
        reader.readAsDataURL(file);
      });
      return;
    }

    // File non-gambar
    const fileItems = items.filter((i) => i.kind === "file" && !i.type.startsWith("image/"));
    if (fileItems.length > 0) {
      e.preventDefault();
      fileItems.forEach((item) => {
        const file = item.getAsFile();
        if (!file) return;
        ingestFile(file);
      });
      return;
    }
    // Plain text → biarkan browser paste ke textarea
  };

  const handleSend = () => {
    if ((!input.trim() && !attachedImages.length && !attachedFiles.length) || isTyping) return;
    sendMessage(
      input.trim(),
      attachedImages.length ? attachedImages : undefined,
      attachedFiles.length ? attachedFiles : undefined,
      { webSearch: webSearchEnabled, thinking: thinkingEnabled, imageGen: imageGenEnabled, modelTier },
    );
    if (imageGenEnabled && imageGenQuota) {
      setImageGenQuota((q) => q ? { ...q, remaining: Math.max(0, q.remaining - 1) } : q);
    }
    setInput("");
    setAttachedImages([]);
    setAttachedFiles([]);
    setImageGenEnabled(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const hasAttachments = attachedImages.length > 0 || attachedFiles.length > 0;
  const isPremium = premiumStatus?.isPremium ?? false;
  const userTier = premiumStatus?.tier ?? "free";
  const effectiveLimit = tierLimit(userTier, isAdmin);
  const isQuotaExhausted = todayUsage.totalTokens >= effectiveLimit;
  const canSend = !!(input.trim() || hasAttachments) && !isTyping && !isQuotaExhausted;

  // Banner premium
  const [isBannerDismissed, setIsBannerDismissed] = useState(() => {
    try { return localStorage.getItem(PREMIUM_BANNER_DISMISSED_KEY) === "1"; } catch { return false; }
  });

  const showPremiumBanner = !isAdmin && !isPremium && !isBannerDismissed;

  const handleDismissBanner = () => {
    setIsBannerDismissed(true);
    try { localStorage.setItem(PREMIUM_BANNER_DISMISSED_KEY, "1"); } catch {}
  };

  if (!isAuthenticated || !user) return null;

  return (
    <div className="flex h-dvh w-full bg-background overflow-hidden font-sans">

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-72 bg-sidebar border-r border-sidebar-border z-50 flex flex-col md:hidden shadow-2xl"
            >
              <ChatSidebar
                user={user}
                chats={chats}
                activeChatId={activeChat?.id}
                createNewChat={() => { createNewChat(); setIsSidebarOpen(false); }}
                selectChat={(id: string) => { selectChat(id); setIsSidebarOpen(false); }}
                deleteChat={deleteChat}
                updateChatTitle={updateChatTitle}
                logout={logout}
                isAdmin={isAdmin}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar — icon rail saat collapsed, full saat open */}
      <motion.div
        animate={{ width: isDesktopSidebarOpen ? 288 : 64 }}
        transition={{ type: "spring", damping: 30, stiffness: 250 }}
        className="hidden md:flex flex-col bg-sidebar border-r border-sidebar-border overflow-hidden shrink-0"
      >
        <ChatSidebar
          user={user}
          chats={chats}
          activeChatId={activeChat?.id}
          createNewChat={createNewChat}
          selectChat={selectChat}
          deleteChat={deleteChat}
          updateChatTitle={updateChatTitle}
          logout={logout}
          isAdmin={isAdmin}
          collapsed={!isDesktopSidebarOpen}
          onExpand={() => setIsDesktopSidebarOpen(true)}
          onCollapse={() => setIsDesktopSidebarOpen(false)}
        />
      </motion.div>

      {/* Main Chat Area + Artifact Panel */}
      <div className="flex-1 flex min-w-0 bg-background relative overflow-hidden">

      {/* Chat column */}
      <div className="flex-1 flex flex-col min-w-0 relative">

        {/* Top Navbar */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-border bg-background/80 backdrop-blur-md z-10 sticky top-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            {/* Rename inline input */}
            {isRenamingHeader ? (
              <form
                onSubmit={(e) => { e.preventDefault(); confirmRenameHeader(); }}
                className="flex items-center gap-2 px-1"
              >
                <input
                  ref={renameTitleRef}
                  value={renameTitleInput}
                  onChange={(e) => setRenameTitleInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setIsRenamingHeader(false); }}
                  className="text-sm font-semibold bg-muted rounded-lg px-2.5 py-1.5 outline-none border border-primary/50 focus:border-primary w-48 md:w-64 text-foreground"
                />
                <button type="submit" className="p-1.5 rounded-lg hover:bg-muted text-primary transition-colors">
                  <Check className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setIsRenamingHeader(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </form>
            ) : (
            <div ref={modelDropdownRef} className="relative px-1">
              <button
                onClick={() => setIsModelDropdownOpen((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-muted transition-colors group"
              >
                <span className="text-sm font-semibold text-foreground">
                  {modelTier === "plus" ? "Pioo Plus" : modelTier === "coder" ? "Pioo Coder" : "Pioo Mini"}
                </span>
                {(isPremium || isAdmin) && (
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none",
                    isAdmin ? "bg-rose-500/10 text-rose-500" : "bg-primary/10 text-primary"
                  )}>
                    {isAdmin ? "Admin" : "Plus"}
                  </span>
                )}
                <ChevronDown className={cn(
                  "w-3.5 h-3.5 text-muted-foreground transition-transform duration-150",
                  isModelDropdownOpen && "rotate-180"
                )} />
              </button>
              <AnimatePresence>
                {isModelDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.12 }}
                    className="absolute top-full left-0 mt-1.5 w-64 bg-popover border border-border rounded-xl shadow-lg z-50 overflow-hidden py-1.5"
                  >
                    {/* Plus — hanya untuk pengguna Plus/Admin */}
                    <button
                      onClick={() => { if (isPremium) setModelTierPersist("plus"); else setLocation("/premium"); }}
                      className={cn(
                        "w-full flex items-start gap-3 px-3.5 py-2.5 transition-colors text-left",
                        isPremium ? "hover:bg-muted" : "opacity-60 cursor-pointer"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">Pioo Plus</span>
                          {modelTier === "plus" && isPremium && <Check className="w-3.5 h-3.5 text-primary" />}
                          {!isPremium && <Lock className="w-3 h-3 text-muted-foreground" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isPremium ? "Model flagship, kualitas terbaik" : "Hanya untuk pengguna Plus"}
                        </p>
                      </div>
                    </button>
                    {/* Coder — hanya untuk pengguna Plus/Admin */}
                    <button
                      onClick={() => { if (isPremium) setModelTierPersist("coder"); else setLocation("/premium"); }}
                      className={cn(
                        "w-full flex items-start gap-3 px-3.5 py-2.5 transition-colors text-left",
                        isPremium ? "hover:bg-muted" : "opacity-60 cursor-pointer"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">Pioo Coder</span>
                          {modelTier === "coder" && isPremium && <Check className="w-3.5 h-3.5 text-primary" />}
                          {!isPremium && <Lock className="w-3 h-3 text-muted-foreground" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isPremium ? "Spesialis coding & programming" : "Hanya untuk pengguna Plus"}
                        </p>
                      </div>
                    </button>
                    {/* Mini — tersedia untuk semua */}
                    <button
                      onClick={() => setModelTierPersist("mini")}
                      className="w-full flex items-start gap-3 px-3.5 py-2.5 hover:bg-muted transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">Pioo Mini</span>
                          {modelTier === "mini" && <Check className="w-3.5 h-3.5 text-primary" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">Cepat & ringan, respons instan</p>
                      </div>
                    </button>
                    {/* Hint upgrade untuk user free */}
                    {!isPremium && !isAdmin && (
                      <div className="mx-2 my-1 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                        <p className="text-xs text-primary font-medium">Upgrade ke Plus untuk akses semua model</p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!isAdmin && !isPremium && (
              <button
                onClick={() => setLocation("/premium")}
                title="Lihat paket Plus & Pro"
                className="relative p-2 text-amber-500 hover:text-amber-600 rounded-lg hover:bg-amber-500/10 transition-colors"
              >
                <Gift className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 ring-1 ring-background" />
              </button>
            )}
            <button
              onClick={toggleTheme}
              className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            {activeChat && (
              <div ref={chatMenuRef} className="relative">
                <button
                  onClick={() => { setIsChatMenuOpen((v) => !v); setPendingDeleteHeader(false); }}
                  className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>
                <AnimatePresence>
                  {isChatMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.12 }}
                      className="absolute top-full right-0 mt-1.5 w-52 bg-popover border border-border rounded-xl shadow-lg z-50 overflow-hidden py-1.5"
                    >
                      {!pendingDeleteHeader ? (
                        <>
                          <button
                            onClick={toggleStarHeader}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-muted transition-colors text-sm text-left"
                          >
                            <Star className={cn("w-4 h-4", activeChat?.id && starredIds.has(activeChat.id) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground")} />
                            <span>{activeChat?.id && starredIds.has(activeChat.id) ? "Hapus bintang" : "Beri bintang"}</span>
                          </button>
                          <button
                            onClick={startRenameHeader}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-muted transition-colors text-sm text-left"
                          >
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                            <span>Rename</span>
                          </button>
                          <button
                            onClick={exportChat}
                            disabled={!activeChat?.messages.length}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-muted transition-colors text-sm text-left disabled:opacity-40"
                          >
                            <Download className="w-4 h-4 text-muted-foreground" />
                            <span>Ekspor chat</span>
                          </button>
                          <div className="my-1 border-t border-border" />
                          <button
                            onClick={() => setPendingDeleteHeader(true)}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-destructive/10 transition-colors text-sm text-left text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>Hapus chat</span>
                          </button>
                        </>
                      ) : (
                        <div className="px-3.5 py-3">
                          <p className="text-sm text-foreground font-medium mb-1">Hapus chat ini?</p>
                          <p className="text-xs text-muted-foreground mb-3">Tidak bisa dibatalkan.</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setPendingDeleteHeader(false)}
                              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors"
                            >
                              Batal
                            </button>
                            <button
                              onClick={confirmDeleteHeader}
                              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </header>

        {/* Banner Penawaran Plus Terbatas */}
        <AnimatePresence>
          {showPremiumBanner && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 overflow-hidden border-b border-amber-500/20 bg-amber-500/5"
            >
              <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center gap-3">
                <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 mr-1.5">Upgrade ke Plus / Pro</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">Token, gambar & video lebih banyak — harga bersahabat</span>
                </div>
                <button
                  onClick={() => setLocation("/premium")}
                  className="h-7 px-3 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors shrink-0"
                >
                  Lihat Paket
                </button>
                <button onClick={handleDismissBanner} className="p-1 rounded-md hover:bg-black/10 transition-colors shrink-0">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth"
        >
          <div className="max-w-3xl mx-auto flex flex-col gap-6 min-h-full">
            {isChatLoading ? (
              <div className="flex-1 flex flex-col gap-6 pt-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className={cn("flex gap-3", i % 2 === 0 ? "justify-end" : "")}>
                    {i % 2 !== 0 && <div className="w-7 h-7 rounded-lg bg-muted animate-pulse shrink-0 mt-1" />}
                    <div className={cn("space-y-2", i % 2 === 0 ? "items-end flex flex-col" : "")}>
                      <div className={cn("h-4 bg-muted animate-pulse rounded-full", i % 2 === 0 ? "w-48" : "w-64")} />
                      <div className={cn("h-4 bg-muted animate-pulse rounded-full", i % 2 === 0 ? "w-32" : "w-80")} />
                      {i % 2 !== 0 && <div className="h-4 bg-muted animate-pulse rounded-full w-56" />}
                    </div>
                  </div>
                ))}
              </div>
            ) : !activeChat || activeChat.messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <Logo size={64} className="rounded-2xl mb-6" />
                <h2 className="text-2xl font-bold text-foreground mb-2">
                  Halo, {user.name.split(" ")[0].replace(/^./, (c) => c.toUpperCase())}! Ada yang bisa aku bantu?
                </h2>
                <p className="text-muted-foreground mb-12 max-w-md">
                  Tanya soal kode, minta dibuatkan fungsi, bantu debug, atau diskusi — ketik aja langsung.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:gap-3 w-full max-w-2xl">
                  {SUGGESTIONS.map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(suggestion.text)}
                      className={cn(
                        "flex items-start gap-2 sm:gap-3 p-3 sm:p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all text-left group",
                        i >= 2 && "hidden sm:flex"
                      )}
                    >
                      <suggestion.icon className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground group-hover:text-primary transition-colors mt-0.5 shrink-0" />
                      <span className="text-sm font-medium text-foreground">{suggestion.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              activeChat.messages
                .filter((msg, idx, arr) => {
                  const isLastMsg = idx === arr.length - 1;
                  const isEmptyAiPlaceholder = msg.role === "ai" && !msg.content && !msg.thinking;
                  return !(isTyping && isLastMsg && isEmptyAiPlaceholder);
                })
                .map((msg, idx, arr) => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={msg.id}
                  className={cn(
                    "w-full group",
                    msg.role === "user" ? "flex flex-col items-end gap-1" : "flex flex-col gap-3"
                  )}
                >
                  {msg.role === "user" ? (
                    <>
                      <div className="flex items-end gap-3 max-w-[75%]">
                        <div className="flex flex-col gap-2 items-end">
                          {/* Multiple images */}
                          {msg.imageUrls && msg.imageUrls.length > 0 && (
                            <div className="flex flex-wrap gap-2 justify-end">
                              {msg.imageUrls.map((url, i) => (
                                <img
                                  key={i}
                                  src={url}
                                  alt={`attached ${i + 1}`}
                                  className="max-w-[200px] max-h-[160px] rounded-xl object-cover shadow-sm"
                                />
                              ))}
                            </div>
                          )}
                          {/* Multiple files */}
                          {msg.attachedFileNames && msg.attachedFileNames.length > 0 && (
                            <div className="flex flex-col gap-1 items-end">
                              {msg.attachedFileNames.map((name, i) => (
                                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20 text-sm text-primary">
                                  <FileText className="w-4 h-4 shrink-0" />
                                  <span className="truncate max-w-[180px]">{name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {msg.content && (
                            <div className="px-5 py-3 rounded-2xl rounded-br-sm bg-primary text-primary-foreground text-[15px] whitespace-pre-wrap leading-relaxed shadow-sm">
                              {msg.content}
                            </div>
                          )}
                        </div>
                        <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 text-xs font-bold shadow-sm self-end">
                          {user.initials}
                        </div>
                      </div>
                      <div className="mr-11 flex items-center gap-2 justify-end">
                        <CopyButton text={msg.content || msg.attachedFileNames?.[0] || ""} />
                        <span className="text-[10px] text-muted-foreground/40 font-mono select-none" title={msg.timestamp instanceof Date ? msg.timestamp.toLocaleString("id-ID") : ""}>
                          {formatMessageTime(msg.timestamp)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2 w-full">
                        <div className="flex items-center gap-2.5">
                          <Logo size={28} className="rounded-lg shadow-sm" />
                          <span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">Pioo 2.0</span>
                        </div>
                        <div className="pl-9 w-full">
                          {msg.thinking && <ThinkingBlock content={msg.thinking} />}
                          <MarkdownRenderer
                            content={msg.content}
                            isStreaming={isTyping && idx === arr.length - 1}
                          />
                        </div>
                      </div>
                      <div className="pl-9 flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-3">
                          <CopyButton text={msg.content} />
                          {idx === arr.length - 1 && !isTyping && (
                            <button
                              onClick={regenerateLastMessage}
                              className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                              title="Regenerate response"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Regenerate</span>
                            </button>
                          )}
                        </div>
                        {showTokenUsage && msg.tokenUsage && (
                          <span className="text-[10px] text-muted-foreground/40 font-mono select-none">
                            ↑ {msg.tokenUsage.promptTokens.toLocaleString()} · ↓ {msg.tokenUsage.completionTokens.toLocaleString()} tokens
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground/40 font-mono select-none ml-auto" title={msg.timestamp instanceof Date ? msg.timestamp.toLocaleString("id-ID") : ""}>
                          {formatMessageTime(msg.timestamp)}
                        </span>
                      </div>
                    </>
                  )}
                </motion.div>
              ))
            )}

            {/* Typing indicator */}
            {isTyping && activeChat?.messages.at(-1)?.content === "" && !activeChat?.messages.at(-1)?.thinking && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2 w-full">
                <div className="flex items-center gap-2.5">
                  <Logo size={28} className="rounded-lg shadow-sm" />
                  <span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">Pioo 2.0</span>
                </div>
                {webSearchEnabled ? (
                  <div className="pl-9 flex items-center gap-2 h-7">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
                      className="text-sky-500"
                    >
                      <Globe size={14} />
                    </motion.div>
                    <motion.span
                      className="text-sm text-sky-500 font-medium"
                      animate={{ opacity: [1, 0.5, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                    >
                      Mencari di web...
                    </motion.span>
                  </div>
                ) : (
                  <div className="pl-9 flex items-center gap-1.5 h-7">
                    <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce-slow" />
                    <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce-slow animation-delay-100" />
                    <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce-slow animation-delay-200" />
                  </div>
                )}
              </motion.div>
            )}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        {/* Input Area */}
        <div className="sticky bottom-0 z-10 p-4 bg-gradient-to-t from-background via-background to-transparent pt-2" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="max-w-3xl mx-auto relative">

            {/* Scroll to bottom button */}
            <AnimatePresence>
              {showScrollBtn && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                  className="absolute -top-12 left-1/2 -translate-x-1/2 z-10"
                >
                  <button
                    onClick={scrollToBottom}
                    className="flex items-center gap-1.5 bg-background border border-border shadow-md hover:bg-muted text-foreground text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                    Scroll ke bawah
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Stop button */}
            {isTyping && !showScrollBtn && (
              <div className="absolute -top-12 left-1/2 -translate-x-1/2">
                <button
                  onClick={stopGeneration}
                  className="flex items-center gap-2 bg-background border border-border shadow-sm hover:bg-muted text-foreground text-xs font-medium px-4 py-2 rounded-full transition-colors"
                >
                  <Square className="w-3 h-3 fill-current" />
                  Stop generating
                </button>
              </div>
            )}

            {/* Hidden file inputs — support multiple */}
            <input ref={imageInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md,.mdx,.log,.json,.jsonc,.json5,.csv,.tsv,.html,.htm,.css,.scss,.sass,.less,.js,.mjs,.cjs,.ts,.jsx,.tsx,.py,.pyi,.java,.cpp,.cxx,.cc,.c,.h,.hpp,.rb,.php,.swift,.kt,.kts,.dart,.go,.rs,.sh,.bash,.zsh,.fish,.ps1,.sql,.yaml,.yml,.toml,.ini,.env,.conf,.cfg,.xml,.vue,.svelte,.astro,.lua,.r,.jl,.ex,.exs,.elm,.hs,.nim,.zig,.gd,.sol,.tf,.tfvars,.dockerfile,.makefile,.gradle,.graphql,.gql,.prisma" multiple onChange={handleFileSelect} className="hidden" />

            {/* Input container */}
            <div className="flex flex-col bg-card border border-border shadow-sm rounded-2xl focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-all">

              {/* Attachment previews */}
              {hasAttachments && (
                <div className="px-3 pt-3 flex flex-wrap gap-2">
                  {attachedImages.map((img, i) => (
                    <div key={i} className="relative inline-block">
                      <img src={img} alt={`preview ${i + 1}`} className="h-20 w-auto rounded-lg object-cover border border-border" />
                      <button
                        onClick={() => setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full flex items-center justify-center transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {attachedFiles.map((file, i) => (
                    <div key={i} className="relative inline-flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border border-border text-sm">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="truncate max-w-[160px] text-foreground">{file.name}</span>
                      <button
                        onClick={() => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input row */}
              <div className="flex flex-col">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onInput={handleInputInput}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={imageGenEnabled ? "Deskripsikan gambar yang ingin dibuat..." : "Tulis pesan..."}
                  className="w-full max-h-[120px] bg-transparent border-0 pt-3.5 pb-1 px-4 text-[15px] focus:outline-none resize-none placeholder:text-muted-foreground/70"
                  rows={1}
                />

                {/* Bottom toolbar */}
                <div className="flex items-center px-2 pb-2 gap-0.5">

                  {/* + Attach button with popup */}
                  <div ref={attachMenuRef} className="relative shrink-0">
                    <button
                      onClick={() => setIsAttachMenuOpen(!isAttachMenuOpen)}
                      className={cn(
                        "p-2 rounded-lg transition-colors",
                        isAttachMenuOpen || hasAttachments
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      title="Lampirkan"
                    >
                      <Plus className="w-4 h-4" />
                    </button>

                    <AnimatePresence>
                      {isAttachMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 4, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 4, scale: 0.97 }}
                          transition={{ duration: 0.12 }}
                          className="absolute bottom-full left-0 mb-2 w-48 bg-popover border border-border rounded-xl shadow-lg overflow-hidden z-50"
                        >
                          <button
                            onClick={() => imageInputRef.current?.click()}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent transition-colors text-left"
                          >
                            <ImageIcon className="w-4 h-4 text-muted-foreground" />
                            Tambah Foto
                          </button>
                          <div className="h-px bg-border mx-2" />
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent transition-colors text-left"
                          >
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            Tambah File
                          </button>
                          <div className="h-px bg-border mx-2" />
                          <button
                            onClick={() => {
                              setIsAttachMenuOpen(false);
                              setIsPustakaPickerOpen(true);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent transition-colors text-left"
                          >
                            <Library className="w-4 h-4 text-muted-foreground" />
                            Dari Pustaka
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Web Search toggle */}
                  <button
                    onClick={() => setWebSearchEnabled((v) => !v)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      webSearchEnabled
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                    title="Web Search"
                  >
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">Web</span>
                  </button>

                  {/* Thinking Mode toggle */}
                  <button
                    onClick={() => setThinkingEnabled((v) => !v)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      thinkingEnabled
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                    title="Thinking Mode"
                  >
                    <Brain className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">Think</span>
                  </button>

                  {/* Image Generation toggle */}
                  <button
                    onClick={() => setImageGenEnabled((v) => !v)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      imageGenEnabled
                        ? "bg-violet-500/15 text-violet-500"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                    title={imageGenQuota ? `Generate Gambar (${imageGenQuota.remaining}/${imageGenQuota.limit} tersisa hari ini)` : "Generate Gambar"}
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">Image</span>
                    {imageGenQuota && !isAdmin && (
                      <span className="hidden sm:inline text-[10px] opacity-60">
                        {imageGenQuota.remaining}/{imageGenQuota.limit}
                      </span>
                    )}
                  </button>

                  <div className="flex-1" />

                  {/* Quota badge */}
                  {(() => {
                    const used = todayUsage.totalTokens;
                    const limit = effectiveLimit;
                    const limitLabel = tierLimitLabel(userTier, isAdmin);
                    const pct = isAdmin ? 0 : Math.min(100, (used / limit) * 100);
                    const isExhausted = !isAdmin && used >= limit;
                    const isWarning = pct >= 85;
                    const isCaution = pct >= 60;
                    const dotColor = isExhausted ? "bg-red-500" : isWarning ? "bg-orange-500" : isCaution ? "bg-yellow-400" : isPremium ? "bg-amber-400" : "bg-primary";
                    const textColor = isExhausted ? "text-red-500" : isWarning ? "text-orange-500" : isCaution ? "text-yellow-500" : isPremium ? "text-amber-500" : "text-muted-foreground";
                    const label = isExhausted
                      ? "Limit!"
                      : used >= 1000
                      ? `${(used / 1000).toFixed(1)}K / ${limitLabel}`
                      : `${used} / ${limitLabel}`;
                    return (
                      <span className={cn("flex items-center gap-1 text-[11px] font-medium mr-1 select-none", textColor)} title={`${used.toLocaleString()} / ${limit.toLocaleString()} token hari ini`}>
                        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
                        {label}
                      </span>
                    );
                  })()}

                  {/* Voice Mode button (telponan dengan AI) */}
                  <button
                    onClick={() => setVoiceModeOpen(true)}
                    disabled={isTyping}
                    className={cn(
                      "p-2 rounded-xl shrink-0 transition-all duration-200 flex items-center justify-center",
                      "text-muted-foreground hover:text-primary hover:bg-primary/10",
                      isTyping && "opacity-50 cursor-not-allowed",
                    )}
                    title="Voice mode — ngobrol langsung dengan Pio"
                  >
                    <AudioLines className="w-4 h-4" />
                  </button>

                  {/* Send button */}
                  <button
                    onClick={handleSend}
                    disabled={!canSend}
                    className={cn(
                      "p-2 rounded-xl shrink-0 transition-all duration-200 flex items-center justify-center",
                      canSend
                        ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:scale-105"
                        : "bg-muted text-muted-foreground/50 cursor-not-allowed"
                    )}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="text-center mt-2 text-[11px] text-muted-foreground">
              Pio bisa membuat kesalahan. Pertimbangkan untuk memverifikasi informasi penting.
            </div>
          </div>
        </div>

      </div>

      </div>

      {/* Voice Mode fullscreen overlay (telponan dengan AI) */}
      <VoiceModeOverlay
        open={voiceModeOpen}
        onClose={() => setVoiceModeOpen(false)}
        sendMessage={sendMessage}
        activeChat={activeChat as any}
        isTyping={isTyping}
        modelTier={modelTier}
      />

      {/* Pustaka picker — pilih dokumen untuk dilampirkan ke chat */}
      <PustakaPickerDialog
        open={isPustakaPickerOpen}
        onClose={() => setIsPustakaPickerOpen(false)}
        onPick={(picked) => {
          setAttachedFiles((prev) => [...prev, ...picked]);
        }}
      />
    </div>
  );
}

