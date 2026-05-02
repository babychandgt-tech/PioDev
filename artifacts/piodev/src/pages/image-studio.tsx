import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Image as ImageIcon, Menu, Sparkles, Download, X, Loader2,
  RefreshCw, Sun, Moon, Square, RectangleHorizontal,
  RectangleVertical, LayoutTemplate, Cpu,
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

// ── Model fallback chain — system tries each in order, best → fallback ─────────
const MODEL_CHAIN = [
  "qwen-image-2.0-pro",
  "wan2.7-image-pro",
  "qwen-image-max",
  "qwen-image-plus",
  "wan2.7-image",
  "qwen-image-2.0",
];

const MODEL_LABELS: Record<string, string> = {
  "qwen-image-2.0-pro": "Qwen Image 2.0 Pro",
  "wan2.7-image-pro":   "Wan2.7 Image Pro",
  "qwen-image-max":     "Qwen Image Max",
  "qwen-image-plus":    "Qwen Image Plus",
  "wan2.7-image":       "Wan2.7 Image",
  "qwen-image-2.0":     "Qwen Image 2.0",
};

const SIZES: GenSize[] = [
  { label: "Square",    value: "1024*1024", icon: <Square className="w-3.5 h-3.5" />,            ratio: "1:1"  },
  { label: "Landscape", value: "1280*720",  icon: <RectangleHorizontal className="w-3.5 h-3.5" />, ratio: "16:9" },
  { label: "Portrait",  value: "720*1280",  icon: <RectangleVertical className="w-3.5 h-3.5" />,   ratio: "9:16" },
  { label: "Classic",   value: "1024*768",  icon: <LayoutTemplate className="w-3.5 h-3.5" />,      ratio: "4:3"  },
];

