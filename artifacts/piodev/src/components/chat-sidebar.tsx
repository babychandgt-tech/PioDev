import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Plus, Settings, LogOut, MessageSquare, Trash2, Pencil, Search, X, MoreHorizontal, Star, Menu, Shield, Newspaper, Video, Key, Sparkles, Library, ChevronDown, ChevronRight, Mic, Image as ImageIcon, FolderOpen, Globe } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Chat {
  id: string;
  title: string;
  updatedAt?: Date;
}

interface User {
  name: string;
  initials: string;
  email?: string;
}

interface ChatSidebarProps {
  user: User;
  chats: Chat[];
  activeChatId?: string;
  createNewChat: () => void;
  selectChat: (id: string) => void;
  deleteChat: (id: string) => void;
  updateChatTitle?: (id: string, title: string) => void;
  logout: () => void;
  isAdmin?: boolean;
  collapsed?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
  onNavigate?: () => void;
}

function getDateGroup(date?: Date): string {
  if (!date) return "Lebih lama";
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Terbaru";
  if (diffDays === 1) return "Kemarin";
  if (diffDays <= 7) return "7 hari terakhir";
  if (diffDays <= 30) return "30 hari terakhir";
  return "Lebih lama";
}

const GROUP_ORDER = ["Terbaru", "Kemarin", "7 hari terakhir", "30 hari terakhir", "Lebih lama"];

const STARRED_KEY = "piodev_starred_chats";

