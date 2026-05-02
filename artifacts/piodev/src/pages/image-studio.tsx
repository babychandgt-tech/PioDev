import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Image as ImageIcon, Menu, Sparkles, Download, X, Loader2,
  RefreshCw, Sun, Moon, Square, RectangleHorizontal,
  RectangleVertical, LayoutTemplate, Cpu, Trash2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useChat } from "@/hooks/use-chat";
import { ChatSidebar } from "@/components/chat-sidebar";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────────
type GenSize = { label: string; value: string; icon: React.ReactNode; ratio: string };
type StylePreset = { label: string; suffix: string };
type GeneratedImage = { url: string; prompt: string; model: string; size: string };

// ── Model fallback chain — system tries each in order, best → fallback ─────────
// Two endpoint types:
//   MULTIMODAL  → /multimodal-generation/generation  (sync, returns image URL directly)
//   TEXT2IMAGE  → /text2image/image-synthesis        (async task polling)
const MODEL_CHAIN = [
  // ── Multimodal sync endpoint (best quality) ─────────────────────────────
  "qwen-image-2.0-pro",   // Qwen Image 2.0 Pro  — best quality + text rendering
  "qwen-image-max",       // Qwen Image Max       — high realism, fewer AI artifacts
  "qwen-image-2.0",       // Qwen Image 2.0       — balanced quality & speed
  // ── Text2Image async endpoint (confirmed working) ───────────────────────
  "qwen-image-plus",      // Qwen Image Plus      — diverse styles + text rendering
  "qwen-image",           // Qwen Image           — balanced
  "wan2.2-t2i-plus",      // Wan 2.2 Plus         — high artistic quality
  "wan2.5-t2i-preview",   // Wan 2.5 Preview      — newer generation
  "wan2.2-t2i-flash",     // Wan 2.2 Flash        — fast
  "wan2.1-t2i-plus",      // Wan 2.1 Plus
  "wan2.1-t2i-turbo",     // Wan 2.1 Turbo        — fastest stable fallback
];

const MODEL_LABELS: Record<string, string> = {
  "qwen-image-2.0-pro":   "Qwen Image 2.0 Pro",
  "qwen-image-max":       "Qwen Image Max",
  "qwen-image-2.0":       "Qwen Image 2.0",
  "qwen-image-plus":      "Qwen Image Plus",
  "qwen-image":           "Qwen Image",
  "wan2.2-t2i-plus":      "Wan 2.2 Plus",
  "wan2.5-t2i-preview":   "Wan 2.5 Preview",
  "wan2.2-t2i-flash":     "Wan 2.2 Flash",
  "wan2.1-t2i-plus":      "Wan 2.1 Plus",
  "wan2.1-t2i-turbo":     "Wan 2.1 Turbo",
};

// Models that use the multimodal-generation/generation sync endpoint
const MULTIMODAL_MODELS = new Set([
  "qwen-image-2.0-pro",
  "qwen-image-2.0-pro-2026-04-22",
  "qwen-image-2.0-pro-2026-03-03",
  "qwen-image-max",
  "qwen-image-max-2025-12-30",
  "qwen-image-2.0",
  "qwen-image-2.0-2026-03-03",
]);