const STYLE_PRESETS: StylePreset[] = [
  { label: "Default",      suffix: "" },
  { label: "Realistic",    suffix: ", realistic photo, ultra detailed, 8k" },
  { label: "Cinematic",    suffix: ", cinematic lighting, film grain, dramatic composition" },
  { label: "Anime",        suffix: ", anime style, vibrant colors, detailed illustration" },
  { label: "Illustration", suffix: ", digital illustration, flat design, vector art" },
  { label: "3D Render",    suffix: ", 3D render, blender, octane render, studio lighting" },
  { label: "Sketch",       suffix: ", pencil sketch, hand drawn, black and white" },
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
  const [prompt, setPrompt]           = useState("");
  const [selectedSize, setSelectedSize]   = useState(SIZES[0].value);
  const [selectedStyle, setSelectedStyle] = useState(0);
  const [numImages, setNumImages]     = useState(1);
  const [isGenerating, setIsGenerating]   = useState(false);
  const [progress, setProgress]       = useState("");
  const [error, setError]             = useState<string | null>(null);
  const [results, setResults]         = useState<GeneratedImage[]>([]);
  const [quota, setQuota]             = useState<{ remaining: number; limit: number } | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [activeModelName, setActiveModelName] = useState<string | null>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

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

  const handleTextareaInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  // ── Fallback chain generate ─────────────────────────────────────────────────
  const generate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    if (!isAdmin && quota && quota.remaining <= 0) {
      setError("Kuota generate gambar hari ini sudah habis. Coba lagi besok!");
      return;
    }

    abortRef.current = new AbortController();
    setIsGenerating(true);
    setError(null);
    setActiveModelName(null);
    setProgress("Mencari model terbaik...");

    const styleObj  = STYLE_PRESETS[selectedStyle];
    const fullPrompt = prompt.trim() + styleObj.suffix;
    const token     = await getToken();

    let succeeded = false;

    for (const model of MODEL_CHAIN) {
      if (abortRef.current.signal.aborted) break;

      setProgress(`Mencoba ${MODEL_LABELS[model] ?? model}...`);

      try {
        const submitRes = await fetch("/api/dashscope/api/v1/services/aigc/text2image/image-synthesis", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
          },
          body: JSON.stringify({
            model,
            input: { prompt: fullPrompt },
            parameters: { size: selectedSize, n: numImages },
          }),
          signal: abortRef.current.signal,
        });

        // Quota hit (our own quota gate) — stop entirely
        if (submitRes.status === 429) {
          const body = await submitRes.json().catch(() => ({}));
          throw new Error(body.error ?? "Kuota generate gambar habis.");
        }

        // Model-level error (rate limit from DashScope, invalid param, etc.) — try next model
        if (!submitRes.ok) continue;

        const submitData = await submitRes.json();
        const taskId = submitData.output?.task_id;
        if (!taskId) continue;

        // Poll for result
        setProgress(`Memproses dengan ${MODEL_LABELS[model] ?? model}...`);
        let taskSucceeded = false;

        for (let i = 0; i < 45; i++) {
          if (abortRef.current.signal.aborted) throw new DOMException("Aborted", "AbortError");
          await new Promise((r) => setTimeout(r, 2000));
          setProgress(`${MODEL_LABELS[model] ?? model} · ${(i + 1) * 2}s...`);

          const pollRes = await fetch(`/api/dashscope/api/v1/tasks/${taskId}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: abortRef.current.signal,
          });
          if (!pollRes.ok) continue;

          const pollData = await pollRes.json();
          const status   = pollData.output?.task_status;

          if (status === "SUCCEEDED") {
            const urls: string[] = (pollData.output?.results ?? []).map((r: any) => r.url).filter(Boolean);
            if (urls.length === 0) break;
            const newImages: GeneratedImage[] = urls.map((url) => ({
              url, prompt: prompt.trim(), model, size: selectedSize,
            }));
            setResults((prev) => [...newImages, ...prev]);
            setActiveModelName(MODEL_LABELS[model] ?? model);
            if (!isAdmin && quota) setQuota((q) => q ? { ...q, remaining: Math.max(0, q.remaining - 1) } : q);
            taskSucceeded = true;
            succeeded = true;
            break;
          }

          // Task failed — try next model
          if (status === "FAILED" || status === "CANCELED") break;
        }

        if (succeeded) break;
        if (!taskSucceeded) continue;

      } catch (err: any) {
        if (err?.name === "AbortError") break;
        // Hard error (quota) — stop chain
        if (err?.message?.includes("Kuota")) {
          setError(err.message);
          break;
        }
        // Other error — try next model
        continue;
      }
    }

    if (!succeeded && !abortRef.current.signal.aborted && !error) {
      setError("Semua model sedang tidak tersedia. Coba lagi dalam beberapa saat.");
    }

    setIsGenerating(false);
    setProgress("");
  }, [prompt, selectedSize, selectedStyle, numImages, isGenerating, isAdmin, quota, error]);

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
              <p className="text-[11px] text-muted-foreground">Generate gambar AI · model otomatis</p>
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

        {/* Body: split layout */}
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

              {/* Jumlah */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Jumlah Gambar</label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} onClick={() => setNumImages(n)}
                      className={cn(
                        "py-2.5 rounded-xl border text-sm font-semibold transition-all",
                        numImages === n
                          ? "bg-violet-500/15 text-violet-500 border-violet-500/30"
                          : isDark ? "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:border-zinc-600" : "bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-zinc-300"
                      )}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto-model info */}
              <div className={cn(
                "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs",
                isDark ? "bg-zinc-800/50 border-zinc-700/40 text-zinc-400" : "bg-zinc-50 border-zinc-200 text-zinc-500"
              )}>
                <Cpu className="w-3.5 h-3.5 shrink-0 text-violet-400" />
                <span>Model dipilih otomatis · sistem akan coba model terbaik yang tersedia</span>
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
                    {progress || "Generating..."} · Batalkan
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
                  Tulis prompt di kiri, pilih gaya &amp; ukuran, lalu klik Generate.
                </p>
                <p className="text-xs text-muted-foreground/50 mt-2 max-w-xs">
                  Model terbaik akan dipilih otomatis oleh sistem.
                </p>
              </div>
            ) : (
              <div className="p-5">
                {/* Active model badge */}
                {activeModelName && !isGenerating && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex items-center gap-1.5 mb-4 px-3 py-2 rounded-lg border w-fit text-xs font-medium",
                      isDark ? "bg-violet-500/10 border-violet-500/20 text-violet-400" : "bg-violet-50 border-violet-200 text-violet-600"
                    )}>
                    <Cpu className="w-3 h-3" />
                    Dibuat dengan {activeModelName}
                  </motion.div>
                )}

                {isGenerating && results.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-16 h-16 rounded-full border-2 border-violet-500/20 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-muted-foreground">{progress || "Memproses..."}</p>
                      <p className="text-xs text-muted-foreground/50 mt-1">Sistem memilih model terbaik untukmu</p>
                    </div>
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
                      {/* Model badge on image */}
                      <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-black/60 text-white/80">
                          {MODEL_LABELS[img.model] ?? img.model}
                        </span>
                      </div>
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
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxUrl && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setLightboxUrl(null)}>
            <motion.img
              initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              src={lightboxUrl} alt="Preview"
              className="max-w-full max-h-full rounded-xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button onClick={() => setLightboxUrl(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
            <button onClick={() => { downloadImage(lightboxUrl, 0); }}
              className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors">
              <Download className="w-4 h-4" /> Download
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
