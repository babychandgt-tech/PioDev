import express from "express";
import { createClient } from "@supabase/supabase-js";
import net from "net";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import mammoth from "mammoth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SERVER_PORT = IS_PRODUCTION
  ? Number(process.env.PORT ?? 8080)
  : Number(process.env.SERVER_PORT ?? 3099);
// ── Tier limits (3-tier: free / plus / pro) ────────────────────────────────────
const FREE_TOKEN_LIMIT = 60_000;
const PLUS_TOKEN_LIMIT = 200_000;
const PRO_TOKEN_LIMIT  = 360_000;

const FREE_IMAGE_LIMIT = 7;
const PLUS_IMAGE_LIMIT = 25;
const PRO_IMAGE_LIMIT  = 40;

const FREE_VIDEO_CREDITS = 3;
const PLUS_VIDEO_CREDITS = 12;
const PRO_VIDEO_CREDITS  = 20;

// ── Voice Studio credits (BULANAN, mirror pattern video_credits) ───────────────
// 1 TTS = 1 credit, 1 voice clone = 5 credits, 1 voice design = 10 credits.
const FREE_VOICE_CREDITS = 10;
const PLUS_VOICE_CREDITS = 60;
const PRO_VOICE_CREDITS  = 200;
const VOICE_COST_TTS    = 1;
const VOICE_COST_CLONE  = 5;
const VOICE_COST_DESIGN = 10;

// ── Pustaka (Knowledge Base) limits per tier ───────────────────────────────────
const FREE_PUSTAKA_FILE_BYTES = 10 * 1024 * 1024;   // 10 MB
const PLUS_PUSTAKA_FILE_BYTES = 20 * 1024 * 1024;   // 20 MB
const PRO_PUSTAKA_FILE_BYTES  = 30 * 1024 * 1024;   // 30 MB
const FREE_PUSTAKA_FILE_COUNT = 10;
const PLUS_PUSTAKA_FILE_COUNT = 20;
const PRO_PUSTAKA_FILE_COUNT  = 35;
const FREE_PUSTAKA_PAGES_MO   = 100;
const PLUS_PUSTAKA_PAGES_MO   = 1000;
const PRO_PUSTAKA_PAGES_MO    = 5000;

// Aliases biar kode lama yg masih nyebut PREMIUM_* gak break (Plus = "Premium" lama).
const DAILY_TOKEN_LIMIT     = FREE_TOKEN_LIMIT;
const PREMIUM_TOKEN_LIMIT   = PLUS_TOKEN_LIMIT;
const PREMIUM_IMAGE_LIMIT   = PLUS_IMAGE_LIMIT;
const PREMIUM_VIDEO_CREDITS = PLUS_VIDEO_CREDITS;

// ── Limit khusus akses lewat API key (terpisah dari pemakaian web) ─────────────
// Tetap dipake untuk request_count (rate limiting per hari) — bukan untuk billing.
const API_DAILY_REQUEST_LIMIT = 1_000;

// ── Credit system (BYOK API) — saldo IDR persistent, no daily reset ────────────
// Konversi: 2 token = Rp 1 (cost = ceil(tokens / 2))
const IDR_PER_TOKEN_NUM = 1;
const IDR_PER_TOKEN_DEN = 2;
const IMAGE_COST_IDR = 1_000;     // per gambar
const VIDEO_COST_IDR = 10_000;    // per video
const PLUS_UPGRADE_BONUS_IDR = 75_000;   // bonus sekali saat upgrade ke Plus
const PRO_UPGRADE_BONUS_IDR  = 125_000;  // bonus sekali saat upgrade ke Pro

// ── Trial Plus (uji coba gratis 1 bulan, sekali per akun) ─────────────────────
// Bonus saldo trial = Rp 75.000 (sama nominal dengan bonus upgrade berbayar).
// Pake ledger type SEPARATE 'bonus_plus_trial' supaya GAK ngeblok bonus upgrade
// berbayar nanti — user yang trial → nanti beli paket Plus berbayar TETEP dapet
// bonus 75k lagi via 'bonus_plus_upgrade'. Total maksimum: 150k per user (75k
// trial + 75k upgrade berbayar). Re-claim trial dicegah oleh kolom
// `profiles.trial_claimed_at` (bukan oleh idempotency cek ledger).
const PLUS_TRIAL_BONUS_IDR    = 75_000;  // bonus saldo saat klaim trial
const PLUS_TRIAL_DURATION_DAYS = 30;     // durasi trial

function tokensToIdr(tokens: number): number {
  if (!tokens || tokens <= 0) return 0;
  return Math.ceil((tokens * IDR_PER_TOKEN_NUM) / IDR_PER_TOKEN_DEN);
}

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com";
const DASHSCOPE_COMPATIBLE_BASE = `${DASHSCOPE_BASE}/compatible-mode/v1`;

// Model-model yang hanya boleh dipakai user Plus/Pro/Admin (Free akan kena 403 MODEL_RESTRICTED)
const PREMIUM_ONLY_MODELS = new Set([
  // ── Qwen3 Max / Flagship (frontier) ─────────────────────────────────────
  "qwen3-max","qwen3-max-preview","qwen3-max-2026-01-23","qwen3-max-2025-09-23",
  "qwen3.5-397b-a17b","qwen3.5-122b-a10b",
  "qwen3-235b-a22b","qwen3-235b-a22b-instruct-2507","qwen3-235b-a22b-thinking-2507",
  "qwen3-next-80b-a3b-instruct","qwen3-next-80b-a3b-thinking",
  "qwq-plus","deepseek-v3.2",
  "qwen3.5-35b-a3b","qwen3.5-27b","qwen3.5-plus","qwen3.5-plus-2026-02-15","qwen3.5-plus-2026-04-20",
  "qwen3-32b","qwen3-30b-a3b","qwen3-30b-a3b-instruct-2507","qwen3-30b-a3b-thinking-2507",
  "qwen3-14b","qwen2.5-72b-instruct","qwen-max","qwen-max-2025-01-25",
  // ── Qwen3.6 (generasi terbaru — April 2026) ─────────────────────────────
  "qwen3.6-max-preview",
  "qwen3.6-plus","qwen3.6-plus-2026-04-02",
  "qwen3.6-flash","qwen3.6-flash-2026-04-16",
  "qwen3.6-27b","qwen3.6-35b-a3b",
  // ── Coder ───────────────────────────────────────────────────────────────
  "qwen3-coder-480b-a35b-instruct","qwen3-coder-next",
  "qwen3-coder-plus","qwen3-coder-plus-2025-09-23","qwen3-coder-plus-2025-07-22",
  "qwen3-coder-30b-a3b-instruct","qwen3-coder-flash","qwen3-coder-flash-2025-07-28",
  // ── Qwen3-VL (vision-language generasi baru) ────────────────────────────
  "qwen3-vl-235b-a22b-instruct","qwen3-vl-235b-a22b-thinking",
  "qwen3-vl-30b-a3b-instruct","qwen3-vl-30b-a3b-thinking",
  "qwen3-vl-plus","qwen3-vl-plus-2025-12-19","qwen3-vl-plus-2025-09-23",
  "qwen3-vl-flash","qwen3-vl-flash-2026-01-22","qwen3-vl-flash-2025-10-15",
  "qwen3-vl-8b-instruct","qwen3-vl-8b-thinking",
  // ── QvQ (visual reasoning) ──────────────────────────────────────────────
  "qvq-max","qvq-max-latest","qvq-max-2025-03-25",
  // ── Qwen Omni (multimodal text+image+audio) ─────────────────────────────
  "qwen3-omni-flash","qwen3-omni-flash-2025-09-15",
  "qwen-omni-turbo","qwen-omni-turbo-2025-03-26",
  "qwen3-omni-flash-realtime","qwen3-omni-flash-realtime-2025-09-15",
  "qwen-omni-turbo-realtime","qwen-omni-turbo-realtime-2025-05-08",
]);

// Model-model paling powerful — eksklusif untuk tier Pro (Plus akan kena 403 MODEL_PRO_ONLY)
// Plus tetap bisa pakai semua model lain (workhorse + alternatif kuat).
const PRO_ONLY_MODELS = new Set([
  // ── Chat — frontier & top-tier ──────────────────────────────────────────
  "qwen3-max","qwen3-max-preview","qwen3-max-2026-01-23","qwen3-max-2025-09-23",
  "qwen3.6-max-preview", // ← flagship terbaru (April 2026)
  "qwen3-235b-a22b-thinking-2507",
  "qwen3.5-397b-a17b", // MoE raksasa generasi 3.5
  "qwen3-coder-plus","qwen3-coder-plus-2025-09-23","qwen3-coder-plus-2025-07-22",
  "qwen3-coder-480b-a35b-instruct", // coder MoE raksasa
  // ── Vision-Language — frontier ──────────────────────────────────────────
  "qwen3-vl-235b-a22b-instruct","qwen3-vl-235b-a22b-thinking",
  "qvq-max","qvq-max-latest","qvq-max-2025-03-25",
  // ── Multimodal Omni — frontier (Qwen3.5 Plus generation, Maret 2026) ────
  "qwen3.5-omni-plus","qwen3.5-omni-plus-2026-03-15",
  "qwen3.5-omni-plus-realtime","qwen3.5-omni-plus-realtime-2026-03-15",
  // ── Image — premium quality & latest ────────────────────────────────────
  "qwen-image-max","qwen-image-max-2025-12-30",
  "qwen-image-2.0-pro","qwen-image-2.0-pro-2026-03-03","qwen-image-2.0-pro-2026-04-22",
  "qwen-image-edit-max","qwen-image-edit-max-2026-01-16",
  "qwen-image-edit-plus","qwen-image-edit-plus-2025-12-15","qwen-image-edit-plus-2025-10-30",
  // Wan 2.7 image (generasi terbaru — April 2026)
  "wan2.7-image","wan2.7-image-pro",
  // ── Video — newest generation & best ────────────────────────────────────
  // HappyHorse 1.0 (family baru — Juli 2026, super limited 10/quota)
  "happyhorse-1.0-t2v","happyhorse-1.0-i2v","happyhorse-1.0-r2v","happyhorse-1.0-video-edit",
  // Wan 2.7 video (generasi terbaru — April 2026)
  "wan2.7-t2v","wan2.7-t2v-2026-04-25",
  "wan2.7-i2v","wan2.7-i2v-2026-04-25",
  "wan2.7-r2v","wan2.7-videoedit",
  "wan2.6-t2v","wan2.6-i2v","wan2.6-i2v-flash",
  "wan2.6-r2v","wan2.6-r2v-flash", // reference-to-video terbaru
  "wan2.2-i2v-plus","wan2.5-t2v-preview","wan2.5-i2v-preview",
]);

/** Tanggal hari ini dalam timezone WIB (UTC+7), format YYYY-MM-DD */
function getTodayWIB(): string {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

/** Bulan saat ini dalam timezone WIB (UTC+7), format YYYY-MM */
function getThisMonthWIB(): string {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 7);
}

/** Tanggal 1 bulan dari sekarang (ISO string) untuk premium_expires_at */
function oneMonthFromNow(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

/** Cek apakah user aktif premium (is_premium=true dan belum expired) */
function isPremiumActive(profile: { is_premium?: boolean | null; premium_expires_at?: string | null }): boolean {
  if (!profile.is_premium) return false;
  if (!profile.premium_expires_at) return true; // record lama tanpa expiry = tetap aktif
  return new Date(profile.premium_expires_at) > new Date();
}

export type Tier = "free" | "plus" | "pro";

/**
 * Tentukan tier user dari profile row.
 * Prioritas: kolom `tier` baru → fallback ke is_premium boolean (legacy).
 * Kalau is_premium=true tapi sudah expired → 'free'.
 */
function getTier(profile: {
  tier?: string | null;
  is_premium?: boolean | null;
  premium_expires_at?: string | null;
} | null | undefined): Tier {
  if (!profile) return "free";
  if (!isPremiumActive(profile)) return "free";
  const t = (profile.tier ?? "").toLowerCase();
  if (t === "pro") return "pro";
  if (t === "plus") return "plus";
  return "plus"; // is_premium=true tanpa tier (legacy) → anggap Plus
}

/** Limit-limit per tier (untuk admin, semua unlimited). */
function getTierLimits(tier: Tier, isAdmin: boolean): {
  tokenLimit: number;
  imageLimit: number;
  videoMax: number;
  voiceMax: number;
} {
  if (isAdmin) return { tokenLimit: 9_999_999, imageLimit: 9999, videoMax: 999, voiceMax: 9999 };
  if (tier === "pro")  return { tokenLimit: PRO_TOKEN_LIMIT,  imageLimit: PRO_IMAGE_LIMIT,  videoMax: PRO_VIDEO_CREDITS,  voiceMax: PRO_VOICE_CREDITS };
  if (tier === "plus") return { tokenLimit: PLUS_TOKEN_LIMIT, imageLimit: PLUS_IMAGE_LIMIT, videoMax: PLUS_VIDEO_CREDITS, voiceMax: PLUS_VOICE_CREDITS };
  return { tokenLimit: FREE_TOKEN_LIMIT, imageLimit: FREE_IMAGE_LIMIT, videoMax: FREE_VIDEO_CREDITS, voiceMax: FREE_VOICE_CREDITS };
}

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const dashscopeApiKey = process.env.VITE_OPENAI_API_KEY!;

if (!supabaseUrl || !supabaseAnonKey || !dashscopeApiKey) {
  console.error("[PioCode API] Missing required environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Supabase Storage: permanent media upload ──────────────────────────────────
const STUDIO_IMAGES_BUCKET = "studio-images";
const STUDIO_VIDEOS_BUCKET = "studio-videos";

async function ensurePublicBucket(bucketId: string, allowedMimes: string[]) {
  const { data: existing } = await supabaseAdmin.storage.getBucket(bucketId);
  if (existing) return;
  const { error } = await supabaseAdmin.storage.createBucket(bucketId, {
    public: true,
    allowedMimeTypes: allowedMimes,
  });
  if (error) console.warn(`[storage] bucket '${bucketId}' create error:`, error.message);
  else console.log(`[storage] bucket '${bucketId}' created`);
}

async function uploadUrlToStorage(
  sourceUrl: string,
  bucket: string,
  storagePath: string,
  mimeType: string,
): Promise<string | null> {
  try {
    const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) { console.warn("[storage] fetch failed:", resp.status, sourceUrl.slice(0, 80)); return null; }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const { error } = await supabaseAdmin.storage.from(bucket).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true,
    });
    if (error) { console.warn("[storage] upload error:", error.message); return null; }
    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);
    return data?.publicUrl ?? null;
  } catch (e) {
    console.warn("[storage] uploadUrlToStorage failed:", (e as Error).message);
    return null;
  }
}

// Ensure buckets exist at startup (fire-and-forget)
Promise.all([
  ensurePublicBucket(STUDIO_IMAGES_BUCKET, ["image/png", "image/jpeg", "image/webp", "image/gif"]),
  ensurePublicBucket(STUDIO_VIDEOS_BUCKET, ["video/mp4", "video/webm", "video/quicktime"]),
]).catch((e) => console.warn("[storage] bucket setup error:", (e as Error).message));

const app = express();
app.use(express.json());
app.use(express.raw({
  type: (req: any) => {
    const ct = (req.headers?.["content-type"] || "");
    return !ct.startsWith("application/json") && !ct.startsWith("multipart/");
  },
  limit: "50mb",
}));

async function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as any).userId = user.id;
  next();
}

async function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const userId = (req as any).userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (profile?.role !== "admin") {
    res.status(403).json({ error: "Forbidden: admin only" });
    return;
  }
  next();
}

// ── GET /api/me/role  (ambil role user sendiri) ──────────────────────────────
app.get("/api/me/role", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !data) {
    res.json({ role: "user" });
    return;
  }
  res.json({ role: data.role });
});

// ── GET /api/admin/users  (daftar semua user) ─────────────────────────────────
app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  const { data: authUsers, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
  if (authErr) { res.status(500).json({ error: authErr.message }); return; }

  const { data: profiles } = await supabaseAdmin.from("profiles").select("*");
  const profileMap: Record<string, any> = {};
  (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });

  const users = authUsers.users.map((u) => {
    const p = profileMap[u.id];
    const tier = getTier(p ?? null);
    return {
      id: u.id,
      email: u.email,
      full_name: p?.full_name || u.user_metadata?.full_name || "",
      role: p?.role || "user",
      is_premium: p?.is_premium ?? false,
      tier,
      premium_expires_at: p?.premium_expires_at ?? null,
      credit_balance_idr: p?.credit_balance_idr ?? 0,
      trial_claimed_at: p?.trial_claimed_at ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    };
  });

  res.json({ users });
});

// ── GET /api/admin/stats  (statistik singkat) ─────────────────────────────────
app.get("/api/admin/stats", requireAuth, requireAdmin, async (_req, res) => {
  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
  const totalUsers = authUsers?.users.length ?? 0;

  const { count: totalConversations } = await supabaseAdmin
    .from("conversations")
    .select("*", { count: "exact", head: true });

  const { count: totalMessages } = await supabaseAdmin
    .from("messages")
    .select("*", { count: "exact", head: true });

  const { data: tokenData } = await supabaseAdmin
    .from("daily_token_usage")
    .select("total_tokens");

  const totalTokens = (tokenData || []).reduce(
    (sum: number, row: any) => sum + (row.total_tokens || 0), 0
  );

  res.json({ totalUsers, totalConversations, totalMessages, totalTokens });
});

