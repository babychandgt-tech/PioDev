import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen,
  Menu,
  Sparkles,
  Video as VideoIcon,
  Mic,
  Play,
  Download,
  Trash2,
  Loader2,
  RefreshCw,
  AudioLines,
  X,
  CheckSquare,
  Check,
  Image as ImageIcon,
  Maximize2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useChat } from "@/hooks/use-chat";
import { ChatSidebar } from "@/components/chat-sidebar";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type FilterTab = "all" | "image" | "video" | "voice";

interface ImageItem {
  kind: "image";
  id: string;
  prompt: string;
  model: string;
  size: string;
  imageUrl: string;
  createdAt: string;
}

interface VideoItem {
  kind: "video";
  id: string;
  prompt: string;
  model: string;
  status: "pending" | "running" | "succeeded" | "failed";
  videoUrl?: string;
  imageUrl?: string;
  error?: string;
  createdAt: string;
}

interface VoiceItem {
  kind: "voice";
  id: string;
  text: string;
  voiceLabel: string | null;
  language: string | null;
  model: string | null;
  audioUrl: string | null;
  mime: string | null;
  createdAt: string;
}

type GalleryItem = ImageItem | VideoItem | VoiceItem;

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Baru aja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} hari lalu`;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function GaleriStudio() {
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [, navigate] = useLocation();
  const { chats, activeChat, createNewChat, selectChat, deleteChat, updateChatTitle } = useChat(user?.id);

  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const [filter, setFilter] = useState<FilterTab>("all");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<VideoItem | null>(null);
  const [previewVoice, setPreviewVoice] = useState<VoiceItem | null>(null);
  const [previewImage, setPreviewImage] = useState<ImageItem | null>(null);

  // Select / batch mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState<null | "download" | "delete">(null);

  const itemKey = (it: GalleryItem) => `${it.kind}-${it.id}`;
  const toggleSelect = (key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedKeys(new Set());
  };

  // Esc key buat tutup modal apapun + keluar dari select mode
  useEffect(() => {
    if (!previewVideo && !previewVoice && !previewImage && !selectMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (previewVideo || previewVoice || previewImage) {
        setPreviewVideo(null);
        setPreviewVoice(null);
        setPreviewImage(null);
      } else if (selectMode) {
        exitSelectMode();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [previewVideo, previewVoice, previewImage, selectMode]);

  const loadAll = async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Sesi habis, silakan login lagi");

      const [imgRes, vidRes, voiceRes] = await Promise.all([
        fetch("/api/image-jobs?limit=100", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/video-jobs", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/voice-studio/history?limit=50", { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (imgRes.ok) {
        const data = await imgRes.json();
        setImages(
          (data || []).map((j: any): ImageItem => ({
            kind: "image",
            id: j.id,
            prompt: j.prompt || "",
            model: j.model || "",
            size: j.size || "",
            imageUrl: j.image_url || "",
            createdAt: j.created_at,
          })),
        );
      }

      if (vidRes.ok) {
        const data = await vidRes.json();
        setVideos(
          (data || []).map((j: any): VideoItem => ({
            kind: "video",
            id: j.id,
            prompt: j.prompt || "",
            model: j.model || "",
            status: j.status,
            videoUrl: j.video_url || undefined,
            imageUrl: j.image_url || undefined,
            error: j.error || undefined,
            createdAt: j.created_at,
          })),
        );
      }

      if (voiceRes.ok) {
        const json = await voiceRes.json();
        setVoices(
          (json?.items || []).map((it: any): VoiceItem => ({
            kind: "voice",
            id: it.id,
            text: it.text || "",
            voiceLabel: it.voiceLabel || null,
            language: it.language || null,
            model: it.model || null,
            audioUrl: it.audioUrl || null,
            mime: it.mime || null,
            createdAt: it.createdAt,
          })),
        );
      }
    } catch (err: any) {
      setError(err?.message || "Gagal load galeri");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const items = useMemo<GalleryItem[]>(() => {
    const merged: GalleryItem[] = [];
    if (filter === "all" || filter === "image") merged.push(...images);
    if (filter === "all" || filter === "video") merged.push(...videos);
    if (filter === "all" || filter === "voice") merged.push(...voices);
    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return merged;
  }, [images, videos, voices, filter]);

  const counts = {
    all: images.length + videos.length + voices.length,
    image: images.length,
    video: videos.length,
    voice: voices.length,
  };

  const handleDeleteImage = async (id: string) => {
    if (!confirm("Hapus gambar ini dari galeri?")) return;
    setDeletingId(id);
    try {
      const token = await getToken();
      const res = await fetch(`/api/image-jobs/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setImages(prev => prev.filter(v => v.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    if (!confirm("Hapus video ini dari galeri?")) return;
    setDeletingId(id);
    try {
      const token = await getToken();
      const res = await fetch(`/api/video-jobs/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setVideos(prev => prev.filter(v => v.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteVoice = async (id: string) => {
    if (!confirm("Hapus audio ini dari galeri?")) return;
    setDeletingId(id);
    try {
      const token = await getToken();
      const res = await fetch(`/api/voice-studio/history/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setVoices(prev => prev.filter(v => v.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  // Batch actions
  const selectedItems = useMemo(
    () => items.filter(it => selectedKeys.has(itemKey(it))),
    [items, selectedKeys],
  );

  const handleBatchDownload = async () => {
    const downloadable = selectedItems.filter(it => {
      if (it.kind === "image") return !!it.imageUrl;
      if (it.kind === "video") return !!it.videoUrl;
      if (it.kind === "voice") return !!it.audioUrl;
      return false;
    });
    if (downloadable.length === 0) return;
    setBatchBusy("download");
    try {
      for (const it of downloadable) {
        if (it.kind === "image" && it.imageUrl) {
          downloadUrl(it.imageUrl, `pio-image-${it.id}.png`);
        } else if (it.kind === "video" && it.videoUrl) {
          downloadUrl(it.videoUrl, `pio-video-${it.id}.mp4`);
        } else if (it.kind === "voice" && it.audioUrl) {
          const ext = it.mime?.includes("wav") ? "wav" : "mp3";
          downloadUrl(it.audioUrl, `pio-voice-${it.id}.${ext}`);
        }
        await new Promise(r => setTimeout(r, 350));
      }
    } finally {
      setBatchBusy(null);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedItems.length === 0) return;
    if (!confirm(`Hapus ${selectedItems.length} item dari galeri? Aksi ini gak bisa di-undo.`)) return;
    setBatchBusy("delete");
    try {
      const token = await getToken();
      const imageIds = selectedItems.filter(it => it.kind === "image").map(it => it.id);
      const videoIds = selectedItems.filter(it => it.kind === "video").map(it => it.id);
      const voiceIds = selectedItems.filter(it => it.kind === "voice").map(it => it.id);

      const results = await Promise.allSettled([
        ...imageIds.map(id =>
          fetch(`/api/image-jobs/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }),
        ),
        ...videoIds.map(id =>
          fetch(`/api/video-jobs/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }),
        ),
        ...voiceIds.map(id =>
          fetch(`/api/voice-studio/history/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }),
        ),
      ]);

      const okImageIds = new Set<string>();
      const okVideoIds = new Set<string>();
      const okVoiceIds = new Set<string>();
      results.forEach((r, idx) => {
        if (r.status === "fulfilled" && r.value.ok) {
          if (idx < imageIds.length) okImageIds.add(imageIds[idx]);
          else if (idx < imageIds.length + videoIds.length) okVideoIds.add(videoIds[idx - imageIds.length]);
          else okVoiceIds.add(voiceIds[idx - imageIds.length - videoIds.length]);
        }
      });

      if (okImageIds.size) setImages(prev => prev.filter(v => !okImageIds.has(v.id)));
      if (okVideoIds.size) setVideos(prev => prev.filter(v => !okVideoIds.has(v.id)));
      if (okVoiceIds.size) setVoices(prev => prev.filter(v => !okVoiceIds.has(v.id)));
      exitSelectMode();
    } finally {
      setBatchBusy(null);
    }
  };

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
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
          isAdmin={user.role === "admin"}
          collapsed={!isDesktopSidebarOpen}
          onExpand={() => setIsDesktopSidebarOpen(true)}
          onCollapse={() => setIsDesktopSidebarOpen(false)}
        />
      </motion.div>

      <AnimatePresence>
        {isMobileSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40 md:hidden"
              onClick={() => setIsMobileSidebarOpen(false)}
            />
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
                isAdmin={user.role === "admin"}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className={cn(
          "flex items-center gap-3 px-4 py-3 border-b shrink-0",
          isDark ? "border-white/[0.06] bg-background" : "border-black/[0.06] bg-white"
        )}>
          <button
            onClick={() => setIsMobileSidebarOpen(true)}
            className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-400 flex items-center justify-center shadow-sm shrink-0">
              <FolderOpen className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight">Galeri Studio</h1>
              <p className="text-[11px] text-muted-foreground truncate">Semua karyamu di Pio Studio</p>
            </div>
          </div>
          {selectMode ? (
            <button
              onClick={exitSelectMode}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-muted hover:bg-muted/70 transition-colors inline-flex items-center gap-1.5"
              title="Batal pilih"
            >
              <X className="w-3.5 h-3.5" /> Batal
            </button>
          ) : (
            <>
              <button
                onClick={() => setSelectMode(true)}
                disabled={items.length === 0}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                title="Pilih item"
              >
                <CheckSquare className="w-3.5 h-3.5" /> Pilih
              </button>
              <button
                onClick={() => setSelectMode(true)}
                disabled={items.length === 0}
                className="sm:hidden p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-40"
                title="Pilih item"
              >
                <CheckSquare className="w-4 h-4" />
              </button>
              <button
                onClick={() => loadAll(true)}
                disabled={refreshing}
                className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              </button>
            </>
          )}
        </header>

        <div className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            {/* Filter tabs */}
            <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 -mx-1 px-1">
              {([
                { key: "all" as const, label: "Semua", icon: Sparkles, count: counts.all },
                { key: "image" as const, label: "Gambar", icon: ImageIcon, count: counts.image },
                { key: "video" as const, label: "Video", icon: VideoIcon, count: counts.video },
                { key: "voice" as const, label: "Voice", icon: Mic, count: counts.voice },
              ]).map(tab => {
                const Icon = tab.icon;
                const active = filter === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setFilter(tab.key)}
                    className={cn(
                      "inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap shrink-0",
                      active
                        ? "bg-foreground text-background shadow-sm"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                    <span className={cn(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
                      active ? "bg-background/20" : "bg-foreground/10"
                    )}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Loading */}
            {loading && (
              <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3 md:gap-4">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="rounded-xl sm:rounded-2xl border border-border/60 bg-card overflow-hidden">
                    <div className="aspect-video bg-muted/50 animate-pulse" />
                    <div className="p-2 sm:p-3.5 space-y-2">
                      <div className="h-3 bg-muted/50 rounded animate-pulse w-3/4" />
                      <div className="h-2.5 bg-muted/40 rounded animate-pulse w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {!loading && error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 p-4 text-sm">
                {error}
              </div>
            )}

            {/* Empty */}
            {!loading && !error && items.length === 0 && (
              <div className="max-w-2xl mx-auto px-6 py-16 text-center">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/15 to-orange-400/15 flex items-center justify-center mx-auto mb-6">
                  <FolderOpen className="w-10 h-10 text-amber-500" />
                </div>
                <h2 className="text-xl font-bold mb-2">Galeri masih kosong</h2>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Mulai bikin karya di Image Studio, Voice Studio, atau Video Studio — hasilnya bakal otomatis muncul di sini.
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <button
                    onClick={() => navigate("/image-studio")}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-br from-primary to-indigo-500 text-white text-sm font-medium shadow-sm hover:brightness-110 transition-all"
                  >
                    <ImageIcon className="w-4 h-4" /> Buka Image Studio
                  </button>
                  <button
                    onClick={() => navigate("/voice-studio")}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted hover:bg-muted/70 text-foreground text-sm font-medium transition-colors"
                  >
                    <Mic className="w-4 h-4" /> Voice Studio
                  </button>
                  <button
                    onClick={() => navigate("/video-studio")}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted hover:bg-muted/70 text-foreground text-sm font-medium transition-colors"
                  >
                    <VideoIcon className="w-4 h-4" /> Video Studio
                  </button>
                </div>
              </div>
            )}

            {/* Grid */}
            {!loading && !error && items.length > 0 && (
              <div className={cn(
                "grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3 md:gap-4",
                selectMode && "pb-24"
              )}>
                {items.map(item => {
                  const key = itemKey(item);
                  const selected = selectedKeys.has(key);
                  if (item.kind === "image") {
                    return (
                      <ImageCard
                        key={key}
                        item={item}
                        isDeleting={deletingId === item.id}
                        selectMode={selectMode}
                        selected={selected}
                        onToggleSelect={() => toggleSelect(key)}
                        onPreview={() => setPreviewImage(item)}
                        onDelete={() => handleDeleteImage(item.id)}
                      />
                    );
                  }
                  return item.kind === "video" ? (
                    <VideoCard
                      key={key}
                      item={item}
                      isDeleting={deletingId === item.id}
                      selectMode={selectMode}
                      selected={selected}
                      onToggleSelect={() => toggleSelect(key)}
                      onPlay={() => setPreviewVideo(item)}
                      onDelete={() => handleDeleteVideo(item.id)}
                    />
                  ) : (
                    <VoiceCard
                      key={key}
                      item={item}
                      isDeleting={deletingId === item.id}
                      selectMode={selectMode}
                      selected={selected}
                      onToggleSelect={() => toggleSelect(key)}
                      onPlay={() => setPreviewVoice(item)}
                      onDelete={() => handleDeleteVoice(item.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Batch Action Bar ────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectMode && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 280 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 w-[min(640px,calc(100vw-1.5rem))]"
          >
            <div className={cn(
              "rounded-2xl shadow-2xl border flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5",
              isDark ? "bg-zinc-900/95 border-white/10 backdrop-blur" : "bg-white/95 border-black/10 backdrop-blur"
            )}>
              <div className="text-xs sm:text-sm font-semibold flex-1 min-w-0">
                {selectedKeys.size === 0 ? (
                  <span className="text-muted-foreground">Pilih item dulu</span>
                ) : (
                  <span><span className="text-primary">{selectedKeys.size}</span> dipilih</span>
                )}
              </div>
              <button
                onClick={() => {
                  if (selectedKeys.size === items.length) setSelectedKeys(new Set());
                  else setSelectedKeys(new Set(items.map(itemKey)));
                }}
                className="text-[11px] sm:text-xs px-2.5 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                {selectedKeys.size === items.length ? "Batal semua" : "Pilih semua"}
              </button>
              <button
                onClick={handleBatchDownload}
                disabled={selectedKeys.size === 0 || batchBusy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-xs sm:text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Download yang dipilih"
              >
                {batchBusy === "download" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">Download</span>
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedKeys.size === 0 || batchBusy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-500 text-xs sm:text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Hapus yang dipilih"
              >
                {batchBusy === "delete" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">Hapus</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Video Preview Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {previewVideo && previewVideo.videoUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
            onClick={() => setPreviewVideo(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-5xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => setPreviewVideo(null)}
                className="absolute -top-12 right-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                title="Tutup (Esc)"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="rounded-2xl overflow-hidden bg-black shadow-2xl">
                <video
                  src={previewVideo.videoUrl}
                  controls
                  autoPlay
                  playsInline
                  className="w-full max-h-[80vh] block"
                />
              </div>

              <div className="mt-4 flex items-start justify-between gap-4 text-white">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug line-clamp-3">{previewVideo.prompt || "Tanpa prompt"}</p>
                  <div className="text-[11px] text-white/60 mt-1">
                    {previewVideo.model} · {formatDate(previewVideo.createdAt)}
                  </div>
                </div>
                <button
                  onClick={() => downloadUrl(previewVideo.videoUrl!, `pio-video-${previewVideo.id}.mp4`)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors shrink-0"
                >
                  <Download className="w-4 h-4" /> Download
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Voice Preview Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {previewVoice && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewVoice(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setPreviewVoice(null)}
                className="absolute -top-12 right-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                title="Tutup (Esc)"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="rounded-2xl overflow-hidden bg-card border border-border/60 shadow-2xl">
                {/* Content */}
                <div className="p-5 space-y-4">
                  {previewVoice.voiceLabel && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                      <AudioLines className="w-3 h-3" /> {previewVoice.voiceLabel}
                    </div>
                  )}

                  <div>
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Teks</div>
                    <p className="text-sm leading-relaxed max-h-40 overflow-y-auto pr-1">
                      {previewVoice.text || "Tanpa teks"}
                    </p>
                  </div>

                  {previewVoice.audioUrl ? (
                    <audio
                      src={previewVoice.audioUrl}
                      controls
                      autoPlay
                      className="w-full"
                    />
                  ) : (
                    <div className="text-xs text-muted-foreground italic">Audio gak tersedia</div>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/60">
                    <div className="text-[11px] text-muted-foreground min-w-0">
                      {previewVoice.language && <span>{previewVoice.language} · </span>}
                      <span>{formatDate(previewVoice.createdAt)}</span>
                    </div>
                    {previewVoice.audioUrl && (
                      <button
                        onClick={() => downloadUrl(
                          previewVoice.audioUrl!,
                          `pio-voice-${previewVoice.id}.${previewVoice.mime?.includes("wav") ? "wav" : "mp3"}`
                        )}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-xs font-medium transition-colors shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" /> Download
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Image Preview Modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 sm:p-8"
            onClick={() => setPreviewImage(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="relative max-w-5xl w-full flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setPreviewImage(null)}
                className="absolute -top-12 right-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                title="Tutup (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
              <img
                src={previewImage.imageUrl}
                alt={previewImage.prompt}
                className="max-w-full max-h-[80vh] rounded-2xl shadow-2xl object-contain"
              />
              <div className="mt-4 flex items-start justify-between gap-4 text-white w-full max-w-2xl">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug line-clamp-3">{previewImage.prompt || "Tanpa prompt"}</p>
                  <div className="text-[11px] text-white/60 mt-1">
                    {previewImage.model} · {formatDate(previewImage.createdAt)}
                  </div>
                </div>
                <button
                  onClick={() => downloadUrl(previewImage.imageUrl, `pio-image-${previewImage.id}.png`)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors shrink-0"
                >
                  <Download className="w-4 h-4" /> Download
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Image Card ───────────────────────────────────────────────────────────────
function ImageCard({
  item,
  isDeleting,
  selectMode,
  selected,
  onToggleSelect,
  onPreview,
  onDelete,
}: {
  item: ImageItem;
  isDeleting: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onPreview: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "group rounded-xl sm:rounded-2xl border bg-card overflow-hidden hover:shadow-lg transition-all",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border/60 hover:border-primary/40"
      )}
    >
      <button
        type="button"
        onClick={selectMode ? onToggleSelect : onPreview}
        className="relative aspect-square w-full bg-gradient-to-br from-primary/10 to-indigo-400/10 overflow-hidden block cursor-pointer"
      >
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.prompt}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-primary/30" />
          </div>
        )}

        {/* Top badge */}
        <div className="absolute top-1 left-1 sm:top-2 sm:left-2 inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-[9px] sm:text-[10px] font-semibold">
          <ImageIcon className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> Gambar
        </div>

        {/* Hover overlay with expand icon */}
        {!selectMode && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity w-9 h-9 sm:w-12 sm:h-12 rounded-full bg-white/95 text-black flex items-center justify-center shadow-lg">
              <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
        )}

        {/* Select mode overlay */}
        {selectMode && (
          <div className={cn(
            "absolute inset-0 transition-colors",
            selected ? "bg-primary/30" : "bg-black/20 hover:bg-black/30"
          )}>
            <div className={cn(
              "absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
              selected ? "bg-primary border-primary" : "bg-black/40 border-white/70 backdrop-blur-sm"
            )}>
              {selected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </div>
          </div>
        )}
      </button>

      <div className="p-2 sm:p-3 md:p-3.5">
        <p className="text-[11px] sm:text-xs md:text-sm font-medium leading-snug line-clamp-2 mb-1 sm:mb-1.5">
          {item.prompt || "Tanpa prompt"}
        </p>
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-muted-foreground min-w-0">
            <span className="truncate hidden sm:inline">{item.model}</span>
            <span className="hidden sm:inline">·</span>
            <span className="shrink-0">{formatDate(item.createdAt)}</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {item.imageUrl && (
              <button
                onClick={() => downloadUrl(item.imageUrl, `pio-image-${item.id}.png`)}
                className="p-1 sm:p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Download"
              >
                <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
            )}
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="p-1 sm:p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title="Hapus"
            >
              {isDeleting ? <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" /> : <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
            </button>
          </div>
        </div>
        <div className="sm:hidden text-[9px] text-muted-foreground mt-0.5">{formatDate(item.createdAt)}</div>
      </div>
    </motion.div>
  );
}

// ── Video Card ───────────────────────────────────────────────────────────────
function VideoCard({
  item,
  isDeleting,
  selectMode,
  selected,
  onToggleSelect,
  onPlay,
  onDelete,
}: {
  item: VideoItem;
  isDeleting: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onPlay: () => void;
  onDelete: () => void;
}) {
  const isReady = item.status === "succeeded" && item.videoUrl;
  const isFailed = item.status === "failed";
  const isPending = item.status === "pending" || item.status === "running";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "group rounded-xl sm:rounded-2xl border bg-card overflow-hidden hover:shadow-lg transition-all",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border/60 hover:border-primary/40"
      )}
    >
      <button
        type="button"
        onClick={selectMode ? onToggleSelect : (isReady ? onPlay : undefined)}
        disabled={!selectMode && !isReady}
        className={cn(
          "relative aspect-video w-full bg-gradient-to-br from-primary/10 to-indigo-400/10 overflow-hidden block",
          (selectMode || isReady) && "cursor-pointer"
        )}
      >
        {isReady ? (
          // Static thumbnail: pake poster (gambar input untuk i2v) atau frame pertama video.
          // preload="metadata" + muted + tanpa autoplay → cuma load 1 frame.
          item.imageUrl ? (
            <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <video
              src={item.videoUrl}
              muted
              playsInline
              preload="metadata"
              className="w-full h-full object-cover pointer-events-none"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {isPending && <Loader2 className="w-8 h-8 text-primary animate-spin" />}
            {isFailed && (
              <div className="text-center px-4">
                <div className="text-xs font-semibold text-red-500 mb-1">Gagal</div>
                <div className="text-[10px] text-muted-foreground line-clamp-2">{item.error || "Video gagal di-generate"}</div>
              </div>
            )}
          </div>
        )}

        {/* Top badge */}
        <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-[10px] font-semibold">
          <VideoIcon className="w-3 h-3" /> Video
        </div>

        {/* Status badge */}
        {isPending && !selectMode && (
          <div className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/90 text-white text-[10px] font-semibold">
            <Loader2 className="w-2.5 h-2.5 animate-spin" /> Proses
          </div>
        )}

        {/* Play button overlay (sembunyi pas select mode) */}
        {isReady && !selectMode && (
          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors flex items-center justify-center">
            <div className="w-9 h-9 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full bg-white/95 text-black flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <Play className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 ml-0.5" fill="currentColor" />
            </div>
          </div>
        )}

        {/* Select mode overlay — ceklis di kanan atas */}
        {selectMode && (
          <div className={cn(
            "absolute inset-0 transition-colors",
            selected ? "bg-primary/30" : "bg-black/20 hover:bg-black/30"
          )}>
            <div className={cn(
              "absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
              selected ? "bg-primary border-primary" : "bg-black/40 border-white/70 backdrop-blur-sm"
            )}>
              {selected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </div>
          </div>
        )}
      </button>

      <div className="p-2 sm:p-3 md:p-3.5">
        <p className="text-[11px] sm:text-xs md:text-sm font-medium leading-snug line-clamp-2 mb-1 sm:mb-1.5">{item.prompt || "Tanpa prompt"}</p>
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-muted-foreground min-w-0">
            <span className="truncate">{item.model}</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline shrink-0">{formatDate(item.createdAt)}</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {isReady && item.videoUrl && (
              <button
                onClick={() => downloadUrl(item.videoUrl!, `pio-video-${item.id}.mp4`)}
                className="p-1 sm:p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Download"
              >
                <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
            )}
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="p-1 sm:p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title="Hapus"
            >
              {isDeleting ? <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" /> : <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
            </button>
          </div>
        </div>
        {/* Tanggal di mobile (di bawah, biar gak crowded) */}
        <div className="sm:hidden text-[9px] text-muted-foreground mt-0.5">{formatDate(item.createdAt)}</div>
      </div>
    </motion.div>
  );
}

// ── Voice Card ───────────────────────────────────────────────────────────────
function VoiceCard({
  item,
  isDeleting,
  selectMode,
  selected,
  onToggleSelect,
  onPlay,
  onDelete,
}: {
  item: VoiceItem;
  isDeleting: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onPlay: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "group rounded-xl sm:rounded-2xl border bg-card overflow-hidden hover:shadow-lg transition-all",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border/60 hover:border-primary/40"
      )}
    >
      <button
        type="button"
        onClick={selectMode ? onToggleSelect : (item.audioUrl ? onPlay : undefined)}
        disabled={!selectMode && !item.audioUrl}
        className={cn(
          "relative aspect-video w-full bg-gradient-to-br from-violet-500/15 via-primary/10 to-indigo-400/15 overflow-hidden flex items-center justify-center block",
          (selectMode || item.audioUrl) && "cursor-pointer"
        )}
      >
        {/* Decorative wave bars */}
        <div className="absolute inset-0 flex items-center justify-center gap-0.5 sm:gap-1 px-2 sm:px-6 pointer-events-none">
          {Array.from({ length: 28 }).map((_, i) => {
            const seed = (item.id.charCodeAt(i % item.id.length) || 50) % 100;
            const h = 12 + (seed % 60);
            return (
              <div
                key={i}
                className="w-0.5 sm:w-1 rounded-full bg-primary/40"
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>

        {/* Top badge */}
        <div className="absolute top-1 left-1 sm:top-2 sm:left-2 inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-[9px] sm:text-[10px] font-semibold">
          <AudioLines className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> Voice
        </div>

        {/* Voice label (sembunyi di mobile biar gak crowded) */}
        {item.voiceLabel && !selectMode && (
          <div className="hidden sm:inline-flex absolute top-2 right-2 items-center gap-1 px-2 py-0.5 rounded-full bg-white/90 text-black text-[10px] font-semibold max-w-[60%] truncate">
            {item.voiceLabel}
          </div>
        )}

        {/* Play button overlay (sembunyi pas select mode) */}
        {!selectMode && (
          <div className="absolute inset-0 bg-black/10 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <div className="w-9 h-9 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full bg-white/95 text-primary flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <Play className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 ml-0.5" fill="currentColor" />
            </div>
          </div>
        )}

        {/* Select mode overlay — ceklis di kanan atas */}
        {selectMode && (
          <div className={cn(
            "absolute inset-0 transition-colors",
            selected ? "bg-primary/30" : "bg-black/20 hover:bg-black/30"
          )}>
            <div className={cn(
              "absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
              selected ? "bg-primary border-primary" : "bg-black/40 border-white/70 backdrop-blur-sm"
            )}>
              {selected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </div>
          </div>
        )}
      </button>

      <div className="p-2 sm:p-3 md:p-3.5">
        <p className="text-[11px] sm:text-xs md:text-sm font-medium leading-snug line-clamp-2 mb-1 sm:mb-1.5">{item.text || "Tanpa teks"}</p>
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-muted-foreground min-w-0">
            {item.language && <><span className="truncate hidden sm:inline">{item.language}</span><span className="hidden sm:inline">·</span></>}
            <span className="shrink-0">{formatDate(item.createdAt)}</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {item.audioUrl && (
              <button
                onClick={() => downloadUrl(item.audioUrl!, `pio-voice-${item.id}.${item.mime?.includes("wav") ? "wav" : "mp3"}`)}
                className="p-1 sm:p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Download"
              >
                <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
            )}
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="p-1 sm:p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title="Hapus"
            >
              {isDeleting ? <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" /> : <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
