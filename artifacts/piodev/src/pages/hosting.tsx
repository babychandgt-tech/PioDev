import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe, Plus, Trash2, RefreshCw, Rocket, GitBranch, ExternalLink,
  Loader2, AlertCircle, CheckCircle2, Clock, X, ChevronRight,
  Terminal, Copy, Check, Menu, Server, Zap, XCircle, Sparkles,
  KeyRound, Eye, EyeOff,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useChat } from "@/hooks/use-chat";
import { ChatSidebar } from "@/components/chat-sidebar";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ProjectStatus = "inactive" | "deploying" | "running" | "failed" | "stopped";

interface HostingProject {
  id: string;
  name: string;
  description: string;
  git_url: string;
  git_branch: string;
  build_command: string;
  start_command: string;
  port: number;
  coolify_app_uuid: string | null;
  subdomain: string | null;
  public_url: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

interface Deployment {
  id: string;
  project_id: string;
  status: "queued" | "in_progress" | "finished" | "failed" | "cancelled";
  logs: string;
  triggered_by: string;
  created_at: string;
  finished_at: string | null;
}

interface HostingStatus {
  coolifyConfigured: boolean;
  coolifyReachable: boolean;
  projectCount: number;
  projectLimit: number;
  tier: string;
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

async function authedFetch(path: string, init?: RequestInit) {
  const token = await getToken();
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  const map = {
    inactive: { label: "Tidak aktif", color: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20", icon: Clock },
    deploying: { label: "Deploy...", color: "text-blue-400 bg-blue-400/10 border-blue-400/20", icon: Loader2, spin: true },
    running: { label: "Berjalan", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20", icon: CheckCircle2 },
    failed: { label: "Gagal", color: "text-red-400 bg-red-400/10 border-red-400/20", icon: XCircle },
    stopped: { label: "Dihentikan", color: "text-amber-400 bg-amber-400/10 border-amber-400/20", icon: Clock },
  };
  const cfg = map[status] ?? map.inactive;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border", cfg.color)}>
      <Icon className={cn("w-3 h-3", (cfg as any).spin && "animate-spin")} />
      {cfg.label}
    </span>
  );
}

function DeployStatusBadge({ status }: { status: Deployment["status"] }) {
  const map = {
    queued: { label: "Antri", color: "text-zinc-400" },
    in_progress: { label: "Berjalan", color: "text-blue-400" },
    finished: { label: "Selesai", color: "text-emerald-400" },
    failed: { label: "Gagal", color: "text-red-400" },
    cancelled: { label: "Dibatalkan", color: "text-amber-400" },
  };
  const cfg = map[status] ?? map.queued;
  return <span className={cn("text-xs font-medium", cfg.color)}>{cfg.label}</span>;
}

function formatDate(s: string) {
  return new Date(s).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function truncateGitUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\.git$/, "").slice(0, 50);
}

export default function HostingPage() {
  const [, navigate] = useLocation();
  const { user, logout, isAuthenticated, isLoading: authLoading, isAdmin } = useAuth();
  const { chats, activeChat, createNewChat, selectChat, deleteChat, updateChatTitle } = useChat(user?.id);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);

  const [hostingStatus, setHostingStatus] = useState<HostingStatus | null>(null);
  const [projects, setProjects] = useState<HostingProject[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", git_url: "", git_branch: "main",
    build_command: "", start_command: "", port: "3000",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<{ framework?: string; isMonorepo?: boolean } | null>(null);
  const [detectAttempted, setDetectAttempted] = useState(false);
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());
  const [workspacePackages, setWorkspacePackages] = useState<{ name: string; path: string; framework: string; buildCommand: string; startCommand: string; port: number }[]>([]);
  const [selectedWorkspacePkg, setSelectedWorkspacePkg] = useState<string | null>(null);
  const detectTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [selectedProject, setSelectedProject] = useState<HostingProject | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HostingProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [logs, setLogs] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);

  const [envRows, setEnvRows] = useState<{ key: string; value: string; hidden: boolean }[]>([]);
  const [envEditing, setEnvEditing] = useState(false);
  const [savingEnv, setSavingEnv] = useState(false);
  const [envDotMode, setEnvDotMode] = useState(false);
  const [envDotText, setEnvDotText] = useState("");