// ── PATCH /api/admin/users/:id/role  (ubah role user) ────────────────────────
app.patch("/api/admin/users/:id/role", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  let body: any = {};
  try {
    const raw = req.body instanceof Buffer ? req.body.toString("utf8") : req.body;
    body = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { /**/ }

  const { role } = body;
  if (!["user", "admin"].includes(role)) {
    res.status(400).json({ error: "Role harus 'user' atau 'admin'" });
    return;
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .upsert({ id, role }, { onConflict: "id" });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
});

// ── DELETE /api/admin/users/:id  (hapus user) ─────────────────────────────────
app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
});

// ── GET /api/admin/users/:id/usage  (token usage per user) ────────────────────
app.get("/api/admin/users/:id/usage", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from("daily_token_usage")
    .select("*")
    .eq("user_id", id)
    .order("date", { ascending: false })
    .limit(30);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ usage: data || [] });
});

// ── GET /api/admin/daily-usage  (grafik token 7 hari) ─────────────────────────
app.get("/api/admin/daily-usage", async (_req, res, next) => {
  console.log("[daily-usage] INCOMING REQUEST — auth:", _req.headers.authorization?.slice(0,20));
  next();
}, requireAuth, requireAdmin, async (_req, res) => {
  // Ambil semua data tanpa filter tanggal di query (hindari masalah tipe kolom)
  const { data, error } = await supabaseAdmin
    .from("daily_token_usage")
    .select("date, total_tokens, messages")
    .order("date", { ascending: true });

  console.log("[daily-usage] rows:", data?.length ?? 0, "error:", error?.message ?? null);
  if (data && data.length > 0) console.log("[daily-usage] sample row:", JSON.stringify(data[0]));

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Hitung batas 7 hari terakhir di JS
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  cutoff.setHours(0, 0, 0, 0);

  const byDate: Record<string, { total_tokens: number; messages: number }> = {};

  (data || []).forEach((row: any) => {
    // date bisa berupa "2026-03-26" atau timestamp ISO
    const rawDate = String(row.date || "").slice(0, 10); // ambil YYYY-MM-DD saja
    if (!rawDate || rawDate.length < 10) return;
    const rowDate = new Date(rawDate + "T00:00:00");
    if (rowDate < cutoff) return; // lewati data lebih lama dari 7 hari
    if (!byDate[rawDate]) byDate[rawDate] = { total_tokens: 0, messages: 0 };
    byDate[rawDate].total_tokens += Number(row.total_tokens) || 0;
    byDate[rawDate].messages += Number(row.messages) || 0;
  });

  // Pastikan 7 slot hari selalu ada (isi 0 kalau tidak ada data) — berbasis WIB
  const slots: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() + 7 * 60 * 60 * 1000 - i * 24 * 60 * 60 * 1000);
    slots.push(d.toISOString().slice(0, 10));
  }

  const daily = slots.map((dateStr) => {
    const vals = byDate[dateStr] ?? { total_tokens: 0, messages: 0 };
    return {
      date: new Date(dateStr + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
      token: vals.total_tokens,
      pesan: vals.messages,
    };
  });

  res.json({ daily });
});

// ── Changelog (What's New) ─────────────────────────────────────────────────────
app.get("/api/changelog", async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from("changelogs")
    .select("*")
    .eq("published", true)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

app.post("/api/admin/changelog", requireAuth, requireAdmin, async (req, res) => {
  const { title, description, tag } = req.body as { title?: string; description?: string; tag?: string };
  if (!title?.trim() || !description?.trim()) {
    res.status(400).json({ error: "title dan description wajib diisi." }); return;
  }
  const validTags = ["new", "improvement", "fix", "removed"];
  const { data, error } = await supabaseAdmin
    .from("changelogs")
    .insert({ title: title.trim(), description: description.trim(), tag: validTags.includes(tag ?? "") ? tag : "new" })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.delete("/api/admin/changelog/:id", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin
    .from("changelogs")
    .delete()
    .eq("id", Number(req.params.id));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ─── Pricing config (harga + diskon, editable dari admin) ──────────────────────
type TierPricing = {
  price_idr: number;
  discount_percent: number;
  discount_label: string;
};
type PricingConfig = {
  plus: TierPricing;
  pro: TierPricing;
};

const DEFAULT_PRICING: PricingConfig = {
  plus: { price_idr: 10000, discount_percent: 0, discount_label: "" },
  pro:  { price_idr: 18000, discount_percent: 0, discount_label: "" },
};

const PRICING_CACHE_TTL_MS = 60_000;
let pricingCache: { value: PricingConfig; loadedAt: number } | null = null;

function sanitizeTierPricing(input: any, fallback: TierPricing): TierPricing {
  const price = Number(input?.price_idr);
  const discount = Number(input?.discount_percent);
  const label = typeof input?.discount_label === "string" ? input.discount_label : "";
  return {
    price_idr: Number.isFinite(price) && price >= 0 && price <= 10_000_000
      ? Math.round(price)
      : fallback.price_idr,
    discount_percent: Number.isFinite(discount) && discount >= 0 && discount <= 99
      ? Math.round(discount)
      : 0,
    discount_label: label.slice(0, 60),
  };
}

function sanitizePricingConfig(raw: any): PricingConfig {
  return {
    plus: sanitizeTierPricing(raw?.plus, DEFAULT_PRICING.plus),
    pro:  sanitizeTierPricing(raw?.pro,  DEFAULT_PRICING.pro),
  };
}

async function loadPricingConfig(force = false): Promise<PricingConfig> {
  if (!force && pricingCache && Date.now() - pricingCache.loadedAt < PRICING_CACHE_TTL_MS) {
    return pricingCache.value;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "pricing")
      .maybeSingle();
    if (error) throw error;
    const value = data?.value
      ? sanitizePricingConfig(data.value)
      : DEFAULT_PRICING;
    pricingCache = { value, loadedAt: Date.now() };
    return value;
  } catch {
    // Tabel belum di-migrate — fallback ke default biar app tetap jalan.
    pricingCache = { value: DEFAULT_PRICING, loadedAt: Date.now() };
    return DEFAULT_PRICING;
  }
}

// GET /api/pricing-config — public (dipakai pricing page tanpa login)
app.get("/api/pricing-config", async (_req, res) => {
  const config = await loadPricingConfig();
  res.json(config);
});

// PUT /api/admin/pricing-config — admin only
app.put("/api/admin/pricing-config", requireAuth, requireAdmin, async (req, res) => {
  const userId = (req as any).userId;
  const sanitized = sanitizePricingConfig(req.body);
  const { error } = await supabaseAdmin
    .from("app_config")
    .upsert(
      {
        key: "pricing",
        value: sanitized,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: "key" },
    );
  if (error) {
    res.status(500).json({
      error: error.message,
      hint: "Pastikan migration `app-config-migration.sql` udah dijalanin di Supabase.",
    });
    return;
  }
  pricingCache = null; // invalidate
  res.json({ ok: true, value: sanitized });
});

// ── GET /api/me/quota  (sisa token hari ini) ───────────────────────────────────
app.get("/api/me/quota", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const today = getTodayWIB();
  const [usageRes, profileRes] = await Promise.all([
    supabaseAdmin.from("daily_token_usage").select("total_tokens").eq("user_id", userId).eq("date", today).single(),
    supabaseAdmin.from("profiles").select("is_premium, premium_expires_at, role, tier").eq("id", userId).single(),
  ]);
  const used = usageRes.data?.total_tokens ?? 0;
  const isAdmin = profileRes.data?.role === "admin";
  const tier = getTier(profileRes.data ?? null);
  const isPremium = isAdmin || tier !== "free";
  const { tokenLimit: limit } = getTierLimits(tier, isAdmin);
  res.json({ used, limit, remaining: Math.max(0, limit - used), isPremium, tier });
});

// GET /api/me/usage-summary — ringkasan quota + status plus untuk halaman pengaturan
app.get("/api/me/usage-summary", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const today = getTodayWIB();
  const [usageRow, profileRow] = await Promise.all([
    supabaseAdmin.from("daily_token_usage").select("total_tokens").eq("user_id", userId).eq("date", today).single(),
    supabaseAdmin.from("profiles")
      .select("role, is_premium, premium_expires_at, tier, video_credits, video_credits_reset_date, image_gen_count, image_gen_reset_date, voice_credits, voice_credits_reset_date")
      .eq("id", userId).single(),
  ]);
  const profile = profileRow.data;
  const isAdmin = profile?.role === "admin";
  const tier = getTier(profile);
  const isPremium = isAdmin || tier !== "free";
  const { tokenLimit, imageLimit: imgLimit, videoMax } = getTierLimits(tier, isAdmin);

  const tokenUsed = usageRow.data?.total_tokens ?? 0;

  // Image quota
  const imgDate = profile?.image_gen_reset_date ?? "";
  const imgCount = imgDate === today ? (profile?.image_gen_count ?? 0) : 0;

  // Video credits (monthly) — video_credits nyimpen TERPAKAI, bukan sisa
  const thisMonth = getThisMonthWIB();
  const storedMonth = (profile?.video_credits_reset_date ?? "").slice(0, 7);
  const videoUsed = storedMonth === thisMonth ? (profile?.video_credits ?? 0) : 0;
  const videoCredits = Math.max(0, videoMax - videoUsed);

  // Voice credits (monthly) — voice_credits nyimpen TERPAKAI, bukan sisa
  const voiceMax = getTierLimits(tier, isAdmin).voiceMax;
  const storedVoiceMonth = (profile?.voice_credits_reset_date ?? "").slice(0, 7);
  const voiceUsed = storedVoiceMonth === thisMonth ? (profile?.voice_credits ?? 0) : 0;
  const voiceCredits = Math.max(0, voiceMax - voiceUsed);

  res.json({
    isPremium,
    isAdmin,
    tier,
    premiumExpiresAt: profile?.premium_expires_at ?? null,
    token: { used: tokenUsed, limit: tokenLimit },
    image: { used: imgCount, limit: imgLimit },
    video: { credits: videoCredits, max: videoMax },
    voice: { credits: voiceCredits, max: voiceMax },
  });
});

app.get("/api/me/whats-new-last-seen", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("whats_new_last_seen")
    .eq("id", userId)
    .single();
  res.json({ lastSeen: data?.whats_new_last_seen ?? null });
});

app.put("/api/me/whats-new-last-seen", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("profiles")
    .update({ whats_new_last_seen: now })
    .eq("id", userId);
  res.json({ lastSeen: now });
});

// ── Video Credits API (reset BULANAN, tier-aware) ──────────────────────────────
// CATATAN: video_credits menyimpan jumlah TERPAKAI (bukan sisa) bulan ini.
// Sisa = maxCredits - video_credits.
async function getVideoCredits(userId: string): Promise<{ credits: number; maxCredits: number }> {
  const thisMonth = getThisMonthWIB();
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("video_credits, video_credits_reset_date, role, is_premium, premium_expires_at, tier")
    .eq("id", userId)
    .single();

  if (!profile) return { credits: 0, maxCredits: FREE_VIDEO_CREDITS };

  if (profile.role === "admin") return { credits: 999, maxCredits: 999 };

  const tier = getTier(profile);
  const { videoMax: maxCredits } = getTierLimits(tier, false);

  const storedMonth = (profile.video_credits_reset_date ?? "").slice(0, 7);
  if (storedMonth !== thisMonth) {
    // Bulan baru — reset used ke 0
    await supabaseAdmin
      .from("profiles")
      .update({ video_credits: 0, video_credits_reset_date: thisMonth })
      .eq("id", userId);
    return { credits: maxCredits, maxCredits };
  }

  const used = profile.video_credits ?? 0;
  return { credits: Math.max(0, maxCredits - used), maxCredits };
}

async function deductVideoCredit(userId: string): Promise<boolean> {
  const thisMonth = getThisMonthWIB();

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role, is_premium, premium_expires_at, tier, video_credits, video_credits_reset_date")
    .eq("id", userId)
    .single();

  if (!profile) return false;
  if (profile.role === "admin") return true;

  const tier = getTier(profile);
  const { videoMax: maxCredits } = getTierLimits(tier, false);

  const storedMonth = (profile.video_credits_reset_date ?? "").slice(0, 7);
  const used = storedMonth === thisMonth ? (profile.video_credits ?? 0) : 0;

  if (used >= maxCredits) return false; // kredit habis

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ video_credits: used + 1, video_credits_reset_date: thisMonth })
    .eq("id", userId);

  if (error) return false;
  return true;
}

// ── Image Generation Quota API (reset HARIAN, tier-aware) ──────────────────────
async function getImageGenQuota(userId: string): Promise<{ count: number; limit: number; remaining: number }> {
  const today = getTodayWIB();
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("image_gen_count, image_gen_reset_date, role, is_premium, premium_expires_at, tier")
    .eq("id", userId)
    .single();

  if (!profile) return { count: 0, limit: FREE_IMAGE_LIMIT, remaining: FREE_IMAGE_LIMIT };
  if (profile.role === "admin") return { count: 0, limit: 9999, remaining: 9999 };

  const tier = getTier(profile);
  const { imageLimit: limit } = getTierLimits(tier, false);

  if ((profile.image_gen_reset_date ?? "") !== today) {
    await supabaseAdmin
      .from("profiles")
      .update({ image_gen_count: 0, image_gen_reset_date: today })
      .eq("id", userId);
    return { count: 0, limit, remaining: limit };
  }

  const count = profile.image_gen_count ?? 0;
  return { count, limit, remaining: Math.max(0, limit - count) };
}

async function deductImageGen(userId: string): Promise<boolean> {
  const today = getTodayWIB();
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role, is_premium, premium_expires_at, tier, image_gen_count, image_gen_reset_date")
    .eq("id", userId)
    .single();

  if (!profile) return false;
  if (profile.role === "admin") return true;

  const tier = getTier(profile);
  const { imageLimit: limit } = getTierLimits(tier, false);

  let currentCount = profile.image_gen_count ?? 0;
  if ((profile.image_gen_reset_date ?? "") !== today) {
    currentCount = 0;
  }

  if (currentCount >= limit) return false;

  await supabaseAdmin
    .from("profiles")
    .update({ image_gen_count: currentCount + 1, image_gen_reset_date: today })
    .eq("id", userId);

  return true;
}

app.get("/api/video-credits", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const result = await getVideoCredits(userId);
  res.json(result);
});

app.post("/api/video-credits/deduct", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const ok = await deductVideoCredit(userId);
  if (!ok) {
    const quota = await getVideoCredits(userId);
    res.status(429).json({ error: `Kredit video bulan ini sudah habis (${quota.maxCredits} kredit). Coba lagi bulan depan!` });
    return;
  }
  const result = await getVideoCredits(userId);
  res.json(result);
});

// ── Image Gen Quota endpoints ───────────────────────────────────────────────────
app.get("/api/image-gen-quota", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const result = await getImageGenQuota(userId);
  res.json(result);
});

// ── Video Jobs API (Pio Studio) ────────────────────────────────────────────────
app.get("/api/video-jobs", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data, error } = await supabaseAdmin
    .from("video_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data || []);
});

