import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Image as ImageIcon, Menu, Sparkles, Download, X, Loader2,
  ChevronDown, RefreshCw, Sun, Moon, Square, RectangleHorizontal,
  RectangleVertical, LayoutTemplate,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useChat } from "@/hooks/use-chat";
import { ChatSidebar } from "@/components/chat-sidebar";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────────
type GenSize = { label: string; value: string; icon: React.ReactNode; ratio: string };
type StylePreset = { label: string; suffix: string };
type GeneratedImage = { url: string; prompt: string; model: string; size: string };

// ── Constants ─────────────────────────────────────────────────────────────────
const MODELS = [
  { value: "qwen-image-2.0-pro", label: "Qwen Image 2.0 Pro", badge: "Best" },
  { value: "qwen-image-max",     label: "Qwen Image Max",     badge: null },
  { value: "qwen-image-plus",    label: "Qwen Image Plus",    badge: null },
  { value: "qwen-image-2.0",     label: "Qwen Image 2.0",     badge: null },
  { value: "wan2.7-image-pro",   label: "Wan2.7 Image Pro",   badge: "New" },
  { value: "wan2.7-image",       label: "Wan2.7 Image",       badge: null },
];

const SIZES: GenSize[] = [
  { label: "Square", value: "1024*1024", icon: <Square className="w-3.5 h-3.5" />, ratio: "1:1" },
  { label: "Landscape", value: "1280*720", icon: <RectangleHorizontal className="w-3.5 h-3.5" />, ratio: "16:9" },
  { label: "Portrait", value: "720*1280", icon: <RectangleVertical className="w-3.5 h-3.5" />, ratio: "9:16" },
  { label: "Classic", value: "1024*768", icon: <LayoutTemplate className="w-3.5 h-3.5" />, ratio: "4:3" },
];