function loadStarred(): Set<string> {
  try {
    const raw = localStorage.getItem(STARRED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveStarred(starred: Set<string>) {
  localStorage.setItem(STARRED_KEY, JSON.stringify([...starred]));
}

export function ChatSidebar({
  user, chats, activeChatId, createNewChat, selectChat, deleteChat, updateChatTitle, logout, isAdmin, collapsed, onExpand, onCollapse,
}: ChatSidebarProps) {
  const [location, navigate] = useLocation();
  const isOnVideoStudio = location === "/video-studio";
  const isOnVoiceStudio = location === "/voice-studio";
  const isOnImageStudio = location === "/image-studio";
  const isOnGaleriStudio = location === "/galeri-studio";
  const isOnStudio = isOnVideoStudio || isOnVoiceStudio || isOnImageStudio || isOnGaleriStudio;
  const isOnPustaka = location === "/pustaka";
  const isOnHosting = location === "/hosting";

  // Pio Studio collapsible — auto-expand kalo lagi di sub-route Studio
  const [studioExpanded, setStudioExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("piodev_studio_expanded");
      if (saved === "true") return true;
      if (saved === "false") return false;
    } catch {}
    return false;
  });
  useEffect(() => {
    if (isOnStudio) setStudioExpanded(true);
  }, [isOnStudio]);
  const toggleStudio = () => {
    const next = !studioExpanded;
    setStudioExpanded(next);
    try { localStorage.setItem("piodev_studio_expanded", String(next)); } catch {}
  };
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [starredIds, setStarredIds] = useState<Set<string>>(loadStarred);
  const [hasNewChangelog, setHasNewChangelog] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const chatToDelete = chats.find((c) => c.id === pendingDeleteId);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

        const [changelogRes, lastSeenRes] = await Promise.all([
          fetch("/api/changelog"),
          token ? fetch("/api/me/whats-new-last-seen", { headers }) : Promise.resolve(null),
        ]);

        const changelog: { created_at: string }[] = await changelogRes.json();
        if (!Array.isArray(changelog) || changelog.length === 0) return;

        const newestDate = changelog[0].created_at;
        let lastSeen: string | null = null;

        if (lastSeenRes && lastSeenRes.ok) {
          const body = await lastSeenRes.json();
          lastSeen = body.lastSeen;
        }
        if (!lastSeen) {
          lastSeen = localStorage.getItem("pioo_whatsNewLastSeen");
        }

        if (!lastSeen || newestDate > lastSeen) setHasNewChangelog(true);
      } catch {}
    })();
  }, []);

  const startEditing = (chat: Chat) => {
    setEditingId(chat.id);
    setEditingTitle(chat.title);
  };

  const commitEdit = () => {
    if (editingId && editingTitle.trim() && updateChatTitle) {
      updateChatTitle(editingId, editingTitle.trim());
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const toggleStar = (id: string) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveStarred(next);
      return next;
    });
  };

  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats;
    const q = searchQuery.toLowerCase();
    return chats.filter((c) => c.title.toLowerCase().includes(q));
  }, [chats, searchQuery]);

  const { starredChats, unstarredChats } = useMemo(() => {
    const starred = chats.filter((c) => starredIds.has(c.id));
    const unstarred = chats.filter((c) => !starredIds.has(c.id));
    return { starredChats: starred, unstarredChats: unstarred };
  }, [chats, starredIds]);

  const groupedChats = useMemo(() => {
    const groups: Record<string, Chat[]> = {};
    for (const chat of unstarredChats) {
      const group = getDateGroup(chat.updatedAt);
      if (!groups[group]) groups[group] = [];
      groups[group].push(chat);
    }
    return GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => ({ label: g, chats: groups[g] }));
  }, [unstarredChats]);

  const renderChatItem = (chat: Chat) => (
    <div
      key={chat.id}
      onClick={() => editingId !== chat.id && selectChat(chat.id)}
      className={cn(
        "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-colors group cursor-pointer",
        activeChatId === chat.id
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
    >
      {editingId === chat.id ? (
        <input
          ref={editInputRef}
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
            if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-background border border-primary/40 rounded-md px-2 py-0.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      ) : (
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {starredIds.has(chat.id)
            ? <Star className="w-3.5 h-3.5 shrink-0 fill-yellow-400 text-yellow-400" />
            : <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-50" />
          }
          <span className="truncate text-left">
            {chat.title}
          </span>
        </div>
      )}

      {editingId !== chat.id && (
        <div
          className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Opsi chat"
                className="p-1.5 -m-0.5 rounded hover:bg-sidebar-accent/70 text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors touch-manipulation"
                title="Opsi"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-44">
              <DropdownMenuItem
                onClick={() => toggleStar(chat.id)}
                className="gap-2 cursor-pointer"
              >
                <Star className={cn("w-3.5 h-3.5", starredIds.has(chat.id) ? "fill-yellow-400 text-yellow-400" : "")} />
                {starredIds.has(chat.id) ? "Hapus bintang" : "Beri bintang"}
              </DropdownMenuItem>
              {updateChatTitle && (
                <DropdownMenuItem
                  onClick={() => startEditing(chat)}
                  className="gap-2 cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Rename
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setPendingDeleteId(chat.id)}
                className="gap-2 cursor-pointer text-red-500 focus:text-red-500"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Hapus
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  if (collapsed) {
    return (
      <div className="flex flex-col h-full items-center py-3 gap-1 bg-sidebar/50 overflow-hidden">
        {/* Hamburger — expand sidebar */}
        <button
          onClick={onExpand}
          title="Buka sidebar"
          className="w-10 h-10 flex items-center justify-center rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors mb-1"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* New Chat */}
        <button
          onClick={createNewChat}
          title="Chat Baru"
          className="w-10 h-10 flex items-center justify-center rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Plus className="w-5 h-5" />
        </button>

        {/* Pio Studio — di mode collapsed, dropdown menu untuk pilih sub-studio */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title="Pio Studio"
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded-lg transition-colors",
                isOnStudio
                  ? "bg-primary/15 text-primary"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <Sparkles className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-52">
            <DropdownMenuItem onClick={() => navigate("/galeri-studio")} className="gap-2 cursor-pointer">
              <FolderOpen className="w-4 h-4" /> Galeri Studio
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/image-studio")} className="gap-2 cursor-pointer">
              <ImageIcon className="w-4 h-4" /> Image Studio
              <span className="ml-auto text-[10px] text-muted-foreground">soon</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/voice-studio")} className="gap-2 cursor-pointer">
              <Mic className="w-4 h-4" /> Voice Studio
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/video-studio")} className="gap-2 cursor-pointer">
              <Video className="w-4 h-4" /> Video Studio
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Pustaka */}
        <button
          onClick={() => navigate("/pustaka")}
          title="Pustaka"
          className={cn(
            "w-10 h-10 flex items-center justify-center rounded-lg transition-colors",
            isOnPustaka
              ? "bg-primary/15 text-primary"
              : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          )}
        >
          <Library className="w-5 h-5" />
        </button>

        {/* Hosting */}
        <button
          onClick={() => navigate("/hosting")}
          title="Hosting"
          className={cn(
            "w-10 h-10 flex items-center justify-center rounded-lg transition-colors",
            isOnHosting
              ? "bg-primary/15 text-primary"
              : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          )}
        >
          <Globe className="w-5 h-5" />
        </button>

        {/* Search — klik untuk expand */}
        <button
          onClick={onExpand}
          title="Cari percakapan"
          className="w-10 h-10 flex items-center justify-center rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Admin */}
        {isAdmin && (
          <button
            onClick={() => navigate("/admin")}
            title="Admin Dashboard"
            className="w-10 h-10 flex items-center justify-center rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <Shield className="w-5 h-5 text-orange-500" />
          </button>
        )}

        {/* Settings */}
        <button
          onClick={() => navigate("/settings")}
          title="Pengaturan"
          className="w-10 h-10 flex items-center justify-center rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Settings className="w-5 h-5" />
        </button>

        {/* User avatar */}
        <div
          className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold cursor-default mb-1"
          title={user.name}
        >
          {user.initials}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-sidebar/50">
      {/* Header */}
      <div className="px-3 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-lg text-sidebar-foreground px-1">
          <Logo size={20} />
          PioCode
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Tutup sidebar"
            className="p-2 rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* New chat button */}
      <div className="px-3 pb-1.5">
        <button
          onClick={createNewChat}
          className={cn(
            "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl font-medium transition-colors",
            !isOnStudio && !activeChatId
              ? "bg-primary/10 hover:bg-primary/15 text-primary border border-primary/10"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          )}
        >
          <span className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Chat Baru
          </span>
          {!isOnStudio && !activeChatId && (
            <span className="text-[10px] bg-background/50 px-1.5 rounded text-primary border border-primary/10">⌘K</span>
          )}
        </button>
      </div>

      {/* Pio Studio — collapsible parent dengan 4 sub-items */}
      <div className="px-3 pb-1.5">
        <button
          onClick={toggleStudio}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium transition-colors",
            isOnStudio
              ? "bg-primary/10 text-primary border border-primary/10"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          )}
        >
          <Sparkles className="w-4 h-4" />
          <span>Pio Studio</span>
          <span className="ml-auto">
            {studioExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        </button>

        {studioExpanded && (
          <div className="mt-1 ml-3 pl-3 border-l border-sidebar-border/60 flex flex-col gap-0.5">
            {/* Galeri Studio */}
            <button
              onClick={() => navigate("/galeri-studio")}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors",
                isOnGaleriStudio
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <FolderOpen className="w-4 h-4" />
              <span>Galeri Studio</span>
            </button>

            {/* Image Studio (coming soon) */}
            <button
              onClick={() => navigate("/image-studio")}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors",
                isOnImageStudio
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <ImageIcon className="w-4 h-4" />
              <span>Image Studio</span>
              <span className="ml-auto text-[9px] uppercase text-sidebar-foreground/40">soon</span>
            </button>

            {/* Voice Studio (NEW) */}
            <button
              onClick={() => navigate("/voice-studio")}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors",
                isOnVoiceStudio
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Mic className="w-4 h-4" />
              <span>Voice Studio</span>
            </button>

            {/* Video Studio */}
            <button
              onClick={() => navigate("/video-studio")}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors",
                isOnVideoStudio
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Video className="w-4 h-4" />
              <span>Video Studio</span>
            </button>
          </div>
        )}
      </div>

      {/* Pustaka */}
      <div className="px-3 pb-1.5">
        <button
          onClick={() => navigate("/pustaka")}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium transition-colors",
            isOnPustaka
              ? "bg-primary/10 text-primary border border-primary/10"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          )}
        >
          <Library className="w-4 h-4" />
          Pustaka
        </button>
      </div>

      {/* Hosting */}
      <div className="px-3 pb-2">
        <button
          onClick={() => navigate("/hosting")}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium transition-colors",
            isOnHosting
              ? "bg-primary/10 text-primary border border-primary/10"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          )}
        >
          <Globe className="w-4 h-4" />
          Hosting
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sidebar-foreground/30" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari percakapan..."
            className="w-full pl-8 pr-7 py-2 text-xs rounded-lg bg-sidebar-accent/40 border border-sidebar-border focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 text-sidebar-foreground placeholder:text-sidebar-foreground/30 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sidebar-foreground/30 hover:text-sidebar-foreground/60 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1">
        {searchQuery.trim() ? (
          filteredChats.length === 0 ? (
            <p className="text-xs text-sidebar-foreground/40 px-2 py-3 text-center">
              Tidak ada percakapan yang cocok
            </p>
          ) : (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold text-sidebar-foreground/40 px-2 mb-1.5 uppercase tracking-wider">
                {filteredChats.length} hasil
              </p>
              {filteredChats.map(renderChatItem)}
            </div>
          )
        ) : chats.length === 0 ? (
          <p className="text-sm text-sidebar-foreground/40 px-2 py-4 text-center italic">
            Belum ada percakapan
          </p>
        ) : (
          <div className="space-y-4">
            {/* Starred section */}
            {starredChats.length > 0 && (
              <div>
                <div className="flex items-center gap-2 px-2 mb-1.5">
                  <p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider">
                    Berbintang
                  </p>
                  <span className="text-[10px] tabular-nums text-sidebar-foreground/30 font-medium">
                    {starredChats.length}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {starredChats.map(renderChatItem)}
                </div>
              </div>
            )}

            {/* Grouped by date */}
            {groupedChats.map(({ label, chats: groupChats }) => (
              <div key={label}>
                <div className="flex items-center gap-2 px-2 mb-1.5">
                  <p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider">
                    {label}
                  </p>
                  <span className="text-[10px] tabular-nums text-sidebar-foreground/30 font-medium">
                    {groupChats.length}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {groupChats.map(renderChatItem)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg group">
          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
            {user.initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative p-1.5 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-md transition-colors">
                <MoreHorizontal className="w-4 h-4" />
                {hasNewChangelog && (
                  <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-red-500 rounded-full border border-background" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-48 mb-1">
              {isAdmin && (
                <>
                  <DropdownMenuItem onClick={() => navigate("/admin")} className="gap-2 cursor-pointer">
                    <Shield className="w-4 h-4 text-orange-500" />
                    <span>Admin Dashboard</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={() => { setHasNewChangelog(false); navigate("/whats-new"); }}
                className="gap-2 cursor-pointer"
              >
                <Newspaper className="w-4 h-4" />
                <span className="whitespace-nowrap">Apa yang baru?</span>
                {hasNewChangelog && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-red-500" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/settings")} className="gap-2 cursor-pointer">
                <Settings className="w-4 h-4" />
                <span>Pengaturan</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/premium")} className="gap-2 cursor-pointer">
                <Sparkles className="w-4 h-4" />
                <span>Upgrade Akun</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/api-keys")} className="gap-2 cursor-pointer">
                <Key className="w-4 h-4" />
                <span>API Keys</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="gap-2 cursor-pointer text-red-500 focus:text-red-500">
                <LogOut className="w-4 h-4" />
                <span>Keluar</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent className="max-w-sm rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus percakapan?</AlertDialogTitle>
            <AlertDialogDescription>
              {chatToDelete
                ? <>Percakapan <span className="font-medium text-foreground">"{chatToDelete.title}"</span> akan dihapus permanen dan tidak bisa dikembalikan.</>
                : "Percakapan ini akan dihapus permanen dan tidak bisa dikembalikan."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { deleteChat(pendingDeleteId!); setPendingDeleteId(null); }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