app.post("/api/video-jobs", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { task_id, prompt, model, mode, status, image_url } = req.body;
  const { data, error } = await supabaseAdmin
    .from("video_jobs")
    .insert({ user_id: userId, task_id, prompt, model, mode, status: status || "pending", image_url })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.patch("/api/video-jobs/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { id } = req.params;
  const updates: Record<string, any> = {};
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.video_url !== undefined) {
    const sourceUrl: string = req.body.video_url;
    if (sourceUrl) {
      // Upload to permanent Supabase Storage (fall back to original if upload fails)
      const permanentUrl = await uploadUrlToStorage(
        sourceUrl,
        STUDIO_VIDEOS_BUCKET,
        `${userId}/${id}.mp4`,
        "video/mp4",
      );
      updates.video_url = permanentUrl ?? sourceUrl;
    } else {
      updates.video_url = sourceUrl;
    }
  }
  if (req.body.error !== undefined) updates.error = req.body.error;
  const { data, error } = await supabaseAdmin
    .from("video_jobs")
    .update(updates)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.delete("/api/video-jobs/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { id } = req.params;
  const { error } = await supabaseAdmin.from("video_jobs").delete().eq("id", id).eq("user_id", userId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

app.delete("/api/video-jobs", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { error } = await supabaseAdmin.from("video_jobs").delete().eq("user_id", userId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ── Image Jobs API (Image Studio → Galeri Studio) ──────────────────────────────
app.get("/api/image-jobs", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const { data, error } = await supabaseAdmin
    .from("image_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data || []);
});

app.post("/api/image-jobs", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { prompt, model, size, image_url } = req.body;
  if (!image_url) { res.status(400).json({ error: "image_url required" }); return; }
  // Upload to permanent Supabase Storage (fall back to original if upload fails)
  const jobId = crypto.randomUUID();
  const permanentUrl = await uploadUrlToStorage(
    image_url,
    STUDIO_IMAGES_BUCKET,
    `${userId}/${jobId}.png`,
    "image/png",
  );
  const { data, error } = await supabaseAdmin
    .from("image_jobs")
    .insert({ id: jobId, user_id: userId, prompt: prompt || "", model: model || "", size: size || "", image_url: permanentUrl ?? image_url })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.delete("/api/image-jobs/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { id } = req.params;
  const { error } = await supabaseAdmin.from("image_jobs").delete().eq("id", id).eq("user_id", userId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

app.delete("/api/image-jobs", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { error } = await supabaseAdmin.from("image_jobs").delete().eq("user_id", userId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Voice Studio (Qwen TTS / Voice Cloning / Voice Design via DashScope)
// ═══════════════════════════════════════════════════════════════════════════════
// Konsep:
// - Pake Qwen3-TTS family (qwen3-tts-flash, qwen3-tts-instruct-flash, cosyvoice-v3-flash, cosyvoice-v3-plus).
// - Voice clone pake `voice-enrollment` (upload sample → dapet voice_id) + `qwen3-tts-vc` (generate dengan voice_id).
// - Voice design pake `qwen-voice-design` (prompt teks → dapet voice_id) + `qwen3-tts-vd` (generate dengan voice_id).
// - Credit per generate: 1 TTS = 1, 1 clone = 5, 1 design = 10.
// - Tier limits: Free 10/bln, Plus 60/bln, Pro 200/bln (lihat FREE/PLUS/PRO_VOICE_CREDITS).
// - Hasil audio TIDAK disimpan ke DB (Galeri Studio masih coming-soon). User tinggal download/share.
// - Voice IDs (clone & design) DISIMPAN di tabel `user_voices` supaya reusable.

// Multer instance khusus untuk upload audio sample voice cloning (max 10 MB)
const voiceCloneUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Voice presets — Azure (id-ID neural, BEST untuk Bahasa Indonesia) + Qwen3-TTS (multilingual)
const VOICE_STUDIO_PRESETS: Array<{
  id: string;
  name: string;
  lang: string;
  gender: string;
  provider: "azure" | "dashscope";
}> = [
  // Azure Neural — kualitas terbaik untuk Bahasa Indonesia
  { id: "azure:id-ID-GadisNeural", name: "Gadis (Wanita, Indonesia)", lang: "id-ID", gender: "female", provider: "azure" },
  { id: "azure:id-ID-ArdiNeural",  name: "Ardi (Pria, Indonesia)",    lang: "id-ID", gender: "male",   provider: "azure" },
  // Azure English (kualitas premium)
  { id: "azure:en-US-AvaNeural",      name: "Ava (Wanita, US English)",    lang: "en-US", gender: "female", provider: "azure" },
  { id: "azure:en-US-AndrewNeural",   name: "Andrew (Pria, US English)",   lang: "en-US", gender: "male",   provider: "azure" },
  { id: "azure:en-US-EmmaNeural",     name: "Emma (Wanita, US English)",   lang: "en-US", gender: "female", provider: "azure" },
  { id: "azure:ja-JP-NanamiNeural",   name: "Nanami (Wanita, Jepang)",     lang: "ja-JP", gender: "female", provider: "azure" },
  // Qwen3-TTS (multilingual, untuk style unik atau bahasa lain)
  { id: "Cherry",  name: "Cherry (Wanita, hangat)",     lang: "multi", gender: "female", provider: "dashscope" },
  { id: "Ethan",   name: "Ethan (Pria, dewasa)",        lang: "multi", gender: "male",   provider: "dashscope" },
  { id: "Chelsie", name: "Chelsie (Wanita, ceria)",     lang: "multi", gender: "female", provider: "dashscope" },
  { id: "Serena",  name: "Serena (Wanita, kalem)",      lang: "multi", gender: "female", provider: "dashscope" },
  { id: "Dylan",   name: "Dylan (Pria, ramah)",         lang: "multi", gender: "male",   provider: "dashscope" },
  { id: "Jada",    name: "Jada (Wanita, tegas)",        lang: "multi", gender: "female", provider: "dashscope" },
];

// Helper: panggil Azure Speech TTS (reuse infra Azure yang sudah ada untuk voice mode chat)
async function callAzureTTS(payload: {
  text: string;
  voiceName: string;  // contoh "id-ID-GadisNeural"
}): Promise<{ ok: true; audioBuffer: Buffer; mime: string } | { ok: false; status: number; error: string }> {
  const azureKey = process.env.AZURE_SPEECH_KEY ?? "";
  const azureRegion = process.env.AZURE_SPEECH_REGION ?? "southeastasia";
  if (!azureKey) {
    return { ok: false, status: 503, error: "Azure Speech belum dikonfigurasi (AZURE_SPEECH_KEY missing)" };
  }
  const lang = payload.voiceName.split("-").slice(0, 2).join("-");
  const escaped = payload.text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const ssml = `<speak version="1.0" xml:lang="${lang}"><voice name="${payload.voiceName}"><prosody rate="0%">${escaped}</prosody></voice></speak>`;
  const url = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "PioCode-VoiceStudio",
      },
      body: ssml,
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[voice-studio][Azure TTS] HTTP", upstream.status, errText.slice(0, 300));
      return { ok: false, status: upstream.status, error: errText.slice(0, 300) || `Azure HTTP ${upstream.status}` };
    }
    const audioBuffer = Buffer.from(await upstream.arrayBuffer());
    return { ok: true, audioBuffer, mime: "audio/mpeg" };
  } catch (err: any) {
    console.error("[voice-studio][Azure TTS] error:", err?.message);
    return { ok: false, status: 502, error: `Network error ke Azure: ${err?.message || err}` };
  }
}

// ── Voice credits helpers (reset BULANAN, mirror video_credits) ────────────────
// voice_credits MENYIMPAN JUMLAH TERPAKAI bulan ini (BUKAN sisa).
async function getVoiceCredits(userId: string): Promise<{ credits: number; maxCredits: number }> {
  const thisMonth = getThisMonthWIB();
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("voice_credits, voice_credits_reset_date, role, is_premium, premium_expires_at, tier")
    .eq("id", userId)
    .single();

  if (!profile) return { credits: 0, maxCredits: FREE_VOICE_CREDITS };
  if (profile.role === "admin") return { credits: 9999, maxCredits: 9999 };

  const tier = getTier(profile);
  const { voiceMax: maxCredits } = getTierLimits(tier, false);

  const storedMonth = (profile.voice_credits_reset_date ?? "").slice(0, 7);
  if (storedMonth !== thisMonth) {
    await supabaseAdmin
      .from("profiles")
      .update({ voice_credits: 0, voice_credits_reset_date: `${thisMonth}-01` })
      .eq("id", userId);
    return { credits: maxCredits, maxCredits };
  }

  const used = profile.voice_credits ?? 0;
  return { credits: Math.max(0, maxCredits - used), maxCredits };
}

async function deductVoiceCredits(userId: string, cost: number): Promise<{ ok: boolean; error?: string }> {
  if (cost <= 0) return { ok: true };
  const thisMonth = getThisMonthWIB();
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role, is_premium, premium_expires_at, tier, voice_credits, voice_credits_reset_date")
    .eq("id", userId)
    .single();

  if (!profile) return { ok: false, error: "Profile tidak ditemukan" };
  if (profile.role === "admin") return { ok: true };

  const tier = getTier(profile);
  const { voiceMax: maxCredits } = getTierLimits(tier, false);

  const storedMonth = (profile.voice_credits_reset_date ?? "").slice(0, 7);
  const used = storedMonth === thisMonth ? (profile.voice_credits ?? 0) : 0;

  if (used + cost > maxCredits) {
    return { ok: false, error: `Kredit Voice Studio bulan ini gak cukup (butuh ${cost}, sisa ${Math.max(0, maxCredits - used)} dari ${maxCredits}).` };
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ voice_credits: used + cost, voice_credits_reset_date: `${thisMonth}-01` })
    .eq("id", userId);

  if (error) {
    console.error("[deductVoiceCredits] update failed:", error);
    return { ok: false, error: "Gagal update kredit." };
  }
  return { ok: true };
}

// ── DashScope helper: panggil TTS sync API ────────────────────────────────────
// Endpoint: /api/v1/services/aigc/multimodal-generation/generation
// Response shape: { output: { audio: { url } } } atau { output: { audio: { data } } } (base64)
async function callDashscopeTTS(payload: {
  model: string;
  text: string;
  voice: string;
  language?: string;
  instruction?: string;
}): Promise<{ ok: true; audioBuffer: Buffer; mime: string } | { ok: false; status: number; error: string }> {
  // Qwen3-TTS family: language_type & instruct ada di INPUT (bukan parameters).
  // Ref: https://help.aliyun.com/zh/model-studio/qwen-tts (REST sync)
  const body: any = {
    model: payload.model,
    input: {
      text: payload.text,
      voice: payload.voice,
      language_type: payload.language || "Auto",
    },
  };
  if (payload.instruction) {
    body.input.instruct = payload.instruction;
  }

  const url = `${DASHSCOPE_BASE}/api/v1/services/aigc/multimodal-generation/generation`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dashscopeApiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "disable",
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    console.error("[voice-studio][TTS] fetch error:", err?.message);
    return { ok: false, status: 502, error: `Network error ke DashScope: ${err?.message || err}` };
  }

  const txt = await upstream.text();
  if (!upstream.ok) {
    console.error("[voice-studio][TTS] HTTP", upstream.status, "body:", txt.slice(0, 500));
    // Coba parse JSON error message biar lebih jelas
    let cleanMsg = txt.slice(0, 300);
    try {
      const errJson = JSON.parse(txt);
      cleanMsg = errJson?.message || errJson?.error?.message || errJson?.code || cleanMsg;
    } catch {}
    return { ok: false, status: upstream.status, error: cleanMsg };
  }

  let json: any;
  try { json = JSON.parse(txt); } catch {
    console.error("[voice-studio][TTS] invalid JSON:", txt.slice(0, 300));
    return { ok: false, status: 502, error: "Invalid JSON dari DashScope" };
  }

  // Audio bisa di output.audio.url (download), output.audio.data (base64), atau output.audio.audio (qwen3-tts pake key 'audio')
  const audio = json?.output?.audio;
  if (!audio) {
    console.error("[voice-studio][TTS] no audio in response:", JSON.stringify(json).slice(0, 500));
    const apiMsg = json?.message || json?.code;
    return { ok: false, status: 502, error: apiMsg ? `DashScope: ${apiMsg}` : "Audio kosong di response (kemungkinan model gak support sync mode)" };
  }

  let audioBuffer: Buffer;
  let mime = "audio/mpeg";
  // Beberapa varian: audio.url, audio.data (base64), audio.audio (string base64 di qwen3-tts)
  const url2 = audio.url;
  const b64 = audio.data || audio.audio;
  if (url2) {
    try {
      const dl = await fetch(url2);
      if (!dl.ok) return { ok: false, status: 502, error: `Gagal download audio dari URL (HTTP ${dl.status})` };
      audioBuffer = Buffer.from(await dl.arrayBuffer());
      const ct = dl.headers.get("content-type") || "";
      if (ct.includes("wav")) mime = "audio/wav";
      else if (ct.includes("mp3") || ct.includes("mpeg")) mime = "audio/mpeg";
    } catch (err: any) {
      return { ok: false, status: 502, error: `Network error download audio: ${err?.message || err}` };
    }
  } else if (b64) {
    try {
      audioBuffer = Buffer.from(b64, "base64");
    } catch {
      return { ok: false, status: 502, error: "Format audio base64 invalid" };
    }
  } else {
    console.error("[voice-studio][TTS] unknown audio shape:", JSON.stringify(audio).slice(0, 300));
    return { ok: false, status: 502, error: "Format audio tidak dikenal di response" };
  }

  return { ok: true, audioBuffer, mime };
}

// ── Voice Studio: TTS history helpers ─────────────────────────────────────────
// Bucket dibuat lewat scripts/run-tts-history-migration.ts.
// Tabel public.tts_history harus dibuat lewat SQL editor (file: tts-history-migration.sql).
const TTS_BUCKET = "voice-studio-tts";
const TTS_HISTORY_MAX_PER_USER = 30; // auto-prune entry paling lama lebih dari 30

async function saveTtsHistory(params: {
  userId: string;
  text: string;
  voiceKey: string;
  voiceLabel: string | null;
  language: string;
  model: string;
  instruction?: string;
  audioBuffer: Buffer;
  mime: string;
}): Promise<{ id: string; storagePath: string } | null> {
  try {
    const id = crypto.randomUUID();
    const ext = params.mime.includes("wav") ? "wav" : "mp3";
    const storagePath = `${params.userId}/${id}.${ext}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(TTS_BUCKET)
      .upload(storagePath, params.audioBuffer, {
        contentType: params.mime,
        upsert: false,
      });
    if (upErr) {
      console.error("[tts-history] storage upload failed:", upErr.message);
      return null;
    }

    const { error: insErr } = await supabaseAdmin.from("tts_history").insert({
      id,
      user_id: params.userId,
      text: params.text.slice(0, 2000),
      voice_key: params.voiceKey,
      voice_label: params.voiceLabel,
      language: params.language,
      model: params.model,
      instruction: params.instruction || null,
      storage_path: storagePath,
      mime: params.mime,
      size_bytes: params.audioBuffer.length,
    });
    if (insErr) {
      console.error("[tts-history] db insert failed:", insErr.message);
      // Bersihin file kalau insert gagal supaya gak ada storage orphan.
      await supabaseAdmin.storage.from(TTS_BUCKET).remove([storagePath]);
      return null;
    }

    // Auto-prune: hapus entry paling lama kalau total > MAX_PER_USER.
    pruneTtsHistory(params.userId).catch(() => {
      /* best-effort */
    });

    return { id, storagePath };
  } catch (err: any) {
    console.error("[tts-history] unexpected:", err?.message || err);
    return null;
  }
}

async function pruneTtsHistory(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("tts_history")
    .select("id, storage_path")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !data) return;
  if (data.length <= TTS_HISTORY_MAX_PER_USER) return;
  const toDelete = data.slice(TTS_HISTORY_MAX_PER_USER);
  const ids = toDelete.map((r) => r.id);
  const paths = toDelete.map((r) => r.storage_path).filter(Boolean);
  if (paths.length) {
    await supabaseAdmin.storage.from(TTS_BUCKET).remove(paths);
  }
  if (ids.length) {
    await supabaseAdmin.from("tts_history").delete().in("id", ids);
  }
}

function presetLabel(voiceKey: string): string | null {
  if (!voiceKey.startsWith("preset:")) return null;
  const id = voiceKey.slice(7);
  const found = VOICE_STUDIO_PRESETS.find((p) => p.id === id);
  return found ? found.name : id;
}

// ── GET /api/voice-studio/quota — kredit + max ────────────────────────────────
app.get("/api/voice-studio/quota", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const result = await getVoiceCredits(userId);
  res.json({
    ...result,
    costs: { tts: VOICE_COST_TTS, clone: VOICE_COST_CLONE, design: VOICE_COST_DESIGN },
  });
});

// ── GET /api/voice-studio/voices — list preset + user voices ───────────────────
app.get("/api/voice-studio/voices", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data, error } = await supabaseAdmin
    .from("user_voices")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({
    presets: VOICE_STUDIO_PRESETS,
    custom: data || [],
  });
});

// ── DELETE /api/voice-studio/voices/:id — hapus voice user ────────────────────
app.delete("/api/voice-studio/voices/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { id } = req.params;
  const { error } = await supabaseAdmin
    .from("user_voices")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ── POST /api/voice-studio/tts — generate audio dari teks ─────────────────────
// Body: { text, model?, voice?, language?, instruction? }
// Response: audio binary (audio/mpeg atau audio/wav)
app.post("/api/voice-studio/tts", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const text = String(req.body?.text || "").trim();
  if (!text) { res.status(400).json({ error: "Text kosong" }); return; }
  if (text.length > 2000) { res.status(400).json({ error: "Text terlalu panjang (max 2000 karakter)" }); return; }

  const model = String(req.body?.model || "qwen3-tts-flash");
  const voice = String(req.body?.voice || "azure:id-ID-GadisNeural");
  const language = String(req.body?.language || "Auto");
  const instruction = req.body?.instruction ? String(req.body.instruction).slice(0, 200) : undefined;

  // Cek dulu apakah masih ada kredit
  const quota = await getVoiceCredits(userId);
  if (quota.credits < VOICE_COST_TTS) {
    res.status(429).json({ error: `Kredit Voice Studio habis (${quota.maxCredits}/bulan). Coba lagi bulan depan!` });
    return;
  }

  // Routing: prefix "azure:" → Azure Speech Neural; selain itu → DashScope/Qwen3-TTS
  const result = voice.startsWith("azure:")
    ? await callAzureTTS({ text, voiceName: voice.slice(6) })
    : await callDashscopeTTS({ model, text, voice, language, instruction });

  if (!result.ok) {
    res.status(result.status).json({ error: "TTS gagal", detail: result.error });
    return;
  }

  // Deduct setelah sukses
  await deductVoiceCredits(userId, VOICE_COST_TTS);

  // Simpan ke history (best-effort; kalau gagal, audio tetap dikirim ke user).
  const saved = await saveTtsHistory({
    userId,
    text,
    voiceKey: `preset:${voice}`,
    voiceLabel: presetLabel(`preset:${voice}`),
    language,
    model,
    instruction,
    audioBuffer: result.audioBuffer,
    mime: result.mime,
  });

  res.setHeader("Content-Type", result.mime);
  res.setHeader("Cache-Control", "no-cache");
  if (saved) {
    res.setHeader("X-Tts-History-Id", saved.id);
    res.setHeader("Access-Control-Expose-Headers", "X-Tts-History-Id");
  }
  res.send(result.audioBuffer);
});

// ── POST /api/voice-studio/clone — voice cloning dari sample audio ────────────
// Multipart: { audio: File, name: string, language?: string }
// Pake voice-enrollment API → dapet voice_id → simpan di user_voices
app.post("/api/voice-studio/clone", requireAuth, voiceCloneUpload.single("audio"), async (req, res) => {
  const userId = (req as any).userId;
  const file = (req as any).file as Express.Multer.File | undefined;
  const name = String(req.body?.name || "").trim() || `Clone ${new Date().toLocaleDateString("id-ID")}`;
  const language = String(req.body?.language || "id");

  if (!file || !file.buffer?.length) {
    res.status(400).json({ error: "Audio sample tidak ditemukan (field 'audio')" });
    return;
  }
  if (file.buffer.length < 10_000) {
    res.status(400).json({ error: "Audio sample terlalu pendek (minimal ~10 detik)" });
    return;
  }

  const quota = await getVoiceCredits(userId);
  if (quota.credits < VOICE_COST_CLONE) {
    res.status(429).json({ error: `Butuh ${VOICE_COST_CLONE} kredit, sisa ${quota.credits}. Tunggu bulan depan atau upgrade tier.` });
    return;
  }

  // DashScope voice-enrollment endpoint:
  // POST https://dashscope-intl.aliyuncs.com/api/v1/services/audio/tts/customization/voice-enrollment
  // Multipart: model, prefix, audio (binary)
  try {
    const formData = new FormData();
    formData.append("model", "voice-enrollment");
    formData.append("target_model", "qwen3-tts-vc");
    formData.append("prefix", `pio_${userId.slice(0, 8)}`);
    const audioBlob = new Blob([file.buffer], { type: file.mimetype || "audio/wav" });
    formData.append("audio", audioBlob, file.originalname || "sample.wav");

    const enrollUrl = `${DASHSCOPE_BASE}/api/v1/services/audio/tts/customization/voice-enrollment`;
    const upstream = await fetch(enrollUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${dashscopeApiKey}` },
      body: formData,
    });

    const txt = await upstream.text();
    if (!upstream.ok) {
      console.error("[Voice Clone] DashScope error:", upstream.status, txt.slice(0, 300));
      res.status(upstream.status).json({ error: "Voice enrollment gagal", detail: txt.slice(0, 300) });
      return;
    }

    let json: any;
    try { json = JSON.parse(txt); } catch { res.status(502).json({ error: "Response invalid" }); return; }
    const voiceId = json?.output?.voice_id || json?.voice_id;
    if (!voiceId) {
      res.status(502).json({ error: "voice_id tidak ditemukan di response", detail: JSON.stringify(json).slice(0, 200) });
      return;
    }

    // Simpan ke DB
    const { data: row, error: insertErr } = await supabaseAdmin
      .from("user_voices")
      .insert({
        user_id: userId,
        name,
        type: "clone",
        dashscope_voice_id: voiceId,
        source_text: file.originalname || "audio sample",
        language,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("[Voice Clone] DB insert error:", insertErr);
      res.status(500).json({ error: "Gagal simpan voice ke database" });
      return;
    }

    await deductVoiceCredits(userId, VOICE_COST_CLONE);
    res.json({ ok: true, voice: row, remaining: (quota.credits - VOICE_COST_CLONE) });
  } catch (err: any) {
    console.error("[Voice Clone] Error:", err);
    res.status(500).json({ error: "Voice cloning gagal", detail: err?.message });
  }
});

// ── POST /api/voice-studio/design — voice design dari prompt ──────────────────
// Body: { prompt, name, language? }
app.post("/api/voice-studio/design", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const prompt = String(req.body?.prompt || "").trim();
  const name = String(req.body?.name || "").trim() || `Design ${new Date().toLocaleDateString("id-ID")}`;
  const language = String(req.body?.language || "id");

  if (!prompt) { res.status(400).json({ error: "Prompt deskripsi suara kosong" }); return; }
  if (prompt.length > 500) { res.status(400).json({ error: "Prompt terlalu panjang (max 500 karakter)" }); return; }

  const quota = await getVoiceCredits(userId);
  if (quota.credits < VOICE_COST_DESIGN) {
    res.status(429).json({ error: `Butuh ${VOICE_COST_DESIGN} kredit, sisa ${quota.credits}. Tunggu bulan depan atau upgrade tier.` });
    return;
  }

  // DashScope qwen-voice-design endpoint
  try {
    const designUrl = `${DASHSCOPE_BASE}/api/v1/services/audio/tts/customization/voice-design`;
    const upstream = await fetch(designUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dashscopeApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-voice-design",
        input: { prompt },
        parameters: { target_model: "qwen3-tts-vd" },
      }),
    });

    const txt = await upstream.text();
    if (!upstream.ok) {
      console.error("[Voice Design] DashScope error:", upstream.status, txt.slice(0, 300));
      res.status(upstream.status).json({ error: "Voice design gagal", detail: txt.slice(0, 300) });
      return;
    }

    let json: any;
    try { json = JSON.parse(txt); } catch { res.status(502).json({ error: "Response invalid" }); return; }
    const voiceId = json?.output?.voice_id || json?.voice_id;
    if (!voiceId) {
      res.status(502).json({ error: "voice_id tidak ditemukan di response", detail: JSON.stringify(json).slice(0, 200) });
      return;
    }

    const { data: row, error: insertErr } = await supabaseAdmin
      .from("user_voices")
      .insert({
        user_id: userId,
        name,
        type: "design",
        dashscope_voice_id: voiceId,
        source_text: prompt,
        language,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("[Voice Design] DB insert error:", insertErr);
      res.status(500).json({ error: "Gagal simpan voice ke database" });
      return;
    }

    await deductVoiceCredits(userId, VOICE_COST_DESIGN);
    res.json({ ok: true, voice: row, remaining: (quota.credits - VOICE_COST_DESIGN) });
  } catch (err: any) {
    console.error("[Voice Design] Error:", err);
    res.status(500).json({ error: "Voice design gagal", detail: err?.message });
  }
});

