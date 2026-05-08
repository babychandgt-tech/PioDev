import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe, Plus, Trash2, RefreshCw, Rocket, GitBranch, ExternalLink,
  Loader2, AlertCircle, CheckCircle2, Clock, X, ChevronRight,
  Terminal, Copy, Check, Menu, Server, Zap, XCircle, Sparkles,
  KeyRound, Eye, EyeOff, Settings, LayoutDashboard, History,
  ArrowUpRight, GitCommit, Package, Github, Link, Unlink,
  Search, Lock, Star, GitFork, Activity, ArrowDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useChat } from "@/hooks/use-chat";
import { ChatSidebar } from "@/components/chat-sidebar";
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
  auto_deploy: boolean;
  github_webhook_id: number | null;
  created_at: string;
  updated_at: string;
}

interface GithubStatus {
  connected: boolean;
  username?: string | null;
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

type DetailTab = "overview" | "logs" | "env" | "settings" | "history";
type CreateMode = "repo" | "manual";

interface GithubRepo {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  private: boolean;
  language: string | null;
  clone_url: string;
  html_url: string;
  default_branch: string;
  pushed_at: string;
  stargazers_count: number;
  fork: boolean;
}

// Strip ANSI escape codes from log strings
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, "").replace(/\x1B\[[0-9;]*[A-Z]/g, "");
}