const STYLE_PRESETS: StylePreset[] = [
  { label: "Default", suffix: "" },
  { label: "Realistic", suffix: ", realistic photo, ultra detailed, 8k" },
  { label: "Cinematic", suffix: ", cinematic lighting, film grain, dramatic composition" },
  { label: "Anime", suffix: ", anime style, vibrant colors, detailed illustration" },
  { label: "Illustration", suffix: ", digital illustration, flat design, vector art" },
  { label: "3D Render", suffix: ", 3D render, blender, octane render, studio lighting" },
  { label: "Sketch", suffix: ", pencil sketch, hand drawn, black and white" },
  { label: "Oil Painting", suffix: ", oil painting style, canvas texture, impasto" },
];

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ImageStudio() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  const [, navigate] = useLocation();
  const { chats, activeChat, createNewChat, selectChat, deleteChat, updateChatTitle } = useChat(user?.id);

  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Generation state
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(MODELS[0].value);
  const [selectedSize, setSelectedSize] = useState(SIZES[0].value);
  const [selectedStyle, setSelectedStyle] = useState(0);
  const [numImages, setNumImages] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [quota, setQuota] = useState<{ remaining: number; limit: number } | null>(null);
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelDropRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!user?.id) return;
    const fetchQuota = async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/image-gen-quota", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) { const d = await res.json(); setQuota({ remaining: d.remaining, limit: d.limit }); }
      } catch {}
    };
    fetchQuota();
  }, [user?.id]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropRef.current && !modelDropRef.current.contains(e.target as Node)) setIsModelOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleTextareaInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  const generate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    if (!isAdmin && quota && quota.remaining <= 0) {
      setError("Kuota generate gambar hari ini sudah habis. Coba lagi besok!");
      return;
    }

    abortRef.current = new AbortController();
    setIsGenerating(true);
    setError(null);
    setProgress("Mengirim permintaan...");

    const styleObj = STYLE_PRESETS[selectedStyle];
    const fullPrompt = prompt.trim() + styleObj.suffix;

    try {
      const token = await getToken();
      setProgress("Memproses gambar...");

      const submitRes = await fetch("/api/dashscope/api/v1/services/aigc/text2image/image-synthesis", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify({
          model: selectedModel,
          input: { prompt: fullPrompt },
          parameters: { size: selectedSize, n: numImages },
        }),
        signal: abortRef.current.signal,
      });

      if (submitRes.status === 429) {
        const body = await submitRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Kuota generate gambar habis.");
      }
      if (!submitRes.ok) {
        const body = await submitRes.json().catch(() => ({}));
        throw new Error(body.error?.message || body.message || "Gagal submit task.");
      }

      const submitData = await submitRes.json();
      const taskId = submitData.output?.task_id;
      if (!taskId) throw new Error("Task ID tidak ditemukan.");

      // Poll
      for (let i = 0; i < 45; i++) {
        if (abortRef.current.signal.aborted) throw new DOMException("Aborted", "AbortError");
        await new Promise((r) => setTimeout(r, 2000));
        setProgress(`Menunggu hasil... (${(i + 1) * 2}s)`);

        const pollRes = await fetch(`/api/dashscope/api/v1/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortRef.current.signal,
        });
        if (!pollRes.ok) continue;
        const pollData = await pollRes.json();
        const status = pollData.output?.task_status;

        if (status === "SUCCEEDED") {
          const urls: string[] = (pollData.output?.results ?? []).map((r: any) => r.url).filter(Boolean);
          const newImages: GeneratedImage[] = urls.map((url) => ({
            url,
            prompt: prompt.trim(),
            model: selectedModel,
            size: selectedSize,
          }));
          setResults((prev) => [...newImages, ...prev]);
          if (!isAdmin && quota) setQuota((q) => q ? { ...q, remaining: Math.max(0, q.remaining - 1) } : q);
          break;
        }
        if (status === "FAILED" || status === "CANCELED") {
          throw new Error("Generate gambar gagal.");
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError(err.message || "Terjadi kesalahan.");
    } finally {
      setIsGenerating(false);
      setProgress("");
    }
  }, [prompt, selectedModel, selectedSize, selectedStyle, numImages, isGenerating, isAdmin, quota]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
  };

  const downloadImage = async (url: string, idx: number) => {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = `pioo-image-${Date.now()}-${idx + 1}.png`;
      a.target = "_blank";
      a.click();
    } catch {}
  };

  if (!user) return null;

  const selectedModelObj = MODELS.find((m) => m.value === selectedModel) ?? MODELS[0];
  const selectedSizeObj = SIZES.find((s) => s.value === selectedSize) ?? SIZES[0];
  const canGenerate = !!(prompt.trim()) && !isGenerating && (isAdmin || !quota || quota.remaining > 0);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <motion.div
        animate={{ width: isDesktopSidebarOpen ? 288 : 64 }}
        transition={{ type: "spring", damping: 30, stiffness: 250 }}
        className="hidden md:flex flex-col bg-sidebar border-r border-sidebar-border overflow-hidden shrink-0"
      >
        <ChatSidebar
          user={{ name: user.name, initials: user.initials, email: user.email }}
          chats={chats.map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))}
          activeChatId={activeChat?.id}
          createNewChat={() => { createNewChat(); navigate("/chat"); }}
          selectChat={(id) => { selectChat(id); navigate("/chat"); }}
          deleteChat={deleteChat}
          updateChatTitle={updateChatTitle}
          logout={logout}
          isAdmin={isAdmin}
          collapsed={!isDesktopSidebarOpen}
          onExpand={() => setIsDesktopSidebarOpen(true)}
          onCollapse={() => setIsDesktopSidebarOpen(false)}
        />
      </motion.div>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {isMobileSidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40 md:hidden"
              onClick={() => setIsMobileSidebarOpen(false)} />
            <motion.div
              initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed left-0 top-0 bottom-0 w-[280px] z-50 md:hidden bg-sidebar"
            >
              <ChatSidebar
                user={{ name: user.name, initials: user.initials, email: user.email }}
                chats={chats.map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))}
                activeChatId={activeChat?.id}
                createNewChat={() => { createNewChat(); navigate("/chat"); setIsMobileSidebarOpen(false); }}
                selectChat={(id) => { selectChat(id); navigate("/chat"); setIsMobileSidebarOpen(false); }}
                deleteChat={deleteChat}
                updateChatTitle={updateChatTitle}
                logout={logout}
                isAdmin={isAdmin}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className={cn(
          "flex items-center gap-3 px-4 py-3 border-b shrink-0",
          isDark ? "border-white/[0.06] bg-background" : "border-black/[0.06] bg-white"
        )}>
          <button onClick={() => setIsMobileSidebarOpen(true)} className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2.5">
            <Logo size={28} className="rounded-lg shadow-sm" />
            <div>
              <h1 className="text-base font-bold tracking-tight">Image Studio</h1>
              <p className="text-[11px] text-muted-foreground">Generate gambar AI dengan Qwen & Wan</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!isAdmin && quota && (
              <span className={cn(
                "text-xs font-medium px-2.5 py-1 rounded-full border",
                quota.remaining <= 0
                  ? "text-red-500 bg-red-500/10 border-red-500/20"
                  : quota.remaining <= 3
                  ? "text-orange-500 bg-orange-500/10 border-orange-500/20"
                  : isDark ? "text-zinc-400 bg-zinc-800 border-zinc-700/60" : "text-zinc-600 bg-zinc-100 border-zinc-200"
              )}>
                {quota.remaining}/{quota.limit} gambar hari ini
              </span>
            )}
            <button onClick={() => setTheme(isDark ? "light" : "dark")}
              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Body: split layout — controls left, results right on desktop */}
        <div className="flex-1 flex overflow-hidden">
          {/* Controls panel */}
          <div className={cn(
            "w-full md:w-[380px] md:border-r shrink-0 flex flex-col overflow-y-auto",
            isDark ? "border-white/[0.06]" : "border-black/[0.06]"
          )}>
            <div className="flex flex-col gap-5 p-5">

              {/* Prompt */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Prompt</label>
                <div className={cn(
                  "rounded-xl border overflow-hidden transition-colors",
                  isDark ? "bg-zinc-900 border-zinc-700/60 focus-within:border-violet-500/50" : "bg-white border-zinc-200 focus-within:border-violet-500/50"
                )}>
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onInput={handleTextareaInput}
                    onKeyDown={handleKeyDown}
                    placeholder="Deskripsikan gambar yang ingin dibuat... (⌘+Enter untuk generate)"
                    className="w-full bg-transparent border-0 p-3.5 text-sm focus:outline-none resize-none min-h-[100px] placeholder:text-muted-foreground/60 leading-relaxed"
                    rows={4}
                  />
                  <div className={cn("flex items-center justify-between px-3 py-2 border-t", isDark ? "border-zinc-700/40" : "border-zinc-100")}>
                    <span className="text-[11px] text-muted-foreground/50">{prompt.length} karakter</span>
                    {prompt.trim() && (
                      <button onClick={() => { setPrompt(""); if (textareaRef.current) textareaRef.current.style.height = "auto"; }}
                        className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1">
                        <X className="w-3 h-3" /> Hapus
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Style presets */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Gaya</label>
                <div className="flex flex-wrap gap-1.5">
                  {STYLE_PRESETS.map((s, i) => (
                    <button key={s.label} onClick={() => setSelectedStyle(i)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-medium transition-all border",
                        selectedStyle === i
                          ? "bg-violet-500/15 text-violet-500 border-violet-500/30"
                          : isDark ? "bg-zinc-800 text-zinc-400 border-zinc-700/50 hover:border-zinc-600" : "bg-zinc-100 text-zinc-600 border-zinc-200 hover:border-zinc-300"
                      )}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ukuran</label>
                <div className="grid grid-cols-4 gap-2">
                  {SIZES.map((s) => (
                    <button key={s.value} onClick={() => setSelectedSize(s.value)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all text-center",
                        selectedSize === s.value
                          ? "bg-violet-500/15 text-violet-500 border-violet-500/30"
                          : isDark ? "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:border-zinc-600" : "bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-zinc-300"
                      )}>
                      {s.icon}
                      <span className="text-[10px] font-semibold">{s.ratio}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Model & count row */}
              <div className="grid grid-cols-2 gap-3">
                {/* Model selector */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Model</label>
                  <div ref={modelDropRef} className="relative">
                    <button
                      onClick={() => setIsModelOpen((v) => !v)}
                      className={cn(
                        "w-full flex items-center justify-between gap-1 px-3 py-2 rounded-xl border text-sm transition-all",
                        isDark ? "bg-zinc-900 border-zinc-700/60 hover:border-zinc-600 text-zinc-200" : "bg-white border-zinc-200 hover:border-zinc-300 text-zinc-700"
                      )}>
                      <span className="truncate text-xs font-medium">{selectedModelObj.label}</span>
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    </button>
                    <AnimatePresence>
                      {isModelOpen && (
                        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                          className={cn(
                            "absolute left-0 top-full mt-1 w-56 rounded-xl border shadow-xl z-20 overflow-hidden",
                            isDark ? "bg-zinc-900 border-zinc-700/60" : "bg-white border-zinc-200"
                          )}>
                          {MODELS.map((m) => (
                            <button key={m.value}
                              onClick={() => { setSelectedModel(m.value); setIsModelOpen(false); }}
                              className={cn(
                                "w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium transition-colors text-left",
                                selectedModel === m.value
                                  ? "text-violet-500 bg-violet-500/10"
                                  : isDark ? "text-zinc-300 hover:bg-zinc-800" : "text-zinc-700 hover:bg-zinc-50"
                              )}>
                              {m.label}
                              {m.badge && (
                                <span className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-semibold",
                                  m.badge === "Best" ? "bg-violet-500/15 text-violet-500" : "bg-green-500/15 text-green-500"
                                )}>{m.badge}</span>
                              )}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Num images */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Jumlah</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[1, 2, 3, 4].map((n) => (
                      <button key={n} onClick={() => setNumImages(n)}
                        className={cn(
                          "py-2 rounded-xl border text-xs font-semibold transition-all",
                          numImages === n
                            ? "bg-violet-500/15 text-violet-500 border-violet-500/30"
                            : isDark ? "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:border-zinc-600" : "bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-zinc-300"
                        )}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
                  <X className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </motion.div>
              )}

              {/* Generate button */}
              <button
                onClick={isGenerating ? () => { abortRef.current?.abort(); setIsGenerating(false); setProgress(""); } : generate}
                disabled={!isGenerating && !canGenerate}
                className={cn(
                  "flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-all",
                  isGenerating
                    ? "bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20"
                    : canGenerate
                    ? "bg-violet-500 text-white hover:bg-violet-600 shadow-lg shadow-violet-500/25"
                    : "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
                )}>
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {progress || "Generating..."} (Batalkan)
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate {numImages > 1 ? `${numImages} Gambar` : "Gambar"}
                  </>
                )}
              </button>

              {/* Size info */}
              <p className="text-[11px] text-muted-foreground/50 text-center -mt-2">
                {selectedSizeObj.label} ({selectedSizeObj.ratio}) · {selectedSizeObj.value.replace("*", "×")} px
              </p>
            </div>
          </div>

          {/* Results panel */}
          <div className="hidden md:flex flex-1 flex-col overflow-y-auto">
            {results.length === 0 && !isGenerating ? (
              <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
                <div className={cn(
                  "w-20 h-20 rounded-2xl flex items-center justify-center mb-5",
                  isDark ? "bg-zinc-800" : "bg-zinc-100"
                )}>
                  <ImageIcon className="w-9 h-9 text-muted-foreground/40" />
                </div>
                <p className="text-base font-semibold text-foreground mb-1.5">Belum ada gambar</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Tulis prompt di kiri, pilih gaya & ukuran, lalu klik Generate.
                </p>
              </div>
            ) : (
              <div className="p-5">
                {isGenerating && results.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-full border-2 border-violet-500/20 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
                      </div>
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">{progress || "Memproses..."}</p>
                  </div>
                )}

                <div className="columns-2 gap-3 space-y-3">
                  {isGenerating && results.length > 0 && (
                    <div className={cn(
                      "break-inside-avoid rounded-xl border flex items-center justify-center aspect-square",
                      isDark ? "bg-zinc-800/60 border-zinc-700/50" : "bg-zinc-100 border-zinc-200"
                    )}>
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
                        <p className="text-xs text-muted-foreground">{progress}</p>
                      </div>
                    </div>
                  )}
                  {results.map((img, i) => (
                    <motion.div key={i} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                      className="break-inside-avoid group relative rounded-xl overflow-hidden cursor-pointer"
                      onClick={() => setLightboxUrl(img.url)}>
                      <img src={img.url} alt={img.prompt} className="w-full object-cover rounded-xl" loading="lazy" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors rounded-xl flex items-end justify-end p-2.5 opacity-0 group-hover:opacity-100">
                        <div className="flex gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadImage(img.url, i); }}
                            className="p-2 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
                            title="Download">
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setPrompt(img.prompt); if (textareaRef.current) { textareaRef.current.style.height = "auto"; textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`; } }}
                            className="p-2 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
                            title="Gunakan prompt ini">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile results (below controls) */}
        <div className={cn(
          "md:hidden border-t",
          isDark ? "border-white/[0.06]" : "border-black/[0.06]"
        )}>
          {isGenerating ? (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
              {progress || "Generating..."}
            </div>
          ) : results.length > 0 ? (
            <div className="p-4 grid grid-cols-2 gap-2">
              {results.slice(0, 6).map((img, i) => (
                <div key={i} className="relative rounded-xl overflow-hidden group cursor-pointer"
                  onClick={() => setLightboxUrl(img.url)}>
                  <img src={img.url} alt={img.prompt} className="w-full aspect-square object-cover" loading="lazy" />
                  <button
                    onClick={(e) => { e.stopPropagation(); downloadImage(img.url, i); }}
                    className="absolute bottom-1.5 right-1.5 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxUrl && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
            onClick={() => setLightboxUrl(null)}>
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
              <X className="w-5 h-5" />
            </button>
            <motion.img
              initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              src={lightboxUrl}
              alt=""
              className="max-h-[90vh] max-w-[90vw] rounded-2xl shadow-2xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute bottom-5 flex gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); downloadImage(lightboxUrl, 0); }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors text-sm font-medium">
                <Download className="w-4 h-4" /> Download
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