// ── POST /api/voice-studio/tts-custom — TTS pake custom voice (clone/design) ──
// Body: { text, voice_db_id } (voice_db_id = id row di user_voices)
app.post("/api/voice-studio/tts-custom", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const text = String(req.body?.text || "").trim();
  const voiceDbId = String(req.body?.voice_db_id || "").trim();
  const language = String(req.body?.language || "Indonesian");

  if (!text) { res.status(400).json({ error: "Text kosong" }); return; }
  if (!voiceDbId) { res.status(400).json({ error: "voice_db_id wajib" }); return; }
  if (text.length > 2000) { res.status(400).json({ error: "Text terlalu panjang (max 2000 karakter)" }); return; }

  const { data: voiceRow, error: voiceErr } = await supabaseAdmin
    .from("user_voices")
    .select("*")
    .eq("id", voiceDbId)
    .eq("user_id", userId)
    .single();
  if (voiceErr || !voiceRow) { res.status(404).json({ error: "Voice tidak ditemukan" }); return; }

  const quota = await getVoiceCredits(userId);
  if (quota.credits < VOICE_COST_TTS) {
    res.status(429).json({ error: `Kredit habis. Tunggu bulan depan!` });
    return;
  }

  const ttsModel = voiceRow.type === "clone" ? "qwen3-tts-vc" : "qwen3-tts-vd";
  const result = await callDashscopeTTS({
    model: ttsModel,
    text,
    voice: voiceRow.dashscope_voice_id,
    language,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: "TTS gagal", detail: result.error });
    return;
  }

  await deductVoiceCredits(userId, VOICE_COST_TTS);

  const saved = await saveTtsHistory({
    userId,
    text,
    voiceKey: `custom:${voiceDbId}`,
    voiceLabel: voiceRow.name || null,
    language,
    model: ttsModel,
    audioBuffer: result.audioBuffer,
    mime: result.mime,
  });

  res.setHeader("Content-Type", result.mime);
  res.setHeader("Cache-Control", "no-cache");
  if (saved) {
    res.setHeader("X-Tts-History-Id", saved.id);
    res.setHeader("Access-Control-Expose-Headers", "X-Tts-History-Id");
  }
  res.send(result.audioBuffer);
});

// ── GET /api/voice-studio/history — list TTS history user (signed URLs) ───────
app.get("/api/voice-studio/history", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

  const { data, error } = await supabaseAdmin
    .from("tts_history")
    .select(
      "id, text, voice_key, voice_label, language, model, instruction, storage_path, mime, size_bytes, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // Bikin signed URL (expire 1 jam) buat tiap entry.
  const items = await Promise.all(
    (data || []).map(async (row) => {
      const { data: signed } = await supabaseAdmin.storage
        .from(TTS_BUCKET)
        .createSignedUrl(row.storage_path, 3600);
      return {
        id: row.id,
        text: row.text,
        voiceKey: row.voice_key,
        voiceLabel: row.voice_label,
        language: row.language,
        model: row.model,
        instruction: row.instruction,
        mime: row.mime,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        audioUrl: signed?.signedUrl || null,
      };
    }),
  );

  res.json({ items });
});

// ── DELETE /api/voice-studio/history/:id — hapus 1 entry history ──────────────
app.delete("/api/voice-studio/history/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { id } = req.params;

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("tts_history")
    .select("storage_path")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message });
    return;
  }
  if (!row) {
    res.status(404).json({ error: "Entry tidak ditemukan" });
    return;
  }

  if (row.storage_path) {
    await supabaseAdmin.storage.from(TTS_BUCKET).remove([row.storage_path]);
  }
  const { error: delErr } = await supabaseAdmin
    .from("tts_history")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (delErr) {
    res.status(500).json({ error: delErr.message });
    return;
  }
  res.json({ ok: true });
});

// ── Premium Applications ───────────────────────────────────────────────────────

// GET /api/premium/status — info tier user sendiri
app.get("/api/premium/status", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("is_premium, premium_expires_at, role, tier, trial_claimed_at")
    .eq("id", userId)
    .single();
  const isAdmin = profile?.role === "admin";
  const tier = getTier(profile);
  res.json({
    isPremium: isAdmin || tier !== "free",
    isAdmin,
    tier,
    premiumExpiresAt: profile?.premium_expires_at ?? null,
    trialClaimedAt: (profile as any)?.trial_claimed_at ?? null,
    trialAvailable: !isAdmin && !(profile as any)?.trial_claimed_at && tier === "free",
  });
});

// POST /api/premium/claim-trial — klaim uji coba Plus 1 bulan (sekali per akun)
app.post("/api/premium/claim-trial", requireAuth, async (req, res) => {
  const userId = (req as any).userId;

  // 1. Cek email_confirmed_at di Supabase Auth (anti farming pakai email random)
  const { data: { user: authUser }, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authErr || !authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!authUser.email_confirmed_at) {
    res.status(403).json({
      error: "email_not_verified",
      message: "Verifikasi email kamu dulu sebelum klaim uji coba.",
    });
    return;
  }

  // 2. Ambil profile + cek sudah pernah klaim atau belum
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("is_premium, premium_expires_at, role, tier, trial_claimed_at")
    .eq("id", userId)
    .single();
  if (profileErr || !profile) {
    res.status(500).json({ error: "Profile tidak ditemukan." });
    return;
  }

  const isAdmin = (profile as any).role === "admin";
  if (isAdmin) {
    res.status(409).json({
      error: "admin_bypass",
      message: "Admin tidak perlu klaim uji coba.",
    });
    return;
  }

  if ((profile as any).trial_claimed_at) {
    res.status(409).json({
      error: "trial_already_claimed",
      message: "Uji coba gratis cuma bisa diklaim sekali per akun.",
    });
    return;
  }

  const currentTier = getTier(profile);
  if (currentTier !== "free") {
    res.status(409).json({
      error: "already_premium",
      message: "Kamu sudah punya paket aktif. Uji coba cuma untuk user Free.",
    });
    return;
  }

  // 3. Set tier ke Plus + premium_expires_at = NOW + 30 hari + tandain trial_claimed_at
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + PLUS_TRIAL_DURATION_DAYS);

  const { error: updErr } = await supabaseAdmin
    .from("profiles")
    .update({
      is_premium: true,
      tier: "plus",
      premium_expires_at: expiresAt.toISOString(),
      trial_claimed_at: now.toISOString(),
    })
    .eq("id", userId);

  if (updErr) {
    res.status(500).json({ error: updErr.message });
    return;
  }

  // 4. Kasih bonus saldo Rp 75.000 via type 'bonus_plus_trial' (terpisah dari
  //    'bonus_plus_upgrade' supaya nanti user yg upgrade ke Plus berbayar TETEP
  //    dapet bonus 75k lagi). Trial cuma sekali per akun (di-enforce oleh kolom
  //    trial_claimed_at), jadi gak ada risiko dobel di sisi trial.
  let bonusGranted = false;
  try {
    await addCredit(userId, PLUS_TRIAL_BONUS_IDR, "bonus_plus_trial", { source: "claim_trial" });
    bonusGranted = true;
  } catch (e) {
    console.error("[claim-trial] bonus credit failed:", e);
  }

  res.json({
    ok: true,
    tier: "plus",
    premium_expires_at: expiresAt.toISOString(),
    trial_claimed_at: now.toISOString(),
    bonus_granted: bonusGranted,
    bonus_amount_idr: bonusGranted ? PLUS_TRIAL_BONUS_IDR : 0,
    duration_days: PLUS_TRIAL_DURATION_DAYS,
  });
});

// ── Endpoint flow "Apply Plus via IG screenshot" sudah DIHAPUS (event promo gratis selesai) ──
// Endpoint berikut dipertahankan TAPI sekarang return 410 Gone supaya client lama gak crash:
// - POST /api/premium/upload-screenshots
// - POST /api/premium/apply
// - GET /api/admin/premium-applications
// - PATCH /api/admin/premium-applications/:id/approve
// - PATCH /api/admin/premium-applications/:id/reject
const APPLY_GONE = (_req: any, res: any) => res.status(410).json({
  error: "Fitur klaim Plus via Instagram sudah berakhir. Silakan beli paket di /premium.",
});
app.post("/api/premium/upload-screenshots", requireAuth, APPLY_GONE);
app.post("/api/premium/apply", requireAuth, APPLY_GONE);
app.get("/api/admin/premium-applications", requireAuth, requireAdmin, APPLY_GONE);
app.patch("/api/admin/premium-applications/:id/approve", requireAuth, requireAdmin, APPLY_GONE);
app.patch("/api/admin/premium-applications/:id/reject", requireAuth, requireAdmin, APPLY_GONE);

// Multer instance untuk POST /v1/files (file upload generic, max 5MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// PATCH /api/admin/users/:id/premium — toggle premium langsung dari tab pengguna
// Body: { is_premium: boolean, tier?: 'plus'|'pro', days?: number }
app.patch("/api/admin/users/:id/premium", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  let body: any = {};
  try {
    const raw = req.body instanceof Buffer ? req.body.toString("utf8") : req.body;
    body = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { /**/ }
  const { is_premium, days } = body;
  const requestedTier: Tier = body?.tier === "pro" ? "pro" : "plus";

  let expiresAt: string | null = null;
  if (is_premium) {
    const d = new Date();
    if (typeof days === "number" && days > 0) {
      d.setDate(d.getDate() + days);
    } else {
      d.setMonth(d.getMonth() + 1); // default 1 bulan
    }
    expiresAt = d.toISOString();
  }

  // video_credits tidak perlu diubah saat toggle — getVideoCredits otomatis hitung sisa berdasar used count
  const updatePayload: any = {
    is_premium: !!is_premium,
    premium_expires_at: expiresAt,
    tier: is_premium ? requestedTier : "free",
  };
  const { error } = await supabaseAdmin.from("profiles").update(updatePayload).eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Saat admin toggle premium ON → coba grant bonus tier-aware (skip kalau user udah pernah dapat)
  let bonusGranted = false;
  let bonusAmount = 0;
  if (is_premium) {
    const result = await grantTierBonusOnce(id, requestedTier, { source: "admin_toggle_premium" });
    bonusGranted = result.granted;
    bonusAmount = result.amount;
  }

  res.json({ ok: true, bonus_granted: bonusGranted, bonus_amount_idr: bonusAmount, tier: updatePayload.tier });
});