// Determine CSS class for a log line based on keywords
function logLineClass(line: string): string {
  const l = line.toLowerCase();
  if (/\b(error|err|fatal|failed|failure|exception)\b/.test(l)) return "text-red-400";
  if (/\b(warn|warning)\b/.test(l)) return "text-amber-400";
  if (/\b(success|done|finished|ready|started|listening|deployed)\b/.test(l)) return "text-emerald-400";
  if (/^\s*#/.test(line) || /\b(step|from|run|copy|add|workdir|arg|env)\b/.test(l)) return "text-blue-400/80";
  return "text-zinc-300";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}h lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "bg-blue-500/20 text-blue-400",
  JavaScript: "bg-yellow-500/20 text-yellow-400",
  Python: "bg-green-500/20 text-green-400",
  Go: "bg-cyan-500/20 text-cyan-400",
  Rust: "bg-orange-500/20 text-orange-400",
  Java: "bg-red-500/20 text-red-400",
  "C++": "bg-purple-500/20 text-purple-400",
  CSS: "bg-pink-500/20 text-pink-400",
  HTML: "bg-orange-400/20 text-orange-300",
};

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
  const map: Record<string, { label: string; color: string; dot: string }> = {
    queued:      { label: "Antri",     color: "text-zinc-400",   dot: "bg-zinc-400" },
    in_progress: { label: "Berjalan",  color: "text-blue-400",   dot: "bg-blue-400 animate-pulse" },
    finished:    { label: "Selesai",   color: "text-emerald-400",dot: "bg-emerald-400" },
    failed:      { label: "Gagal",     color: "text-red-400",    dot: "bg-red-400" },
    cancelled:   { label: "Dibatalkan",color: "text-amber-400",  dot: "bg-amber-400" },
  };
  const cfg = map[status] ?? map.queued;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", cfg.color)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function formatDate(s: string) {
  return new Date(s).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function formatDateShort(s: string) {
  return new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function truncateGitUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
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
  const [workspacePackages, setWorkspacePackages] = useState<{ name: string; path: string; framework: string; buildCommand: string; startCommand: string; port: number; isDeployable?: boolean }[]>([]);
  const [selectedWorkspacePkgs, setSelectedWorkspacePkgs] = useState<Set<string>>(new Set());
  const detectTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [selectedProject, setSelectedProject] = useState<HostingProject | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HostingProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [logType, setLogType] = useState<"build" | "runtime">("build");
  const [logs, setLogs] = useState<string>("");
  const [runtimeLogs, setRuntimeLogs] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [runtimeLogsLoading, setRuntimeLogsLoading] = useState(false);
  const [logsAutoScroll, setLogsAutoScroll] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);

  const [envRows, setEnvRows] = useState<{ key: string; value: string; hidden: boolean }[]>([]);
  const [envEditing, setEnvEditing] = useState(false);
  const [savingEnv, setSavingEnv] = useState(false);
  const [envDotMode, setEnvDotMode] = useState(false);
  const [envDotText, setEnvDotText] = useState("");

  const [editForm, setEditForm] = useState({ build_command: "", start_command: "", git_branch: "main", port: "3000" });
  const [savingSettings, setSavingSettings] = useState(false);

  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [togglingAutoDeploy, setTogglingAutoDeploy] = useState(false);
  const [connectingGithub, setConnectingGithub] = useState(false);

  const [createMode, setCreateMode] = useState<CreateMode>("repo");
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);

  const logsRef = useRef<HTMLPreElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const logsPollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/login");
  }, [authLoading, isAuthenticated]);

  // Load GitHub connection status
  useEffect(() => {
    if (!isAuthenticated) return;
    authedFetch("/api/hosting/github/status").then(r => r.json()).then(setGithubStatus).catch(() => {});
  }, [isAuthenticated]);

  // Handle OAuth callback params
  useEffect(() => {
    localStorage.removeItem("gh_link_pending");
    localStorage.removeItem("gh_link_refresh_token");
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("github_connected");
    const username = params.get("username");
    const ghError = params.get("github_error");
    if (connected === "1") {
      setGithubStatus({ connected: true, username: username ?? null });
      toast({ title: "GitHub terhubung!", description: username ? `Akun @${username} berhasil ditautkan.` : "Akun GitHub berhasil ditautkan." });
      window.history.replaceState({}, "", "/hosting");
    } else if (ghError) {
      const msg = ghError === "cancelled" ? "Koneksi GitHub dibatalkan."
        : ghError === "invalid_state" ? "Sesi OAuth kedaluwarsa. Coba lagi."
        : "Gagal menghubungkan GitHub. Coba lagi.";
      toast({ title: msg, variant: "destructive" });
      window.history.replaceState({}, "", "/hosting");
    }
  }, []);

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
          setSelectedWorkspacePkgs(new Set());
          setForm(f => ({ ...f, build_command: "", start_command: "" }));
          setAutoFilledFields(new Set());
        } else {
          setWorkspacePackages([]);
          setSelectedWorkspacePkgs(new Set());
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
        setSelectedWorkspacePkgs(new Set());
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

  // Auto-sync deploying projects every 5s — calls /sync (hits Coolify) instead of reading stale DB
  useEffect(() => {
    const deployingProjects = projects.filter(p => p.status === "deploying");
    if (deployingProjects.length === 0) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    const poll = async () => {
      await Promise.all(deployingProjects.map(async (proj) => {
        try {
          const res = await authedFetch(`/api/hosting/projects/${proj.id}/sync`);
          const data = await res.json();
          if (res.ok && data.project) {
            setProjects(prev => prev.map(p => p.id === proj.id ? data.project : p));
            setSelectedProject(prev => prev?.id === proj.id ? data.project : prev);
          }
        } catch {}
      }));
    };
    poll();
    pollRef.current = setInterval(poll, 5000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.filter(p => p.status === "deploying").map(p => p.id).join(",")]);

  const loadDetail = useCallback(async (project: HostingProject) => {
    setDetailLoading(true);
    setLogs("");
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
    setDetailTab("overview");
    setEnvEditing(false);
    setLogs("");
    setRuntimeLogs("");
    setLogType("build");
    await loadDetail(project);
  };

  useEffect(() => {
    if (!selectedProject) return;
    const ev = (selectedProject as any).env_vars ?? {};
    setEnvRows(Object.entries(ev).map(([key, value]) => ({ key, value: String(value), hidden: true })));
    setEditForm({
      build_command: selectedProject.build_command ?? "",
      start_command: selectedProject.start_command ?? "",
      git_branch: selectedProject.git_branch ?? "main",
      port: String(selectedProject.port ?? 3000),
    });
  }, [selectedProject?.id]);

  // Auto-scroll helper
  const scrollLogsToBottom = () => {
    setTimeout(() => { if (logsAutoScroll) logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: "smooth" }); }, 50);
  };

  // Build log poller — runs every 2s while deploying and logs tab is open
  useEffect(() => {
    if (!selectedProject || detailTab !== "logs" || logType !== "build") {
      if (logsPollRef.current) { clearInterval(logsPollRef.current); logsPollRef.current = null; }
      return;
    }
    const isDeploying = selectedProject.status === "deploying";
    if (!isDeploying) {
      if (logsPollRef.current) { clearInterval(logsPollRef.current); logsPollRef.current = null; }
      // Final fetch to make sure we have the complete build output
      if (!logs) {
        authedFetch(`/api/hosting/projects/${selectedProject.id}/logs`)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.logs) { setLogs(data.logs); scrollLogsToBottom(); } })
          .catch(() => {});
      }
      return;
    }
    const poll = async () => {
      try {
        const res = await authedFetch(`/api/hosting/projects/${selectedProject.id}/logs`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.logs !== undefined) { setLogs(data.logs); scrollLogsToBottom(); }
        if (data.status === "finished" || data.status === "failed") {
          if (logsPollRef.current) { clearInterval(logsPollRef.current); logsPollRef.current = null; }
          const newStatus = data.status === "finished" ? "running" : "failed";
          setSelectedProject(prev => prev ? { ...prev, status: newStatus } : prev);
          setProjects(prev => prev.map(p => p.id === selectedProject.id ? { ...p, status: newStatus } : p));
          setDeployments(prev => prev.map(d => d.status === "in_progress" ? { ...d, status: data.status } : d));
        }
      } catch {}
    };
    poll();
    logsPollRef.current = setInterval(poll, 2000);
    return () => { if (logsPollRef.current) { clearInterval(logsPollRef.current); logsPollRef.current = null; } };
  }, [selectedProject?.id, selectedProject?.status, detailTab, logType, logsAutoScroll]);

  // When status transitions from deploying → running/failed, fetch final build logs regardless of active tab
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = selectedProject?.status ?? null;
    prevStatusRef.current = curr;
    if (prev === "deploying" && (curr === "running" || curr === "failed")) {
      // Always fetch final build logs so they're ready when user switches to Logs tab
      authedFetch(`/api/hosting/projects/${selectedProject!.id}/logs`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.logs) setLogs(data.logs); })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.status]);

  // Runtime log poller — runs every 4s while logs tab is open and project is running
  useEffect(() => {
    if (!selectedProject || detailTab !== "logs" || logType !== "runtime") return;
    const canPoll = selectedProject.status === "running" || selectedProject.status === "failed";
    if (!canPoll) return;
    const poll = async () => {
      try {
        const res = await authedFetch(`/api/hosting/projects/${selectedProject.id}/runtime-logs`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.logs !== undefined) { setRuntimeLogs(data.logs); scrollLogsToBottom(); }
      } catch {}
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, [selectedProject?.id, selectedProject?.status, detailTab, logType, logsAutoScroll]);

  const resetCreateDialog = () => {
    setShowCreate(false);
    setDetectResult(null);
    setDetectAttempted(false);
    setAutoFilledFields(new Set());
    setWorkspacePackages([]);
    setSelectedWorkspacePkgs(new Set());
    setFormError(null);
    setForm({ name: "", description: "", git_url: "", git_branch: "main", build_command: "", start_command: "", port: "3000" });
    setSelectedRepo(null);
    setRepoSearch("");
    setReposError(null);
    setRepoDropdownOpen(false);
  };

  const loadGithubRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const res = await authedFetch("/api/hosting/github/repos");
      const data = await res.json();
      if (res.ok) {
        setGithubRepos(data.repos ?? []);
      } else {
        setReposError(data.error ?? "Gagal memuat repo");
      }
    } catch {
      setReposError("Gagal terhubung ke server");
    } finally {
      setReposLoading(false);
    }
  }, []);

  const selectRepo = useCallback((repo: GithubRepo) => {
    setSelectedRepo(repo);
    const branch = repo.default_branch || "main";
    setForm(f => ({
      ...f,
      git_url: repo.clone_url,
      git_branch: branch,
      name: f.name.trim() ? f.name : repo.name,
      description: f.description.trim() ? f.description : (repo.description ?? ""),
    }));
    setDetectResult(null);
    setDetectAttempted(false);
    setAutoFilledFields(new Set());
    setWorkspacePackages([]);
    setSelectedWorkspacePkgs(new Set());
    runDetect(repo.clone_url, branch);
  }, [runDetect]);

  const handleCreate = async () => {
    setFormError(null);
    if (!form.name.trim()) { setFormError("Nama proyek wajib diisi"); return; }
    if (!form.git_url.trim()) { setFormError("Git URL wajib diisi"); return; }
    setCreating(true);
    try {
      const multiPkgs = workspacePackages.filter(p => selectedWorkspacePkgs.has(p.path));
      if (multiPkgs.length > 1) {
        const created: any[] = [];
        for (const pkg of multiPkgs) {
          const pkgSuffix = pkg.name.split("/")[1] ?? pkg.path.replace(/\//g, "-");
          const res = await authedFetch("/api/hosting/projects", {
            method: "POST",
            body: JSON.stringify({
              name: `${form.name.trim()}-${pkgSuffix}`,
              description: form.description,
              git_url: form.git_url.trim(),
              git_branch: form.git_branch || "main",
              build_command: pkg.buildCommand,
              start_command: pkg.startCommand,
              port: pkg.port,
            }),
          });
          const data = await res.json();
          if (!res.ok) { setFormError(data.error ?? `Gagal membuat proyek ${pkg.name}`); return; }
          created.push(data.project);
        }
        setProjects(prev => [...created.reverse(), ...prev]);
        setHostingStatus(prev => prev ? { ...prev, projectCount: prev.projectCount + created.length } : prev);
        resetCreateDialog();
        toast({ title: `${created.length} proyek berhasil dibuat!`, description: "Klik Deploy pada masing-masing proyek untuk memulai." });
      } else {
        const res = await authedFetch("/api/hosting/projects", {
          method: "POST",
          body: JSON.stringify({ ...form, port: Number(form.port) || 3000 }),
        });
        const data = await res.json();
        if (!res.ok) { setFormError(data.error ?? "Gagal membuat proyek"); return; }
        setProjects(prev => [data.project, ...prev]);
        setHostingStatus(prev => prev ? { ...prev, projectCount: prev.projectCount + 1 } : prev);
        resetCreateDialog();
        toast({ title: "Proyek berhasil dibuat!", description: "Klik Deploy untuk mulai deployment pertama." });
      }
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
      const updatedStatus: ProjectStatus = "deploying";
      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, status: updatedStatus } : p));
      if (selectedProject?.id === project.id) {
        setSelectedProject(prev => prev ? { ...prev, status: updatedStatus } : prev);
        setDeployments(prev => [data.deployment, ...prev]);
        setDetailTab("logs");
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

  const handleLoadLogs = async (project: HostingProject) => {
    setLogsLoading(true);
    try {
      const res = await authedFetch(`/api/hosting/projects/${project.id}/logs`);
      const data = await res.json();
      setLogs(data.logs ?? "");
    } finally {
      setLogsLoading(false);
      setTimeout(() => logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight }), 100);
    }
  };

  const handleLoadRuntimeLogs = async (project: HostingProject) => {
    setRuntimeLogsLoading(true);
    try {
      const res = await authedFetch(`/api/hosting/projects/${project.id}/runtime-logs`);
      const data = await res.json();
      setRuntimeLogs(data.logs ?? "");
    } finally {
      setRuntimeLogsLoading(false);
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
      setEnvRows(Object.entries(env_vars).map(([key, value]) => ({ key, value: String(value), hidden: true })));
      setEnvDotMode(false);
      setEnvEditing(false);
      toast({ title: "Env vars disimpan", description: "Deploy ulang untuk menerapkan perubahan." });
    } finally {
      setSavingEnv(false);
    }
  };

  const copyLogs = () => {
    navigator.clipboard.writeText(logType === "build" ? logs : runtimeLogs);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  useEffect(() => {
    if (!showCreate) return;
    const defaultMode: CreateMode = githubStatus?.connected ? "repo" : "manual";
    setCreateMode(defaultMode);
    if (githubStatus?.connected && githubRepos.length === 0) {
      loadGithubRepos();
    }
  }, [showCreate, githubStatus?.connected]);

  const handleGithubConnect = async () => {
    setConnectingGithub(true);
    try {
      const res = await authedFetch("/api/hosting/github/oauth/start");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({ title: "Gagal memulai koneksi GitHub", variant: "destructive" });
        setConnectingGithub(false);
      }
    } catch {
      toast({ title: "Terjadi kesalahan. Coba lagi.", variant: "destructive" });
      setConnectingGithub(false);
    }
  };

  const handleGithubDisconnect = async () => {
    await authedFetch("/api/hosting/github/disconnect", { method: "DELETE" });
    setGithubStatus({ connected: false, username: null });
    toast({ title: "GitHub diputuskan" });
  };

  const handleToggleAutoDeploy = async (project: HostingProject, enabled: boolean) => {
    setTogglingAutoDeploy(true);
    try {
      const res = await authedFetch(`/api/hosting/projects/${project.id}/auto-deploy`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Gagal", description: data.error, variant: "destructive" }); return; }
      setSelectedProject(prev => prev ? { ...prev, auto_deploy: enabled } : prev);
      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, auto_deploy: enabled } : p));
      toast({ title: enabled ? "Auto Deploy aktif!" : "Auto Deploy dinonaktifkan" });
    } finally {
      setTogglingAutoDeploy(false);
    }
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

  const DETAIL_TABS: { id: DetailTab; label: string; icon: any }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "logs",     label: "Logs",     icon: Terminal },
    { id: "env",      label: "Env Vars", icon: KeyRound },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "history",  label: "Riwayat",  icon: History },
  ];

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

        {/* ── LEFT: Projects list ── */}
        <div className={cn(
          "flex flex-col border-r border-border overflow-hidden shrink-0 transition-all duration-200",
          selectedProject ? "hidden md:flex md:w-72 lg:w-80" : "flex flex-1"
        )}>
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border shrink-0">
            <button
              className="md:hidden p-1.5 rounded-lg hover:bg-accent transition-colors"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <Globe className="w-4 h-4 text-primary shrink-0" />
            <h1 className="font-semibold text-sm flex-1">Hosting</h1>

            {/* Coolify status dot */}
            {hostingStatus && (
              <div className="flex items-center gap-1.5">
                <span className={cn("w-1.5 h-1.5 rounded-full", hostingStatus.coolifyReachable ? "bg-emerald-400" : "bg-red-400")} />
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {hostingStatus.projectCount}/{hostingStatus.projectLimit === 999 ? "∞" : hostingStatus.projectLimit}
                </span>
              </div>
            )}

            <button
              onClick={() => setShowCreate(true)}
              disabled={!!(hostingStatus && hostingStatus.projectCount >= hostingStatus.projectLimit && hostingStatus.projectLimit !== 999)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              Baru
            </button>
          </div>

          {/* GitHub connect banner */}
          {githubStatus !== null && (
            githubStatus.connected ? (
              <div className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <Github className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <p className="text-[11px] text-muted-foreground flex-1 min-w-0 truncate">
                  <span className="text-foreground font-medium">@{githubStatus.username}</span>
                </p>
                <button
                  onClick={handleGithubDisconnect}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0 flex items-center gap-1"
                >
                  <Unlink className="w-3 h-3" /> Putuskan
                </button>
              </div>
            ) : (
              <div className="mx-3 mt-3 flex items-center gap-3 p-3 rounded-lg bg-zinc-900/50 border border-border">
                <Github className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">Hubungkan GitHub</p>
                  <p className="text-[11px] text-muted-foreground">Aktifkan Auto Deploy saat push</p>
                </div>
                <button
                  onClick={handleGithubConnect}
                  disabled={connectingGithub}
                  className="text-xs px-2.5 py-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1"
                >
                  {connectingGithub ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link className="w-3 h-3" />}
                  Hubungkan
                </button>
              </div>
            )
          )}

          {/* Coolify warning */}
          {hostingStatus && !hostingStatus.coolifyReachable && (
            <div className="mx-3 mt-3 flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Coolify tidak terjangkau. Cek konfigurasi VM, COOLIFY_API_URL dan TOKEN.</span>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-20">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Server className="w-7 h-7 text-primary/50" />
                </div>
                <div>
                  <p className="font-medium text-sm">Belum ada proyek</p>
                  <p className="text-xs text-muted-foreground mt-1">Deploy web app dari Git repository</p>
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
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => openProject(project)}
                  className={cn(
                    "group relative flex flex-col gap-2.5 p-3.5 rounded-xl border cursor-pointer transition-all",
                    selectedProject?.id === project.id
                      ? "border-primary/50 bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/25 hover:bg-accent/40"
                  )}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm leading-tight truncate">{project.name}</p>
                      {project.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{project.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {project.auto_deploy && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-medium">
                          <Zap className="w-2.5 h-2.5" />
                          Auto
                        </span>
                      )}
                      <StatusBadge status={project.status} />
                    </div>
                  </div>

                  {/* Git info */}
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <GitBranch className="w-3 h-3 shrink-0" />
                    <span className="truncate font-mono">{truncateGitUrl(project.git_url)}</span>
                    <span className="shrink-0 opacity-40">·</span>
                    <span className="shrink-0">{project.git_branch}</span>
                  </div>

                  {/* Running URL */}
                  {project.public_url && project.status === "running" && (
                    <a
                      href={project.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline truncate"
                    >
                      <ArrowUpRight className="w-3 h-3 shrink-0" />
                      <span className="truncate">{project.public_url.replace("https://", "")}</span>
                    </a>
                  )}

                  {/* Hover actions */}
                  <div className="flex items-center gap-1.5 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); handleDeploy(project); }}
                      disabled={deploying === project.id || project.status === "deploying"}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/20 transition-colors disabled:opacity-40"
                    >
                      {deploying === project.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />}
                      Deploy
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleSync(project); }}
                      disabled={syncing === project.id}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent text-[11px] hover:bg-accent/80 transition-colors disabled:opacity-40"
                    >
                      <RefreshCw className={cn("w-3 h-3", syncing === project.id && "animate-spin")} />
                      Sync
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteTarget(project); }}
                      className="ml-auto flex items-center justify-center w-6 h-6 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT: Project detail with tabs ── */}
        <AnimatePresence>
          {selectedProject && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col flex-1 overflow-hidden"
            >
              {/* Detail header */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border shrink-0">
                <button
                  onClick={() => setSelectedProject(null)}
                  className="p-1.5 rounded-lg hover:bg-accent transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm leading-tight truncate">{selectedProject.name}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {selectedProject.subdomain ? `${selectedProject.subdomain}.app.pio.codes` : "subdomain belum tersedia"}
                  </p>
                </div>
                <StatusBadge status={selectedProject.status} />
                <button
                  onClick={() => handleDeploy(selectedProject)}
                  disabled={deploying === selectedProject.id || selectedProject.status === "deploying"}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
                >
                  {deploying === selectedProject.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
                  Deploy
                </button>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-0 border-b border-border shrink-0 px-4 overflow-x-auto">
                {DETAIL_TABS.map(tab => {
                  const Icon = tab.icon;
                  const isActive = detailTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setDetailTab(tab.id);
                        if (tab.id === "logs" && selectedProject) {
                          if (logType === "build" && !logs) handleLoadLogs(selectedProject);
                          if (logType === "runtime" && !runtimeLogs) handleLoadRuntimeLogs(selectedProject);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap",
                        isActive
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                      {tab.id === "history" && deployments.length > 0 && (
                        <span className="ml-0.5 text-[10px] bg-accent text-muted-foreground px-1.5 py-0.5 rounded-full">{deployments.length}</span>
                      )}
                      {tab.id === "env" && envRows.length > 0 && (
                        <span className="ml-0.5 text-[10px] bg-accent text-muted-foreground px-1.5 py-0.5 rounded-full">{envRows.length}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto">
                {detailLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {/* ─ Overview tab ─ */}
                    {detailTab === "overview" && (
                      <div className="p-4 space-y-4">
                        {/* Public URL card */}
                        {selectedProject.public_url ? (
                          <a
                            href={selectedProject.public_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors group"
                          >
                            <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                              selectedProject.status === "running" ? "bg-emerald-500/15" : "bg-muted")}>
                              <Globe className={cn("w-5 h-5", selectedProject.status === "running" ? "text-emerald-400" : "text-muted-foreground")} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-muted-foreground">URL Publik</p>
                              <p className="text-sm font-medium text-primary truncate">{selectedProject.public_url}</p>
                            </div>
                            <ArrowUpRight className="w-4 h-4 text-primary shrink-0 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                          </a>
                        ) : (
                          <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-accent/20">
                            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                              <Globe className="w-5 h-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">URL Publik</p>
                              <p className="text-sm text-muted-foreground">Belum tersedia — deploy untuk mendapat URL</p>
                            </div>
                          </div>
                        )}

                        {/* Info grid */}
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { label: "Repository", value: truncateGitUrl(selectedProject.git_url), icon: Package },
                            { label: "Branch", value: selectedProject.git_branch, icon: GitBranch },
                            { label: "Port", value: String(selectedProject.port), icon: Server },
                            { label: "Status", value: selectedProject.status, icon: Zap },
                          ].map(item => (
                            <div key={item.label} className="flex items-start gap-2.5 p-3 rounded-lg bg-accent/30 border border-border">
                              <item.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{item.label}</p>
                                <p className="text-xs font-mono text-foreground truncate mt-0.5">{item.value}</p>
                              </div>
                            </div>
                          ))}
                          {selectedProject.build_command && (
                            <div className="col-span-2 flex items-start gap-2.5 p-3 rounded-lg bg-accent/30 border border-border">
                              <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Build Command</p>
                                <p className="text-xs font-mono text-foreground truncate mt-0.5">{selectedProject.build_command}</p>
                              </div>
                            </div>
                          )}
                          {selectedProject.start_command && (
                            <div className="col-span-2 flex items-start gap-2.5 p-3 rounded-lg bg-accent/30 border border-border">
                              <Rocket className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Start Command</p>
                                <p className="text-xs font-mono text-foreground truncate mt-0.5">{selectedProject.start_command}</p>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Quick actions */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDeploy(selectedProject)}
                            disabled={deploying === selectedProject.id || selectedProject.status === "deploying"}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                          >
                            {deploying === selectedProject.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                            Deploy
                          </button>
                          <button
                            onClick={() => { setDetailTab("logs"); handleLoadLogs(selectedProject); }}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm transition-colors"
                          >
                            <Terminal className="w-4 h-4" />
                            Logs
                          </button>
                          <button
                            onClick={() => handleSync(selectedProject)}
                            disabled={syncing === selectedProject.id}
                            className="p-2.5 rounded-xl border border-border hover:bg-accent transition-colors disabled:opacity-50"
                            title="Sync status"
                          >
                            <RefreshCw className={cn("w-4 h-4", syncing === selectedProject.id && "animate-spin")} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(selectedProject)}
                            className="p-2.5 rounded-xl border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Hapus proyek"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Deploy on Push card */}
                        <div className={cn(
                          "flex items-center justify-between p-3.5 rounded-xl border transition-colors",
                          selectedProject.auto_deploy
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-border bg-accent/10"
                        )}>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                              selectedProject.auto_deploy ? "bg-emerald-500/15" : "bg-primary/10"
                            )}>
                              <Zap className={cn("w-4 h-4", selectedProject.auto_deploy ? "text-emerald-400" : "text-primary")} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-tight">Deploy on Push</p>
                              {selectedProject.auto_deploy ? (
                                <p className="text-[11px] text-emerald-400 mt-0.5">
                                  Aktif — push ke <span className="font-mono">{selectedProject.git_branch || "main"}</span> akan auto-deploy
                                </p>
                              ) : (
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  Auto-deploy saat push ke <span className="font-mono">{selectedProject.git_branch || "main"}</span>
                                </p>
                              )}
                            </div>
                          </div>
                          {!githubStatus?.connected ? (
                            <button
                              onClick={handleGithubConnect}
                              disabled={connectingGithub}
                              className="text-[11px] px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1"
                            >
                              {connectingGithub ? <Loader2 className="w-3 h-3 animate-spin" /> : <Github className="w-3 h-3" />}
                              Hubungkan GitHub
                            </button>
                          ) : (
                            <button
                              onClick={() => handleToggleAutoDeploy(selectedProject, !selectedProject.auto_deploy)}
                              disabled={togglingAutoDeploy}
                              className={cn(
                                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 shrink-0",
                                selectedProject.auto_deploy ? "bg-emerald-500" : "bg-muted"
                              )}
                            >
                              {togglingAutoDeploy ? (
                                <Loader2 className="w-3 h-3 animate-spin absolute inset-0 m-auto text-white" />
                              ) : (
                                <span className={cn(
                                  "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform",
                                  selectedProject.auto_deploy ? "translate-x-4" : "translate-x-0.5"
                                )} />
                              )}
                            </button>
                          )}
                        </div>

                        {/* Last updated */}
                        <p className="text-[11px] text-muted-foreground text-center">
                          Dibuat {formatDate(selectedProject.created_at)} · Diperbarui {formatDateShort(selectedProject.updated_at)}
                        </p>
                      </div>
                    )}

                    {/* ─ Logs tab ─ */}
                    {detailTab === "logs" && (() => {
                      const isDeploying = selectedProject.status === "deploying";
                      const isRunning  = selectedProject.status === "running";
                      const isFailed   = selectedProject.status === "failed";
                      const activeLog  = logType === "build" ? logs : runtimeLogs;
                      const isLive     = logType === "build" ? isDeploying : (isRunning || isFailed);
                      const isLoading  = logType === "build" ? logsLoading : runtimeLogsLoading;
                      const lines      = stripAnsi(activeLog).split("\n");
                      return (
                        <div className="flex flex-col h-full">
                          {/* Toolbar */}
                          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0 gap-2">
                            {/* Log type tabs */}
                            <div className="flex p-0.5 rounded-lg bg-zinc-900 border border-zinc-800 gap-0.5">
                              <button
                                type="button"
                                onClick={() => { setLogType("build"); if (!logs) handleLoadLogs(selectedProject); }}
                                className={cn(
                                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                                  logType === "build" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                                )}
                              >
                                <Terminal className="w-3 h-3" />
                                Build
                                {isDeploying && logType === "build" && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setLogType("runtime"); if (!runtimeLogs) handleLoadRuntimeLogs(selectedProject); }}
                                className={cn(
                                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                                  logType === "runtime" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                                )}
                              >
                                <Activity className="w-3 h-3" />
                                Runtime
                                {isRunning && logType === "runtime" && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                )}
                              </button>
                            </div>

                            {/* Right controls */}
                            <div className="flex items-center gap-1.5 ml-auto">
                              {/* Live indicator */}
                              {isLive && (
                                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  Live
                                </span>
                              )}
                              {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                              {/* Auto-scroll toggle */}
                              <button
                                onClick={() => setLogsAutoScroll(v => !v)}
                                title={logsAutoScroll ? "Auto-scroll aktif" : "Auto-scroll mati"}
                                className={cn(
                                  "p-1.5 rounded-md transition-colors text-[10px] border",
                                  logsAutoScroll ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"
                                )}
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                              {/* Refresh */}
                              <button
                                onClick={() => logType === "build" ? handleLoadLogs(selectedProject) : handleLoadRuntimeLogs(selectedProject)}
                                className="p-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground"
                              >
                                <RefreshCw className="w-3 h-3" />
                              </button>
                              {/* Copy */}
                              <button onClick={copyLogs} className="p-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground">
                                {copiedLogs ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                          </div>

                          {/* Log output */}
                          <div
                            ref={logsRef}
                            className="flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed"
                          >
                            {isLoading && !activeLog ? (
                              <div className="flex items-center gap-2 text-zinc-500 pt-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Memuat logs...
                              </div>
                            ) : !activeLog ? (
                              <div className="pt-2">
                                {logType === "build" && isDeploying ? (
                                  <div className="flex flex-col gap-3">
                                    <div className="flex items-center gap-2 text-zinc-500">
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                                      <span className="text-amber-400/80">Build sedang berjalan...</span>
                                    </div>
                                    <div className="space-y-1.5 pl-1">
                                      {["Menghubungkan ke VM...", "Menunggu output Coolify..."].map((msg, i) => (
                                        <div key={i} className="flex items-center gap-2 text-zinc-700 text-[10px]">
                                          <span className="w-1 h-1 rounded-full bg-zinc-700" />
                                          {msg}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-zinc-600">
                                    {logType === "build"
                                      ? "Belum ada build log. Klik Deploy untuk memulai."
                                      : !isRunning && !isFailed ? "Jalankan deployment terlebih dahulu untuk melihat runtime logs." : "Belum ada output runtime."}
                                  </span>
                                )}
                              </div>
                            ) : (
                              lines.map((line, i) => (
                                <div key={i} className={cn("whitespace-pre-wrap break-all", logLineClass(line))}>
                                  {line || "\u00a0"}
                                </div>
                              ))
                            )}
                          </div>

                          {/* Line count footer */}
                          {activeLog && (
                            <div className="px-3 py-1.5 border-t border-zinc-800 bg-zinc-950 text-[10px] text-zinc-600 shrink-0 flex items-center gap-2">
                              <span>{lines.length} baris</span>
                              {logType === "build" && isDeploying && <span className="text-amber-400">● Build sedang berjalan...</span>}
                              {logType === "runtime" && isRunning && <span className="text-emerald-400">● Polling setiap 4 detik</span>}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ─ Env Vars tab ─ */}
                    {detailTab === "env" && (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">Environment Variables</p>
                          <div className="flex items-center gap-1.5">
                            {envEditing ? (
                              <>
                                <button
                                  onClick={() => {
                                    if (envDotMode) {
                                      setEnvDotMode(false);
                                      setEnvRows(dotEnvToRows(envDotText));
                                    } else {
                                      setEnvDotMode(true);
                                      setEnvDotText(rowsToDotEnv(envRows));
                                    }
                                  }}
                                  className="text-xs px-2.5 py-1 rounded-lg border border-border hover:bg-accent transition-colors"
                                >
                                  {envDotMode ? "Mode Form" : "Edit .env"}
                                </button>
                                <button
                                  onClick={() => {
                                    setEnvEditing(false);
                                    setEnvDotMode(false);
                                    const ev = (selectedProject as any).env_vars ?? {};
                                    setEnvRows(Object.entries(ev).map(([key, value]) => ({ key, value: String(value), hidden: true })));
                                  }}
                                  className="text-xs px-2.5 py-1 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground"
                                >Batal</button>
                                <button
                                  onClick={handleSaveEnv}
                                  disabled={savingEnv}
                                  className="text-xs px-2.5 py-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1 disabled:opacity-50"
                                >
                                  {savingEnv ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                  Simpan
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setEnvEditing(true)}
                                className="text-xs px-2.5 py-1 rounded-lg border border-border hover:bg-accent transition-colors"
                              >
                                Edit
                              </button>
                            )}
                          </div>
                        </div>

                        {envEditing && envDotMode ? (
                          <div className="space-y-2">
                            <p className="text-[10px] text-muted-foreground">Format: <span className="font-mono">KEY=VALUE</span> per baris, baris # diabaikan</p>
                            <textarea
                              value={envDotText}
                              onChange={e => setEnvDotText(e.target.value)}
                              placeholder={"DATABASE_URL=postgres://...\nAPI_KEY=sk-...\nNODE_ENV=production"}
                              rows={10}
                              spellCheck={false}
                              className="w-full px-3 py-3 rounded-xl bg-zinc-950 border border-border text-xs font-mono text-zinc-200 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10 placeholder:text-zinc-600 resize-y leading-relaxed"
                            />
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {envRows.length === 0 && !envEditing && (
                              <div className="text-center py-10 text-xs text-muted-foreground">
                                <KeyRound className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
                                Belum ada env variable
                                <br />
                                <button onClick={() => setEnvEditing(true)} className="mt-2 text-primary hover:underline">Tambah sekarang</button>
                              </div>
                            )}
                            {envRows.map((row, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                {envEditing ? (
                                  <>
                                    <input
                                      placeholder="KEY"
                                      value={row.key}
                                      onChange={e => setEnvRows(r => r.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                                      className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10"
                                    />
                                    <input
                                      placeholder="VALUE"
                                      value={row.value}
                                      onChange={e => setEnvRows(r => r.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                                      className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-xs font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10"
                                    />
                                    <button onClick={() => setEnvRows(r => r.filter((_, j) => j !== i))} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors shrink-0">
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <span className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-accent/40 border border-border text-xs font-mono truncate">{row.key}</span>
                                    <span className={cn("flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-accent/40 border border-border text-xs font-mono truncate", row.hidden ? "text-muted-foreground" : "")}>
                                      {row.hidden ? "••••••••" : row.value}
                                    </span>
                                    <button onClick={() => setEnvRows(r => r.map((x, j) => j === i ? { ...x, hidden: !x.hidden } : x))} className="p-1.5 rounded-lg hover:bg-accent transition-colors shrink-0 text-muted-foreground">
                                      {row.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                    </button>
                                  </>
                                )}
                              </div>
                            ))}
                            {envEditing && (
                              <button
                                onClick={() => setEnvRows(r => [...r, { key: "", value: "", hidden: false }])}
                                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors w-full justify-center py-2 rounded-xl border border-dashed border-primary/30 hover:border-primary/50 hover:bg-primary/5"
                              >
                                <Plus className="w-3 h-3" />
                                Tambah variable
                              </button>
                            )}
                          </div>
                        )}

                        {!envEditing && envRows.length > 0 && (
                          <p className="text-[11px] text-muted-foreground text-center">
                            Deploy ulang setelah mengubah env vars agar perubahan diterapkan
                          </p>
                        )}
                      </div>
                    )}

                    {/* ─ Settings tab ─ */}
                    {detailTab === "settings" && (
                      <div className="p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">Konfigurasi Proyek</p>
                          <button
                            onClick={handleSaveSettings}
                            disabled={savingSettings}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                          >
                            {savingSettings ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Simpan
                          </button>
                        </div>

                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Branch</label>
                              <input
                                value={editForm.git_branch}
                                onChange={e => setEditForm(f => ({ ...f, git_branch: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Port</label>
                              <input
                                type="number"
                                value={editForm.port}
                                onChange={e => setEditForm(f => ({ ...f, port: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10"
                              />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Build Command</label>
                            <input
                              placeholder="Kosong = auto-detect"
                              value={editForm.build_command}
                              onChange={e => setEditForm(f => ({ ...f, build_command: e.target.value }))}
                              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10 placeholder:text-muted-foreground/40"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Start Command</label>
                            <input
                              placeholder="Kosong = auto-detect"
                              value={editForm.start_command}
                              onChange={e => setEditForm(f => ({ ...f, start_command: e.target.value }))}
                              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10 placeholder:text-muted-foreground/40"
                            />
                          </div>
                        </div>

                        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
                          Setelah menyimpan settings, lakukan Deploy ulang agar perubahan diterapkan.
                        </div>

                        {/* Auto Deploy toggle */}
                        <div className="space-y-2">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Deploy on Push</p>
                          <div className={cn(
                            "flex items-center justify-between p-3.5 rounded-xl border transition-colors",
                            selectedProject.auto_deploy
                              ? "border-emerald-500/30 bg-emerald-500/5"
                              : "border-border bg-accent/10"
                          )}>
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                selectedProject.auto_deploy ? "bg-emerald-500/15" : "bg-primary/10"
                              )}>
                                <Zap className={cn("w-4 h-4", selectedProject.auto_deploy ? "text-emerald-400" : "text-primary")} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium">Deploy on Push</p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  Push ke <span className="font-mono">{selectedProject.git_branch || "main"}</span> → auto-deploy
                                </p>
                              </div>
                            </div>
                            {!githubStatus?.connected ? (
                              <button
                                onClick={handleGithubConnect}
                                disabled={connectingGithub}
                                className="text-[11px] px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1"
                              >
                                {connectingGithub ? <Loader2 className="w-3 h-3 animate-spin" /> : <Github className="w-3 h-3" />}
                                Hubungkan GitHub
                              </button>
                            ) : (
                              <button
                                onClick={() => handleToggleAutoDeploy(selectedProject, !selectedProject.auto_deploy)}
                                disabled={togglingAutoDeploy}
                                className={cn(
                                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 shrink-0",
                                  selectedProject.auto_deploy ? "bg-emerald-500" : "bg-muted"
                                )}
                              >
                                {togglingAutoDeploy ? (
                                  <Loader2 className="w-3 h-3 animate-spin absolute inset-0 m-auto text-white" />
                                ) : (
                                  <span className={cn(
                                    "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform",
                                    selectedProject.auto_deploy ? "translate-x-4" : "translate-x-0.5"
                                  )} />
                                )}
                              </button>
                            )}
                          </div>
                          {selectedProject.auto_deploy && (
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-[11px] text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>Webhook GitHub terdaftar. Setiap push ke <span className="font-mono">{selectedProject.git_branch || "main"}</span> akan langsung memicu deployment otomatis.</span>
                            </div>
                          )}
                        </div>

                        {/* Danger zone */}
                        <div className="pt-2 border-t border-border space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Danger Zone</p>
                          <button
                            onClick={() => setDeleteTarget(selectedProject)}
                            className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 text-sm transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            Hapus Proyek Ini
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ─ History tab ─ */}
                    {detailTab === "history" && (
                      <div className="p-4 space-y-3">
                        <p className="text-sm font-medium">Riwayat Deployment</p>
                        {deployments.length === 0 ? (
                          <div className="text-center py-10 text-xs text-muted-foreground">
                            <History className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
                            Belum ada deployment
                            <br />
                            <button
                              onClick={() => handleDeploy(selectedProject)}
                              className="mt-2 text-primary hover:underline"
                            >
                              Deploy sekarang
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {deployments.map((dep, i) => (
                              <div
                                key={dep.id}
                                className="flex items-center justify-between px-3.5 py-3 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                    dep.status === "finished" ? "bg-emerald-500/10" :
                                    dep.status === "failed" ? "bg-red-500/10" :
                                    dep.status === "in_progress" ? "bg-blue-500/10" : "bg-muted"
                                  )}>
                                    <GitCommit className={cn("w-4 h-4",
                                      dep.status === "finished" ? "text-emerald-400" :
                                      dep.status === "failed" ? "text-red-400" :
                                      dep.status === "in_progress" ? "text-blue-400" : "text-muted-foreground"
                                    )} />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium capitalize">
                                      {i === 0 && (dep.status === "in_progress" || dep.status === "queued") ? "Deployment terbaru" : `Deploy #${deployments.length - i}`}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatDateShort(dep.created_at)}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <DeployStatusBadge status={dep.status} />
                                  {(dep.status === "in_progress" || dep.status === "finished" || dep.status === "failed") && (
                                    <button
                                      onClick={() => { setDetailTab("logs"); handleLoadLogs(selectedProject); }}
                                      className="text-[10px] px-2 py-0.5 rounded-md bg-accent hover:bg-accent/80 text-muted-foreground transition-colors"
                                    >
                                      Logs
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state when no project selected */}
        {!selectedProject && projects.length > 0 && (
          <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Server className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
              <p className="text-sm">Pilih proyek untuk melihat detail</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Create Project Dialog ── */}
      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={resetCreateDialog}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 md:inset-auto md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:top-1/2 md:w-[560px] z-50 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Dialog header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Globe className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-sm">Proyek Hosting Baru</h2>
                    <p className="text-xs text-muted-foreground">Deploy dari Git repository ke VM</p>
                  </div>
                </div>
                <button onClick={resetCreateDialog} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Mode tabs — only when GitHub is connected */}
              {githubStatus?.connected && (
                <div className="px-5 pt-4 pb-0 shrink-0">
                  <div className="flex p-1 rounded-xl bg-muted/40 border border-border gap-1">
                    <button
                      type="button"
                      onClick={() => { setCreateMode("repo"); if (githubRepos.length === 0) loadGithubRepos(); }}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all",
                        createMode === "repo"
                          ? "bg-background shadow-sm text-foreground border border-border"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Github className="w-3.5 h-3.5" />
                      Pilih dari Repo
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateMode("manual")}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all",
                        createMode === "manual"
                          ? "bg-background shadow-sm text-foreground border border-border"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Link className="w-3.5 h-3.5" />
                      Dari URL / Link
                    </button>
                  </div>
                </div>
              )}

              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                {formError && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {formError}
                  </div>
                )}

                {/* ── Repo picker mode ── */}
                {createMode === "repo" && githubStatus?.connected && (
                  <div className="space-y-2">
                    {/* Dropdown trigger */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setRepoDropdownOpen(o => !o)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border bg-background text-sm text-left transition-all",
                          repoDropdownOpen ? "border-primary/50 ring-2 ring-primary/10" : "border-border hover:border-primary/30"
                        )}
                      >
                        {reposLoading ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" /><span className="text-muted-foreground flex-1">Memuat repo...</span></>
                        ) : selectedRepo ? (
                          <>
                            <Github className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="flex-1 font-medium truncate">{selectedRepo.full_name}</span>
                            {selectedRepo.private && <Lock className="w-3 h-3 text-muted-foreground shrink-0" />}
                            {selectedRepo.language && (
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0", LANG_COLORS[selectedRepo.language] ?? "bg-muted text-muted-foreground")}>
                                {selectedRepo.language}
                              </span>
                            )}
                          </>
                        ) : (
                          <><Github className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><span className="text-muted-foreground/60 flex-1">Pilih repository...</span></>
                        )}
                        <svg className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform", repoDropdownOpen && "rotate-180")} viewBox="0 0 10 10" fill="none">
                          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>

                      {/* Dropdown panel */}
                      {repoDropdownOpen && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                          {/* Search inside dropdown */}
                          <div className="p-2 border-b border-border">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                              <input
                                autoFocus
                                type="text"
                                placeholder="Cari repo..."
                                value={repoSearch}
                                onChange={e => setRepoSearch(e.target.value)}
                                className="w-full pl-7 pr-3 py-1.5 rounded-md bg-background border border-border text-xs focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/40 transition-all"
                              />
                            </div>
                          </div>

                          {/* List */}
                          <div className="max-h-52 overflow-y-auto">
                            {reposError ? (
                              <div className="flex flex-col items-center py-6 gap-2 text-center">
                                <AlertCircle className="w-4 h-4 text-red-400/60" />
                                <p className="text-xs text-red-400">{reposError}</p>
                                <button type="button" onClick={loadGithubRepos} className="text-xs text-primary hover:underline">Coba lagi</button>
                              </div>
                            ) : githubRepos.length === 0 ? (
                              <div className="py-6 text-center text-xs text-muted-foreground">Tidak ada repo</div>
                            ) : (() => {
                              const q = repoSearch.toLowerCase();
                              const filtered = q
                                ? githubRepos.filter(r => r.full_name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q))
                                : githubRepos;
                              if (filtered.length === 0) return <div className="py-6 text-center text-xs text-muted-foreground">Tidak ada yang cocok</div>;
                              return filtered.map((repo, i) => {
                                const isSelected = selectedRepo?.id === repo.id;
                                return (
                                  <button
                                    key={repo.id}
                                    type="button"
                                    onClick={() => { selectRepo(repo); setRepoDropdownOpen(false); setRepoSearch(""); }}
                                    className={cn(
                                      "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                                      i < filtered.length - 1 && "border-b border-border/50",
                                      isSelected ? "bg-primary/8" : "hover:bg-accent/60"
                                    )}
                                  >
                                    <div className={cn(
                                      "w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                                      isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                                    )}>
                                      {isSelected && <svg className="w-2 h-2 text-primary-foreground" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                    </div>
                                    <span className="flex-1 text-xs font-medium truncate">{repo.full_name}</span>
                                    {repo.private && <Lock className="w-2.5 h-2.5 text-muted-foreground shrink-0" />}
                                    {repo.language && (
                                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0", LANG_COLORS[repo.language] ?? "bg-muted text-muted-foreground")}>
                                        {repo.language}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(repo.pushed_at)}</span>
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Selected repo status chip */}
                    {selectedRepo && (
                      <div className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all",
                        detecting ? "border-violet-500/30 bg-violet-500/5 text-violet-400"
                          : detectResult ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                          : detectAttempted ? "border-amber-500/30 bg-amber-500/5 text-amber-400"
                          : "border-primary/20 bg-primary/5 text-primary"
                      )}>
                        {detecting ? (
                          <><Loader2 className="w-3 h-3 animate-spin shrink-0" /> Mendeteksi framework dari <span className="font-mono font-medium">{selectedRepo.name}</span>...</>
                        ) : detectResult ? (
                          <><CheckCircle2 className="w-3 h-3 shrink-0" />
                            {detectResult.isMonorepo && workspacePackages.length > 0 ? `Monorepo · ${workspacePackages.length} package` : `${detectResult.framework} · command diisi otomatis`}
                          </>
                        ) : detectAttempted ? (
                          <><AlertCircle className="w-3 h-3 shrink-0" /> Repo terpilih: <span className="font-mono font-medium">{selectedRepo.name}</span> · isi command manual</>
                        ) : (
                          <><GitBranch className="w-3 h-3 shrink-0" /> <span className="font-mono font-medium">{selectedRepo.name}</span> · branch <span className="font-mono">{selectedRepo.default_branch}</span></>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Manual URL mode ── */}
                {(createMode === "manual" || !githubStatus?.connected) && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Git URL *</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="https://github.com/user/repo"
                        value={form.git_url}
                        onChange={e => setForm(f => ({ ...f, git_url: e.target.value }))}
                        className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/40 transition-all"
                      />
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
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />
                        {detectResult.isMonorepo
                          ? workspacePackages.length > 0
                            ? `Monorepo terdeteksi — ${workspacePackages.length} package ditemukan`
                            : "Monorepo terdeteksi — isi build & start command manual"
                          : `Framework: ${detectResult.framework} — command diisi otomatis`}
                      </div>
                    )}
                    {detectAttempted && !detectResult && !detecting && form.git_url.trim() && (
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
                        <AlertCircle className="w-3 h-3" />
                        Tidak dapat mendeteksi — pastikan repo publik atau isi command manual
                      </div>
                    )}
                  </div>
                )}

                {/* ── Config fields (shared by both modes) ── */}
                <div className={cn(
                  "space-y-4 transition-opacity",
                  createMode === "repo" && !selectedRepo && !form.git_url && "opacity-50 pointer-events-none"
                )}>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Nama Proyek *" placeholder="my-web-app" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
                    <FormField label="Deskripsi" placeholder="Opsional" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} />
                  </div>

                  {/* Package multi-select (monorepo) */}
                  {workspacePackages.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pilih Package</p>
                        {selectedWorkspacePkgs.size > 0 && (
                          <span className="text-[11px] text-primary font-medium">{selectedWorkspacePkgs.size} terpilih</span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 max-h-44 overflow-y-auto pr-1">
                        {workspacePackages.map(pkg => {
                          const isSelected = selectedWorkspacePkgs.has(pkg.path);
                          return (
                            <button
                              key={pkg.path}
                              type="button"
                              onClick={() => {
                                setSelectedWorkspacePkgs(prev => {
                                  const next = new Set(prev);
                                  if (next.has(pkg.path)) next.delete(pkg.path);
                                  else next.add(pkg.path);
                                  const remaining = [...next];
                                  if (remaining.length === 1) {
                                    const single = workspacePackages.find(p => p.path === remaining[0]);
                                    if (single) {
                                      setForm(f => ({ ...f, build_command: single.buildCommand, start_command: single.startCommand, port: String(single.port) }));
                                      setAutoFilledFields(new Set(["build_command", "start_command", "port"]));
                                    }
                                  } else {
                                    setAutoFilledFields(new Set());
                                  }
                                  return next;
                                });
                              }}
                              className={cn(
                                "flex items-center justify-between px-3 py-2.5 rounded-lg border text-left text-sm transition-all",
                                isSelected ? "border-primary bg-primary/8 text-primary" : "border-border hover:border-primary/40 hover:bg-accent"
                              )}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
                                  isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
                                )}>
                                  {isSelected && <svg className="w-2.5 h-2.5 text-primary-foreground" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                </span>
                                <span className="font-mono text-xs truncate">{pkg.name}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">{pkg.path}</span>
                              </div>
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ml-2",
                                pkg.framework === "vite" || pkg.framework === "nextjs" || pkg.framework === "nuxt" || pkg.framework === "svelte" ? "bg-blue-500/20 text-blue-400" :
                                pkg.framework === "node-server" || pkg.framework === "node" ? "bg-green-500/20 text-green-400" :
                                pkg.framework === "python" || pkg.framework === "django" || pkg.framework === "fastapi" || pkg.framework === "flask" ? "bg-yellow-500/20 text-yellow-400" :
                                pkg.framework === "bun" ? "bg-pink-500/20 text-pink-400" :
                                pkg.framework === "deno" ? "bg-cyan-500/20 text-cyan-400" :
                                pkg.framework === "php" || pkg.framework === "laravel" ? "bg-purple-500/20 text-purple-400" :
                                pkg.framework === "static" ? "bg-orange-500/20 text-orange-400" :
                                "bg-muted text-muted-foreground"
                              )}>
                                {pkg.framework}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {selectedWorkspacePkgs.size > 1 && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-[11px] text-muted-foreground">
                          <Package className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                          <span>
                            Akan dibuat <span className="text-foreground font-medium">{selectedWorkspacePkgs.size} proyek terpisah</span> dengan command otomatis.
                            Nama: <span className="font-mono">{form.name || "nama"}-[package]</span>
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Branch + port + commands */}
                  {selectedWorkspacePkgs.size <= 1 && (
                    <>
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
                    </>
                  )}
                  {selectedWorkspacePkgs.size > 1 && (
                    <FormField label="Branch" placeholder="main" value={form.git_branch} onChange={v => setForm(f => ({ ...f, git_branch: v }))} />
                  )}

                  <p className="text-xs text-muted-foreground">
                    Subdomain: <span className="font-mono text-primary">
                      {form.name
                        ? `${form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-xxxx.app.pio.codes`
                        : "nama-xxxx.app.pio.codes"}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex gap-2 px-5 py-4 border-t border-border bg-accent/10 shrink-0">
                <button
                  onClick={resetCreateDialog}
                  className="px-4 py-2 rounded-lg border border-border hover:bg-accent text-sm transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || (createMode === "repo" && !selectedRepo && !form.git_url)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                  {selectedWorkspacePkgs.size > 1 ? `Deploy ${selectedWorkspacePkgs.size} Proyek` : "Buat Proyek"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete confirm */}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus proyek?</AlertDialogTitle>
            <AlertDialogDescription>
              Proyek <span className="font-semibold text-foreground">"{deleteTarget?.name}"</span> dan semua deploymentnya akan dihapus permanen dari VM. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              Hapus Selamanya
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