  const [editSettings, setEditSettings] = useState(false);
  const [editForm, setEditForm] = useState({ build_command: "", start_command: "", git_branch: "main", port: "3000" });
  const [savingSettings, setSavingSettings] = useState(false);

  const logsRef = useRef<HTMLPreElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const logsPollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/login");
  }, [authLoading, isAuthenticated]);

  const runDetect = useCallback(async (url: string, branch: string) => {
    if (!url || !url.includes("github.com")) return;
    setDetecting(true);
    setDetectAttempted(false);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ git_url: url, branch: branch || "main" });
      const res = await fetch(`/api/hosting/detect?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setDetectResult(null); setDetectAttempted(true); return; }
      const data = await res.json();
      if (data.detected) {
        setDetectResult({ framework: data.framework, isMonorepo: data.isMonorepo });
        if (data.isMonorepo && data.workspacePackages?.length) {
          setWorkspacePackages(data.workspacePackages);
          setSelectedWorkspacePkg(null);
          setForm(f => ({ ...f, build_command: "", start_command: "" }));
          setAutoFilledFields(new Set());
        } else {
          setWorkspacePackages([]);
          setSelectedWorkspacePkg(null);
          const filled = new Set<string>();
          setForm(f => {
            const next = { ...f };
            next.build_command = data.buildCommand ?? "";
            filled.add("build_command");
            next.start_command = data.startCommand ?? "";
            filled.add("start_command");
            if (data.port) { next.port = String(data.port); filled.add("port"); }
            return next;
          });
          setAutoFilledFields(filled);
        }
      } else {
        setDetectResult(null);
        setWorkspacePackages([]);
        setSelectedWorkspacePkg(null);
      }
      setDetectAttempted(true);
    } catch { setDetectResult(null); setDetectAttempted(true); }
    finally { setDetecting(false); }
  }, []);

  useEffect(() => {
    const url = form.git_url.trim();
    if (!url || !url.includes("github.com")) {
      setDetectResult(null);
      setDetectAttempted(false);
      setAutoFilledFields(new Set());
      return;
    }
    if (detectTimerRef.current) clearTimeout(detectTimerRef.current);
    detectTimerRef.current = setTimeout(() => runDetect(url, form.git_branch), 900);
    return () => { if (detectTimerRef.current) clearTimeout(detectTimerRef.current); };
  }, [form.git_url, form.git_branch, runDetect]);

  const loadData = useCallback(async () => {
    try {
      const [statusRes, projectsRes] = await Promise.all([
        authedFetch("/api/hosting/status"),
        authedFetch("/api/hosting/projects"),
      ]);
      if (statusRes.ok) setHostingStatus(await statusRes.json());
      if (projectsRes.ok) {
        const d = await projectsRes.json();
        setProjects(d.projects ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadData();
  }, [isAuthenticated, loadData]);

  useEffect(() => {
    const hasDeploying = projects.some(p => p.status === "deploying");
    if (hasDeploying) {
      pollRef.current = setInterval(loadData, 5000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [projects, loadData]);

  const loadDetail = useCallback(async (project: HostingProject) => {
    setDetailLoading(true);
    setLogs("");
    setShowLogs(false);
    try {
      const res = await authedFetch(`/api/hosting/projects/${project.id}`);
      if (res.ok) {
        const d = await res.json();
        setSelectedProject(d.project);
        setDeployments(d.deployments ?? []);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openProject = async (project: HostingProject) => {
    setSelectedProject(project);
    setEnvEditing(false);
    setShowLogs(false);
    setLogs("");
    await loadDetail(project);
  };

  // Init env rows when project detail loads
  useEffect(() => {
    if (!selectedProject) return;
    const ev = (selectedProject as any).env_vars ?? {};
    setEnvRows(Object.entries(ev).map(([key, value]) => ({ key, value: String(value), hidden: true })));
  }, [selectedProject?.id]);

  // Auto-poll logs while deploying
  useEffect(() => {
    if (!selectedProject || selectedProject.status !== "deploying" || !showLogs) {
      if (logsPollRef.current) { clearInterval(logsPollRef.current); logsPollRef.current = null; }
      return;
    }
    const poll = async () => {
      try {
        const res = await authedFetch(`/api/hosting/projects/${selectedProject.id}/logs`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.logs) { setLogs(data.logs); setTimeout(() => logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight }), 50); }
        if (data.status === "finished" || data.status === "failed") {
          if (logsPollRef.current) { clearInterval(logsPollRef.current); logsPollRef.current = null; }
          setSelectedProject(prev => prev ? { ...prev, status: data.status === "finished" ? "running" : "failed" } : prev);
          setProjects(prev => prev.map(p => p.id === selectedProject.id ? { ...p, status: data.status === "finished" ? "running" : "failed" } : p));
          setDeployments(prev => prev.map(d => d.status === "in_progress" ? { ...d, status: data.status } : d));
        }
      } catch {}
    };
    poll();
    logsPollRef.current = setInterval(poll, 3000);
    return () => { if (logsPollRef.current) { clearInterval(logsPollRef.current); logsPollRef.current = null; } };
  }, [selectedProject?.id, selectedProject?.status, showLogs]);

  const handleCreate = async () => {
    setFormError(null);
    if (!form.name.trim()) { setFormError("Nama proyek wajib diisi"); return; }
    if (!form.git_url.trim()) { setFormError("Git URL wajib diisi"); return; }
    setCreating(true);
    try {
      const res = await authedFetch("/api/hosting/projects", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          port: Number(form.port) || 3000,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? "Gagal membuat proyek"); return; }
      setProjects(prev => [data.project, ...prev]);
      setHostingStatus(prev => prev ? { ...prev, projectCount: prev.projectCount + 1 } : prev);
      setShowCreate(false);
      setForm({ name: "", description: "", git_url: "", git_branch: "main", build_command: "", start_command: "", port: "3000" });
      toast({ title: "Proyek berhasil dibuat!", description: "Klik Deploy untuk mulai deployment pertama." });
    } finally {
      setCreating(false);
    }
  };

  const handleDeploy = async (project: HostingProject) => {
    setDeploying(project.id);
    try {
      const res = await authedFetch(`/api/hosting/projects/${project.id}/deploy`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Gagal deploy", description: data.error, variant: "destructive" }); return; }
      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, status: "deploying" } : p));
      if (selectedProject?.id === project.id) {
        setSelectedProject(prev => prev ? { ...prev, status: "deploying" } : prev);
        setDeployments(prev => [data.deployment, ...prev]);
        setShowLogs(true);
      }
      toast({ title: "Deployment dimulai", description: "Proses build sedang berjalan di VM." });
    } finally {
      setDeploying(null);
    }
  };

  const handleSync = async (project: HostingProject) => {
    setSyncing(project.id);
    try {
      const res = await authedFetch(`/api/hosting/projects/${project.id}/sync`);
      const data = await res.json();
      if (res.ok && data.project) {
        setProjects(prev => prev.map(p => p.id === project.id ? data.project : p));
        if (selectedProject?.id === project.id) setSelectedProject(data.project);
        toast({ title: "Status disinkronkan" });
      }
    } finally {
      setSyncing(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await authedFetch(`/api/hosting/projects/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) { toast({ title: "Gagal menghapus proyek", variant: "destructive" }); return; }
      setProjects(prev => prev.filter(p => p.id !== deleteTarget.id));
      setHostingStatus(prev => prev ? { ...prev, projectCount: Math.max(0, prev.projectCount - 1) } : prev);
      if (selectedProject?.id === deleteTarget.id) setSelectedProject(null);
      toast({ title: "Proyek dihapus" });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleViewLogs = async (project: HostingProject) => {
    setShowLogs(true);
    setLogsLoading(true);
    try {
      const res = await authedFetch(`/api/hosting/projects/${project.id}/logs`);
      const data = await res.json();
      setLogs(data.logs || "");
    } finally {
      setLogsLoading(false);
      setTimeout(() => logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight }), 100);
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedProject) return;
    setSavingSettings(true);
    try {
      const res = await authedFetch(`/api/hosting/projects/${selectedProject.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          build_command: editForm.build_command,
          start_command: editForm.start_command,
          git_branch: editForm.git_branch,
          port: Number(editForm.port) || 3000,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Gagal simpan settings", variant: "destructive" }); return; }
      setSelectedProject(prev => prev ? { ...prev, ...data.project } : prev);
      setProjects(prev => prev.map(p => p.id === selectedProject.id ? { ...p, ...data.project } : p));
      setEditSettings(false);
      toast({ title: "Settings disimpan", description: "Deploy ulang untuk menerapkan perubahan." });
    } finally {
      setSavingSettings(false);
    }
  };

  function rowsToDotEnv(rows: { key: string; value: string }[]): string {
    return rows.filter(r => r.key.trim()).map(r => {
      const needsQuotes = /[\s"'`#]/.test(r.value);
      return `${r.key}=${needsQuotes ? `"${r.value.replace(/"/g, '\\"')}"` : r.value}`;
    }).join("\n");
  }

  function dotEnvToRows(text: string): { key: string; value: string; hidden: boolean }[] {
    return text.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#")).map(line => {
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) return null;
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1).replace(/\\"/g, '"');
      }
      return key ? { key, value, hidden: true } : null;
    }).filter(Boolean) as { key: string; value: string; hidden: boolean }[];
  }

  const handleSaveEnv = async () => {
    if (!selectedProject) return;
    setSavingEnv(true);
    try {
      const rows = envDotMode ? dotEnvToRows(envDotText) : envRows;
      const env_vars = Object.fromEntries(rows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value]));
      const res = await authedFetch(`/api/hosting/projects/${selectedProject.id}/env`, {
        method: "PUT",
        body: JSON.stringify({ env_vars }),
      });
      if (!res.ok) { toast({ title: "Gagal simpan env vars", variant: "destructive" }); return; }
      setSelectedProject(prev => prev ? { ...prev, env_vars } as any : prev);
      setEnvEditing(false);
      toast({ title: "Env vars disimpan", description: "Deploy ulang untuk menerapkan perubahan." });
    } finally {
      setSavingEnv(false);
    }
  };

  const copyLogs = () => {
    navigator.clipboard.writeText(logs);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  const sidebar = user ? (
    <ChatSidebar
      user={user}
      chats={chats}
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
  ) : null;

  if (loading) {
    return (
      <div className="flex h-screen bg-background">
        <div className="hidden md:block w-64 border-r border-border">{sidebar}</div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <div className={cn("hidden md:block border-r border-border transition-all duration-200 shrink-0",
        isDesktopSidebarOpen ? "w-64" : "w-14")}>
        {sidebar}
      </div>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {isMobileSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={() => setIsMobileSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed left-0 top-0 h-full w-72 z-50 md:hidden bg-sidebar border-r border-border"
            >
              {sidebar}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Projects panel */}
        <div className={cn("flex flex-col overflow-hidden transition-all duration-200",
          selectedProject ? "w-full md:w-2/5 lg:w-1/3" : "flex-1")}>

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-4 border-b border-border shrink-0">
            <button
              className="md:hidden p-2 rounded-lg hover:bg-accent transition-colors"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="w-5 h-5 text-primary shrink-0" />
              <h1 className="font-semibold text-base truncate">PioCode Hosting</h1>
            </div>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {hostingStatus && (
                <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("w-1.5 h-1.5 rounded-full", hostingStatus.coolifyReachable ? "bg-emerald-400" : "bg-red-400")} />
                  {hostingStatus.projectCount}/{hostingStatus.projectLimit === 999 ? "∞" : hostingStatus.projectLimit}
                </span>
              )}
              <button
                onClick={() => setShowCreate(true)}
                disabled={!!(hostingStatus && hostingStatus.projectCount >= hostingStatus.projectLimit && hostingStatus.projectLimit !== 999)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Proyek Baru</span>
              </button>
            </div>
          </div>

          {/* Coolify warning */}
          {hostingStatus && !hostingStatus.coolifyReachable && (
            <div className="mx-4 mt-3 flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Coolify tidak terjangkau. Pastikan VM berjalan dan COOLIFY_API_URL/TOKEN sudah dikonfigurasi.</span>
            </div>
          )}

          {/* Project list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Server className="w-8 h-8 text-primary/60" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Belum ada proyek</p>
                  <p className="text-sm text-muted-foreground mt-1">Deploy web app kamu dari Git repository</p>
                </div>
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Buat Proyek Pertama
                </button>
              </div>
            ) : (
              projects.map(project => (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => openProject(project)}
                  className={cn(
                    "group flex flex-col gap-2 p-3.5 rounded-xl border cursor-pointer transition-all",
                    selectedProject?.id === project.id
                      ? "border-primary/40 bg-primary/5"
                      : "border-border hover:border-primary/30 hover:bg-accent/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{project.name}</p>
                      {project.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{project.description}</p>
                      )}
                    </div>
                    <StatusBadge status={project.status} />
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <GitBranch className="w-3 h-3 shrink-0" />
                    <span className="truncate">{truncateGitUrl(project.git_url)}</span>
                    <span className="shrink-0 text-muted-foreground/50">·</span>
                    <span className="shrink-0">{project.git_branch}</span>
                  </div>

                  {project.public_url && project.status === "running" && (
                    <a
                      href={project.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs text-primary hover:underline truncate"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{project.public_url.replace("https://", "")}</span>
                    </a>
                  )}

                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); handleDeploy(project); }}
                      disabled={deploying === project.id || project.status === "deploying"}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      {deploying === project.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />}
                      Deploy
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleSync(project); }}
                      disabled={syncing === project.id}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent text-accent-foreground text-xs hover:bg-accent/80 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={cn("w-3 h-3", syncing === project.id && "animate-spin")} />
                      Sync
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteTarget(project); }}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 transition-colors ml-auto"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Project detail panel */}
        <AnimatePresence>
          {selectedProject && (
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.2 }}
              className="hidden md:flex flex-col flex-1 border-l border-border overflow-hidden"
            >
              {/* Detail header */}
              <div className="flex items-center gap-3 px-4 py-4 border-b border-border shrink-0">
                <button
                  onClick={() => setSelectedProject(null)}
                  className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{selectedProject.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{selectedProject.subdomain}.app.pio.codes</p>
                </div>
                <StatusBadge status={selectedProject.status} />
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {detailLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {/* Info cards + Settings */}
                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2.5 bg-accent/20 border-b border-border">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Konfigurasi</p>
                        {editSettings ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setEditSettings(false)} className="text-xs px-2 py-1 rounded hover:bg-accent transition-colors text-muted-foreground">Batal</button>
                            <button
                              onClick={handleSaveSettings}
                              disabled={savingSettings}
                              className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                              {savingSettings ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              Simpan
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditForm({
                                build_command: selectedProject.build_command ?? "",
                                start_command: selectedProject.start_command ?? "",
                                git_branch: selectedProject.git_branch ?? "main",
                                port: String(selectedProject.port ?? 3000),
                              });
                              setEditSettings(true);
                            }}
                            className="text-xs px-2 py-1 rounded hover:bg-accent transition-colors text-muted-foreground"
                          >Edit</button>
                        )}
                      </div>
                      {editSettings ? (
                        <div className="p-3 space-y-2.5">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Branch</label>
                              <input value={editForm.git_branch} onChange={e => setEditForm(f => ({ ...f, git_branch: e.target.value }))}
                                className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Port</label>
                              <input type="number" value={editForm.port} onChange={e => setEditForm(f => ({ ...f, port: e.target.value }))}
                                className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Build Command</label>
                            <input placeholder="Kosong = auto-detect" value={editForm.build_command} onChange={e => setEditForm(f => ({ ...f, build_command: e.target.value }))}
                              className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10 placeholder:text-muted-foreground/40" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Start Command</label>
                            <input placeholder="Kosong = auto-detect" value={editForm.start_command} onChange={e => setEditForm(f => ({ ...f, start_command: e.target.value }))}
                              className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10 placeholder:text-muted-foreground/40" />
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-px bg-border">
                          <InfoFlat label="Git URL" value={truncateGitUrl(selectedProject.git_url)} />
                          <InfoFlat label="Branch" value={selectedProject.git_branch} />
                          <InfoFlat label="Port" value={String(selectedProject.port)} />
                          <InfoFlat label="Status" value={selectedProject.status} />
                          {selectedProject.build_command && <InfoFlat label="Build" value={selectedProject.build_command} className="col-span-2" />}
                          {selectedProject.start_command && <InfoFlat label="Start" value={selectedProject.start_command} className="col-span-2" />}
                        </div>
                      )}
                    </div>

                    {/* Public URL */}
                    {selectedProject.public_url && (
                      <a
                        href={selectedProject.public_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 p-3 rounded-lg border border-primary/20 bg-primary/5 text-primary text-sm hover:bg-primary/10 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4 shrink-0" />
                        <span className="truncate">{selectedProject.public_url}</span>
                        <ChevronRight className="w-4 h-4 ml-auto shrink-0" />
                      </a>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDeploy(selectedProject)}
                        disabled={deploying === selectedProject.id || selectedProject.status === "deploying"}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {deploying === selectedProject.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                        Deploy
                      </button>
                      <button
                        onClick={() => handleViewLogs(selectedProject)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent text-sm transition-colors"
                      >
                        <Terminal className="w-4 h-4" />
                        Logs
                      </button>
                      <button
                        onClick={() => handleSync(selectedProject)}
                        disabled={syncing === selectedProject.id}
                        className="p-2 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={cn("w-4 h-4", syncing === selectedProject.id && "animate-spin")} />
                      </button>
                    </div>

                    {/* Logs panel */}
                    <AnimatePresence>
                      {showLogs && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="rounded-xl border border-border overflow-hidden"
                        >
                          <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/50 border-b border-border">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Terminal className="w-3.5 h-3.5" />
                              <span>Build Logs</span>
                              {logsLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={copyLogs} className="p-1.5 rounded hover:bg-white/10 transition-colors">
                                {copiedLogs ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                              </button>
                              <button onClick={() => setShowLogs(false)} className="p-1.5 rounded hover:bg-white/10 transition-colors">
                                <X className="w-3.5 h-3.5 text-muted-foreground" />
                              </button>
                            </div>
                          </div>
                          <pre
                            ref={logsRef}
                            className="p-3 text-[11px] font-mono text-zinc-300 bg-zinc-950 overflow-auto max-h-64 whitespace-pre-wrap leading-relaxed"
                          >
                            {logsLoading
                              ? "Memuat logs..."
                              : logs || (selectedProject.status === "deploying"
                                ? "Menunggu output dari VM..."
                                : "Belum ada log. Klik Deploy untuk mulai.")}
                          </pre>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Environment Variables */}
                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2.5 bg-accent/20 border-b border-border">
                        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          <KeyRound className="w-3.5 h-3.5" />
                          Environment Variables
                        </div>
                        <div className="flex items-center gap-1.5">
                          {envEditing ? (
                            <>
                              <button
                                onClick={() => {
                                  if (envDotMode) {
                                    setEnvDotMode(false);
                                    const parsed = dotEnvToRows(envDotText);
                                    setEnvRows(parsed);
                                  } else {
                                    setEnvDotMode(true);
                                    setEnvDotText(rowsToDotEnv(envRows));
                                  }
                                }}
                                className="text-xs px-2 py-1 rounded hover:bg-accent transition-colors text-muted-foreground border border-border"
                              >
                                {envDotMode ? "Form" : "Edit as .env"}
                              </button>
                              <button
                                onClick={() => {
                                  setEnvEditing(false);
                                  setEnvDotMode(false);
                                  const ev = (selectedProject as any).env_vars ?? {};
                                  setEnvRows(Object.entries(ev).map(([key, value]) => ({ key, value: String(value), hidden: true })));
                                }}
                                className="text-xs px-2 py-1 rounded hover:bg-accent transition-colors text-muted-foreground"
                              >Batal</button>
                              <button
                                onClick={handleSaveEnv}
                                disabled={savingEnv}
                                className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1 disabled:opacity-50"
                              >
                                {savingEnv ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Simpan
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                setEnvEditing(true);
                                setEnvDotMode(false);
                              }}
                              className="text-xs px-2 py-1 rounded hover:bg-accent transition-colors text-muted-foreground"
                            >Edit</button>
                          )}
                        </div>
                      </div>

                      {envEditing && envDotMode ? (
                        <div className="p-3">
                          <p className="text-[10px] text-muted-foreground mb-2">Format: <span className="font-mono">KEY=VALUE</span> — satu baris per variable, baris # diabaikan</p>
                          <textarea
                            value={envDotText}
                            onChange={e => setEnvDotText(e.target.value)}
                            placeholder={"DATABASE_URL=postgres://...\nAPI_KEY=sk-...\nNODE_ENV=production"}
                            rows={8}
                            spellCheck={false}
                            className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-border text-xs font-mono text-zinc-200 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10 placeholder:text-zinc-600 resize-y leading-relaxed"
                          />
                        </div>
                      ) : (
                        <div className="p-3 space-y-2">
                          {envRows.length === 0 && !envEditing && (
                            <p className="text-xs text-muted-foreground text-center py-2">Belum ada env variable. Klik Edit untuk tambah.</p>
                          )}
                          {envRows.map((row, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              {envEditing ? (
                                <>
                                  <input
                                    placeholder="KEY"
                                    value={row.key}
                                    onChange={e => setEnvRows(r => r.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                                    className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10"
                                  />
                                  <input
                                    placeholder="VALUE"
                                    value={row.value}
                                    onChange={e => setEnvRows(r => r.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                                    className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10"
                                  />
                                  <button onClick={() => setEnvRows(r => r.filter((_, j) => j !== i))} className="p-1.5 rounded hover:bg-red-500/10 text-red-400 transition-colors shrink-0">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-background border border-border text-xs font-mono truncate text-foreground">{row.key}</span>
                                  <span className={cn("flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-background border border-border text-xs font-mono truncate", row.hidden ? "text-muted-foreground" : "text-foreground")}>
                                    {row.hidden ? "••••••••" : row.value}
                                  </span>
                                  <button onClick={() => setEnvRows(r => r.map((x, j) => j === i ? { ...x, hidden: !x.hidden } : x))} className="p-1.5 rounded hover:bg-accent transition-colors shrink-0 text-muted-foreground">
                                    {row.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                          {envEditing && (
                            <button
                              onClick={() => setEnvRows(r => [...r, { key: "", value: "", hidden: false }])}
                              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors w-full justify-center py-1.5 rounded-lg border border-dashed border-primary/30 hover:border-primary/50 hover:bg-primary/5"
                            >
                              <Plus className="w-3 h-3" />
                              Tambah variable
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Deployment history */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Riwayat Deployment
                      </p>
                      {deployments.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">Belum ada deployment</p>
                      ) : (
                        <div className="space-y-1.5">
                          {deployments.map(dep => (
                            <div key={dep.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-accent/30 border border-border">
                              <div className="flex items-center gap-2 min-w-0">
                                <Zap className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-xs font-medium capitalize">{dep.triggered_by}</p>
                                  <p className="text-[11px] text-muted-foreground">{formatDate(dep.created_at)}</p>
                                </div>
                              </div>
                              <DeployStatusBadge status={dep.status} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Create Project Dialog */}
      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setShowCreate(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 md:inset-auto md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:top-1/2 md:w-[520px] z-50 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <h2 className="font-semibold">Proyek Hosting Baru</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Deploy dari Git repository ke VM kamu</p>
                </div>
                <button onClick={() => { setShowCreate(false); setDetectResult(null); setDetectAttempted(false); setAutoFilledFields(new Set()); setWorkspacePackages([]); setSelectedWorkspacePkg(null); }} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                {formError && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {formError}
                  </div>
                )}

                <FormField label="Nama Proyek *" placeholder="my-web-app" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
                <FormField label="Deskripsi" placeholder="Opsional" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} />

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Git URL *</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder="https://github.com/user/repo"
                        value={form.git_url}
                        onChange={e => setForm(f => ({ ...f, git_url: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/40 transition-all"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => runDetect(form.git_url.trim(), form.git_branch || "main")}
                      disabled={detecting || !form.git_url.trim().includes("github.com")}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-accent hover:bg-accent/80 text-xs font-medium transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-violet-400" />}
                      {detecting ? "Deteksi..." : "Deteksi"}
                    </button>
                  </div>
                  {detectResult && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400 font-medium">
                        {detectResult.isMonorepo
                          ? workspacePackages.length > 0
                            ? `Monorepo terdeteksi — pilih app yang ingin di-deploy (${workspacePackages.length} ditemukan)`
                            : "Monorepo terdeteksi — isi build & start command manual"
                          : `Framework terdeteksi: ${detectResult.framework} — command sudah diisi otomatis`}
                      </span>
                    </div>
                  )}
                  {detectAttempted && !detectResult && !detecting && form.git_url.trim() && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <AlertCircle className="w-3 h-3 text-amber-400" />
                      <span className="text-amber-400">Tidak dapat mendeteksi — pastikan repo publik atau isi command manual</span>
                    </div>
                  )}
                </div>

                {workspacePackages.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pilih App</p>
                    <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
                      {workspacePackages.map(pkg => (
                        <button
                          key={pkg.path}
                          type="button"
                          onClick={() => {
                            setSelectedWorkspacePkg(pkg.path);
                            const filled = new Set<string>(["build_command", "start_command", "port"]);
                            setForm(f => ({ ...f, build_command: pkg.buildCommand, start_command: pkg.startCommand, port: String(pkg.port) }));
                            setAutoFilledFields(filled);
                          }}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left text-sm transition-all ${selectedWorkspacePkg === pkg.path ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/50 hover:bg-accent"}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selectedWorkspacePkg === pkg.path ? "bg-primary" : "bg-muted-foreground"}`} />
                            <span className="font-mono text-xs truncate">{pkg.name}</span>
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">{pkg.path}</span>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ml-2 ${pkg.framework === "vite" || pkg.framework === "nextjs" ? "bg-blue-500/20 text-blue-400" : pkg.framework === "node-server" ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"}`}>
                            {pkg.framework}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Branch" placeholder="main" value={form.git_branch} onChange={v => setForm(f => ({ ...f, git_branch: v }))} />
                  <FormField
                    label="Port"
                    placeholder="3000"
                    value={form.port}
                    onChange={v => { setAutoFilledFields(s => { const n = new Set(s); n.delete("port"); return n; }); setForm(f => ({ ...f, port: v })); }}
                    type="number"
                    isAutoDetected={autoFilledFields.has("port")}
                  />
                </div>

                <FormField
                  label="Build Command"
                  placeholder={detecting ? "Mendeteksi..." : "Biarkan kosong untuk auto-detect"}
                  value={form.build_command}
                  onChange={v => { setAutoFilledFields(s => { const n = new Set(s); n.delete("build_command"); return n; }); setForm(f => ({ ...f, build_command: v })); }}
                  isAutoDetected={autoFilledFields.has("build_command")}
                />
                <FormField
                  label="Start Command"
                  placeholder={detecting ? "Mendeteksi..." : "Biarkan kosong untuk auto-detect"}
                  value={form.start_command}
                  onChange={v => { setAutoFilledFields(s => { const n = new Set(s); n.delete("start_command"); return n; }); setForm(f => ({ ...f, start_command: v })); }}
                  isAutoDetected={autoFilledFields.has("start_command")}
                />

                <p className="text-xs text-muted-foreground">
                  Subdomain akan dibuat otomatis: <span className="font-mono text-primary">{form.name ? `${form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-xxxx.app.pio.codes` : "nama-xxxx.app.pio.codes"}</span>
                </p>
              </div>

              <div className="flex gap-3 px-5 py-4 border-t border-border">
                <button onClick={() => { setShowCreate(false); setDetectResult(null); setDetectAttempted(false); setAutoFilledFields(new Set()); setWorkspacePackages([]); setSelectedWorkspacePkg(null); }} className="flex-1 px-4 py-2 rounded-lg border border-border hover:bg-accent text-sm transition-colors">
                  Batal
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Buat Proyek
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="max-w-sm rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus proyek?</AlertDialogTitle>
            <AlertDialogDescription>
              Proyek <span className="font-semibold text-foreground">"{deleteTarget?.name}"</span> dan semua deploymentnya akan dihapus permanen dari VM.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InfoCard({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("p-2.5 rounded-lg bg-accent/30 border border-border", className)}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">{label}</p>
      <p className="text-xs font-mono text-foreground truncate">{value}</p>
    </div>
  );
}

function InfoFlat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("px-3 py-2 bg-background", className)}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">{label}</p>
      <p className="text-xs font-mono text-foreground truncate">{value}</p>
    </div>
  );
}

function FormField({
  label, placeholder, value, onChange, type = "text", isAutoDetected = false,
}: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void; type?: string; isAutoDetected?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        {isAutoDetected && (
          <span className="flex items-center gap-0.5 text-[10px] text-violet-400 font-medium">
            <Sparkles className="w-2.5 h-2.5" />
            Auto-detect
          </span>
        )}
      </div>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          "w-full px-3 py-2 rounded-lg bg-background border text-sm focus:outline-none focus:ring-2 placeholder:text-muted-foreground/40 transition-all",
          isAutoDetected
            ? "border-violet-500/30 focus:border-violet-500/50 focus:ring-violet-500/10"
            : "border-border focus:border-primary/50 focus:ring-primary/10"
        )}
      />
    </div>
  );
}