// PATCH /api/admin/users/:id/credit — admin set/adjust saldo user
// Body: { mode: 'set' | 'add', amount_idr: number, note?: string }
//   - mode='set' → langsung override saldo ke amount_idr
//   - mode='add' → tambah/kurangi (negatif untuk kurangi)
// Setiap perubahan dicatat ke credit_transactions sebagai audit trail.
app.patch("/api/admin/users/:id/credit", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  let body: any = {};
  try {
    const raw = req.body instanceof Buffer ? req.body.toString("utf8") : req.body;
    body = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { /**/ }

  const mode = body?.mode === "set" ? "set" : "add";
  const amountIdr = Math.round(Number(body?.amount_idr ?? 0));
  const note = typeof body?.note === "string" ? body.note.slice(0, 200) : null;
  const adminId = (req as any).userId ?? null;

  if (!Number.isFinite(amountIdr)) {
    res.status(400).json({ error: "amount_idr harus angka valid." });
    return;
  }

  const current = await getCreditBalance(id);
  let next: number;
  let delta: number;
  if (mode === "set") {
    if (amountIdr < 0) {
      res.status(400).json({ error: "Saldo tidak boleh negatif." });
      return;
    }
    next = amountIdr;
    delta = next - current;
  } else {
    next = Math.max(0, current + amountIdr);
    delta = next - current;
  }

  if (delta === 0) {
    res.json({ ok: true, balance_idr: current, delta: 0 });
    return;
  }

  try {
    await supabaseAdmin.from("profiles").update({ credit_balance_idr: next }).eq("id", id);
    await supabaseAdmin.from("credit_transactions").insert({
      user_id: id,
      amount_idr: delta,
      type: delta >= 0 ? "admin_credit_add" : "admin_credit_deduct",
      metadata: { admin_id: adminId, mode, note, previous_balance: current },
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Gagal menyimpan perubahan saldo." });
    return;
  }

  res.json({ ok: true, balance_idr: next, delta });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── API KEYS (BYOK — Bring Your Own Key untuk akses PioCode API dari luar) ─────
// ═══════════════════════════════════════════════════════════════════════════════

const API_KEY_PREFIX = "pio-sk-";

// ── Master key buat enkripsi API key user (AES-256-GCM) ──────────────────────
// Disimpen di env var API_KEY_ENCRYPTION_SECRET. Kalo gak ada → reveal disabled,
// tapi sistem tetep jalan (key cuma bisa dilihat sekali pas dibuat).
const ENCRYPTION_SECRET_RAW = process.env.API_KEY_ENCRYPTION_SECRET;
let ENCRYPTION_KEY: Buffer | null = null;
if (ENCRYPTION_SECRET_RAW) {
  try {
    const decoded = Buffer.from(ENCRYPTION_SECRET_RAW, "base64");
    ENCRYPTION_KEY =
      decoded.length === 32
        ? decoded
        : crypto.createHash("sha256").update(ENCRYPTION_SECRET_RAW).digest();
  } catch {
    ENCRYPTION_KEY = crypto.createHash("sha256").update(ENCRYPTION_SECRET_RAW).digest();
  }
}

function encryptApiKey(plain: string): string | null {
  if (!ENCRYPTION_KEY) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function decryptApiKey(stored: string): string | null {
  if (!ENCRYPTION_KEY) return null;
  try {
    const buf = Buffer.from(stored, "base64");
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

function generateApiKey(): { full: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(36).toString("base64url");
  const full = `${API_KEY_PREFIX}${random}`;
  const hash = crypto.createHash("sha256").update(full).digest("hex");
  const prefix = `${API_KEY_PREFIX}${random.slice(0, 4)}...${random.slice(-4)}`;
  return { full, hash, prefix };
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// ── Middleware: requireApiKey ────────────────────────────────────────────────
// Validasi API key + cek user premium aktif + cek limit harian khusus API.
// Setelah lolos, attach (req as any).apiUserId, .apiKeyId, .apiUsage
async function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      error: { message: "Missing or invalid Authorization header. Use: Authorization: Bearer pio-sk-...", type: "invalid_request_error" },
    });
    return;
  }
  const presented = authHeader.slice(7).trim();
  if (!presented.startsWith(API_KEY_PREFIX)) {
    res.status(401).json({
      error: { message: "Invalid API key format.", type: "invalid_request_error" },
    });
    return;
  }

  const keyHash = hashApiKey(presented);
  const { data: keyRow, error: keyErr } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id, revoked_at")
    .eq("key_hash", keyHash)
    .single();

  if (keyErr || !keyRow || keyRow.revoked_at) {
    res.status(401).json({
      error: { message: "Invalid or revoked API key.", type: "invalid_request_error" },
    });
    return;
  }

  const userId = keyRow.user_id;

  // Cek user premium aktif
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("is_premium, premium_expires_at, role, tier")
    .eq("id", userId)
    .single();

  const isAdmin = profile?.role === "admin";
  const userTier = getTier(profile ?? null); // "free" | "plus" | "pro"
  const isPremium = isAdmin || userTier !== "free";
  if (!isPremium) {
    res.status(403).json({
      error: { message: "API access requires an active Plus or Pro subscription.", type: "permission_denied" },
    });
    return;
  }

  // Update last_used_at (fire and forget)
  supabaseAdmin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id).then(() => {});

  (req as any).apiUserId = userId;
  (req as any).apiKeyId = keyRow.id;
  (req as any).apiIsAdmin = isAdmin;
  // Admin diperlakukan setara Pro untuk pembatasan model
  (req as any).apiTier = isAdmin ? "pro" : userTier;
  next();
}

/**
 * Cek apakah model boleh diakses oleh tier user.
 * Return true kalau lolos. Return false dan sudah kirim 403 ke res kalau tidak.
 */
function assertProAccess(
  res: express.Response,
  model: string | undefined,
  tier: string,
  isAdmin: boolean,
): boolean {
  if (isAdmin || tier === "pro") return true;
  if (!model) return true;
  if (PRO_ONLY_MODELS.has(model)) {
    res.status(403)
      .set("X-Pioo-Error", "MODEL_PRO_ONLY")
      .json({
        error: {
          message: `Model "${model}" eksklusif untuk pengguna Pro. Upgrade ke Pro untuk akses ke model frontier ini.`,
          type: "permission_denied",
          required_tier: "pro",
          current_tier: tier,
        },
      });
    return false;
  }
  return true;
}

// Helpers untuk usage harian API
async function getApiUsage(userId: string) {
  const today = getTodayWIB();
  const { data } = await supabaseAdmin
    .from("api_daily_usage")
    .select("total_tokens, image_count, video_count, request_count")
    .eq("user_id", userId)
    .eq("date", today)
    .single();
  return data ?? { total_tokens: 0, image_count: 0, video_count: 0, request_count: 0 };
}

async function bumpApiUsage(userId: string, fields: { tokens?: number; images?: number; videos?: number; requests?: number }) {
  const today = getTodayWIB();
  const current = await getApiUsage(userId);
  await supabaseAdmin.from("api_daily_usage").upsert({
    user_id: userId,
    date: today,
    total_tokens: current.total_tokens + (fields.tokens ?? 0),
    image_count: current.image_count + (fields.images ?? 0),
    video_count: current.video_count + (fields.videos ?? 0),
    request_count: current.request_count + (fields.requests ?? 1),
  }, { onConflict: "user_id,date" });
}

// ── Credit system helpers ──────────────────────────────────────────────────────
// Saldo persistent di profiles.credit_balance_idr (no daily reset).
// Setiap perubahan di-log ke credit_transactions sebagai audit trail.
//
// NOTE: Read-modify-write tanpa lock — race condition mungkin terjadi pada burst
// concurrent requests dari satu user. Untuk skala sekarang OK; nanti kalau perlu,
// pindah ke Postgres function dengan UPDATE ... RETURNING untuk atomic.
async function getCreditBalance(userId: string): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("credit_balance_idr")
      .eq("id", userId)
      .single();
    return data?.credit_balance_idr ?? 0;
  } catch {
    return 0;
  }
}

async function addCredit(userId: string, amountIdr: number, type: string, metadata?: any): Promise<number> {
  if (!amountIdr || amountIdr <= 0) return await getCreditBalance(userId);
  const current = await getCreditBalance(userId);
  const next = current + amountIdr;
  try {
    await supabaseAdmin.from("profiles").update({ credit_balance_idr: next }).eq("id", userId);
    await supabaseAdmin.from("credit_transactions").insert({
      user_id: userId,
      amount_idr: amountIdr,
      type,
      metadata: metadata ?? null,
    });
  } catch (e) {
    console.error("[addCredit] failed:", e);
  }
  return next;
}

async function deductCredit(userId: string, amountIdr: number, type: string, metadata?: any): Promise<number> {
  if (!amountIdr || amountIdr <= 0) return await getCreditBalance(userId);
  const current = await getCreditBalance(userId);
  const next = Math.max(0, current - amountIdr);
  try {
    await supabaseAdmin.from("profiles").update({ credit_balance_idr: next }).eq("id", userId);
    await supabaseAdmin.from("credit_transactions").insert({
      user_id: userId,
      amount_idr: -amountIdr,
      type,
      metadata: metadata ?? null,
    });
  } catch (e) {
    console.error("[deductCredit] failed:", e);
  }
  return next;
}

// Grant bonus Plus upgrade — hanya sekali per user (idempotent).
// Dipertahankan untuk backward compat. Logic baru pakai grantTierBonusOnce.
async function grantPlusBonusOnce(userId: string, sourceMetadata?: any): Promise<boolean> {
  const { granted } = await grantTierBonusOnce(userId, "plus", sourceMetadata);
  return granted;
}

/**
 * Grant bonus tier upgrade — idempotent per tier.
 * - Plus: Rp 75.000 sekali. Skip kalau user udah pernah dapet bonus Plus atau Pro.
 * - Pro: Rp 125.000 sekali. Kalau user udah pernah Plus, kasih selisih (Rp 50.000).
 *   Kalau belum pernah, kasih full Rp 125.000.
 */
async function grantTierBonusOnce(
  userId: string,
  tier: Tier,
  sourceMetadata?: any,
): Promise<{ granted: boolean; amount: number }> {
  if (tier === "free") return { granted: false, amount: 0 };

  // Cek riwayat bonus dari ledger
  let hasPlusBonus = false;
  let hasProBonus = false;
  try {
    const { data: existing } = await supabaseAdmin
      .from("credit_transactions")
      .select("type")
      .eq("user_id", userId)
      .in("type", ["bonus_plus_upgrade", "bonus_pro_upgrade"]);
    for (const row of existing ?? []) {
      if (row.type === "bonus_plus_upgrade") hasPlusBonus = true;
      if (row.type === "bonus_pro_upgrade")  hasProBonus = true;
    }
  } catch {
    // Tabel mungkin belum ada (migration belum jalan)
    return { granted: false, amount: 0 };
  }

  if (tier === "plus") {
    if (hasPlusBonus || hasProBonus) return { granted: false, amount: 0 };
    await addCredit(userId, PLUS_UPGRADE_BONUS_IDR, "bonus_plus_upgrade", sourceMetadata ?? null);
    return { granted: true, amount: PLUS_UPGRADE_BONUS_IDR };
  }

  // tier === "pro"
  if (hasProBonus) return { granted: false, amount: 0 };
  const amount = hasPlusBonus
    ? Math.max(0, PRO_UPGRADE_BONUS_IDR - PLUS_UPGRADE_BONUS_IDR)
    : PRO_UPGRADE_BONUS_IDR;
  if (amount <= 0) return { granted: false, amount: 0 };
  await addCredit(userId, amount, "bonus_pro_upgrade", sourceMetadata ?? null);
  return { granted: true, amount };
}

// ── GET /api/me/api-keys — list semua key user (tanpa value asli) ────────────
app.get("/api/me/api-keys", requireAuth, async (req, res) => {
  const userId = (req as any).userId;

  // Cek user premium — gating sama kayak POST biar frontend bisa nampilin UI upgrade
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("is_premium, premium_expires_at, role")
    .eq("id", userId)
    .single();
  const isAdmin = profile?.role === "admin";
  const isPremium = isAdmin || isPremiumActive(profile ?? {});
  if (!isPremium) {
    res.status(403).json({ error: "Fitur API key hanya untuk pengguna Plus." });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at, key_encrypted")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  // Jangan kirim ciphertext ke client — cuma flag boolean apakah bisa di-reveal
  const keys = (data ?? []).map((k: any) => ({
    id: k.id,
    name: k.name,
    key_prefix: k.key_prefix,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    revoked_at: k.revoked_at,
    revealable: !!k.key_encrypted && !!ENCRYPTION_KEY,
  }));
  res.json({ keys });
});

// ── GET /api/me/api-keys/:id/reveal — tampilkan key full (decrypted) ─────────
app.get("/api/me/api-keys/:id/reveal", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { id } = req.params;
  if (!ENCRYPTION_KEY) {
    res.status(503).json({ error: "Fitur reveal belum aktif di server. Hubungi admin." });
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id, key_encrypted, revoked_at")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (error || !data) {
    res.status(404).json({ error: "Key tidak ditemukan." });
    return;
  }
  if (data.revoked_at) {
    res.status(410).json({ error: "Key sudah di-revoke." });
    return;
  }
  if (!data.key_encrypted) {
    res.status(409).json({
      error: "Key ini dibuat sebelum fitur reveal aktif. Bikin key baru kalau mau bisa dilihat ulang.",
    });
    return;
  }
  const plain = decryptApiKey(data.key_encrypted);
  if (!plain) {
    res.status(500).json({ error: "Gagal decrypt. Master secret mungkin berubah." });
    return;
  }
  res.json({ key: plain });
});

// ── POST /api/me/api-keys — buat key baru (cuma untuk user Plus/Admin) ───────
app.post("/api/me/api-keys", requireAuth, async (req, res) => {
  const userId = (req as any).userId;

  // Cek user premium
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("is_premium, premium_expires_at, role")
    .eq("id", userId)
    .single();
  const isAdmin = profile?.role === "admin";
  const isPremium = isAdmin || isPremiumActive(profile ?? {});
  if (!isPremium) {
    res.status(403).json({ error: "Fitur API key hanya untuk pengguna Plus." });
    return;
  }

  let body: any = {};
  try {
    const raw = req.body instanceof Buffer ? req.body.toString("utf8") : req.body;
    body = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { /**/ }
  const name = (body?.name || "Untitled key").toString().slice(0, 80);

  // Maksimal 10 active key per user (biar ga abuse)
  const { count } = await supabaseAdmin
    .from("api_keys")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if ((count ?? 0) >= 10) {
    res.status(400).json({ error: "Maksimal 10 active API key. Hapus dulu yang ga dipakai." });
    return;
  }

  const { full, hash, prefix } = generateApiKey();
  const encrypted = encryptApiKey(full); // null kalau ENCRYPTION_KEY belum di-set
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .insert({
      user_id: userId,
      name,
      key_hash: hash,
      key_prefix: prefix,
      key_encrypted: encrypted,
    })
    .select("id, name, key_prefix, created_at")
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Kirim full key + flag bisa di-reveal lagi nanti atau enggak
  res.json({
    ...data,
    key: full,
    revealable: !!encrypted,
    warning: encrypted
      ? "Copy sekarang biar gampang. Kamu juga bisa lihat lagi nanti dari halaman ini."
      : "Simpan key ini sekarang. Kamu ga akan bisa lihat lagi.",
  });
});

// ── PATCH /api/me/api-keys/:id — update nama key ─────────────────────────────
app.patch("/api/me/api-keys/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { id } = req.params;
  const body = req.body || {};
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName) {
    res.status(400).json({ error: "Nama tidak boleh kosong." });
    return;
  }
  const name = rawName.slice(0, 80);

  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .update({ name })
    .eq("id", id)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id, name")
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: "Key tidak ditemukan." }); return; }
  res.json({ success: true, key: data });
});

// ── DELETE /api/me/api-keys/:id — hapus permanen ─────────────────────────────
app.delete("/api/me/api-keys/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { id } = req.params;
  const { error } = await supabaseAdmin
    .from("api_keys")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
});

// ── GET /api/me/api-usage — pemakaian API hari ini (untuk stats) ─────────────
// Catatan: dengan sistem credit, limits.tokens/images/videos sudah ga relevan
// (saldo IDR yang menentukan). Tetep di-return untuk backward compat di UI lama.
app.get("/api/me/api-usage", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const usage = await getApiUsage(userId);
  res.json({
    usage,
    limits: {
      tokens: 0,
      images: 0,
      videos: 0,
      requests: API_DAILY_REQUEST_LIMIT,
    },
  });
});