// Size mapping: UI size value → multimodal endpoint size per model group
// qwen-image-2.0 series: up to 2048*2048
const MM_SIZES_V2: Record<string, string> = {
  "1024*1024": "2048*2048",
  "1280*720":  "2688*1536",
  "720*1280":  "1536*2688",
  "1024*768":  "2368*1728",
};
// qwen-image-max / qwen-image-plus series (on multimodal endpoint)
const MM_SIZES_MAXPLUS: Record<string, string> = {
  "1024*1024": "1328*1328",
  "1280*720":  "1664*928",
  "720*1280":  "928*1664",
  "1024*768":  "1472*1104",
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

    const styleObj   = STYLE_PRESETS[selectedStyle];
    const fullPrompt = prompt.trim() + styleObj.suffix;
    const token      = await getToken();

    let succeeded = false;

    for (const model of MODEL_CHAIN) {
      if (abortRef.current.signal.aborted) break;

      setProgress(`Mencoba ${MODEL_LABELS[model] ?? model}...`);

      try {
        // ── Branch: choose endpoint & payload based on model type ─────────
        if (MULTIMODAL_MODELS.has(model)) {
          // ── Multimodal sync endpoint ─────────────────────────────────────
          // qwen-image-2.0-pro/max/2.0 use /multimodal-generation/generation
          // Size must be remapped to the correct resolution for this endpoint.
          const isV2 = model.startsWith("qwen-image-2.0");
          const mappedSize = (isV2 ? MM_SIZES_V2 : MM_SIZES_MAXPLUS)[selectedSize] ?? selectedSize;

          const mmRes = await fetch("/api/dashscope/api/v1/services/aigc/multimodal-generation/generation", {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              input: { messages: [{ role: "user", content: [{ text: fullPrompt }] }] },
              parameters: { size: mappedSize, n: 1, watermark: false },
            }),
            signal: abortRef.current.signal,
          });

          if (mmRes.status === 429) {
            const body = await mmRes.json().catch(() => ({}));
            // Our own quota gate — stop entirely; DashScope 429 — try next model
            if (body.error) throw new Error(body.error);
            console.warn(`[ImageChain] ${model} DashScope rate-limit — skip`);
            continue;
          }

          if (!mmRes.ok) {
            const errBody = await mmRes.json().catch(() => ({}));
            console.warn(`[ImageChain] ${model} multimodal failed — HTTP ${mmRes.status}:`, errBody);
            continue;
          }

          const mmData = await mmRes.json();
          console.log(`[ImageChain] ${model} multimodal OK:`, JSON.stringify(mmData).slice(0, 300));

          // Response: output.choices[0].message.content[].image
          const choices  = mmData.output?.choices ?? [];
          const imageUrl = choices[0]?.message?.content?.find((c: any) => c.image)?.image;
          if (!imageUrl) {
            console.warn(`[ImageChain] ${model} — no image URL in multimodal response:`, mmData);
            continue;
          }

          setResults((prev) => [{ url: imageUrl, prompt: prompt.trim(), model, size: selectedSize }, ...prev]);
          setActiveModelName(MODEL_LABELS[model] ?? model);
          if (!isAdmin && quota) setQuota((q) => q ? { ...q, remaining: Math.max(0, q.remaining - 1) } : q);
          succeeded = true;
          break;

        } else {
          // ── Text2Image async endpoint ────────────────────────────────────
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

          if (submitRes.status === 429) {
            const body = await submitRes.json().catch(() => ({}));
            if (body.error) throw new Error(body.error);
            console.warn(`[ImageChain] ${model} DashScope rate-limit — skip`);
            continue;
          }

          if (!submitRes.ok) {
            const errBody = await submitRes.json().catch(() => ({}));
            console.warn(`[ImageChain] ${model} submit failed — HTTP ${submitRes.status}:`, errBody);
            continue;
          }

          const submitData = await submitRes.json();
          console.log(`[ImageChain] ${model} submit OK:`, JSON.stringify(submitData).slice(0, 300));

          // Handle immediate sync result (some models)
          const syncUrls: string[] = (submitData.output?.results ?? []).map((r: any) => r.url).filter(Boolean);
          if (syncUrls.length > 0) {
            const newImages: GeneratedImage[] = syncUrls.map((url) => ({
              url, prompt: prompt.trim(), model, size: selectedSize,
            }));
            setResults((prev) => [...newImages, ...prev]);
            setActiveModelName(MODEL_LABELS[model] ?? model);
            if (!isAdmin && quota) setQuota((q) => q ? { ...q, remaining: Math.max(0, q.remaining - 1) } : q);
            succeeded = true;
            break;
          }

          // Poll for task result
          const taskId = submitData.output?.task_id;
          if (!taskId) {
            console.warn(`[ImageChain] ${model} — no task_id and no sync results:`, submitData);
            continue;
          }

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
            console.log(`[ImageChain] ${model} poll ${i + 1} → status: ${status}`);

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

            if (status === "FAILED" || status === "CANCELED") {
              console.warn(`[ImageChain] ${model} task ${status}:`, pollData);
              break;
            }
          }

          if (succeeded) break;
          if (!taskSucceeded) continue;
        }

      } catch (err: any) {
        if (err?.name === "AbortError") break;
        if (err?.message?.includes("Kuota")) {
          setError(err.message);
          break;
        }
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
        {/* Header — matches Video/Voice Studio style */}
        <header className={cn(
          "flex items-center gap-3 px-4 py-3 border-b shrink-0",
          isDark ? "border-white/[0.06] bg-background" : "border-black/[0.06] bg-white"
        )}>
          <button onClick={() => setIsMobileSidebarOpen(true)}
            className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-indigo-400 flex items-center justify-center shadow-sm">
              <ImageIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold">Image Studio</h1>
              <p className="text-[11px] text-muted-foreground -mt-0.5">Generate gambar dengan AI</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!isAdmin && quota && (
              <div className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium",
                quota.remaining > 0
                  ? isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                  : isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-600"
              )}>
                <Sparkles className="w-3 h-3" />
                {quota.remaining}/{quota.limit}
              </div>
            )}
            <button onClick={() => setTheme(isDark ? "light" : "dark")}
              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Body — single scrollable column, matches Video/Voice Studio */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">

            {/* ── Main input card ── */}
            <div className={cn(
              "rounded-2xl border p-5 space-y-5",
              isDark ? "bg-zinc-900/50 border-white/[0.06]" : "bg-white border-black/[0.06] shadow-sm"
            )}>
              {/* Prompt */}
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onInput={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder="Deskripsikan gambar yang ingin kamu buat...&#10;Contoh: A serene mountain lake at sunrise, misty atmosphere, ultra detailed, cinematic"
                rows={3}
                className={cn(
                  "w-full resize-none rounded-xl px-4 py-3 text-sm leading-relaxed border transition-all",
                  "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40",
                  isDark
                    ? "bg-zinc-800/50 border-white/[0.06] placeholder:text-zinc-600"
                    : "bg-zinc-50 border-black/[0.06] placeholder:text-zinc-400"
                )}
              />

              {/* Style presets */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Gaya</label>
                <div className="flex flex-wrap gap-1.5">
                  {STYLE_PRESETS.map((s, i) => (
                    <button key={s.label} onClick={() => setSelectedStyle(i)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-medium transition-all border",
                        selectedStyle === i
                          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20 text-foreground"
                          : isDark ? "border-white/[0.06] bg-zinc-800/30 text-zinc-400 hover:bg-zinc-800/60" : "border-black/[0.06] bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                      )}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size + Count row */}
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Ukuran</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {SIZES.map((s) => (
                      <button key={s.value} onClick={() => setSelectedSize(s.value)}
                        className={cn(
                          "flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center",
                          selectedSize === s.value
                            ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                            : isDark ? "border-white/[0.06] bg-zinc-800/30 text-zinc-400 hover:bg-zinc-800/60" : "border-black/[0.06] bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                        )}>
                        {s.icon}
                        <span className="text-[10px] font-semibold">{s.ratio}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Jumlah</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[1, 2, 3, 4].map((n) => (
                      <button key={n} onClick={() => setNumImages(n)}
                        className={cn(
                          "py-2 rounded-xl border text-sm font-semibold transition-all",
                          numImages === n
                            ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                            : isDark ? "border-white/[0.06] bg-zinc-800/30 text-zinc-400 hover:bg-zinc-800/60" : "border-black/[0.06] bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
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
                  className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
                  <X className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </motion.div>
              )}

              {/* Bottom row: auto-model info + generate button */}
              <div className="flex items-center gap-2 justify-between">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                  <Cpu className="w-3 h-3 shrink-0 text-primary/50" />
                  <span>Model dipilih otomatis</span>
                </div>
                <button
                  onClick={isGenerating
                    ? () => { abortRef.current?.abort(); setIsGenerating(false); setProgress(""); }
                    : generate}
                  disabled={!isGenerating && !canGenerate}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-xs transition-all shrink-0",
                    isGenerating
                      ? "bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20"
                      : canGenerate
                      ? "bg-gradient-to-r from-primary to-indigo-500 text-white shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:brightness-110"
                      : "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
                  )}>
                  {isGenerating ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Batalkan</>
                  ) : (
                    <><Sparkles className="w-3.5 h-3.5" /> Generate {numImages > 1 ? `${numImages} Gambar` : "Gambar"}</>
                  )}
                </button>
              </div>

              {/* Progress indicator */}
              {isGenerating && (
                <p className="text-[11px] text-muted-foreground/50 text-center">{progress || "Memproses..."}</p>
              )}
            </div>

            {/* ── Results section ── */}
            {(results.length > 0 || isGenerating) && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hasil</h2>
                  {results.length > 0 && (
                    <button
                      onClick={() => setResults([])}
                      className="text-xs text-muted-foreground/60 hover:text-red-500 transition-colors"
                    >
                      Hapus semua
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AnimatePresence mode="popLayout">
                    {/* Loading card — shown while generating, before first result */}
                    {isGenerating && (
                      <motion.div
                        key="loading-card"
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className={cn(
                          "rounded-xl border overflow-hidden",
                          isDark ? "bg-zinc-900/50 border-white/[0.06]" : "bg-white border-black/[0.06] shadow-sm"
                        )}
                      >
                        <div className="aspect-square relative overflow-hidden">
                          <div className={cn("absolute inset-0", isDark ? "bg-zinc-800/80" : "bg-zinc-100")}>
                            <div className="absolute inset-0 shimmer-bg" />
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                              <Loader2 className="w-6 h-6 text-primary animate-spin" />
                              <span className="text-xs font-medium text-muted-foreground">
                                {progress || "Memproses..."}
                              </span>
                            </div>
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted/50">
                            <motion.div
                              className="h-full bg-gradient-to-r from-primary to-indigo-400"
                              initial={{ width: "5%" }}
                              animate={{ width: "70%" }}
                              transition={{ duration: 30, ease: "linear" }}
                            />
                          </div>
                        </div>
                        <div className="p-3">
                          <p className="text-xs text-foreground/50 line-clamp-2 leading-relaxed mb-2 italic">
                            {prompt || "Generating..."}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground/40">Sistem memilih model terbaik...</span>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* Result cards */}
                    {results.map((img, i) => (
                      <motion.div
                        key={`${img.url}-${i}`}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className={cn(
                          "rounded-xl border overflow-hidden group",
                          isDark ? "bg-zinc-900/50 border-white/[0.06]" : "bg-white border-black/[0.06] shadow-sm"
                        )}
                      >
                        {/* Image — clickable for lightbox */}
                        <div
                          className="aspect-square relative overflow-hidden cursor-pointer"
                          onClick={() => setLightboxUrl(img.url)}
                        >
                          <img
                            src={img.url}
                            alt={img.prompt}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                            loading="lazy"
                          />
                        </div>

                        {/* Info section — matches Video Studio card bottom */}
                        <div className="p-3">
                          <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed mb-2">
                            {img.prompt}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground/50">
                              {MODEL_LABELS[img.model] ?? img.model}
                            </span>
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => downloadImage(img.url, i)}
                                className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                title="Download"
                              >
                                <Download className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => {
                                  setPrompt(img.prompt);
                                  if (textareaRef.current) {
                                    textareaRef.current.style.height = "auto";
                                    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
                                  }
                                }}
                                className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                title="Pakai prompt ini"
                              >
                                <RefreshCw className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => setResults((prev) => prev.filter((_, idx) => idx !== i))}
                                className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-red-500"
                                title="Hapus"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* ── Empty state — matches Video/Voice Studio ── */}
            {results.length === 0 && !isGenerating && (
              <div className="text-center py-12">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-indigo-400/10 flex items-center justify-center mx-auto mb-3">
                  <ImageIcon className="w-7 h-7 text-primary/50" />
                </div>
                <h3 className="text-sm font-semibold text-foreground/70 mb-1">Mulai bikin gambar</h3>
                <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                  Deskripsikan gambar yang ingin kamu buat dan klik Generate
                </p>
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
