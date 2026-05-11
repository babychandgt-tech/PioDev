import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Key, Plus, Copy, Trash2, AlertTriangle, Check, ArrowLeft, ArrowRight, Code, Zap, Clock, Sparkles, MessageSquare, Image as ImageIcon, Video, FileText, ScanText, Lock, Lightbulb, AlertCircle, Rocket, BookOpen, Layers, Eye, EyeOff, Loader2, Activity, Pencil, X as XIcon, CreditCard, Wand2, ShieldCheck, RefreshCw, Cpu, Crown, Gift, PartyPopper } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revealable?: boolean;
};

type ApiUsage = {
  usage: { total_tokens: number; image_count: number; video_count: number; request_count: number };
  limits: { tokens: number; images: number; videos: number; requests: number };
};

type CreditTransaction = {
  id: string;
  amount_idr: number;
  type: string;
  metadata: any;
  created_at: string;
};

type CreditInfo = {
  balance_idr: number;
  is_premium: boolean;
  is_admin: boolean;
  tier?: "free" | "plus" | "pro";
  transactions: CreditTransaction[];
  pricing: {
    idr_per_token_num: number;
    idr_per_token_den: number;
    image_idr: number;
    video_idr: number;
    plus_bonus_idr: number;
    pro_bonus_idr?: number;
  };
};

async function authedFetch(path: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      "Content-Type": "application/json",
    },
  });
}

function formatDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default function ApiKeysPage() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [usage, setUsage] = useState<ApiUsage | null>(null);
  const [credit, setCredit] = useState<CreditInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemResult, setRedeemResult] = useState<{ credit_amount_idr: number; new_balance: number } | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<{ key: string; revealable: boolean; warning?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"keys" | "models" | "docs">("keys");

  // Reveal state per key id: full plaintext key (kalo lagi ditampilin)
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingEditId, setSavingEditId] = useState<string | null>(null);

  // Revoke confirm modal state
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/login");
  }, [authLoading, isAuthenticated, navigate]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [kRes, uRes, cRes] = await Promise.all([
        authedFetch("/api/me/api-keys"),
        authedFetch("/api/me/api-usage"),
        authedFetch("/api/me/credit"),
      ]);
      // Credit info dulu — biar bisa kasih tau gating message yang akurat
      if (cRes.ok) setCredit(await cRes.json());

      if (kRes.status === 403) {
        const errData = await kRes.json().catch(() => ({}));
        setError(errData.error || "Gagal load API keys");
        setLoading(false);
        return;
      }
      if (!kRes.ok) throw new Error("Gagal load keys");
      const kData = await kRes.json();
      setKeys(kData.keys || []);
      if (uRes.ok) setUsage(await uRes.json());
    } catch (e: any) {
      setError(e.message || "Gagal load data");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenRedeem() {
    setRedeemDialogOpen(true);
    setRedeemCode("");
    setRedeemError(null);
    setRedeemResult(null);
  }

  async function handleRedeem() {
    if (!redeemCode.trim() || redeemLoading) return;
    setRedeemLoading(true);
    setRedeemError(null);
    try {
      const r = await authedFetch("/api/redeem", {
        method: "POST",
        body: JSON.stringify({ code: redeemCode.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setRedeemError(d.error ?? "Terjadi kesalahan.");
        return;
      }
      setRedeemResult({ credit_amount_idr: d.credit_amount_idr, new_balance: d.new_balance });
      await load();
    } catch (e: any) {
      setRedeemError(e.message ?? "Terjadi kesalahan.");
    } finally {
      setRedeemLoading(false);
    }
  }

  useEffect(() => { if (user?.id) load(); /* eslint-disable-next-line */ }, [user?.id]);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await authedFetch("/api/me/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || "Gagal buat key";
        setError(msg);
        toast({ title: "Gagal buat key", description: msg, variant: "destructive" });
        setCreating(false);
        return;
      }
      setCreatedKey({ key: data.key, revealable: !!data.revealable, warning: data.warning });
      setNewKeyName("");
      toast({
        title: "Key berhasil dibuat",
        description: data.revealable
          ? "Key juga bisa dilihat & disalin lagi nanti dari halaman ini."
          : "Jangan lupa simpan key-nya ya.",
      });
      await load();
    } catch (e: any) {
      const msg = e.message || "Gagal buat key";
      setError(msg);
      toast({ title: "Gagal buat key", description: msg, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  function askRevoke(k: ApiKey) {
    setRevokeTarget(k);
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setDeletingId(target.id);
    try {
      const res = await authedFetch(`/api/me/api-keys/${target.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Gagal hapus key", description: data.error || "Coba lagi sebentar.", variant: "destructive" });
        return;
      }
      toast({ title: "Key dihapus", description: `"${target.name}" udah dihapus permanen.` });
      await load();
      setRevokeTarget(null);
    } catch (e: any) {
      toast({ title: "Gagal hapus key", description: e?.message || "Coba lagi sebentar.", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  function startRename(k: ApiKey) {
    setEditingId(k.id);
    setEditName(k.name);
  }

  function cancelRename() {
    setEditingId(null);
    setEditName("");
  }

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name) {
      toast({ title: "Nama ga boleh kosong", variant: "destructive" });
      return;
    }
    const current = keys.find((k) => k.id === id);
    if (current && current.name === name) {
      cancelRename();
      return;
    }
    setSavingEditId(id);
    try {
      const res = await authedFetch(`/api/me/api-keys/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Gagal ganti nama", description: data.error || "Coba lagi.", variant: "destructive" });
        return;
      }
      // Optimistic update
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, name } : k)));
      toast({ title: "Nama key diperbarui" });
      cancelRename();
    } catch (e: any) {
      toast({ title: "Gagal ganti nama", description: e?.message || "Coba lagi.", variant: "destructive" });
    } finally {
      setSavingEditId(null);
    }
  }

  async function copyKey(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Key disalin ke clipboard" });
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleReveal(id: string) {
    // Toggle: kalau udah revealed, sembunyiin
    if (revealed[id]) {
      setRevealed((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      return;
    }
    setRevealingId(id);
    try {
      const res = await authedFetch(`/api/me/api-keys/${id}/reveal`);
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || "Gagal menampilkan key";
        setError(msg);
        toast({ title: "Gagal menampilkan key", description: msg, variant: "destructive" });
        return;
      }
      setRevealed((p) => ({ ...p, [id]: data.key }));
    } catch (e: any) {
      const msg = e?.message || "Gagal menampilkan key";
      setError(msg);
      toast({ title: "Gagal menampilkan key", description: msg, variant: "destructive" });
    } finally {
      setRevealingId(null);
    }
  }

  async function handleCopyRow(id: string) {
    let val = revealed[id];
    if (!val) {
      setCopyingId(id);
      try {
        const res = await authedFetch(`/api/me/api-keys/${id}/reveal`);
        const data = await res.json();
        if (!res.ok) {
          const msg = data.error || "Gagal salin key";
          toast({ title: "Gagal salin key", description: msg, variant: "destructive" });
          return;
        }
        val = data.key;
      } catch (e: any) {
        const msg = e?.message || "Gagal salin key";
        toast({ title: "Gagal salin key", description: msg, variant: "destructive" });
        return;
      } finally {
        setCopyingId(null);
      }
    }
    try {
      await navigator.clipboard.writeText(val);
      setCopiedId(id);
      toast({ title: "Key disalin" });
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast({ title: "Gagal salin", description: "Clipboard tidak tersedia.", variant: "destructive" });
    }
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate("/settings")}
            className="p-2 rounded-lg hover:bg-muted transition"
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Key className="w-6 h-6 text-primary" />
              API Keys
            </h1>
            <p className="text-sm text-muted-foreground">
              Pakai PioCode AI dari aplikasi atau script kamu sendiri.
            </p>
          </div>
        </div>

        {/* Error/Premium gate */}
        {error && (
          <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm">{error}</p>
              {(error.includes("Plus") || error.includes("Upgrade")) && (
                <button
                  onClick={() => navigate("/premium")}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600"
                >
                  <Sparkles className="w-4 h-4" /> Upgrade ke Plus
                </button>
              )}
            </div>
          </div>
        )}

        {/* Saldo Credit */}
        {credit && !error && (
          <div className="space-y-3 mb-6">
            <SaldoCard credit={credit} onRedeem={handleOpenRedeem} />
            {usage && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
                <MiniUsageStat icon={MessageSquare} label="Token" value={usage.usage.total_tokens} color="text-emerald-500" />
                <MiniUsageStat icon={Activity} label="Request" value={usage.usage.request_count} color="text-sky-500" />
                <MiniUsageStat icon={ImageIcon} label="Image" value={usage.usage.image_count} color="text-fuchsia-500" />
                <MiniUsageStat icon={Video} label="Video" value={usage.usage.video_count} color="text-rose-500" />
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border mb-6">
          <TabButton active={activeTab === "keys"} onClick={() => setActiveTab("keys")}>
            <Key className="w-4 h-4" /> Keys saya
          </TabButton>
          <TabButton active={activeTab === "models"} onClick={() => setActiveTab("models")}>
            <Cpu className="w-4 h-4" /> Models
          </TabButton>
          <TabButton active={activeTab === "docs"} onClick={() => setActiveTab("docs")}>
            <Code className="w-4 h-4" /> Dokumentasi
          </TabButton>
        </div>

        {activeTab === "keys" && !error && (
          <>
            {/* Create button */}
            <div className="mb-4">
              <button
                onClick={() => { setShowCreate(true); setCreatedKey(null); }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
                data-testid="button-create-key"
              >
                <Plus className="w-4 h-4" /> Buat key baru
              </button>
            </div>

            {/* Keys table */}
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">Loading...</div>
            ) : activeKeys.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-border rounded-xl">
                <Key className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground">Belum ada API key. Buat satu untuk mulai.</p>
              </div>
            ) : (
              <>
              {/* ── Mobile: card list ──────────────────────────────────── */}
              <div className="md:hidden space-y-3">
                {activeKeys.map((k) => {
                  const isRevealed = !!revealed[k.id];
                  const isRevealing = revealingId === k.id;
                  const isCopying = copyingId === k.id;
                  const justCopied = copiedId === k.id;
                  const isEditing = editingId === k.id;
                  const isSavingEdit = savingEditId === k.id;
                  const neverUsed = !k.last_used_at;
                  return (
                    <div
                      key={k.id}
                      className="border border-border rounded-xl bg-card/40 p-4 space-y-3"
                      data-testid={`card-key-${k.id}`}
                    >
                      {/* ── Header: name + actions ─────────────────────── */}
                      <div className="flex items-start justify-between gap-2">
                        {isEditing ? (
                          <div className="flex-1 min-w-0">
                            <RenameInput
                              value={editName}
                              onChange={setEditName}
                              onSave={() => saveRename(k.id)}
                              onCancel={cancelRename}
                              saving={isSavingEdit}
                              testId={`input-rename-${k.id}`}
                            />
                          </div>
                        ) : (
                          <div className="flex-1 min-w-0">
                            <div
                              className="font-semibold text-base text-foreground break-words leading-tight"
                              data-testid={`text-key-name-${k.id}`}
                            >
                              {k.name}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap mt-2">
                              <StatusBadge tone="active">Aktif</StatusBadge>
                              {neverUsed && <StatusBadge tone="info">Belum dipakai</StatusBadge>}
                              {!k.revealable && <StatusBadge tone="warning">Legacy</StatusBadge>}
                            </div>
                          </div>
                        )}
                        {!isEditing && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => startRename(k)}
                              title="Ganti nama"
                              aria-label="Ganti nama key"
                              className="p-2 rounded-md hover:bg-muted active:bg-muted text-muted-foreground hover:text-foreground transition touch-manipulation"
                              data-testid={`button-rename-mobile-${k.id}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => askRevoke(k)}
                              disabled={deletingId === k.id}
                              title="Revoke key"
                              aria-label="Hapus key"
                              className="p-2 rounded-md hover:bg-destructive/10 active:bg-destructive/10 text-destructive transition disabled:opacity-50 touch-manipulation"
                              data-testid={`button-revoke-mobile-${k.id}`}
                            >
                              {deletingId === k.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* ── Key code + reveal/copy ─────────────────────── */}
                      <div
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                          isRevealed
                            ? "bg-primary/5 border-primary/30"
                            : "bg-muted/40 border-border",
                        )}
                      >
                        <code
                          className={cn(
                            "flex-1 min-w-0 font-mono text-xs break-all",
                            isRevealed ? "text-foreground" : "text-muted-foreground",
                          )}
                          data-testid={`text-key-mobile-${k.id}`}
                        >
                          {isRevealed ? revealed[k.id] : k.key_prefix}
                        </code>
                        {k.revealable ? (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleReveal(k.id)}
                              disabled={isRevealing}
                              title={isRevealed ? "Sembunyikan" : "Tampilkan & salin"}
                              aria-label={isRevealed ? "Sembunyikan key" : "Tampilkan key"}
                              className="p-1.5 rounded-md hover:bg-background/60 active:bg-background/60 text-muted-foreground hover:text-foreground transition disabled:opacity-50 touch-manipulation"
                              data-testid={`button-reveal-mobile-${k.id}`}
                            >
                              {isRevealing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : isRevealed ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyRow(k.id)}
                              disabled={isCopying}
                              title="Salin key"
                              aria-label="Salin key"
                              className="p-1.5 rounded-md hover:bg-background/60 active:bg-background/60 text-muted-foreground hover:text-foreground transition touch-manipulation disabled:opacity-50"
                              data-testid={`button-copy-mobile-${k.id}`}
                            >
                              {isCopying ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : justCopied ? (
                                <Check className="w-4 h-4 text-green-500" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {justCopied && (
                        <div className="text-[11px] text-green-500 font-medium -mt-1">Key disalin ke clipboard</div>
                      )}

                      {/* ── Footer: dates ──────────────────────────────── */}
                      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Dibuat</div>
                          <div className="text-xs text-foreground mt-0.5">{formatDate(k.created_at)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Terakhir dipakai</div>
                          <div className="text-xs text-foreground mt-0.5">
                            {neverUsed ? <span className="text-muted-foreground">Belum pernah</span> : formatDate(k.last_used_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Desktop: table ─────────────────────────────────────── */}
              <div className="hidden md:block border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Nama</th>
                      <th className="text-left px-4 py-3 font-medium">Key</th>
                      <th className="text-left px-4 py-3 font-medium hidden md:table-cell whitespace-nowrap">Dibuat</th>
                      <th className="text-left px-4 py-3 font-medium hidden md:table-cell whitespace-nowrap">Terakhir dipakai</th>
                      <th className="px-4 py-3 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeKeys.map((k) => {
                      const isRevealed = !!revealed[k.id];
                      const isRevealing = revealingId === k.id;
                      const isCopying = copyingId === k.id;
                      const justCopied = copiedId === k.id;
                      const isEditing = editingId === k.id;
                      const isSavingEdit = savingEditId === k.id;
                      const neverUsed = !k.last_used_at;
                      return (
                        <tr key={k.id} className="border-t border-border" data-testid={`row-key-${k.id}`}>
                          <td className="px-4 py-3 align-top">
                            {isEditing ? (
                              <RenameInput
                                value={editName}
                                onChange={setEditName}
                                onSave={() => saveRename(k.id)}
                                onCancel={cancelRename}
                                saving={isSavingEdit}
                                testId={`input-rename-${k.id}`}
                              />
                            ) : (
                              <div className="flex items-start gap-2 group/name">
                                <div className="flex flex-col gap-1 min-w-0">
                                  <span className="font-medium break-words" data-testid={`text-key-name-${k.id}`}>{k.name}</span>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <StatusBadge tone="active">Aktif</StatusBadge>
                                    {neverUsed && <StatusBadge tone="info">Belum dipakai</StatusBadge>}
                                    {!k.revealable && <StatusBadge tone="warning">Legacy</StatusBadge>}
                                  </div>
                                </div>
                                <button
                                  onClick={() => startRename(k)}
                                  title="Ganti nama"
                                  className="opacity-0 group-hover/name:opacity-100 focus:opacity-100 p-1 rounded-md hover:bg-muted transition text-muted-foreground hover:text-foreground"
                                  data-testid={`button-rename-${k.id}`}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <code
                                className={cn(
                                  "font-mono text-xs px-2 py-1 rounded border whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0 max-w-[22rem]",
                                  isRevealed
                                    ? "bg-primary/5 border-primary/30 text-foreground"
                                    : "bg-muted/50 border-transparent text-muted-foreground"
                                )}
                                title={isRevealed ? revealed[k.id] : k.key_prefix}
                                data-testid={`text-key-${k.id}`}
                              >
                                {isRevealed ? revealed[k.id] : k.key_prefix}
                              </code>

                              {k.revealable ? (
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button
                                    onClick={() => handleReveal(k.id)}
                                    disabled={isRevealing}
                                    title={isRevealed ? "Sembunyikan" : "Tampilkan key"}
                                    className="p-1.5 rounded-md hover:bg-muted transition text-muted-foreground hover:text-foreground disabled:opacity-50"
                                    data-testid={`button-reveal-${k.id}`}
                                  >
                                    {isRevealing ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : isRevealed ? (
                                      <EyeOff className="w-3.5 h-3.5" />
                                    ) : (
                                      <Eye className="w-3.5 h-3.5" />
                                    )}
                                  </button>

                                  <button
                                    onClick={() => handleCopyRow(k.id)}
                                    disabled={isCopying}
                                    title="Salin key"
                                    className="p-1.5 rounded-md hover:bg-muted transition text-muted-foreground hover:text-foreground disabled:opacity-50"
                                    data-testid={`button-copy-${k.id}`}
                                  >
                                    {isCopying ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : justCopied ? (
                                      <Check className="w-3.5 h-3.5 text-green-500" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>

                                  {justCopied && !isRevealing && !isCopying && (
                                    <span className="text-[10px] text-green-500 font-medium ml-1 whitespace-nowrap">Disalin</span>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden md:table-cell align-top whitespace-nowrap">{formatDate(k.created_at)}</td>
                          <td className="px-4 py-3 text-muted-foreground hidden md:table-cell align-top whitespace-nowrap">{formatDate(k.last_used_at)}</td>
                          <td className="px-4 py-3 text-right align-top">
                            <button
                              onClick={() => askRevoke(k)}
                              disabled={deletingId === k.id}
                              title="Revoke key"
                              className="p-2 rounded-lg hover:bg-destructive/10 text-destructive transition disabled:opacity-50"
                              data-testid={`button-revoke-${k.id}`}
                            >
                              {deletingId === k.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </>
        )}

        {activeTab === "models" && <ModelsSection />}

        {activeTab === "docs" && <Docs />}
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => { if (!createdKey) { setShowCreate(false); setNewKeyName(""); } }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-background border border-border rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              {!createdKey ? (
                <>
                  <h3 className="text-lg font-semibold mb-2">Buat API key baru</h3>
                  <p className="text-sm text-muted-foreground mb-4">Kasih nama biar gampang ngenalin nanti.</p>
                  <input
                    autoFocus
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Misal: Project chatbot"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background mb-4"
                    data-testid="input-key-name"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setShowCreate(false); setNewKeyName(""); }}
                      className="px-4 py-2 rounded-lg hover:bg-muted transition"
                    >
                      Batal
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={creating || !newKeyName.trim()}
                      className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
                      data-testid="button-confirm-create"
                    >
                      {creating ? "Membuat..." : "Buat key"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                      <Check className="w-5 h-5 text-green-500" />
                    </div>
                    <h3 className="text-lg font-semibold">Key berhasil dibuat</h3>
                  </div>
                  {createdKey.revealable ? (
                    <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 text-sm mb-4 flex items-start gap-2">
                      <Eye className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <p className="text-muted-foreground">
                        {createdKey.warning || "Key ini bisa kamu lihat & salin lagi kapan aja dari halaman ini."}
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm mb-4">
                      <strong className="text-amber-600 dark:text-amber-400">Penting:</strong>{" "}
                      {createdKey.warning || "Simpan key sekarang. Setelah modal ditutup, kamu ga bisa lihat lagi."}
                    </div>
                  )}
                  <div className="relative mb-4">
                    <code className="block px-3 py-3 pr-12 rounded-lg bg-muted font-mono text-xs break-all" data-testid="text-new-key">
                      {createdKey.key}
                    </code>
                    <button
                      onClick={() => copyKey(createdKey.key)}
                      className="absolute top-2 right-2 p-2 rounded-md hover:bg-background transition"
                      data-testid="button-copy-key"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => { setShowCreate(false); setCreatedKey(null); }}
                      className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium"
                    >
                      Selesai
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hapus confirm modal */}
      <AnimatePresence>
        {revokeTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => { if (deletingId !== revokeTarget.id) setRevokeTarget(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-background border border-border rounded-2xl p-5 sm:p-6 w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
              data-testid="modal-revoke"
            >
              <h3 className="text-base sm:text-lg font-semibold mb-2">Hapus API key?</h3>
              <p className="text-sm text-muted-foreground mb-5">
                Key <span className="font-medium text-foreground break-words">"{revokeTarget.name}"</span> bakal dihapus permanen. Aplikasi yang masih pakai key ini bakal langsung berhenti jalan.
              </p>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setRevokeTarget(null)}
                  disabled={deletingId === revokeTarget.id}
                  className="px-4 py-2 rounded-lg text-sm hover:bg-muted transition disabled:opacity-50"
                  data-testid="button-cancel-revoke"
                >
                  Batal
                </button>
                <button
                  onClick={confirmRevoke}
                  disabled={deletingId === revokeTarget.id}
                  className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50 inline-flex items-center gap-2"
                  data-testid="button-confirm-revoke"
                >
                  {deletingId === revokeTarget.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  {deletingId === revokeTarget.id ? "Menghapus..." : "Hapus"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Redeem Code dialog */}
      <AnimatePresence>
        {redeemDialogOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => { if (!redeemLoading) setRedeemDialogOpen(false); }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="redeem-dialog-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-5 sm:p-6 relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setRedeemDialogOpen(false)}
                disabled={redeemLoading}
                className="absolute top-3 right-3 sm:top-4 sm:right-4 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                aria-label="Tutup"
              >
                <XIcon className="w-4 h-4" />
              </button>

              <AnimatePresence mode="wait">
                {redeemResult ? (
                  /* ── Success state ── */
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center text-center py-2 gap-4 pr-6"
                  >
                    <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
                      <PartyPopper className="w-8 h-8 text-green-500" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-foreground leading-tight">Berhasil!</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        <span className="font-semibold text-green-600">
                          +{`Rp ${redeemResult.credit_amount_idr.toLocaleString("id-ID")}`}
                        </span>{" "}
                        telah ditambahkan ke saldo kamu.
                      </p>
                    </div>
                    <div className="w-full rounded-xl bg-muted/50 border border-border px-4 py-3 text-center">
                      <p className="text-xs text-muted-foreground mb-0.5">Saldo sekarang</p>
                      <p className="text-2xl font-bold tabular-nums">
                        Rp {redeemResult.new_balance.toLocaleString("id-ID")}
                      </p>
                    </div>
                    <button
                      onClick={() => setRedeemDialogOpen(false)}
                      className="w-full h-10 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Tutup
                    </button>
                  </motion.div>
                ) : (
                  /* ── Input state ── */
                  <motion.div key="input" className="pr-6">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary shrink-0">
                        <Gift className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 id="redeem-dialog-title" className="text-base font-semibold text-foreground leading-tight">
                          Redeem Kode
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">Masukkan kode untuk menambah saldo.</p>
                      </div>
                    </div>

                    <div className="space-y-1.5 mb-4">
                      <label className="text-xs text-muted-foreground font-medium">Kode Redeem</label>
                      <input
                        type="text"
                        placeholder="Contoh: WELCOME2025"
                        value={redeemCode}
                        onChange={(e) => {
                          setRedeemCode(e.target.value.toUpperCase().replace(/\s/g, ""));
                          setRedeemError(null);
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") handleRedeem(); }}
                        disabled={redeemLoading}
                        autoFocus
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background font-mono text-sm tracking-wider placeholder:text-muted-foreground placeholder:font-sans placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 disabled:opacity-50"
                      />
                      {redeemError && (
                        <motion.p
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-xs text-rose-500 flex items-center gap-1"
                        >
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          {redeemError}
                        </motion.p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setRedeemDialogOpen(false)}
                        disabled={redeemLoading}
                        className="flex-1 h-10 rounded-lg text-sm font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                      >
                        Batal
                      </button>
                      <button
                        onClick={handleRedeem}
                        disabled={redeemLoading || !redeemCode.trim()}
                        className="flex-1 h-10 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
                      >
                        {redeemLoading
                          ? <><Loader2 className="w-4 h-4 animate-spin" /> Memeriksa...</>
                          : <><Gift className="w-4 h-4" /> Redeem</>
                        }
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Inline rename input ──────────────────────────────────────────────────────
function RenameInput({
  value, onChange, onSave, onCancel, saving, testId,
}: {
  value: string;
  onChange: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        maxLength={80}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSave(); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        disabled={saving}
        className="px-2 py-1 rounded-md border border-primary/40 bg-background text-sm font-medium w-full max-w-[200px] focus:outline-none focus:ring-2 focus:ring-primary/30"
        data-testid={testId}
      />
      <button
        onClick={onSave}
        disabled={saving}
        title="Simpan"
        className="p-1.5 rounded-md text-green-600 hover:bg-green-500/10 transition disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      </button>
      <button
        onClick={onCancel}
        disabled={saving}
        title="Batal"
        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition disabled:opacity-50"
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ tone, children }: { tone: "active" | "info" | "warning"; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    active: "bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20",
    info: "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset", styles[tone])}>
      {tone === "active" && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
      {children}
    </span>
  );
}

// Konversi: 2 token = Rp 1 (cost = ceil(tokens / 2))
const formatIdr = (n: number) => `Rp ${Math.max(0, Math.floor(n)).toLocaleString("id-ID")}`;

function SaldoCard({ credit, onRedeem }: { credit: CreditInfo; onRedeem: () => void }) {
  const balance = credit.balance_idr;
  const isAdmin = credit.is_admin;
  const isLow = !isAdmin && balance > 0 && balance < 5_000;
  const isEmpty = !isAdmin && balance <= 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-5" data-testid="card-saldo">
      {/* Label + Redeem trigger */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Saldo Credit</p>
        {!isAdmin && (
          <button
            onClick={onRedeem}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition"
            data-testid="button-redeem"
          >
            <Gift className="w-3.5 h-3.5" />
            Redeem Kode
          </button>
        )}
      </div>

      {/* Big nominal */}
      <p className="text-4xl font-bold tracking-tight" data-testid="text-saldo-remaining">
        {isAdmin ? "Tanpa Batas" : formatIdr(balance)}
      </p>

      {/* Status line + link ke billing */}
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <p className={cn(
          "text-xs",
          isEmpty ? "text-rose-500 font-medium" : isLow ? "text-amber-500 font-medium" : "text-muted-foreground"
        )}>
          {isAdmin
            ? "Akun admin · gak di-charge"
            : isEmpty
            ? "Saldo habis. Redeem kode untuk lanjut pakai API."
            : isLow
            ? "Saldo menipis."
            : "Tanpa reset harian."}
        </p>
        {!isAdmin && (
          <a
            href="/settings?section=billing"
            className="text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
          >
            Lihat riwayat →
          </a>
        )}
      </div>
    </div>
  );
}

function formatCompactNumber(n: number): string {
  if (n < 1_000) return n.toLocaleString("id-ID");
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}rb`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, "")}jt`;
}

function MiniUsageStat({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="p-2.5 sm:p-3 rounded-xl border border-border bg-card min-w-0">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
        <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      </div>
      <p className="text-base sm:text-lg font-semibold tabular-nums leading-tight" title={value.toLocaleString("id-ID")}>
        {formatCompactNumber(value)}
        <span className="text-[10px] text-muted-foreground font-normal ml-1">hari ini</span>
      </p>
    </div>
  );
}



function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition flex items-center gap-2",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

const LANG_LABELS: Record<string, { label: string; dot: string }> = {
  bash:       { label: "Terminal",  dot: "bg-green-500" },
  shell:      { label: "Terminal",  dot: "bg-green-500" },
  python:     { label: "Python",    dot: "bg-blue-500" },
  javascript: { label: "JavaScript", dot: "bg-yellow-400" },
  typescript: { label: "TypeScript", dot: "bg-sky-500" },
  json:       { label: "JSON",      dot: "bg-orange-400" },
};

function CodeBlock({ children, lang = "bash" }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const meta = LANG_LABELS[lang] ?? { label: lang.toUpperCase(), dot: "bg-zinc-400" };

  async function copy() {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-800 bg-[#1e1e2e] shadow-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#181825] border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
            <span className="text-[11px] text-zinc-400 font-medium">{meta.label}</span>
          </div>
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-md transition"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-green-400" />
              <span className="text-green-400">Disalin</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Salin</span>
            </>
          )}
        </button>
      </div>

      {/* Code body */}
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: "16px",
          background: "transparent",
          fontSize: "12.5px",
          lineHeight: "1.6",
        }}
        codeTagProps={{ style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" } }}
        wrapLongLines={false}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

function detectOS(): "windows" | "mac" | "linux" {
  if (typeof window === "undefined") return "linux";
  const ua = window.navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "linux";
}

function CodeTabs({ tabs, autoSelectByOS }: { tabs: { label: string; lang: string; code: string; os?: "windows" | "mac" | "linux" }[]; autoSelectByOS?: boolean }) {
  const [active, setActive] = useState(() => {
    if (!autoSelectByOS) return 0;
    const os = detectOS();
    const idx = tabs.findIndex((t) => t.os === os);
    return idx >= 0 ? idx : 0;
  });

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2 p-1 rounded-lg bg-muted/40 border border-border w-fit">
        {tabs.map((t, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={cn(
              "px-3 py-1.5 text-xs rounded-md transition font-medium",
              active === i
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <CodeBlock lang={tabs[active].lang}>{tabs[active].code}</CodeBlock>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, color = "text-primary" }: { icon: any; title: string; subtitle?: string; color?: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("w-5 h-5", color)} />
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {subtitle && <p className="text-sm text-muted-foreground ml-7">{subtitle}</p>}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("p-5 rounded-xl border border-border bg-card", className)}>{children}</div>;
}

function Callout({ icon: Icon, color, children }: { icon: any; color: "blue" | "amber" | "green" | "red"; children: React.ReactNode }) {
  const styles = {
    blue: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    green: "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-300",
    red: "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300",
  };
  const iconColor = {
    blue: "text-blue-500", amber: "text-amber-500", green: "text-green-500", red: "text-red-500",
  };
  return (
    <div className={cn("p-3 rounded-lg border flex items-start gap-2 text-sm", styles[color])}>
      <Icon className={cn("w-4 h-4 shrink-0 mt-0.5", iconColor[color])} />
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Docs() {
  const baseUrl = typeof window !== "undefined" ? `${window.location.origin}/v1` : "https://your-domain.com/v1";
  const [docTab, setDocTab] = useState<"start" | "chat" | "image" | "video" | "ocr" | "file" | "ref">("start");

  const tabs: { id: typeof docTab; label: string; icon: any }[] = [
    { id: "start", label: "Mulai di sini", icon: Rocket },
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "image", label: "Gambar", icon: ImageIcon },
    { id: "video", label: "Video", icon: Video },
    { id: "ocr", label: "OCR", icon: ScanText },
    { id: "file", label: "File", icon: FileText },
    { id: "ref", label: "Endpoint", icon: BookOpen },
  ];

  return (
    <div className="space-y-6">
      {/* Sub-nav */}
      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-muted/40 border border-border">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setDocTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition",
              docTab === id
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* MULAI DI SINI */}
      {docTab === "start" && (
        <div className="space-y-6">
          <Card className="bg-gradient-to-br from-primary/5 to-transparent">
            <SectionHeader icon={Rocket} title="Apa itu PioCode API?" />
            <p className="text-sm text-muted-foreground mb-4 ml-7">
              API key yang kamu generate di sini bisa dipakai dari aplikasi, script, atau project apapun
              buat akses semua fitur AI PioCode: chat, generate gambar, video, OCR, dan baca file.
            </p>
            <div className="ml-7 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-green-500" />
                <span>Format kompatibel <strong>OpenAI SDK</strong> — kode lama kamu langsung jalan</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-green-500" />
                <span>Pakai dari Python, JavaScript, curl, atau bahasa apapun</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-green-500" />
                <span>Limit harian terpisah dari web app</span>
              </div>
            </div>
          </Card>

          <Card>
            <SectionHeader icon={Lock} title="3 langkah mulai" subtitle="Yang paling penting kamu hapal cuma ini" />
            <ol className="space-y-3 ml-7">
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">1</span>
                <div className="flex-1 text-sm">
                  Buka tab <strong>Keys saya</strong>, klik <strong>"Buat key baru"</strong>, kasih nama, lalu copy key-nya.
                  <Callout icon={AlertTriangle} color="amber">
                    Key cuma muncul <strong>sekali</strong>. Kalau lupa nge-copy, ya udah, bikin baru.
                  </Callout>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">2</span>
                <div className="flex-1 text-sm">
                  Pakai <strong>Base URL</strong> ini di kode kamu:
                  <div className="mt-2 p-2 rounded-lg bg-muted font-mono text-xs break-all">{baseUrl}</div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">3</span>
                <div className="flex-1 text-sm">
                  Kirim request dengan header <code className="px-1 py-0.5 bg-muted rounded">Authorization: Bearer pio-sk-...</code>. Selesai!
                </div>
              </li>
            </ol>
          </Card>

          <Card>
            <SectionHeader icon={Zap} title="Contoh paling singkat" subtitle="Pilih sesuai OS kamu, terus paste ke terminal" />
            <CodeTabs tabs={[
              {
                label: "macOS / Linux",
                lang: "bash",
                code: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer pio-sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen-plus",
    "messages": [{"role": "user", "content": "Halo!"}]
  }'`,
              },
              {
                label: "Windows (PowerShell)",
                lang: "bash",
                code: `$headers = @{
  "Authorization" = "Bearer pio-sk-..."
  "Content-Type"  = "application/json"
}
$body = '{
  "model": "qwen-plus",
  "messages": [{"role": "user", "content": "Halo!"}]
}'
Invoke-RestMethod -Uri "${baseUrl}/chat/completions" \`
  -Method Post -Headers $headers -Body $body`,
              },
              {
                label: "Windows (CMD)",
                lang: "bash",
                code: `curl ${baseUrl}/chat/completions ^
  -H "Authorization: Bearer pio-sk-..." ^
  -H "Content-Type: application/json" ^
  -d "{\\"model\\":\\"qwen-plus\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Halo!\\"}]}"`,
              },
            ]} />
            <Callout icon={Lightbulb} color="blue">
              Ganti <code>pio-sk-...</code> dengan key kamu yang asli. Tanda <code>\\</code> di Linux, <code>^</code> di CMD, dan backtick <code>`</code> di PowerShell — itu cuma buat lanjut baris, jangan ketuker.
            </Callout>
          </Card>

          <Card>
            <SectionHeader icon={Lightbulb} title="Tips" />
            <div className="space-y-2 ml-7">
              <Callout icon={AlertCircle} color="red">
                <strong>Jangan share key kamu.</strong> Anggap kayak password. Jangan commit ke GitHub, jangan paste di chat publik.
              </Callout>
              <Callout icon={Lightbulb} color="blue">
                Bingung mau mulai dari mana? Coba klik tab <strong>Chat</strong> di atas — itu paling sering dipakai.
              </Callout>
              <Callout icon={AlertCircle} color="amber">
                Kalau dapet error <strong>401</strong> → key salah/sudah revoke. <strong>403</strong> → kamu belum Plus. <strong>429</strong> → limit harian habis.
              </Callout>
            </div>
          </Card>
        </div>
      )}

      {/* CHAT */}
      {docTab === "chat" && (
        <div className="space-y-6">
          <Card>
            <SectionHeader icon={MessageSquare} title="Chat completion" subtitle="Endpoint paling sering dipakai. Buat ngobrol, jawab pertanyaan, generate teks." />
            <div className="ml-7 flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 font-mono font-semibold">POST</span>
              <code className="text-muted-foreground">{baseUrl}/chat/completions</code>
            </div>
          </Card>

          <div>
            <h3 className="font-semibold mb-3 text-sm">Curl (paling cepat buat test)</h3>
            <CodeBlock>{`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer pio-sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen-plus",
    "messages": [
      {"role": "user", "content": "Halo, siapa kamu?"}
    ]
  }'`}</CodeBlock>
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-sm">Python (pakai OpenAI SDK)</h3>
            <CodeBlock lang="python">{`from openai import OpenAI

client = OpenAI(
    api_key="pio-sk-...",
    base_url="${baseUrl}"
)

response = client.chat.completions.create(
    model="qwen-plus",
    messages=[{"role": "user", "content": "Halo"}]
)
print(response.choices[0].message.content)`}</CodeBlock>
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-sm">Node.js (pakai OpenAI SDK)</h3>
            <CodeBlock lang="javascript">{`import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "pio-sk-...",
  baseURL: "${baseUrl}",
});

const res = await client.chat.completions.create({
  model: "qwen-plus",
  messages: [{ role: "user", content: "Halo" }],
});
console.log(res.choices[0].message.content);`}</CodeBlock>
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-sm">Streaming (jawaban muncul real-time, kayak ChatGPT)</h3>
            <CodeBlock>{`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer pio-sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen-plus",
    "messages": [{"role": "user", "content": "Tulis cerita pendek"}],
    "stream": true,
    "stream_options": {"include_usage": true}
  }'`}</CodeBlock>
            <Callout icon={Lightbulb} color="blue">
              Pakai <code>stream_options.include_usage: true</code> biar token usage tetap kehitung walau pakai streaming.
            </Callout>
          </div>
        </div>
      )}

      {/* IMAGE */}
      {docTab === "image" && (
        <div className="space-y-6">
          <Card>
            <SectionHeader icon={ImageIcon} title="Generate gambar" subtitle="Bikin gambar dari deskripsi teks" />
            <div className="ml-7 flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 font-mono font-semibold">POST</span>
              <code className="text-muted-foreground">{baseUrl}/images/generations</code>
            </div>
          </Card>

          <div>
            <h3 className="font-semibold mb-3 text-sm">Contoh request</h3>
            <CodeBlock>{`curl ${baseUrl}/images/generations \\
  -H "Authorization: Bearer pio-sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "wan2.2-t2i-flash",
    "prompt": "kucing oranye lagi ngoding di kafe",
    "n": 1,
    "size": "1024x1024"
  }'`}</CodeBlock>
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-sm">Parameter</h3>
            <div className="border border-border rounded-lg overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Field</th>
                    <th className="text-left px-3 py-2 font-medium">Wajib?</th>
                    <th className="text-left px-3 py-2 font-medium">Penjelasan</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  <ParamRow name="prompt" required text="Deskripsi gambar yang mau dibuat" />
                  <ParamRow name="model" text="Default: wan2.2-t2i-flash" />
                  <ParamRow name="n" text="Jumlah gambar (1–4). Default 1" />
                  <ParamRow name="size" text="Misal 1024x1024, 1280x720. Default 1024x1024" />
                </tbody>
              </table>
            </div>
          </div>

          <Callout icon={Clock} color="blue">
            URL gambar yang di-return berlaku <strong>~24 jam</strong>. Download/simpan kalau mau pakai jangka panjang.
          </Callout>
        </div>
      )}

      {/* VIDEO */}
      {docTab === "video" && (
        <div className="space-y-6">
          <Card>
            <SectionHeader icon={Video} title="Generate video" subtitle="Beda dari gambar — video pakai pola async (kirim → tunggu → ambil hasil)" />
          </Card>

          <Callout icon={Lightbulb} color="amber">
            Video butuh waktu lama (5–10 menit). Jadi alurnya <strong>2 step</strong>: submit dulu, dapat <code>task_id</code>, terus kamu polling sampai status SUCCEEDED.
          </Callout>

          <div>
            <h3 className="font-semibold mb-3 text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">1</span>
              Submit job
            </h3>
            <div className="ml-7 mb-2 flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 font-mono font-semibold">POST</span>
              <code className="text-muted-foreground">{baseUrl}/videos/generations</code>
            </div>
            <CodeBlock>{`curl ${baseUrl}/videos/generations \\
  -H "Authorization: Bearer pio-sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "wan2.2-t2v-plus",
    "prompt": "ombak biru di pantai saat sunset",
    "size": "1280x720"
  }'

# Response: { "task_id": "abc123", "status": "PENDING" }`}</CodeBlock>
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">2</span>
              Poll status (ulang tiap ~10 detik)
            </h3>
            <div className="ml-7 mb-2 flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono font-semibold">GET</span>
              <code className="text-muted-foreground">{baseUrl}/videos/generations/&#123;task_id&#125;</code>
            </div>
            <CodeBlock>{`curl ${baseUrl}/videos/generations/abc123 \\
  -H "Authorization: Bearer pio-sk-..."

# Status mungkin: PENDING, RUNNING, SUCCEEDED, FAILED
# Kalau SUCCEEDED, ambil video_url dari response`}</CodeBlock>
          </div>
        </div>
      )}

      {/* OCR */}
      {docTab === "ocr" && (
        <div className="space-y-6">
          <Card>
            <SectionHeader icon={ScanText} title="OCR — baca teks dari gambar" subtitle="Extract teks dari foto, dokumen, screenshot, dll" />
            <div className="ml-7 flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 font-mono font-semibold">POST</span>
              <code className="text-muted-foreground">{baseUrl}/ocr</code>
            </div>
          </Card>

          <div>
            <h3 className="font-semibold mb-3 text-sm">Pakai URL gambar</h3>
            <CodeBlock>{`curl ${baseUrl}/ocr \\
  -H "Authorization: Bearer pio-sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "image": "https://example.com/foto-dokumen.jpg",
    "prompt": "Baca semua teks dengan akurat"
  }'`}</CodeBlock>
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-sm">Pakai gambar dari file lokal (base64)</h3>
            <CodeBlock>{`curl ${baseUrl}/ocr \\
  -H "Authorization: Bearer pio-sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "image": "data:image/png;base64,iVBORw0KGgoAAAANS..."
  }'`}</CodeBlock>
            <Callout icon={Lightbulb} color="blue">
              Field <code>prompt</code> opsional — kalau kosong, default-nya cuma "baca semua teks akurat". Kamu bisa kasih instruksi lain misal "ekstrak nomor invoice aja".
            </Callout>
          </div>
        </div>
      )}

      {/* FILE */}
      {docTab === "file" && (
        <div className="space-y-6">
          <Card>
            <SectionHeader icon={FileText} title="Upload file" subtitle="Upload PDF, dokumen, dll buat dipakai sebagai konteks di chat" />
            <div className="ml-7 flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 font-mono font-semibold">POST</span>
              <code className="text-muted-foreground">{baseUrl}/files</code>
            </div>
          </Card>

          <div>
            <h3 className="font-semibold mb-3 text-sm">Upload</h3>
            <CodeBlock>{`curl ${baseUrl}/files \\
  -H "Authorization: Bearer pio-sk-..." \\
  -F "file=@dokumen.pdf" \\
  -F "purpose=file-extract"`}</CodeBlock>
            <p className="text-xs text-muted-foreground mt-2">Response berisi <code>id</code> file yang bisa dipakai di chat completion sebagai referensi.</p>
          </div>

          <Callout icon={AlertCircle} color="amber">
            Maksimal 5 MB per upload. Format yang di-support: PDF, DOCX, TXT, dan format dokumen umum lain.
          </Callout>
        </div>
      )}

      {/* REFERENSI */}
      {docTab === "ref" && (
        <div className="space-y-6">
          <Card>
            <SectionHeader icon={Layers} title="Semua endpoint" subtitle="Daftar lengkap apa aja yang bisa dipanggil" />
            <div className="border border-border rounded-lg overflow-hidden text-sm mt-4">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Method</th>
                    <th className="text-left px-3 py-2 font-medium">Path</th>
                    <th className="text-left px-3 py-2 font-medium">Fungsi</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs">
                  <Row m="GET" p="/v1/models" d="List model" />
                  <Row m="POST" p="/v1/chat/completions" d="Chat (streaming/non)" />
                  <Row m="POST" p="/v1/embeddings" d="Embeddings" />
                  <Row m="POST" p="/v1/images/generations" d="Generate gambar" />
                  <Row m="POST" p="/v1/videos/generations" d="Generate video (async)" />
                  <Row m="GET" p="/v1/videos/generations/:id" d="Status video" />
                  <Row m="POST" p="/v1/ocr" d="OCR gambar" />
                  <Row m="POST" p="/v1/files" d="Upload file" />
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <SectionHeader icon={AlertCircle} title="Kode error umum" color="text-red-500" />
            <div className="space-y-2 mt-3">
              <div className="flex gap-3 text-sm">
                <code className="shrink-0 px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-mono text-xs h-fit">401</code>
                <p className="text-muted-foreground">Key salah, ga ada, atau sudah di-revoke. Cek lagi header Authorization.</p>
              </div>
              <div className="flex gap-3 text-sm">
                <code className="shrink-0 px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-mono text-xs h-fit">403</code>
                <p className="text-muted-foreground">Kamu bukan user Plus aktif. Upgrade dulu di halaman Plus.</p>
              </div>
              <div className="flex gap-3 text-sm">
                <code className="shrink-0 px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-mono text-xs h-fit">429</code>
                <p className="text-muted-foreground">Limit harian habis. Tunggu reset tengah malam WIB.</p>
              </div>
              <div className="flex gap-3 text-sm">
                <code className="shrink-0 px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-mono text-xs h-fit">400</code>
                <p className="text-muted-foreground">Request kamu salah format. Cek field yang wajib (misal <code>prompt</code> atau <code>messages</code>).</p>
              </div>
              <div className="flex gap-3 text-sm">
                <code className="shrink-0 px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-mono text-xs h-fit">502</code>
                <p className="text-muted-foreground">Server upstream lagi bermasalah. Coba lagi sebentar.</p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

type AccessTier = "free" | "plus_pro" | "pro_only";

interface ModelRow {
  id: string;
  label: string;
  desc: string;
  access: AccessTier;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT / LLM models — endpoint: POST /v1/chat/completions
// Diurutkan per family. Badge "Pro only" = frontier model paling gacor.
// ═══════════════════════════════════════════════════════════════════════════
const CHAT_MODELS: ModelRow[] = [
  // ── Qwen3.6 (generasi terbaru — April 2026) ──────────────────────────────
  { id: "qwen3.6-max-preview", label: "Qwen3.6 Max Preview", desc: "🔥 Flagship terbaru. Reasoning & coding paling kuat di katalog saat ini.", access: "pro_only" },
  { id: "qwen3.6-plus-2026-04-02", label: "Qwen3.6 Plus (2026-04-02)", desc: "Workhorse Qwen3.6 — upgrade dari qwen3.5-plus, lebih akurat.", access: "plus_pro" },
  { id: "qwen3.6-plus", label: "Qwen3.6 Plus", desc: "Alias rolling untuk qwen3.6 plus. Pilih ini kalau mau auto-update.", access: "plus_pro" },
  { id: "qwen3.6-flash-2026-04-16", label: "Qwen3.6 Flash (2026-04-16)", desc: "Flash terbaru — paling cepat di Qwen3.6 untuk task ringan.", access: "plus_pro" },
  { id: "qwen3.6-flash", label: "Qwen3.6 Flash", desc: "Alias rolling untuk qwen3.6 flash.", access: "plus_pro" },
  { id: "qwen3.6-27b", label: "Qwen3.6 27B", desc: "Dense 27B generasi 3.6 — balance kualitas & cost.", access: "plus_pro" },
  { id: "qwen3.6-35b-a3b", label: "Qwen3.6 35B A3B", desc: "MoE 35B aktif 3B di Qwen3.6 — efisien & pintar.", access: "plus_pro" },

  // ── Qwen3 Max — frontier sebelumnya ──────────────────────────────────────
  { id: "qwen3-max", label: "Qwen3 Max", desc: "🔥 Frontier model — reasoning, analisa kompleks, long context.", access: "pro_only" },
  { id: "qwen3-max-preview", label: "Qwen3 Max Preview", desc: "🔥 Preview build qwen3-max — fitur paling baru.", access: "pro_only" },
  { id: "qwen3-max-2026-01-23", label: "Qwen3 Max (2026-01-23)", desc: "🔥 Snapshot dated qwen3-max terbaru.", access: "pro_only" },
  { id: "qwen3-max-2025-09-23", label: "Qwen3 Max (2025-09-23)", desc: "🔥 Snapshot dated qwen3-max — pin untuk stabilitas.", access: "pro_only" },

  // ── Qwen3.5 series ───────────────────────────────────────────────────────
  { id: "qwen3.5-397b-a17b", label: "Qwen3.5 397B A17B", desc: "🔥 MoE raksasa generasi 3.5 — alternatif frontier.", access: "pro_only" },
  { id: "qwen3.5-122b-a10b", label: "Qwen3.5 122B A10B", desc: "MoE besar generasi 3.5 — reasoning berat.", access: "plus_pro" },
  { id: "qwen3.5-plus", label: "Qwen3.5 Plus", desc: "Workhorse tier baru di Qwen3.5 — upgrade dari qwen-plus.", access: "plus_pro" },
  { id: "qwen3.5-plus-2026-04-20", label: "Qwen3.5 Plus (2026-04-20)", desc: "Snapshot dated terbaru qwen3.5-plus.", access: "plus_pro" },
  { id: "qwen3.5-plus-2026-02-15", label: "Qwen3.5 Plus (2026-02-15)", desc: "Snapshot dated qwen3.5-plus.", access: "plus_pro" },
  { id: "qwen3.5-flash", label: "Qwen3.5 Flash", desc: "Flash di Qwen3.5 — cepat untuk task ringan.", access: "plus_pro" },
  { id: "qwen3.5-flash-2026-02-23", label: "Qwen3.5 Flash (2026-02-23)", desc: "Snapshot dated qwen3.5-flash.", access: "plus_pro" },
  { id: "qwen3.5-35b-a3b", label: "Qwen3.5 35B A3B", desc: "MoE 35B aktif 3B — efisien generasi 3.5.", access: "plus_pro" },
  { id: "qwen3.5-27b", label: "Qwen3.5 27B", desc: "Dense 27B di seri Qwen3.5.", access: "plus_pro" },

  // ── Qwen3 Reasoning / thinking ───────────────────────────────────────────
  { id: "qwen3-235b-a22b-thinking-2507", label: "Qwen3 235B Thinking", desc: "🔥 Mode thinking eksplisit — math, logic, debugging berat.", access: "pro_only" },
  { id: "qwen3-235b-a22b-instruct-2507", label: "Qwen3 235B A22B Instruct (2507)", desc: "MoE besar instruct — alternatif kuat untuk task umum.", access: "plus_pro" },
  { id: "qwen3-235b-a22b", label: "Qwen3 235B A22B", desc: "Base MoE 235B aktif 22B.", access: "plus_pro" },
  { id: "qwen3-next-80b-a3b-instruct", label: "Qwen3 Next 80B A3B Instruct", desc: "MoE generasi Next, instruct mode. Long context tinggi.", access: "plus_pro" },
  { id: "qwen3-next-80b-a3b-thinking", label: "Qwen3 Next 80B A3B Thinking", desc: "Versi thinking dari Next 80B — reasoning panjang & kompleks.", access: "plus_pro" },
  { id: "qwq-plus", label: "QwQ Plus", desc: "Reasoning model dengan chain-of-thought eksplisit.", access: "plus_pro" },

  // ── Qwen3 dense / MoE general ────────────────────────────────────────────
  { id: "qwen3-32b", label: "Qwen3 32B", desc: "Dense 32B, balance reasoning & cost untuk task kompleks ringan.", access: "plus_pro" },
  { id: "qwen3-30b-a3b", label: "Qwen3 30B A3B", desc: "MoE 30B aktif 3B — efisien tapi tetap kuat.", access: "plus_pro" },
  { id: "qwen3-30b-a3b-instruct-2507", label: "Qwen3 30B A3B Instruct (2507)", desc: "Varian instruct dated dari 30B-A3B.", access: "plus_pro" },
  { id: "qwen3-30b-a3b-thinking-2507", label: "Qwen3 30B A3B Thinking (2507)", desc: "Varian thinking dari 30B-A3B — reasoning eksplisit.", access: "plus_pro" },
  { id: "qwen3-14b", label: "Qwen3 14B", desc: "Dense model ukuran sedang — bagus untuk fine-grained task.", access: "plus_pro" },

  // ── Qwen3 small dense (lightweight, gratis untuk semua tier) ────────────
  { id: "qwen3-8b", label: "Qwen3 8B", desc: "Dense ringan — autocomplete, classification, edge use case.", access: "free" },
  { id: "qwen3-4b", label: "Qwen3 4B", desc: "Dense super ringan — embedded / on-device.", access: "plus_pro" },
  { id: "qwen3-1.7b", label: "Qwen3 1.7B", desc: "Dense mini — task simple, low-latency.", access: "plus_pro" },
  { id: "qwen3-0.6b", label: "Qwen3 0.6B", desc: "Dense paling kecil — eksperimen / prototipe.", access: "plus_pro" },

  // ── Coder (spesialis programming) ────────────────────────────────────────
  { id: "qwen3-coder-480b-a35b-instruct", label: "Qwen3 Coder 480B A35B", desc: "🔥 Coder MoE raksasa — paling kuat untuk task coding kompleks.", access: "pro_only" },
  { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus", desc: "🔥 Spesialis coding — code generation, refactor, review.", access: "pro_only" },
  { id: "qwen3-coder-plus-2025-09-23", label: "Qwen3 Coder Plus (2025-09-23)", desc: "🔥 Snapshot dated dari coder-plus terbaru.", access: "pro_only" },
  { id: "qwen3-coder-plus-2025-07-22", label: "Qwen3 Coder Plus (2025-07-22)", desc: "🔥 Snapshot dated dari coder-plus.", access: "pro_only" },
  { id: "qwen3-coder-next", label: "Qwen3 Coder Next", desc: "Coder generasi Next — long context untuk repo besar.", access: "plus_pro" },
  { id: "qwen3-coder-30b-a3b-instruct", label: "Qwen3 Coder 30B A3B Instruct", desc: "Coder MoE ukuran sedang.", access: "plus_pro" },
  { id: "qwen3-coder-flash", label: "Qwen3 Coder Flash", desc: "Coder versi cepat & murah untuk autocomplete IDE.", access: "plus_pro" },
  { id: "qwen3-coder-flash-2025-07-28", label: "Qwen3 Coder Flash (2025-07-28)", desc: "Snapshot dated dari coder-flash.", access: "plus_pro" },

  // ── Qwen3-VL (vision-language generasi baru) ─────────────────────────────
  { id: "qwen3-vl-235b-a22b-thinking", label: "Qwen3-VL 235B Thinking", desc: "🔥 Frontier VL dengan thinking — reasoning gambar paling pintar.", access: "pro_only" },
  { id: "qwen3-vl-235b-a22b-instruct", label: "Qwen3-VL 235B Instruct", desc: "🔥 Frontier VL — analisa gambar kompleks, dokumen panjang.", access: "pro_only" },
  { id: "qwen3-vl-plus", label: "Qwen3-VL Plus", desc: "Workhorse VL generasi baru — upgrade dari qwen-vl-plus.", access: "plus_pro" },
  { id: "qwen3-vl-plus-2025-12-19", label: "Qwen3-VL Plus (2025-12-19)", desc: "Snapshot dated terbaru qwen3-vl-plus.", access: "plus_pro" },
  { id: "qwen3-vl-plus-2025-09-23", label: "Qwen3-VL Plus (2025-09-23)", desc: "Snapshot dated qwen3-vl-plus.", access: "plus_pro" },
  { id: "qwen3-vl-30b-a3b-instruct", label: "Qwen3-VL 30B A3B Instruct", desc: "MoE VL 30B aktif 3B — balance untuk vision task.", access: "plus_pro" },
  { id: "qwen3-vl-30b-a3b-thinking", label: "Qwen3-VL 30B A3B Thinking", desc: "Versi thinking dari 30B-A3B VL.", access: "plus_pro" },
  { id: "qwen3-vl-flash", label: "Qwen3-VL Flash", desc: "VL flash — cepat untuk klasifikasi gambar / OCR ringan.", access: "plus_pro" },
  { id: "qwen3-vl-flash-2026-01-22", label: "Qwen3-VL Flash (2026-01-22)", desc: "Snapshot dated terbaru qwen3-vl-flash.", access: "plus_pro" },
  { id: "qwen3-vl-flash-2025-10-15", label: "Qwen3-VL Flash (2025-10-15)", desc: "Snapshot dated qwen3-vl-flash.", access: "plus_pro" },
  { id: "qwen3-vl-8b-instruct", label: "Qwen3-VL 8B Instruct", desc: "Dense VL ringan untuk task vision sederhana.", access: "plus_pro" },
  { id: "qwen3-vl-8b-thinking", label: "Qwen3-VL 8B Thinking", desc: "Versi thinking dari 8B VL — reasoning gambar low-cost.", access: "plus_pro" },

  // ── QvQ (Visual Reasoning — frontier khusus reasoning gambar) ───────────
  { id: "qvq-max", label: "QvQ Max", desc: "🔥 Visual reasoning frontier — chain-of-thought untuk gambar.", access: "pro_only" },
  { id: "qvq-max-latest", label: "QvQ Max Latest", desc: "🔥 Alias rolling ke versi qvq-max paling baru.", access: "pro_only" },
  { id: "qvq-max-2025-03-25", label: "QvQ Max (2025-03-25)", desc: "🔥 Snapshot dated qvq-max — pin versi.", access: "pro_only" },

  // ── Qwen-VL klasik & OCR ─────────────────────────────────────────────────
  { id: "qwen-vl-max", label: "Qwen VL Max", desc: "Vision-language flagship klasik — gambar + reasoning.", access: "plus_pro" },
  { id: "qwen-vl-max-latest", label: "Qwen VL Max Latest", desc: "Alias rolling untuk qwen-vl-max paling baru.", access: "plus_pro" },
  { id: "qwen-vl-max-2025-08-13", label: "Qwen VL Max (2025-08-13)", desc: "Snapshot dated qwen-vl-max terbaru.", access: "plus_pro" },
  { id: "qwen-vl-max-2025-04-08", label: "Qwen VL Max (2025-04-08)", desc: "Snapshot dated qwen-vl-max.", access: "plus_pro" },
  { id: "qwen-vl-plus", label: "Qwen VL Plus", desc: "Vision-language workhorse — input text + image.", access: "plus_pro" },
  { id: "qwen-vl-plus-latest", label: "Qwen VL Plus Latest", desc: "Alias rolling untuk qwen-vl-plus paling baru.", access: "plus_pro" },
  { id: "qwen-vl-plus-2025-08-15", label: "Qwen VL Plus (2025-08-15)", desc: "Snapshot dated qwen-vl-plus terbaru.", access: "plus_pro" },
  { id: "qwen-vl-plus-2025-05-07", label: "Qwen VL Plus (2025-05-07)", desc: "Snapshot dated qwen-vl-plus.", access: "plus_pro" },
  { id: "qwen-vl-plus-2025-01-25", label: "Qwen VL Plus (2025-01-25)", desc: "Snapshot dated qwen-vl-plus.", access: "plus_pro" },
  { id: "qwen-vl-ocr", label: "Qwen VL OCR", desc: "Spesialis OCR — extract teks dari gambar/dokumen scan.", access: "plus_pro" },
  { id: "qwen-vl-ocr-2025-11-20", label: "Qwen VL OCR (2025-11-20)", desc: "Snapshot dated qwen-vl-ocr terbaru.", access: "plus_pro" },

  // ── Qwen2.5-VL (legacy VL — masih kuat & gratis) ────────────────────────
  { id: "qwen2.5-vl-72b-instruct", label: "Qwen2.5-VL 72B Instruct", desc: "Dense VL 72B — alternatif frontier-class legacy.", access: "plus_pro" },
  { id: "qwen2.5-vl-32b-instruct", label: "Qwen2.5-VL 32B Instruct", desc: "Dense VL 32B legacy.", access: "plus_pro" },
  { id: "qwen2.5-vl-7b-instruct", label: "Qwen2.5-VL 7B Instruct", desc: "Dense VL ringan legacy.", access: "plus_pro" },
  { id: "qwen2.5-vl-3b-instruct", label: "Qwen2.5-VL 3B Instruct", desc: "Dense VL paling kecil.", access: "plus_pro" },

  // ── Qwen3.5 Omni (multimodal generasi 3.5 — Maret 2026, frontier) ──────
  { id: "qwen3.5-omni-plus", label: "Qwen3.5 Omni Plus", desc: "🔥 Multimodal generasi 3.5 flagship — text + image + audio + video, kualitas paling tinggi.", access: "pro_only" },
  { id: "qwen3.5-omni-plus-2026-03-15", label: "Qwen3.5 Omni Plus (2026-03-15)", desc: "🔥 Snapshot dated qwen3.5-omni-plus.", access: "pro_only" },
  { id: "qwen3.5-omni-plus-realtime", label: "Qwen3.5 Omni Plus Realtime", desc: "🔥 Realtime voice/audio streaming versi flagship 3.5.", access: "pro_only" },
  { id: "qwen3.5-omni-plus-realtime-2026-03-15", label: "Qwen3.5 Omni Plus Realtime (2026-03-15)", desc: "🔥 Snapshot dated realtime plus 3.5.", access: "pro_only" },
  { id: "qwen3.5-omni-flash", label: "Qwen3.5 Omni Flash", desc: "Multimodal 3.5 versi flash — cepat & murah.", access: "plus_pro" },
  { id: "qwen3.5-omni-flash-2026-03-15", label: "Qwen3.5 Omni Flash (2026-03-15)", desc: "Snapshot dated qwen3.5-omni-flash.", access: "plus_pro" },
  { id: "qwen3.5-omni-flash-realtime", label: "Qwen3.5 Omni Flash Realtime", desc: "Realtime voice/audio streaming flash 3.5.", access: "plus_pro" },
  { id: "qwen3.5-omni-flash-realtime-2026-03-15", label: "Qwen3.5 Omni Flash Realtime (2026-03-15)", desc: "Snapshot dated realtime flash 3.5.", access: "plus_pro" },

  // ── Qwen Omni klasik (multimodal text + image + audio/video) ───────────
  { id: "qwen3-omni-flash", label: "Qwen3 Omni Flash", desc: "Multimodal generasi 3 — text + image + audio + video, non-realtime.", access: "plus_pro" },
  { id: "qwen3-omni-flash-2025-09-15", label: "Qwen3 Omni Flash (2025-09-15)", desc: "Snapshot dated qwen3-omni-flash.", access: "plus_pro" },
  { id: "qwen-omni-turbo", label: "Qwen Omni Turbo", desc: "Multimodal klasik turbo — non-realtime.", access: "plus_pro" },
  { id: "qwen-omni-turbo-latest", label: "Qwen Omni Turbo Latest", desc: "Alias rolling untuk qwen-omni-turbo terbaru.", access: "plus_pro" },
  { id: "qwen-omni-turbo-2025-03-26", label: "Qwen Omni Turbo (2025-03-26)", desc: "Snapshot dated qwen-omni-turbo.", access: "plus_pro" },
  { id: "qwen3-omni-flash-realtime", label: "Qwen3 Omni Flash Realtime", desc: "Multimodal generasi 3 realtime — voice/audio streaming.", access: "plus_pro" },
  { id: "qwen3-omni-flash-realtime-2025-09-15", label: "Qwen3 Omni Flash Realtime (2025-09-15)", desc: "Snapshot dated realtime omni 3.", access: "plus_pro" },
  { id: "qwen-omni-turbo-realtime", label: "Qwen Omni Turbo Realtime", desc: "Multimodal klasik realtime — voice/audio streaming.", access: "plus_pro" },
  { id: "qwen-omni-turbo-realtime-latest", label: "Qwen Omni Turbo Realtime Latest", desc: "Alias rolling untuk realtime turbo terbaru.", access: "plus_pro" },
  { id: "qwen-omni-turbo-realtime-2025-05-08", label: "Qwen Omni Turbo Realtime (2025-05-08)", desc: "Snapshot dated realtime omni klasik.", access: "plus_pro" },
  { id: "qwen2.5-omni-7b", label: "Qwen2.5 Omni 7B", desc: "Multimodal open-weight 7B legacy.", access: "plus_pro" },

  // ── Workhorse Qwen klasik ───────────────────────────────────────────────
  { id: "qwen-max", label: "Qwen Max", desc: "Workhorse Qwen2.x flagship klasik. Stabil & matang.", access: "plus_pro" },
  { id: "qwen-max-2025-01-25", label: "Qwen Max (2025-01-25)", desc: "Snapshot dated dari qwen-max.", access: "plus_pro" },
  { id: "qwen-plus", label: "Qwen Plus", desc: "Sweet spot kecepatan, kualitas, dan biaya. Aman buat semua use case.", access: "plus_pro" },
  { id: "qwen-plus-latest", label: "Qwen Plus Latest", desc: "Alias rolling untuk qwen-plus paling baru.", access: "plus_pro" },
  { id: "qwen-plus-2025-09-11", label: "Qwen Plus (2025-09-11)", desc: "Snapshot dated qwen-plus.", access: "plus_pro" },
  { id: "qwen-plus-2025-07-28", label: "Qwen Plus (2025-07-28)", desc: "Snapshot dated qwen-plus.", access: "plus_pro" },
  { id: "qwen-plus-2025-07-14", label: "Qwen Plus (2025-07-14)", desc: "Snapshot dated qwen-plus.", access: "plus_pro" },
  { id: "qwen-plus-2025-04-28", label: "Qwen Plus (2025-04-28)", desc: "Snapshot dated qwen-plus.", access: "plus_pro" },
  { id: "qwen-flash", label: "Qwen Flash", desc: "Paling cepat & murah. Cocok untuk task ringan, autocomplete.", access: "free" },
  { id: "qwen-flash-2025-07-28", label: "Qwen Flash (2025-07-28)", desc: "Snapshot dated qwen-flash.", access: "plus_pro" },
  { id: "qwen-turbo", label: "Qwen Turbo", desc: "Throughput tinggi, latency rendah. Bagus untuk volume besar.", access: "free" },
  { id: "qwen-turbo-latest", label: "Qwen Turbo Latest", desc: "Alias rolling untuk qwen-turbo paling baru.", access: "plus_pro" },
  { id: "qwen-turbo-2025-04-28", label: "Qwen Turbo (2025-04-28)", desc: "Snapshot dated qwen-turbo.", access: "plus_pro" },

  // ── Karakter / Roleplay ─────────────────────────────────────────────────
  { id: "qwen-plus-character", label: "Qwen Plus Character", desc: "Varian qwen-plus untuk roleplay / character chat.", access: "plus_pro" },
  { id: "qwen-flash-character", label: "Qwen Flash Character", desc: "Varian qwen-flash untuk roleplay ringan.", access: "plus_pro" },

  // ── Qwen2.5 family (legacy) ─────────────────────────────────────────────
  { id: "qwen2.5-72b-instruct", label: "Qwen2.5 72B Instruct", desc: "Dense 72B legacy — masih kuat untuk task umum.", access: "plus_pro" },
  { id: "qwen2.5-32b-instruct", label: "Qwen2.5 32B Instruct", desc: "Dense 32B legacy.", access: "plus_pro" },
  { id: "qwen2.5-14b-instruct", label: "Qwen2.5 14B Instruct", desc: "Dense 14B legacy.", access: "plus_pro" },
  { id: "qwen2.5-14b-instruct-1m", label: "Qwen2.5 14B Instruct 1M", desc: "Dense 14B dengan 1M context window.", access: "plus_pro" },
  { id: "qwen2.5-7b-instruct", label: "Qwen2.5 7B Instruct", desc: "Dense 7B legacy ringan.", access: "plus_pro" },
  { id: "qwen2.5-7b-instruct-1m", label: "Qwen2.5 7B Instruct 1M", desc: "Dense 7B dengan 1M context window.", access: "plus_pro" },

  // ── Translation (Qwen-MT — dedicated translation) ──────────────────────
  { id: "qwen-mt-plus", label: "Qwen-MT Plus", desc: "Translation flagship — kualitas terjemahan paling akurat.", access: "plus_pro" },
  { id: "qwen-mt-turbo", label: "Qwen-MT Turbo", desc: "Translation throughput tinggi.", access: "plus_pro" },
  { id: "qwen-mt-flash", label: "Qwen-MT Flash", desc: "Translation paling cepat & murah.", access: "plus_pro" },
  { id: "qwen-mt-lite", label: "Qwen-MT Lite", desc: "Translation paling ringan untuk volume gede.", access: "plus_pro" },

  // ── Alternatif ekosistem ────────────────────────────────────────────────
  { id: "deepseek-v3.2", label: "DeepSeek V3.2", desc: "Alternatif kuat untuk reasoning & coding.", access: "plus_pro" },
];

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE models — endpoint: POST /v1/images/generations atau /api/v1/services/aigc/text2image
// ═══════════════════════════════════════════════════════════════════════════
const IMAGE_MODELS: ModelRow[] = [
  // ── Qwen Image generation ───────────────────────────────────────────────
  { id: "qwen-image-2.0-pro-2026-04-22", label: "Qwen Image 2.0 Pro (2026-04-22)", desc: "🔥 Snapshot dated paling baru — flagship image generation saat ini.", access: "pro_only" },
  { id: "qwen-image-2.0-pro", label: "Qwen Image 2.0 Pro", desc: "🔥 Alias rolling — prompt adherence paling akurat.", access: "pro_only" },
  { id: "qwen-image-2.0-pro-2026-03-03", label: "Qwen Image 2.0 Pro (2026-03-03)", desc: "🔥 Snapshot dated qwen-image-2.0-pro.", access: "pro_only" },
  { id: "qwen-image-max", label: "Qwen Image Max", desc: "🔥 Output paling detail dan tajam.", access: "pro_only" },
  { id: "qwen-image-max-2025-12-30", label: "Qwen Image Max (2025-12-30)", desc: "🔥 Snapshot dated qwen-image-max.", access: "pro_only" },
  { id: "qwen-image-2.0", label: "Qwen Image 2.0", desc: "Versi base 2.0 — kualitas tinggi tanpa premium tier.", access: "plus_pro" },
  { id: "qwen-image-2.0-2026-03-03", label: "Qwen Image 2.0 (2026-03-03)", desc: "Snapshot dated qwen-image-2.0.", access: "plus_pro" },
  { id: "qwen-image-plus", label: "Qwen Image Plus", desc: "Detail tajam, fotorealistik bagus.", access: "plus_pro" },
  { id: "qwen-image-plus-2026-01-09", label: "Qwen Image Plus (2026-01-09)", desc: "Snapshot dated qwen-image-plus.", access: "plus_pro" },
  { id: "qwen-image", label: "Qwen Image", desc: "Balanced quality & speed. Aman buat semua kebutuhan.", access: "plus_pro" },
  { id: "z-image-turbo", label: "Z-Image Turbo", desc: "Generate super cepat untuk preview/iterasi.", access: "plus_pro" },

  // ── Qwen Image edit (image-to-image dengan prompt) ──────────────────────
  { id: "qwen-image-edit-max", label: "Qwen Image Edit Max", desc: "🔥 Edit image paling presisi — best quality.", access: "pro_only" },
  { id: "qwen-image-edit-max-2026-01-16", label: "Qwen Image Edit Max (2026-01-16)", desc: "🔥 Snapshot dated qwen-image-edit-max.", access: "pro_only" },
  { id: "qwen-image-edit-plus", label: "Qwen Image Edit Plus", desc: "🔥 Edit dengan kontrol presisi tinggi.", access: "pro_only" },
  { id: "qwen-image-edit-plus-2025-12-15", label: "Qwen Image Edit Plus (2025-12-15)", desc: "🔥 Snapshot dated qwen-image-edit-plus.", access: "pro_only" },
  { id: "qwen-image-edit-plus-2025-10-30", label: "Qwen Image Edit Plus (2025-10-30)", desc: "🔥 Snapshot dated qwen-image-edit-plus.", access: "pro_only" },
  { id: "qwen-image-edit", label: "Qwen Image Edit", desc: "Edit gambar pakai prompt (image-to-image basic).", access: "plus_pro" },

  // ── Wan series (text-to-image artistik) ────────────────────────────────
  { id: "wan2.7-image-pro", label: "Wan 2.7 Image Pro", desc: "🔥 Wan 2.7 Pro tier — generasi terbaru, kualitas image paling tinggi.", access: "pro_only" },
  { id: "wan2.7-image", label: "Wan 2.7 Image", desc: "🔥 Wan 2.7 image — generasi terbaru text-to-image.", access: "pro_only" },
  { id: "wan2.6-image", label: "Wan 2.6 Image", desc: "Wan 2.6 text-to-image.", access: "plus_pro" },
  { id: "wan2.6-t2i", label: "Wan 2.6 T2I", desc: "Wan 2.6 text-to-image alias.", access: "plus_pro" },
  { id: "wan2.5-t2i-preview", label: "Wan 2.5 T2I Preview", desc: "Wan 2.5 preview build text-to-image.", access: "plus_pro" },
  { id: "wan2.5-i2i-preview", label: "Wan 2.5 I2I Preview", desc: "Wan 2.5 image-to-image preview.", access: "plus_pro" },
  { id: "wan2.2-t2i-plus", label: "Wan 2.2 T2I Plus", desc: "Wan 2.2 versi Plus — kualitas tinggi.", access: "plus_pro" },
  { id: "wan2.2-t2i-flash", label: "Wan 2.2 T2I Flash", desc: "Wan 2.2 cepat — gaya artistik kuat.", access: "plus_pro" },
  { id: "wan2.1-t2i-plus", label: "Wan 2.1 T2I Plus", desc: "Wan 2.1 Plus — generasi sebelumnya.", access: "plus_pro" },
  { id: "wan2.1-t2i-turbo", label: "Wan 2.1 T2I Turbo", desc: "Wan 2.1 turbo cepat.", access: "plus_pro" },
  { id: "wanx-style-repaint-v1", label: "Wanx Style Repaint v1", desc: "Stylize / repaint dengan preset gaya artistik.", access: "plus_pro" },
];

// ═══════════════════════════════════════════════════════════════════════════
// VIDEO models — endpoint: POST /api/v1/services/aigc/video-generation
// ═══════════════════════════════════════════════════════════════════════════
const VIDEO_MODELS: ModelRow[] = [
  // ── HappyHorse 1.0 (family video baru — Juli 2026, super limited) ─────
  { id: "happyhorse-1.0-t2v", label: "HappyHorse 1.0 T2V", desc: "🐎 Model video family baru dari Aliyun — text-to-video generasi terbaru.", access: "pro_only" },
  { id: "happyhorse-1.0-i2v", label: "HappyHorse 1.0 I2V", desc: "🐎 HappyHorse image-to-video — animasi dari gambar awal.", access: "pro_only" },
  { id: "happyhorse-1.0-r2v", label: "HappyHorse 1.0 R2V", desc: "🐎 HappyHorse reference-to-video — pake gambar referensi.", access: "pro_only" },
  { id: "happyhorse-1.0-video-edit", label: "HappyHorse 1.0 Video Edit", desc: "🐎 HappyHorse video editing — modifikasi klip dengan prompt.", access: "pro_only" },

  // ── Text-to-Video (T2V) ────────────────────────────────────────────────
  { id: "wan2.7-t2v-2026-04-25", label: "Wan 2.7 T2V (2026-04-25)", desc: "🔥 Generasi paling baru — flagship text-to-video saat ini.", access: "pro_only" },
  { id: "wan2.7-t2v", label: "Wan 2.7 T2V", desc: "🔥 Wan 2.7 text-to-video — alias rolling.", access: "pro_only" },
  { id: "wan2.6-t2v", label: "Wan 2.6 T2V", desc: "🔥 Generasi sebelumnya, motion smooth.", access: "pro_only" },
  { id: "wan2.5-t2v-preview", label: "Wan 2.5 T2V Preview", desc: "🔥 Wan 2.5 preview text-to-video.", access: "pro_only" },
  { id: "wan2.2-t2v-plus", label: "Wan 2.2 T2V Plus", desc: "Workhorse text-to-video. Output 5 detik 720p.", access: "plus_pro" },
  { id: "wan2.1-t2v-plus", label: "Wan 2.1 T2V Plus", desc: "Wan 2.1 Plus — generasi lebih lama.", access: "plus_pro" },
  { id: "wan2.1-t2v-turbo", label: "Wan 2.1 T2V Turbo", desc: "Cepat untuk iterasi prompt.", access: "plus_pro" },

  // ── Image-to-Video (I2V) ───────────────────────────────────────────────
  { id: "wan2.7-i2v-2026-04-25", label: "Wan 2.7 I2V (2026-04-25)", desc: "🔥 Generasi paling baru — flagship image-to-video saat ini.", access: "pro_only" },
  { id: "wan2.7-i2v", label: "Wan 2.7 I2V", desc: "🔥 Wan 2.7 image-to-video — alias rolling.", access: "pro_only" },
  { id: "wan2.6-i2v", label: "Wan 2.6 I2V", desc: "🔥 I2V Wan 2.6 — kualitas tinggi.", access: "pro_only" },
  { id: "wan2.6-i2v-flash", label: "Wan 2.6 I2V Flash", desc: "🔥 Wan 2.6 I2V versi flash — cepat.", access: "pro_only" },
  { id: "wan2.5-i2v-preview", label: "Wan 2.5 I2V Preview", desc: "🔥 Wan 2.5 preview image-to-video.", access: "pro_only" },
  { id: "wan2.2-i2v-plus", label: "Wan 2.2 I2V Plus", desc: "🔥 I2V — gambar awal + prompt motion.", access: "pro_only" },
  { id: "wan2.2-i2v-flash", label: "Wan 2.2 I2V Flash", desc: "I2V versi cepat & murah.", access: "plus_pro" },
  { id: "wan2.1-i2v-plus", label: "Wan 2.1 I2V Plus", desc: "Wan 2.1 Plus — generasi lebih lama.", access: "plus_pro" },
  { id: "wan2.1-i2v-turbo", label: "Wan 2.1 I2V Turbo", desc: "Wan 2.1 turbo image-to-video.", access: "plus_pro" },

  // ── Reference-to-Video (R2V — gambar referensi) ───────────────────────
  { id: "wan2.7-r2v", label: "Wan 2.7 R2V", desc: "🔥 Reference-to-video Wan 2.7 — generasi terbaru.", access: "pro_only" },
  { id: "wan2.6-r2v", label: "Wan 2.6 R2V", desc: "🔥 Reference-to-video — generate video pake gambar referensi.", access: "pro_only" },
  { id: "wan2.6-r2v-flash", label: "Wan 2.6 R2V Flash", desc: "🔥 R2V versi flash — cepat.", access: "pro_only" },

  // ── Keyframe-to-Video (KF2V — kasih 2 keyframe, generate transisi) ────
  { id: "wan2.2-kf2v-flash", label: "Wan 2.2 KF2V Flash", desc: "Keyframe-to-video — kasih 2 keyframe, AI generate transisinya.", access: "plus_pro" },
  { id: "wan2.1-kf2v-plus", label: "Wan 2.1 KF2V Plus", desc: "Wan 2.1 keyframe-to-video versi Plus.", access: "plus_pro" },

  // ── Video editing & animation ─────────────────────────────────────────
  { id: "wan2.7-videoedit", label: "Wan 2.7 Video Edit", desc: "🔥 Tier video editing terbaru — edit klip dengan prompt.", access: "pro_only" },
  { id: "wan2.1-vace-plus", label: "Wan 2.1 VACE Plus", desc: "Video editing — modifikasi video existing.", access: "plus_pro" },
  { id: "wan2.2-animate-move", label: "Wan 2.2 Animate Move", desc: "Animate gambar dengan motion preset.", access: "plus_pro" },
  { id: "wan2.2-animate-mix", label: "Wan 2.2 Animate Mix", desc: "Animate dengan blending multi-source.", access: "plus_pro" },
];

function AccessBadge({ access }: { access: AccessTier }) {
  if (access === "pro_only") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 whitespace-nowrap">
        <Crown className="w-2.5 h-2.5" /> Pro only
      </span>
    );
  }
  if (access === "free") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 whitespace-nowrap">
        Semua tier
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20 whitespace-nowrap">
      Plus &amp; Pro
    </span>
  );
}

function ModelTable({ models, defaultHint }: { models: ModelRow[]; defaultHint: string }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    toast({ title: "Model ID disalin", description: id });
    setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
  };

  // Sort: free (semua tier) dulu, plus_pro berikutnya, pro_only di bawah.
  // Stable sort — urutan original (per family) dipertahankan dalam masing-masing tier.
  const accessOrder: Record<AccessTier, number> = { free: 0, plus_pro: 1, pro_only: 2 };
  const sortedModels = [...models].sort((a, b) => accessOrder[a.access] - accessOrder[b.access]);

  return (
    <div className="ml-7">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted/50 border border-border font-medium tabular-nums">
          {sortedModels.length} model
        </span>
        <span>tersedia</span>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Desktop table */}
        <table className="w-full text-sm hidden md:table">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Model ID</th>
              <th className="text-left px-3 py-2 font-medium">Nama</th>
              <th className="text-left px-3 py-2 font-medium">Akses</th>
              <th className="text-left px-3 py-2 font-medium">Catatan</th>
              <th className="text-right px-3 py-2 font-medium w-12"></th>
            </tr>
          </thead>
          <tbody>
            {sortedModels.map((m) => (
              <tr key={m.id} className="border-t border-border hover:bg-muted/30 transition">
                <td className="px-3 py-2.5 font-mono text-xs text-foreground/90 align-top">{m.id}</td>
                <td className="px-3 py-2.5 font-medium align-top">{m.label}</td>
                <td className="px-3 py-2.5 align-top">
                  <AccessBadge access={m.access} />
                </td>
                <td className="px-3 py-2.5 text-muted-foreground text-xs align-top">{m.desc}</td>
                <td className="px-3 py-2.5 text-right align-top">
                  <button
                    onClick={() => handleCopy(m.id)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted transition text-muted-foreground hover:text-foreground"
                    title="Copy model ID"
                  >
                    {copiedId === m.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border">
          {sortedModels.map((m) => (
            <div key={m.id} className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{m.label}</div>
                  <div className="font-mono text-xs text-muted-foreground break-all mt-0.5">{m.id}</div>
                </div>
                <button
                  onClick={() => handleCopy(m.id)}
                  className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted transition text-muted-foreground hover:text-foreground"
                  title="Copy model ID"
                >
                  {copiedId === m.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <AccessBadge access={m.access} />
              <p className="text-xs text-muted-foreground">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground italic">{defaultHint}</p>
    </div>
  );
}

function ModelsSection() {
  const [modelTab, setModelTab] = useState<"llm" | "image" | "video">("llm");

  const subTabs: { id: typeof modelTab; label: string; icon: any }[] = [
    { id: "llm", label: "LLM", icon: MessageSquare },
    { id: "image", label: "Gambar", icon: ImageIcon },
    { id: "video", label: "Video", icon: Video },
  ];

  return (
    <div className="space-y-6">
      {/* Info ringkas akses (tanpa card tarif) */}
      <Callout icon={Lightbulb} color="blue">
        Akses API butuh subscription <strong>Plus</strong> atau <strong>Pro</strong> aktif. Sebagian besar model bisa dipakai semua user Plus/Pro. Model yang ditandai{" "}
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 align-middle">
          <Crown className="w-2.5 h-2.5" /> Pro only
        </span>{" "}
        adalah model frontier — eksklusif untuk pengguna <strong>Pro</strong>. Klik ikon copy buat salin Model ID.
      </Callout>

      {/* Sub-tabs LLM / Gambar / Video */}
      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-muted/40 border border-border">
        {subTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setModelTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition",
              modelTab === id
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {modelTab === "llm" && (
        <Card>
          <SectionHeader icon={MessageSquare} title="Chat (LLM)" subtitle="Endpoint: POST /v1/chat/completions" />
          <ModelTable
            models={CHAT_MODELS}
            defaultHint="Belum tau pilih yang mana? Mulai dari qwen-plus — itu sweet spot kualitas vs harga."
          />
        </Card>
      )}

      {modelTab === "image" && (
        <Card>
          <SectionHeader icon={ImageIcon} title="Gambar" subtitle="Endpoint: POST /v1/images/generations · POST /v1/images/edits" />
          <ModelTable
            models={IMAGE_MODELS}
            defaultHint="Default rekomendasi: qwen-image. Untuk hasil premium pakai qwen-image-max."
          />
        </Card>
      )}

      {modelTab === "video" && (
        <Card>
          <SectionHeader icon={Video} title="Video" subtitle="Endpoint: POST /v1/videos/generations" />
          <ModelTable
            models={VIDEO_MODELS}
            defaultHint="Default text-to-video: wan2.2-t2v-plus. Untuk image-to-video pakai wan2.2-i2v-plus."
          />
        </Card>
      )}

      <Card className="bg-muted/30">
        <SectionHeader icon={AlertCircle} title="Catatan penting" />
        <ul className="ml-7 space-y-2 text-sm text-muted-foreground list-disc list-inside">
          <li>List ini adalah model rekomendasi yang paling stabil. Server juga support varian dated (mis. <code className="px-1 py-0.5 bg-muted rounded text-xs">qwen-plus-2025-09-11</code>) untuk pin versi.</li>
          <li>Akses ke endpoint <code className="px-1 py-0.5 bg-muted rounded text-xs">/v1/*</code> butuh subscription Plus atau Pro aktif. Tanpa itu, request balik <code className="px-1 py-0.5 bg-muted rounded text-xs">403 permission_denied</code> di middleware auth.</li>
          <li>User <strong>Plus</strong> yang nyoba pakai model <Crown className="w-3 h-3 inline -mt-0.5 text-amber-500" /> Pro-only akan dapat <code className="px-1 py-0.5 bg-muted rounded text-xs">403 MODEL_PRO_ONLY</code> dengan pesan upgrade. Cek header <code className="px-1 py-0.5 bg-muted rounded text-xs">X-Pioo-Error</code> dan field <code className="px-1 py-0.5 bg-muted rounded text-xs">required_tier</code> di response error.</li>
          <li>Daftar model bisa berubah seiring rilis baru — selalu cek halaman ini sebelum hardcode di production.</li>
        </ul>
      </Card>
    </div>
  );
}

function ParamRow({ name, required, text }: { name: string; required?: boolean; text: string }) {
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 font-mono text-xs">{name}</td>
      <td className="px-3 py-2">
        {required ? (
          <span className="text-xs text-red-500 font-medium">wajib</span>
        ) : (
          <span className="text-xs text-muted-foreground">opsional</span>
        )}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{text}</td>
    </tr>
  );
}

function Row({ m, p, d }: { m: string; p: string; d: string }) {
  const colors: Record<string, string> = {
    GET: "text-blue-500",
    POST: "text-green-500",
    DELETE: "text-red-500",
  };
  return (
    <tr className="border-t border-border">
      <td className={cn("px-3 py-2 font-semibold", colors[m])}>{m}</td>
      <td className="px-3 py-2">{p}</td>
      <td className="px-3 py-2 font-sans text-muted-foreground">{d}</td>
    </tr>
  );
}