// ── GET /api/me/credit — saldo credit + 20 transaksi terakhir ────────────────
app.get("/api/me/credit", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("credit_balance_idr, is_premium, premium_expires_at, role, tier")
    .eq("id", userId)
    .single();
  const isAdmin = profile?.role === "admin";
  const tier = getTier(profile);
  const isPremium = isAdmin || tier !== "free";

  let transactions: any[] = [];
  try {
    const { data: txs } = await supabaseAdmin
      .from("credit_transactions")
      .select("id, amount_idr, type, metadata, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    transactions = txs ?? [];
  } catch { /* tabel mungkin belum ada (migration belum jalan) */ }

  res.json({
    balance_idr: (profile as any)?.credit_balance_idr ?? 0,
    is_premium: isPremium,
    is_admin: isAdmin,
    tier,
    transactions,
    pricing: {
      idr_per_token_num: IDR_PER_TOKEN_NUM,
      idr_per_token_den: IDR_PER_TOKEN_DEN,
      image_idr: IMAGE_COST_IDR,
      video_idr: VIDEO_COST_IDR,
      plus_bonus_idr: PLUS_UPGRADE_BONUS_IDR,
      pro_bonus_idr: PRO_UPGRADE_BONUS_IDR,
    },
  });
});

// ── GET /api/me/credit/transactions — riwayat saldo paginated ────────────────
// Query: ?limit=20&offset=0  → returns { transactions, total, has_more, summary? }
// summary (last 30 days) hanya disertakan saat offset=0 supaya hemat query.
app.get("/api/me/credit/transactions", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
  const offset = Math.max(0, parseInt((req.query.offset as string) || "0", 10));

  try {
    const summaryPromise = offset === 0
      ? supabaseAdmin
          .from("credit_transactions")
          .select("amount_idr, type")
          .eq("user_id", userId)
          .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      : Promise.resolve({ data: null as any });

    const [pageRes, summaryRes] = await Promise.all([
      supabaseAdmin
        .from("credit_transactions")
        .select("id, amount_idr, type, metadata, created_at", { count: "exact" })
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1),
      summaryPromise,
    ]);

    if (pageRes.error) throw pageRes.error;

    let summary: { days: number; count: number; total_spent: number; total_top_up: number; total_bonus: number } | null = null;
    if (summaryRes.data) {
      let spent = 0, topUp = 0, bonus = 0;
      for (const t of summaryRes.data as any[]) {
        const amt = t.amount_idr ?? 0;
        if (amt < 0) spent += -amt;
        else if (t.type === "top_up") topUp += amt;
        else bonus += amt;
      }
      summary = {
        days: 30,
        count: (summaryRes.data as any[]).length,
        total_spent: spent,
        total_top_up: topUp,
        total_bonus: bonus,
      };
    }

    const total = pageRes.count ?? 0;
    res.json({
      transactions: pageRes.data ?? [],
      total,
      has_more: offset + (pageRes.data?.length ?? 0) < total,
      summary,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Gagal memuat riwayat saldo" });
  }
});

// ── POST /api/me/credit/top-up — placeholder, segera hadir ───────────────────
app.post("/api/me/credit/top-up", requireAuth, async (_req, res) => {
  res.status(503).json({
    error: "Top up saldo sedang dikembangkan. Segera hadir!",
    coming_soon: true,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── PUBLIC API (OpenAI-compatible) — diakses pakai pio-sk-... ────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// CORS untuk akses dari aplikasi luar
app.use("/v1", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
});

// Helper: parse JSON body (bisa Buffer atau object)
function parseBody(req: express.Request): any {
  if (req.body instanceof Buffer) {
    try { return JSON.parse(req.body.toString("utf8")); } catch { return {}; }
  }
  return typeof req.body === "object" && req.body !== null ? req.body : {};
}

// Helper: extract token usage dari response chat (untuk billing)
function extractTokensFromResponse(json: any): number {
  return json?.usage?.total_tokens ?? 0;
}

// ── GET /v1/models — list model yang available ───────────────────────────────
app.get("/v1/models", requireApiKey, async (_req, res) => {
  // Forward dari dashscope compatible-mode
  try {
    const upstream = await fetch(`${DASHSCOPE_COMPATIBLE_BASE}/models`, {
      headers: { Authorization: `Bearer ${dashscopeApiKey}` },
    });
    const text = await upstream.text();
    res.status(upstream.status).type("application/json").send(text);
  } catch {
    res.status(502).json({ error: { message: "Upstream error", type: "api_error" } });
  }
});

// ── POST /v1/chat/completions — chat (streaming + non-streaming) ─────────────
app.post("/v1/chat/completions", requireApiKey, async (req, res) => {
  const userId = (req as any).apiUserId;
  const isAdmin = (req as any).apiIsAdmin;
  const userTier = (req as any).apiTier as string;

  // Credit check: harus punya saldo (admin bypass)
  if (!isAdmin) {
    const balance = await getCreditBalance(userId);
    if (balance <= 0) {
      res.status(429).json({ error: {
        message: "Saldo credit habis. Silakan top up untuk lanjut menggunakan API.",
        type: "insufficient_credit",
        balance_idr: balance,
      } });
      return;
    }
  }

  // Rate limit harian (request_count) tetap aktif untuk anti-abuse
  const usage = await getApiUsage(userId);
  if (!isAdmin && usage.request_count >= API_DAILY_REQUEST_LIMIT) {
    res.status(429).json({ error: { message: `Daily request limit reached (${API_DAILY_REQUEST_LIMIT}).`, type: "rate_limit_error" } });
    return;
  }

  const body = parseBody(req);

  // Tier gating: model Pro-only hanya untuk user Pro/Admin
  if (!assertProAccess(res, body.model, userTier, isAdmin)) return;

  const isStream = !!body.stream;

  let upstream: Response;
  try {
    upstream = await fetch(`${DASHSCOPE_COMPATIBLE_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dashscopeApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    res.status(502).json({ error: { message: "Upstream error", type: "api_error" } });
    return;
  }

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    const skip = ["transfer-encoding", "connection", "keep-alive", "content-encoding", "content-length"];
    if (!skip.includes(key.toLowerCase())) res.setHeader(key, value);
  });

  if (!upstream.body) { res.end(); return; }

  if (isStream) {
    // Streaming: pipe + parse SSE untuk extract usage di akhir
    const reader = upstream.body.getReader();
    let buffered = "";
    let totalTokens = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        res.write(chunk);
        buffered += chunk.toString("utf8");
        // Cari frame dengan "usage" (biasanya di chunk terakhir kalau stream_options.include_usage=true)
        const matches = buffered.match(/"total_tokens"\s*:\s*(\d+)/g);
        if (matches && matches.length > 0) {
          const last = matches[matches.length - 1];
          const m = last.match(/(\d+)/);
          if (m) totalTokens = Math.max(totalTokens, parseInt(m[1], 10));
        }
      }
    } catch { /**/ }
    res.end();
    bumpApiUsage(userId, { tokens: totalTokens, requests: 1 }).catch(() => {});
    if (!isAdmin) {
      const cost = tokensToIdr(totalTokens);
      if (cost > 0) deductCredit(userId, cost, "usage_chat", { tokens: totalTokens, model: body.model, stream: true }).catch(() => {});
    }
  } else {
    const text = await upstream.text();
    res.send(text);
    let tokens = 0;
    try { tokens = extractTokensFromResponse(JSON.parse(text)); } catch { /**/ }
    bumpApiUsage(userId, { tokens, requests: 1 }).catch(() => {});
    if (!isAdmin) {
      const cost = tokensToIdr(tokens);
      if (cost > 0) deductCredit(userId, cost, "usage_chat", { tokens, model: body.model, stream: false }).catch(() => {});
    }
  }
});

// ── POST /v1/embeddings — embeddings ─────────────────────────────────────────
app.post("/v1/embeddings", requireApiKey, async (req, res) => {
  const userId = (req as any).apiUserId;
  const isAdmin = (req as any).apiIsAdmin;

  // Credit check
  if (!isAdmin) {
    const balance = await getCreditBalance(userId);
    if (balance <= 0) {
      res.status(429).json({ error: { message: "Saldo credit habis.", type: "insufficient_credit", balance_idr: balance } });
      return;
    }
  }

  const usage = await getApiUsage(userId);
  if (!isAdmin && usage.request_count >= API_DAILY_REQUEST_LIMIT) {
    res.status(429).json({ error: { message: "Daily request limit reached.", type: "rate_limit_error" } });
    return;
  }
  try {
    const upstream = await fetch(`${DASHSCOPE_COMPATIBLE_BASE}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dashscopeApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(parseBody(req)),
    });
    const text = await upstream.text();
    res.status(upstream.status).type("application/json").send(text);
    let tokens = 0;
    try { tokens = extractTokensFromResponse(JSON.parse(text)); } catch { /**/ }
    bumpApiUsage(userId, { tokens, requests: 1 }).catch(() => {});
    if (!isAdmin) {
      const cost = tokensToIdr(tokens);
      if (cost > 0) deductCredit(userId, cost, "usage_embedding", { tokens }).catch(() => {});
    }
  } catch {
    res.status(502).json({ error: { message: "Upstream error", type: "api_error" } });
  }
});

// ── POST /v1/images/generations — image generation (OpenAI-compatible) ───────
// Map ke dashscope text2image-synthesis
app.post("/v1/images/generations", requireApiKey, async (req, res) => {
  const userId = (req as any).apiUserId;
  const isAdmin = (req as any).apiIsAdmin;
  const userTier = (req as any).apiTier as string;

  // Credit check: harus ada minimal 1 image worth saldo (admin bypass)
  if (!isAdmin) {
    const balance = await getCreditBalance(userId);
    if (balance < IMAGE_COST_IDR) {
      res.status(429).json({ error: {
        message: `Saldo credit kurang. Butuh minimal Rp ${IMAGE_COST_IDR.toLocaleString("id-ID")} per gambar.`,
        type: "insufficient_credit",
        balance_idr: balance,
      } });
      return;
    }
  }

  const body = parseBody(req);
  const prompt = body.prompt;
  if (!prompt) {
    res.status(400).json({ error: { message: "prompt is required", type: "invalid_request_error" } });
    return;
  }
  const model = body.model || "wan2.2-t2i-flash";

  // Tier gating: model Pro-only hanya untuk user Pro/Admin
  if (!assertProAccess(res, model, userTier, isAdmin)) return;

  const n = Math.min(Math.max(body.n ?? 1, 1), 4);
  const size = body.size || "1024*1024";

  // Step 1: submit task
  let createResp: Response;
  try {
    createResp = await fetch(`${DASHSCOPE_BASE}/api/v1/services/aigc/text2image/image-synthesis`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dashscopeApiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model,
        input: { prompt },
        parameters: { n, size: size.replace("x", "*") },
      }),
    });
  } catch {
    res.status(502).json({ error: { message: "Upstream error", type: "api_error" } });
    return;
  }

  const createJson: any = await createResp.json().catch(() => ({}));
  const taskId = createJson?.output?.task_id;
  if (!taskId) {
    res.status(createResp.status).json({ error: { message: createJson?.message || "Failed to submit task", type: "api_error", upstream: createJson } });
    return;
  }

  // Step 2: poll until done (max 90s)
  const start = Date.now();
  let result: any = null;
  while (Date.now() - start < 90_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollResp = await fetch(`${DASHSCOPE_BASE}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${dashscopeApiKey}` },
    });
    const pollJson: any = await pollResp.json().catch(() => ({}));
    const status = pollJson?.output?.task_status;
    if (status === "SUCCEEDED") { result = pollJson; break; }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      res.status(500).json({ error: { message: pollJson?.output?.message || "Task failed", type: "api_error" } });
      return;
    }
  }

  if (!result) {
    res.status(504).json({ error: { message: "Image generation timed out", type: "api_error" } });
    return;
  }

  const results = result?.output?.results ?? [];
  const data = results.map((r: any) => ({ url: r.url }));

  res.json({
    created: Math.floor(Date.now() / 1000),
    data,
  });
  bumpApiUsage(userId, { images: data.length, requests: 1 }).catch(() => {});
  if (!isAdmin && data.length > 0) {
    const cost = IMAGE_COST_IDR * data.length;
    deductCredit(userId, cost, "usage_image", { count: data.length, model }).catch(() => {});
  }
});

// ── POST /v1/videos/generations — video generation ───────────────────────────
app.post("/v1/videos/generations", requireApiKey, async (req, res) => {
  const userId = (req as any).apiUserId;
  const isAdmin = (req as any).apiIsAdmin;
  const userTier = (req as any).apiTier as string;

  // Credit check: butuh minimal 1 video worth saldo
  if (!isAdmin) {
    const balance = await getCreditBalance(userId);
    if (balance < VIDEO_COST_IDR) {
      res.status(429).json({ error: {
        message: `Saldo credit kurang. Butuh minimal Rp ${VIDEO_COST_IDR.toLocaleString("id-ID")} per video.`,
        type: "insufficient_credit",
        balance_idr: balance,
      } });
      return;
    }
  }

  const body = parseBody(req);
  const prompt = body.prompt;
  if (!prompt) {
    res.status(400).json({ error: { message: "prompt is required", type: "invalid_request_error" } });
    return;
  }
  const model = body.model || "wan2.2-t2v-plus";

  // Tier gating: model Pro-only hanya untuk user Pro/Admin
  if (!assertProAccess(res, model, userTier, isAdmin)) return;

  const size = body.size || "1280*720";

  // Step 1: submit
  let createResp: Response;
  try {
    createResp = await fetch(`${DASHSCOPE_BASE}/api/v1/services/aigc/video-generation/video-synthesis`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dashscopeApiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model,
        input: { prompt },
        parameters: { size: size.replace("x", "*") },
      }),
    });
  } catch {
    res.status(502).json({ error: { message: "Upstream error", type: "api_error" } });
    return;
  }

  const createJson: any = await createResp.json().catch(() => ({}));
  const taskId = createJson?.output?.task_id;
  if (!taskId) {
    res.status(createResp.status).json({ error: { message: createJson?.message || "Failed to submit task", type: "api_error", upstream: createJson } });
    return;
  }

  // Untuk video, return task_id supaya user bisa poll sendiri (video bisa lama 5+ menit)
  res.json({
    created: Math.floor(Date.now() / 1000),
    task_id: taskId,
    status: "PENDING",
    message: "Video sedang di-generate. Poll GET /v1/videos/generations/{task_id} untuk cek status.",
  });
  bumpApiUsage(userId, { videos: 1, requests: 1 }).catch(() => {});
  if (!isAdmin) {
    deductCredit(userId, VIDEO_COST_IDR, "usage_video", { task_id: taskId, model }).catch(() => {});
  }
});

// ── GET /v1/videos/generations/:taskId — poll status video ───────────────────
app.get("/v1/videos/generations/:taskId", requireApiKey, async (req, res) => {
  const { taskId } = req.params;
  try {
    const pollResp = await fetch(`${DASHSCOPE_BASE}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${dashscopeApiKey}` },
    });
    const pollJson: any = await pollResp.json().catch(() => ({}));
    const status = pollJson?.output?.task_status;
    const videoUrl = pollJson?.output?.video_url ?? pollJson?.output?.results?.[0]?.url ?? null;
    res.json({
      task_id: taskId,
      status: status || "UNKNOWN",
      video_url: videoUrl,
      raw: pollJson?.output ?? null,
    });
  } catch {
    res.status(502).json({ error: { message: "Upstream error", type: "api_error" } });
  }
});

// ── POST /v1/ocr — OCR (pakai qwen-vl, format mirip OpenAI vision) ───────────
// Body: { image: "url-atau-base64-data:image/png;base64,...", prompt?: "..." }
app.post("/v1/ocr", requireApiKey, async (req, res) => {
  const userId = (req as any).apiUserId;
  const isAdmin = (req as any).apiIsAdmin;

  // Credit check
  if (!isAdmin) {
    const balance = await getCreditBalance(userId);
    if (balance <= 0) {
      res.status(429).json({ error: { message: "Saldo credit habis.", type: "insufficient_credit", balance_idr: balance } });
      return;
    }
  }

  const body = parseBody(req);
  const image = body.image;
  const promptText = body.prompt || "Read all text in this image accurately. Return only the text, preserving the original layout where possible.";
  if (!image) {
    res.status(400).json({ error: { message: "image (url or data:base64) is required", type: "invalid_request_error" } });
    return;
  }
  const model = body.model || "qwen-vl-ocr";

  try {
    const upstream = await fetch(`${DASHSCOPE_COMPATIBLE_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dashscopeApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: image } },
            { type: "text", text: promptText },
          ],
        }],
      }),
    });
    const json: any = await upstream.json().catch(() => ({}));
    const text = json?.choices?.[0]?.message?.content ?? "";
    res.status(upstream.status).json({
      text,
      model,
      usage: json?.usage ?? null,
    });
    const tokens = extractTokensFromResponse(json);
    bumpApiUsage(userId, { tokens, requests: 1 }).catch(() => {});
    if (!isAdmin) {
      const cost = tokensToIdr(tokens);
      if (cost > 0) deductCredit(userId, cost, "usage_ocr", { tokens, model }).catch(() => {});
    }
  } catch {
    res.status(502).json({ error: { message: "Upstream error", type: "api_error" } });
  }
});

// ── POST /v1/files — upload file ke dashscope (return file_id) ───────────────
// Pakai multer untuk handle multipart
app.post("/v1/files", requireApiKey, upload.single("file"), async (req, res) => {
  const userId = (req as any).apiUserId;
  const usage = await getApiUsage(userId);
  if (usage.request_count >= API_DAILY_REQUEST_LIMIT) {
    res.status(429).json({ error: { message: "Daily request limit reached.", type: "rate_limit_error" } });
    return;
  }
  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ error: { message: "file field is required (multipart/form-data)", type: "invalid_request_error" } });
    return;
  }
  const purpose = (req.body?.purpose as string) || "file-extract";
  try {
    const fd = new FormData();
    fd.append("file", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
    fd.append("purpose", purpose);
    const upstream = await fetch(`${DASHSCOPE_COMPATIBLE_BASE}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dashscopeApiKey}` },
      body: fd as any,
    });
    const text = await upstream.text();
    res.status(upstream.status).type("application/json").send(text);
    bumpApiUsage(userId, { requests: 1 }).catch(() => {});
  } catch {
    res.status(502).json({ error: { message: "Upstream error", type: "api_error" } });
  }
});

// ── DashScope proxy ────────────────────────────────────────────────────────────
app.all("/api/dashscope/*splat", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const today = getTodayWIB();
  const [usageRow, profileRow] = await Promise.all([
    supabaseAdmin.from("daily_token_usage").select("total_tokens").eq("user_id", userId).eq("date", today).single(),
    supabaseAdmin.from("profiles").select("is_premium, premium_expires_at, role, tier").eq("id", userId).single(),
  ]);
  const todayTokens = usageRow.data?.total_tokens ?? 0;
  const isAdmin = profileRow.data?.role === "admin";
  const tier = getTier(profileRow.data ?? null);
  const isPremium = isAdmin || tier !== "free";

  // ── Cek quota token harian ─────────────────────────────────────────────────
  const { tokenLimit } = getTierLimits(tier, isAdmin);
  if (todayTokens >= tokenLimit) {
    res.status(429)
      .set("X-Pioo-Error", "QUOTA_EXCEEDED")
      .json({ error: `Limit harian ${tokenLimit.toLocaleString()} token sudah tercapai. Coba lagi besok ya!` });
    return;
  }

  // ── Cek model restriction (hanya untuk POST dengan body JSON) ──────────────
  const isImageSynthesis = req.path.includes("text2image/image-synthesis");
  const isChatOrText = req.path.includes("chat/completions") || req.path.includes("generation");
  if (!isAdmin && !isPremium && isChatOrText && req.method === "POST") {
    const bodyObj = req.body instanceof Buffer
      ? (() => { try { return JSON.parse(req.body.toString("utf8")); } catch { return {}; } })()
      : (typeof req.body === "object" ? req.body : {});
    const modelName: string = bodyObj?.model ?? "";
    if (modelName && PREMIUM_ONLY_MODELS.has(modelName)) {
      res.status(403)
        .set("X-Pioo-Error", "MODEL_RESTRICTED")
        .json({ error: `Model "${modelName}" hanya tersedia untuk pengguna Plus. Upgrade ke Plus untuk akses penuh!` });
      return;
    }
  }

  // ── Cek & kurangi kuota image gen ──────────────────────────────────────────
  if (!isAdmin && isImageSynthesis && req.method === "POST") {
    const ok = await deductImageGen(userId);
    if (!ok) {
      const quota = await getImageGenQuota(userId);
      res.status(429)
        .set("X-Pioo-Error", "IMAGE_QUOTA_EXCEEDED")
        .json({ error: `Kuota generate gambar hari ini sudah habis (${quota.limit}/hari). Coba lagi besok!` });
      return;
    }
  }
  const dashscopePath = req.path.replace("/api/dashscope", "");
  const queryString = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const targetUrl = `https://dashscope-intl.aliyuncs.com${dashscopePath}${queryString}`;

  const forwardHeaders: Record<string, string> = {
    Authorization: `Bearer ${dashscopeApiKey}`,
  };
  const ct = req.headers["content-type"];
  if (ct) forwardHeaders["Content-Type"] = ct as string;
  for (const [key, val] of Object.entries(req.headers)) {
    if (key.toLowerCase().startsWith("x-dashscope-") && typeof val === "string") {
      forwardHeaders[key] = val;
    }
  }

  const fetchInit: RequestInit = {
    method: req.method,
    headers: forwardHeaders,
  };

  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    if (req.body instanceof Buffer) {
      if (req.body.length > 0) fetchInit.body = req.body;
    } else if (typeof req.body === "object") {
      fetchInit.body = JSON.stringify(req.body);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, fetchInit);
  } catch (err) {
    console.error("[PioCode API] Upstream fetch error:", err);
    res.status(502).json({ error: "Bad gateway" });
    return;
  }

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    const skip = ["transfer-encoding", "connection", "keep-alive", "content-encoding", "content-length"];
    if (!skip.includes(key.toLowerCase())) res.setHeader(key, value);
  });

  if (!upstream.body) { res.end(); return; }

  const reader = upstream.body.getReader();
  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        res.write(Buffer.from(value));
      }
    } catch { res.end(); }
  };
  pump();
});

// ─────────────────────────────────────────────────────────────────────────────
// Azure Speech Services — Speech-to-Text (STT) & Text-to-Speech (TTS)
// ─────────────────────────────────────────────────────────────────────────────
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY ?? "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION ?? "southeastasia";
const speechAvailable = () => Boolean(AZURE_SPEECH_KEY);

// Suara default Indonesia (Microsoft Neural)
const DEFAULT_TTS_VOICE = "id-ID-ArdiNeural"; // pria Indonesia
// alt: id-ID-GadisNeural (wanita Indonesia)

// Storage in-memory buat audio upload (max 10MB)
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// POST /api/voice/transcribe — terima audio (webm/wav/ogg) → balikin text
app.post("/api/voice/transcribe", requireAuth, audioUpload.single("audio"), async (req, res) => {
  if (!speechAvailable()) {
    res.status(503).json({ error: "Azure Speech belum dikonfigurasi" });
    return;
  }
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file || !file.buffer?.length) {
    res.status(400).json({ error: "Audio tidak ditemukan di field 'audio'" });
    return;
  }

  const language = (req.body?.language as string) || "id-ID";
  // Auto-detect content-type dari mime, fallback webm/opus (default MediaRecorder)
  const mime = (file.mimetype || "audio/webm").toLowerCase();
  let contentType = "audio/webm; codecs=opus";
  if (mime.includes("wav")) contentType = "audio/wav; codecs=audio/pcm; samplerate=16000";
  else if (mime.includes("ogg")) contentType = "audio/ogg; codecs=opus";
  else if (mime.includes("webm")) contentType = "audio/webm; codecs=opus";

  const url = `https://${AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=detailed`;
  console.log("[Voice STT] req", file.buffer.length, "bytes,", contentType, "lang=" + language);

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
        "Content-Type": contentType,
        "Accept": "application/json",
      },
      body: file.buffer,
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      console.error("[Voice STT] Azure error:", upstream.status, text.slice(0, 200));
      res.status(upstream.status).json({ error: "STT gagal", detail: text.slice(0, 300) });
      return;
    }
    const data = JSON.parse(text);
    const transcript: string =
      data?.DisplayText ||
      data?.NBest?.[0]?.Display ||
      data?.NBest?.[0]?.Lexical ||
      "";
    console.log("[Voice STT] full response:", JSON.stringify(data).slice(0, 400));
    res.json({ text: transcript, raw: data?.RecognitionStatus });
  } catch (err: any) {
    console.error("[Voice STT] Fetch error:", err);
    res.status(502).json({ error: "Gagal connect ke Azure Speech", detail: err?.message });
  }
});

// POST /api/voice/synthesize — terima { text, voice? } → balikin MP3 audio
app.post("/api/voice/synthesize", requireAuth, async (req, res) => {
  if (!speechAvailable()) {
    res.status(503).json({ error: "Azure Speech belum dikonfigurasi" });
    return;
  }
  const text = String(req.body?.text || "").trim();
  if (!text) {
    res.status(400).json({ error: "Field 'text' kosong" });
    return;
  }
  if (text.length > 5000) {
    res.status(400).json({ error: "Text terlalu panjang (max 5000 karakter)" });
    return;
  }

  const voice = String(req.body?.voice || DEFAULT_TTS_VOICE);
  const lang = voice.split("-").slice(0, 2).join("-"); // misal "id-ID"

  // Escape XML untuk SSML
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const ssml = `<speak version="1.0" xml:lang="${lang}"><voice name="${voice}"><prosody rate="0%">${escaped}</prosody></voice></speak>`;

  const url = `https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  console.log("[Voice TTS] req voice=" + voice, "len=" + text.length, JSON.stringify(text.slice(0, 60)));

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "PioCode",
      },
      body: ssml,
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[Voice TTS] Azure error:", upstream.status, errText.slice(0, 200));
      res.status(upstream.status).json({ error: "TTS gagal", detail: errText.slice(0, 300) });
      return;
    }
    const arrayBuf = await upstream.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache");
    res.send(Buffer.from(arrayBuf));
  } catch (err: any) {
    console.error("[Voice TTS] Fetch error:", err);
    res.status(502).json({ error: "Gagal connect ke Azure Speech", detail: err?.message });
  }
});

// GET /api/voice/voices — list suara yang tersedia (static, paling umum buat ID/EN)
app.get("/api/voice/voices", requireAuth, (_req, res) => {
  res.json({
    available: speechAvailable(),
    voices: [
      { id: "id-ID-ArdiNeural",  name: "Ardi (Pria, Indonesia)",  lang: "id-ID" },
      { id: "id-ID-GadisNeural", name: "Gadis (Wanita, Indonesia)", lang: "id-ID" },
      { id: "en-US-AndrewNeural", name: "Andrew (Pria, US)",      lang: "en-US" },
      { id: "en-US-AvaNeural",    name: "Ava (Wanita, US)",        lang: "en-US" },
      { id: "en-US-EmmaNeural",   name: "Emma (Wanita, US)",       lang: "en-US" },
      { id: "ja-JP-NanamiNeural", name: "Nanami (Wanita, Jepang)", lang: "ja-JP" },
    ],
    default: DEFAULT_TTS_VOICE,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pustaka (Knowledge Base)
// ═══════════════════════════════════════════════════════════════════════════════

const AZURE_DOC_KEY = process.env.AZURE_DOC_INTELLIGENCE_KEY || "";
const AZURE_DOC_ENDPOINT = (process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT || "").replace(/\/$/, "");

function getPustakaLimits(tier: Tier, isAdmin: boolean): {
  fileBytes: number;
  fileCount: number;
  pagesPerMonth: number;
} {
  if (isAdmin) return { fileBytes: 1024 * 1024 * 1024, fileCount: -1, pagesPerMonth: 99999 };
  if (tier === "pro")  return { fileBytes: PRO_PUSTAKA_FILE_BYTES,  fileCount: PRO_PUSTAKA_FILE_COUNT,  pagesPerMonth: PRO_PUSTAKA_PAGES_MO };
  if (tier === "plus") return { fileBytes: PLUS_PUSTAKA_FILE_BYTES, fileCount: PLUS_PUSTAKA_FILE_COUNT, pagesPerMonth: PLUS_PUSTAKA_PAGES_MO };
  return { fileBytes: FREE_PUSTAKA_FILE_BYTES, fileCount: FREE_PUSTAKA_FILE_COUNT, pagesPerMonth: FREE_PUSTAKA_PAGES_MO };
}

async function getMonthlyPageUsage(userId: string): Promise<{ used: number }> {
  const month = getThisMonthWIB();
  const { data } = await supabaseAdmin
    .from("document_page_usage")
    .select("pages_used")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  return { used: data?.pages_used ?? 0 };
}

async function incrementMonthlyPageUsage(userId: string, pages: number) {
  if (pages <= 0) return;
  const month = getThisMonthWIB();
  const { data: existing } = await supabaseAdmin
    .from("document_page_usage")
    .select("pages_used")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  if (existing) {
    await supabaseAdmin
      .from("document_page_usage")
      .update({ pages_used: (existing.pages_used ?? 0) + pages, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("month", month);
  } else {
    await supabaseAdmin
      .from("document_page_usage")
      .insert({ user_id: userId, month, pages_used: pages });
  }
}

async function azureExtractText(
  fileBuffer: Buffer,
  contentType: string,
): Promise<{ text: string; pageCount: number }> {
  if (!AZURE_DOC_KEY || !AZURE_DOC_ENDPOINT) {
    throw new Error("Azure Document Intelligence belum dikonfigurasi");
  }
  const url = `${AZURE_DOC_ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30`;
  const startRes = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_DOC_KEY,
      "Content-Type": contentType,
    },
    body: new Uint8Array(fileBuffer),
  });
  if (!startRes.ok) {
    const errText = await startRes.text();
    throw new Error(`Azure parse failed (${startRes.status}): ${errText.slice(0, 300)}`);
  }
  const operationLocation = startRes.headers.get("operation-location");
  if (!operationLocation) throw new Error("Azure tidak mengembalikan operation-location");

  const maxTries = 60; // ~60 detik max
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const pollRes = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": AZURE_DOC_KEY },
    });
    if (!pollRes.ok) throw new Error(`Azure poll failed: ${pollRes.status}`);
    const json: any = await pollRes.json();
    if (json.status === "succeeded") {
      const result = json.analyzeResult || {};
      const text = result.content || "";
      const pageCount = Array.isArray(result.pages) ? result.pages.length : 0;
      return { text, pageCount };
    }
    if (json.status === "failed") {
      throw new Error("Azure analysis failed: " + JSON.stringify(json.error || {}).slice(0, 200));
    }
  }
  throw new Error("Azure analysis timeout");
}

const TEXT_FILE_EXT_REGEX = /\.(md|mdx|txt|log|js|mjs|cjs|ts|jsx|tsx|json|jsonc|json5|yaml|yml|html|htm|css|scss|sass|less|sh|bash|zsh|fish|ps1|sql|rs|go|java|cpp|cxx|cc|c|h|hpp|hh|rb|php|swift|kt|kts|dart|py|pyi|csv|tsv|toml|ini|env|conf|cfg|properties|xml|vue|svelte|astro|lua|r|jl|ex|exs|elm|hs|nim|zig|gd|sol|tf|tfvars|dockerfile|makefile|gradle|graphql|gql|prisma)$/i;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function isTextFile(mime: string, name: string): boolean {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("text/")) return true;
  if (m === "application/json" || m === "application/xml") return true;
  if (m.includes("javascript") || m.includes("typescript")) return true;
  if (TEXT_FILE_EXT_REGEX.test(name)) return true;
  return false;
}

function isDocx(mime: string, name: string): boolean {
  if ((mime || "").toLowerCase() === DOCX_MIME) return true;
  return /\.docx$/i.test(name);
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return (result?.value || "").trim();
}

// Estimasi halaman DOCX dari jumlah kata (~400 kata/halaman, mendekati Word default).
function estimateDocxPages(text: string): number {
  if (!text) return 1;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 400));
}

const pustakaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // hard cap 200MB; tier dicek di handler
});

// ── POST /api/pustaka — upload file & parse ───────────────────────────────────
app.post("/api/pustaka", requireAuth, pustakaUpload.single("file"), async (req, res) => {
  const userId = (req as any).userId;
  const file = req.file;
  if (!file) { res.status(400).json({ error: "File wajib di-attach" }); return; }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role, is_premium, premium_expires_at, tier")
    .eq("id", userId)
    .single();
  const isAdmin = profile?.role === "admin";
  const tier = getTier(profile);
  const limits = getPustakaLimits(tier, isAdmin);

  if (file.size > limits.fileBytes) {
    const maxMb = Math.floor(limits.fileBytes / 1024 / 1024);
    res.status(413).json({ error: `File terlalu besar. Maksimal ${maxMb} MB untuk tier ${tier}.` });
    return;
  }

  if (limits.fileCount !== -1) {
    const { count } = await supabaseAdmin
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count || 0) >= limits.fileCount) {
      res.status(403).json({
        error: `Kuota Pustaka habis: maks ${limits.fileCount} file untuk tier ${tier}. Hapus file lama atau upgrade.`,
      });
      return;
    }
  }

  const docId = crypto.randomUUID();
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const storagePath = `${userId}/${docId}-${safeName}`;

  const { error: storageErr } = await supabaseAdmin.storage
    .from("pustaka")
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype || "application/octet-stream",
      upsert: false,
    });
  if (storageErr) {
    res.status(500).json({ error: "Storage upload failed: " + storageErr.message });
    return;
  }

  const { data: insertedDoc, error: insertErr } = await supabaseAdmin
    .from("documents")
    .insert({
      id: docId,
      user_id: userId,
      name: file.originalname,
      file_path: storagePath,
      file_type: file.mimetype || "application/octet-stream",
      size_bytes: file.size,
      parse_status: "processing",
    })
    .select()
    .single();

  if (insertErr || !insertedDoc) {
    await supabaseAdmin.storage.from("pustaka").remove([storagePath]);
    res.status(500).json({ error: insertErr?.message || "DB insert failed" });
    return;
  }

  const mime = (file.mimetype || "").toLowerCase();
  const isPdf = mime === "application/pdf";
  const isImage = mime.startsWith("image/");
  const textFile = isTextFile(mime, file.originalname);
  const docxFile = isDocx(mime, file.originalname);

  try {
    if (textFile) {
      const text = file.buffer.toString("utf8");
      await supabaseAdmin
        .from("documents")
        .update({
          extracted_text: text.slice(0, 500_000),
          page_count: 0,
          parse_status: "done",
        })
        .eq("id", docId);
    } else if (docxFile) {
      const monthUsage = await getMonthlyPageUsage(userId);
      if (monthUsage.used >= limits.pagesPerMonth) {
        await supabaseAdmin
          .from("documents")
          .update({
            parse_status: "skipped",
            parse_error: "Kuota halaman bulan ini habis",
          })
          .eq("id", docId);
      } else {
        const text = await extractDocxText(file.buffer);
        const pageCount = estimateDocxPages(text);
        if (monthUsage.used + pageCount > limits.pagesPerMonth) {
          await supabaseAdmin
            .from("documents")
            .update({
              parse_status: "skipped",
              parse_error: `Butuh ~${pageCount} halaman, sisa kuota ${limits.pagesPerMonth - monthUsage.used} halaman`,
            })
            .eq("id", docId);
        } else {
          await supabaseAdmin
            .from("documents")
            .update({
              extracted_text: text.slice(0, 500_000),
              page_count: pageCount,
              parse_status: "done",
            })
            .eq("id", docId);
          await incrementMonthlyPageUsage(userId, pageCount);
        }
      }
    } else if (isPdf || isImage) {
      const monthUsage = await getMonthlyPageUsage(userId);
      if (monthUsage.used >= limits.pagesPerMonth) {
        await supabaseAdmin
          .from("documents")
          .update({
            parse_status: "skipped",
            parse_error: "Kuota halaman bulan ini habis",
          })
          .eq("id", docId);
      } else {
        const { text, pageCount } = await azureExtractText(file.buffer, file.mimetype);
        if (monthUsage.used + pageCount > limits.pagesPerMonth) {
          await supabaseAdmin
            .from("documents")
            .update({
              parse_status: "skipped",
              parse_error: `Butuh ${pageCount} halaman, sisa kuota ${limits.pagesPerMonth - monthUsage.used} halaman`,
            })
            .eq("id", docId);
        } else {
          await supabaseAdmin
            .from("documents")
            .update({
              extracted_text: text.slice(0, 500_000),
              page_count: pageCount,
              parse_status: "done",
            })
            .eq("id", docId);
          await incrementMonthlyPageUsage(userId, pageCount);
        }
      }
    } else {
      await supabaseAdmin
        .from("documents")
        .update({
          parse_status: "skipped",
          parse_error: `Tipe file belum didukung untuk parsing: ${mime || "unknown"}`,
        })
        .eq("id", docId);
    }
  } catch (e: any) {
    console.error("[Pustaka] parse error:", e);
    await supabaseAdmin
      .from("documents")
      .update({
        parse_status: "failed",
        parse_error: String(e?.message || e).slice(0, 500),
      })
      .eq("id", docId);
  }

  const { data: finalDoc } = await supabaseAdmin
    .from("documents")
    .select("*")
    .eq("id", docId)
    .single();

  res.json({ document: finalDoc });
});

// ── POST /api/parse-file — extract text dari file untuk attach chat (no DB) ──
// Mendukung text/code, DOCX, PDF, image (Azure). Return { name, content, pageCount }
const parseFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB cap untuk attach chat
});

app.post("/api/parse-file", requireAuth, parseFileUpload.single("file"), async (req, res) => {
  const userId = (req as any).userId;
  const file = req.file;
  if (!file) { res.status(400).json({ error: "File wajib di-attach" }); return; }

  const mime = (file.mimetype || "").toLowerCase();
  const name = file.originalname;

  try {
    if (isTextFile(mime, name)) {
      const text = file.buffer.toString("utf8");
      res.json({ name, content: text.slice(0, 500_000), pageCount: 0 });
      return;
    }

    const isPdf = mime === "application/pdf" || /\.pdf$/i.test(name);
    const isImage = mime.startsWith("image/");
    const isDocxFile = isDocx(mime, name);

    if (isPdf || isImage || isDocxFile) {
      // Cek kuota halaman bulanan (pakai sistem yg sama dgn Pustaka)
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role, is_premium, premium_expires_at, tier")
        .eq("id", userId)
        .single();
      const isAdmin = profile?.role === "admin";
      const tier = getTier(profile);
      const limits = getPustakaLimits(tier, isAdmin);
      const monthUsage = await getMonthlyPageUsage(userId);
      if (monthUsage.used >= limits.pagesPerMonth) {
        res.status(403).json({ error: `Kuota halaman bulan ini habis (${limits.pagesPerMonth} hal/bulan untuk tier ${tier})` });
        return;
      }

      let text = "";
      let pageCount = 0;
      if (isDocxFile) {
        text = await extractDocxText(file.buffer);
        pageCount = estimateDocxPages(text);
      } else {
        const azure = await azureExtractText(file.buffer, file.mimetype);
        text = azure.text;
        pageCount = azure.pageCount;
      }

      if (monthUsage.used + pageCount > limits.pagesPerMonth) {
        res.status(403).json({
          error: `Butuh ~${pageCount} halaman, sisa kuota ${limits.pagesPerMonth - monthUsage.used} halaman`,
        });
        return;
      }
      await incrementMonthlyPageUsage(userId, pageCount);
      res.json({ name, content: text.slice(0, 500_000), pageCount });
      return;
    }

    res.status(415).json({ error: `Tipe file belum didukung: ${mime || name}` });
  } catch (e: any) {
    console.error("[parse-file] error:", e);
    res.status(500).json({ error: String(e?.message || e).slice(0, 500) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CHAT BACKGROUND GENERATION
// Memungkinkan generation tetap lanjut walaupun user refresh halaman.
// Server simpan partial content ke DB tiap ~1500ms; client poll untuk update.
// ─────────────────────────────────────────────────────────────────────────────

async function bumpDailyTokenUsage(userId: string, promptTokens: number, completionTokens: number) {
  const today = getTodayWIB();
  try {
    const { data: existing } = await supabaseAdmin
      .from("daily_token_usage")
      .select("*")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("daily_token_usage")
        .update({
          prompt_tokens: (existing.prompt_tokens || 0) + promptTokens,
          completion_tokens: (existing.completion_tokens || 0) + completionTokens,
          total_tokens: (existing.total_tokens || 0) + promptTokens + completionTokens,
          messages: (existing.messages || 0) + 1,
        })
        .eq("user_id", userId)
        .eq("date", today);
    } else {
      await supabaseAdmin.from("daily_token_usage").insert({
        user_id: userId,
        date: today,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        messages: 1,
      });
    }
  } catch (e) {
    console.warn("[bumpDailyTokenUsage] error:", e);
  }
}

// Background generation: streaming Qwen → akumulasi → simpan ke DB tiap 1.5s
async function runChatGenerationBg(
  aiMsgId: string,
  userId: string,
  models: string[],
  history: any[],
  enableThinking: boolean,
) {
  let fullContent = "";
  let fullThinking = "";
  let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;
  let succeeded = false;

  for (const model of models) {
    try {
      const upstream = await fetch(`${DASHSCOPE_COMPATIBLE_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dashscopeApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: history,
          stream: true,
          stream_options: { include_usage: true },
          enable_thinking: !!enableThinking,
        }),
      });

      if (!upstream.ok || !upstream.body) {
        console.warn(`[bg-gen] model ${model} responded ${upstream.status}, trying next`);
        continue;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let lastSave = Date.now();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.reasoning_content) fullThinking += delta.reasoning_content;
            if (delta?.content) fullContent += delta.content;
            if (parsed.usage) {
              usage = {
                promptTokens: parsed.usage.prompt_tokens || 0,
                completionTokens: parsed.usage.completion_tokens || 0,
                totalTokens: parsed.usage.total_tokens || 0,
              };
            }
          } catch {}
        }
        if (Date.now() - lastSave > 800 && fullContent) {
          await supabaseAdmin
            .from("messages")
            .update({ content: fullContent })
            .eq("id", aiMsgId);
          lastSave = Date.now();
        }
      }

      if (fullContent || fullThinking) {
        succeeded = true;
        break;
      }
    } catch (e) {
      console.warn(`[bg-gen] model ${model} exception:`, e);
      continue;
    }
  }

  // Estimasi token kalau Qwen gak balikin usage
  if (!usage) {
    const estPrompt = Math.ceil(JSON.stringify(history).length / 4);
    const estCompletion = Math.ceil(fullContent.length / 4);
    usage = { promptTokens: estPrompt, completionTokens: estCompletion, totalTokens: estPrompt + estCompletion };
  }

  const finalContent = succeeded
    ? fullContent
    : (fullContent || "Gagal generate jawaban: semua model tidak tersedia. Coba lagi sebentar lagi.");

  // Final save: tandai DONE dengan menyimpan total_tokens (konvensi: !=null = selesai)
  await supabaseAdmin
    .from("messages")
    .update({
      content: finalContent,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
    })
    .eq("id", aiMsgId);

  if (succeeded) {
    bumpDailyTokenUsage(userId, usage.promptTokens, usage.completionTokens).catch(() => {});
  }
}

// POST /api/chat/bg-generate — start background generation, return immediately
app.post("/api/chat/bg-generate", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  let body: any = {};
  try {
    const raw = req.body instanceof Buffer ? req.body.toString("utf8") : req.body;
    body = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {}

  const { chatId, aiMsgId, models, messages, enableThinking } = body || {};
  if (!chatId || !aiMsgId || !Array.isArray(models) || !Array.isArray(messages)) {
    res.status(400).json({ error: "Missing chatId/aiMsgId/models/messages" });
    return;
  }

  // Verify chat ownership
  const { data: convo } = await supabaseAdmin
    .from("conversations")
    .select("user_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!convo || convo.user_id !== userId) {
    res.status(403).json({ error: "Chat tidak ditemukan atau bukan milik Anda" });
    return;
  }

  // Tier & quota check
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role, is_premium, premium_expires_at, tier")
    .eq("id", userId)
    .single();
  const isAdmin = profile?.role === "admin";
  const tier = getTier(profile ?? null);
  const today = getTodayWIB();
  const { tokenLimit } = getTierLimits(tier, isAdmin);
  const { data: usageRow } = await supabaseAdmin
    .from("daily_token_usage")
    .select("total_tokens")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();
  const todayTokens = usageRow?.total_tokens ?? 0;
  if (todayTokens >= tokenLimit) {
    res.status(429)
      .set("X-Pioo-Error", "QUOTA_EXCEEDED")
      .json({ error: `Limit harian ${tokenLimit.toLocaleString()} token sudah tercapai. Coba lagi besok ya!` });
    return;
  }

  // Premium-model restriction
  const isPremium = isAdmin || tier !== "free";
  if (!isPremium) {
    for (const m of models) {
      if (PREMIUM_ONLY_MODELS.has(m)) {
        res.status(403)
          .set("X-Pioo-Error", "MODEL_RESTRICTED")
          .json({ error: `Model "${m}" hanya tersedia untuk pengguna Plus.` });
        return;
      }
    }
  }

  // Insert AI placeholder (idempotent: kalau aiMsgId sudah ada, skip)
  const { data: existing } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("id", aiMsgId)
    .maybeSingle();
  if (!existing) {
    const { error: insertErr } = await supabaseAdmin
      .from("messages")
      .insert({
        id: aiMsgId,
        conversation_id: chatId,
        role: "ai",
        content: "",
      });
    if (insertErr) {
      res.status(500).json({ error: insertErr.message });
      return;
    }
  }

  // Bump conversation updated_at
  supabaseAdmin
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", chatId)
    .then(() => {});

  // Return immediately, work continues in background
  res.json({ ok: true, aiMsgId });

  // Background work — TIDAK akan terhenti walau client refresh/disconnect
  setImmediate(() => {
    runChatGenerationBg(aiMsgId, userId, models, messages, !!enableThinking)
      .catch((e) => console.error("[bg-gen] fatal:", e));
  });
});

// GET /api/chat/bg-poll/:msgId — poll status pesan yang sedang di-generate
app.get("/api/chat/bg-poll/:msgId", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const msgId = req.params.msgId;

  const { data: msg } = await supabaseAdmin
    .from("messages")
    .select("id, content, prompt_tokens, completion_tokens, total_tokens, conversation_id, created_at")
    .eq("id", msgId)
    .maybeSingle();
  if (!msg) { res.status(404).json({ error: "Pesan tidak ditemukan" }); return; }

  // Verify ownership via conversation
  const { data: convo } = await supabaseAdmin
    .from("conversations")
    .select("user_id")
    .eq("id", msg.conversation_id)
    .maybeSingle();
  if (!convo || convo.user_id !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const isDone = msg.total_tokens != null;
  res.json({
    content: msg.content || "",
    status: isDone ? "done" : "generating",
    tokenUsage: isDone ? {
      promptTokens: msg.prompt_tokens || 0,
      completionTokens: msg.completion_tokens || 0,
      totalTokens: msg.total_tokens || 0,
    } : null,
  });
});

// ── GET /api/pustaka — list dokumen user ──────────────────────────────────────
app.get("/api/pustaka", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("id, name, file_type, size_bytes, page_count, parse_status, parse_error, tags, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ documents: data || [] });
});

// ── GET /api/pustaka/usage — kuota Pustaka user ───────────────────────────────
app.get("/api/pustaka/usage", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role, is_premium, premium_expires_at, tier")
    .eq("id", userId)
    .single();
  const isAdmin = profile?.role === "admin";
  const tier = getTier(profile);
  const limits = getPustakaLimits(tier, isAdmin);
  const { count: fileCount } = await supabaseAdmin
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  const { used: pagesUsed } = await getMonthlyPageUsage(userId);
  res.json({
    tier,
    isAdmin,
    fileCount: fileCount || 0,
    fileLimit: limits.fileCount,
    fileMaxBytes: limits.fileBytes,
    pagesUsed,
    pagesLimit: limits.pagesPerMonth,
  });
});

// ── GET /api/pustaka/:id/text — fetch extracted text (buat attach ke chat) ────
app.get("/api/pustaka/:id/text", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("name, extracted_text, parse_status")
    .eq("id", req.params.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) { res.status(404).json({ error: "Dokumen tidak ditemukan" }); return; }
  if (data.parse_status !== "done") {
    res.status(400).json({ error: `Dokumen belum siap (status: ${data.parse_status})` });
    return;
  }
  res.json({ name: data.name, text: data.extracted_text || "" });
});

// ── DELETE /api/pustaka/:id ───────────────────────────────────────────────────
app.delete("/api/pustaka/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: doc } = await supabaseAdmin
    .from("documents")
    .select("file_path")
    .eq("id", req.params.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!doc) { res.status(404).json({ error: "Dokumen tidak ditemukan" }); return; }

  await supabaseAdmin.storage.from("pustaka").remove([doc.file_path]);
  await supabaseAdmin
    .from("documents")
    .delete()
    .eq("id", req.params.id)
    .eq("user_id", userId);
  res.json({ ok: true });
});

// ── PATCH /api/pustaka/:id — rename / tag dokumen ─────────────────────────────
app.patch("/api/pustaka/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  let body: any = {};
  try {
    const raw = req.body instanceof Buffer ? req.body.toString("utf8") : req.body;
    body = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { /**/ }
  const update: any = {};
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim().slice(0, 200);
  if (Array.isArray(body.tags)) update.tags = body.tags.map((t: any) => String(t).slice(0, 40)).slice(0, 20);
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "Tidak ada field yang diupdate" }); return; }
  update.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("documents")
    .update(update)
    .eq("id", req.params.id)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  if (error || !data) { res.status(500).json({ error: error?.message || "Update gagal" }); return; }
  res.json({ document: data });
});

// Cek apakah port sudah dipakai sebelum mencoba bind
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createConnection({ port, host: "127.0.0.1" });
    tester.once("connect", () => { tester.destroy(); resolve(true); });
    tester.once("error", () => resolve(false));
    tester.setTimeout(200, () => { tester.destroy(); resolve(false); });
  });
}

// Serve static files in production (dist/public built by Vite)
if (IS_PRODUCTION) {
  const staticDir = path.join(__dirname, "..", "dist", "public");
  app.use(express.static(staticDir));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

const portTaken = IS_PRODUCTION ? false : await isPortInUse(SERVER_PORT);
if (portTaken) {
  console.log(`[PioCode API] Port ${SERVER_PORT} sudah dipakai instance lain. Skip start server.`);
  // Jaga event loop tetap hidup agar Vite di concurrently tidak mati
  setInterval(() => {}, 60_000);
} else {
  const server = app.listen(SERVER_PORT, "0.0.0.0", () => {
    console.log(`[PioCode API] Secure proxy running on port ${SERVER_PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error("[PioCode API] Server error:", err.code, err.message);
    // Jika port tetiba ditangkap instance lain, tetap jaga proses
    setInterval(() => {}, 60_000);
  });

  process.on("uncaughtException", (err) => {
    console.error("[PioCode API] Uncaught exception:", err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[PioCode API] Unhandled rejection:", reason);
  });
}
