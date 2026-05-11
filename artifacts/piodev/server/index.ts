import express from "express";
import { createClient } from "@supabase/supabase-js";
import net from "net";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import nodemailer from "nodemailer";

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
const PLUS_UPGRADE_BONUS_IDR = 45_000;   // bonus sekali saat upgrade ke Plus
const PRO_UPGRADE_BONUS_IDR  = 100_000;  // bonus sekali saat upgrade ke Pro

// ── Trial Plus (uji coba gratis 1 bulan, sekali per akun) ─────────────────────
// Bonus saldo trial = Rp 45.000 (sama nominal dengan bonus upgrade berbayar).
// Pake ledger type SEPARATE 'bonus_plus_trial' supaya GAK ngeblok bonus upgrade
// berbayar nanti — user yang trial → nanti beli paket Plus berbayar TETEP dapet
// bonus 45k lagi via 'bonus_plus_upgrade'. Total maksimum: 90k per user (45k
// trial + 45k upgrade berbayar). Re-claim trial dicegah oleh kolom
// `profiles.trial_claimed_at` (bukan oleh idempotency cek ledger).
const PLUS_TRIAL_BONUS_IDR    = 45_000;  // bonus saldo saat klaim trial
const PLUS_TRIAL_DURATION_DAYS = 30;     // durasi trial

function tokensToIdr(tokens: number): number {
  if (!tokens || tokens <= 0) return 0;
  return Math.ceil((tokens * IDR_PER_TOKEN_NUM) / IDR_PER_TOKEN_DEN);
}

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com";
const DASHSCOPE_COMPATIBLE_BASE = `${DASHSCOPE_BASE}/compatible-mode/v1`;

// Model-model yang hanya boleh dipakai user Plus/Pro/Admin (Free akan kena 403 MODEL_RESTRICTED)
// Model yang boleh diakses Free user via API key (3 model paling ringan)
const FREE_API_MODELS = new Set(["qwen-flash", "qwen-turbo", "qwen3-8b"]);

// Bonus welcome untuk user baru
const SIGNUP_BONUS_IDR = 7_500;

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
app.use(express.json({
  limit: "25mb",
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
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

// ── POST /api/admin/broadcast-email ──────────────────────────────────────────
// Kirim email broadcast ke semua user atau user terpilih, pakai SMTP yang
// dikonfigurasi lewat env var SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
app.post("/api/admin/broadcast-email", requireAuth, requireAdmin, async (req, res) => {
  const { subject, body, userIds, tiers } = req.body as {
    subject?: string;
    body?: string;
    userIds?: string[] | "all";
    tiers?: string[]; // ["free","plus","pro"] — kosong/undefined = semua
  };
  if (!subject?.trim()) { res.status(400).json({ error: "Subject wajib diisi." }); return; }
  if (!body?.trim()) { res.status(400).json({ error: "Isi email wajib diisi." }); return; }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT ?? 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass) {
    res.status(503).json({
      error: "SMTP belum dikonfigurasi.",
      smtp_missing: true,
    });
    return;
  }

  const { data: authUsers, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
  if (authErr) { res.status(500).json({ error: authErr.message }); return; }

  let recipients: { id: string; email: string }[];

  if (!userIds || userIds === "all") {
    // Filter by tier jika diminta
    const filterByTier = tiers && tiers.length > 0 && tiers.length < 3;
    if (filterByTier) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, is_premium, premium_expires_at");
      const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      recipients = authUsers.users
        .filter((u) => {
          if (!u.email || !u.email_confirmed_at) return false;
          const userTier = getTier(profileMap.get(u.id) ?? null);
          return tiers!.includes(userTier);
        })
        .map((u) => ({ id: u.id, email: u.email! }));
    } else {
      recipients = authUsers.users
        .filter((u) => u.email && u.email_confirmed_at)
        .map((u) => ({ id: u.id, email: u.email! }));
    }
  } else {
    const idSet = new Set(userIds as string[]);
    recipients = authUsers.users
      .filter((u) => u.email && idSet.has(u.id))
      .map((u) => ({ id: u.id, email: u.email! }));
  }

  if (recipients.length === 0) {
    res.status(400).json({ error: "Tidak ada penerima yang valid." }); return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const buildHtml = (subj: string, txt: string) => `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subj}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="background:#18181b;padding:24px 36px;">
        <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">PioCode</span>
      </td></tr>
      <tr><td style="padding:32px 36px;">
        <h2 style="margin:0 0 18px;font-size:20px;font-weight:700;color:#18181b;line-height:1.3;">${subj}</h2>
        <div style="font-size:15px;color:#3f3f46;line-height:1.75;">${txt.replace(/\n/g, "<br>")}</div>
      </td></tr>
      <tr><td style="padding:20px 36px;border-top:1px solid #e4e4e7;">
        <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5;">Kamu menerima email ini karena terdaftar di PioCode. Jika tidak ingin menerima email semacam ini, hubungi kami.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    try {
      await transporter.sendMail({
        from: smtpFrom,
        to: r.email,
        subject: subject.trim(),
        html: buildHtml(subject.trim(), body.trim()),
        text: body.trim(), // plain-text fallback — penting untuk deliverability
        headers: {
          "List-Unsubscribe": `<mailto:${smtpUser}?subject=unsubscribe>`,
          "Precedence": "bulk",
          "X-Mailer": "PioCode Broadcast",
        },
      });
      sent++;
    } catch (e: any) {
      failed++;
      errors.push(`${r.email}: ${e.message}`);
    }
    if (i > 0 && i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`[Broadcast Email] subject="${subject}" tiers=${JSON.stringify(tiers)} total=${recipients.length} sent=${sent} failed=${failed}`);
  res.json({ ok: true, sent, failed, total: recipients.length, errors: errors.slice(0, 20) });
});

// ── POST /api/redeem — user redeem code ──────────────────────────────────────
app.post("/api/redeem", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { code } = req.body as { code?: string };
  if (!code?.trim()) { res.status(400).json({ error: "Kode tidak boleh kosong." }); return; }

  const normalized = code.trim().toUpperCase();

  const { data: rc, error: rcErr } = await supabaseAdmin
    .from("redeem_codes")
    .select("*")
    .eq("code", normalized)
    .single();

  if (rcErr || !rc) { res.status(404).json({ error: "Kode tidak ditemukan." }); return; }
  if (!rc.is_active) { res.status(400).json({ error: "Kode ini sudah tidak aktif." }); return; }
  if (rc.expires_at && new Date(rc.expires_at) < new Date()) {
    res.status(400).json({ error: "Kode sudah kedaluwarsa." }); return;
  }
  if (rc.max_redemptions !== null && rc.current_redemptions >= rc.max_redemptions) {
    res.status(400).json({ error: "Kuota kode ini sudah habis." }); return;
  }

  const { data: existing } = await supabaseAdmin
    .from("code_redemptions")
    .select("id")
    .eq("code_id", rc.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) { res.status(400).json({ error: "Kamu sudah pernah memakai kode ini." }); return; }

  const newBalance = await addCredit(userId, rc.credit_amount_idr, "redeem_code", {
    code: rc.code, code_id: rc.id, description: rc.description,
  });

  await supabaseAdmin.from("code_redemptions").insert({
    code_id: rc.id, user_id: userId, credit_amount_idr: rc.credit_amount_idr,
  });
  await supabaseAdmin.from("redeem_codes")
    .update({ current_redemptions: rc.current_redemptions + 1 })
    .eq("id", rc.id);

  console.log(`[Redeem] userId=${userId} code="${rc.code}" amount=${rc.credit_amount_idr} newBalance=${newBalance}`);
  res.json({ ok: true, credit_added: rc.credit_amount_idr, new_balance_idr: newBalance, description: rc.description });
});

// ── GET /api/admin/redeem-codes ───────────────────────────────────────────────
app.get("/api/admin/redeem-codes", requireAuth, requireAdmin, async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from("redeem_codes").select("*").order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ codes: data ?? [] });
});

// ── POST /api/admin/redeem-codes ──────────────────────────────────────────────
app.post("/api/admin/redeem-codes", requireAuth, requireAdmin, async (req, res) => {
  const userId = (req as any).userId;
  const { code, description, credit_amount_idr, max_redemptions, expires_at } = req.body as {
    code?: string; description?: string; credit_amount_idr?: number;
    max_redemptions?: number | null; expires_at?: string | null;
  };
  if (!code?.trim()) { res.status(400).json({ error: "Kode wajib diisi." }); return; }
  if (!credit_amount_idr || Number(credit_amount_idr) <= 0) {
    res.status(400).json({ error: "Jumlah kredit harus lebih dari 0." }); return;
  }
  const { data, error } = await supabaseAdmin.from("redeem_codes").insert({
    code: code.trim().toUpperCase(),
    description: description?.trim() || null,
    credit_amount_idr: Number(credit_amount_idr),
    max_redemptions: max_redemptions != null && max_redemptions !== 0 ? Number(max_redemptions) : null,
    expires_at: expires_at || null,
    created_by: userId,
  }).select().single();
  if (error) {
    if (error.code === "23505") { res.status(409).json({ error: "Kode sudah dipakai. Gunakan nama lain." }); }
    else { res.status(500).json({ error: error.message }); }
    return;
  }
  res.json({ ok: true, code: data });
});

// ── PATCH /api/admin/redeem-codes/:id ────────────────────────────────────────
app.patch("/api/admin/redeem-codes/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const updates: Record<string, any> = {};
  if (typeof req.body.is_active === "boolean") updates.is_active = req.body.is_active;
  if (req.body.description !== undefined) updates.description = req.body.description;
  const { error } = await supabaseAdmin.from("redeem_codes").update(updates).eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ── DELETE /api/admin/redeem-codes/:id ───────────────────────────────────────
app.delete("/api/admin/redeem-codes/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabaseAdmin.from("redeem_codes").delete().eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
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

  // 4. Kasih bonus saldo Rp 45.000 via type 'bonus_plus_trial' (terpisah dari
  //    'bonus_plus_upgrade' supaya nanti user yg upgrade ke Plus berbayar TETEP
  //    dapet bonus 45k lagi). Trial cuma sekali per akun (di-enforce oleh kolom
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

  // Update last_used_at (fire and forget)
  supabaseAdmin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id).then(() => {});

  (req as any).apiUserId = userId;
  (req as any).apiKeyId = keyRow.id;
  (req as any).apiIsAdmin = isAdmin;
  // Admin diperlakukan setara Pro untuk pembatasan model
  (req as any).apiTier = isAdmin ? "pro" : userTier;
  // Free tier: hanya boleh pakai 3 model ringan
  (req as any).apiIsFreeRestricted = !isAdmin && userTier === "free";
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
 * - Plus: Rp 45.000 sekali. Skip kalau user udah pernah dapet bonus Plus atau Pro.
 * - Pro: Rp 100.000 sekali. Kalau user udah pernah Plus, kasih selisih (Rp 55.000).
 *   Kalau belum pernah, kasih full Rp 100.000.
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

// ── POST /api/me/api-keys — buat key baru (terbuka untuk semua tier) ─────────
app.post("/api/me/api-keys", requireAuth, async (req, res) => {
  const userId = (req as any).userId;

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

  // Signup bonus — grant idempotently untuk user baru (cek sebelum baca saldo)
  try {
    const { count: bonusCount } = await supabaseAdmin
      .from("credit_transactions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("type", "bonus_signup");
    if ((bonusCount ?? 0) === 0) {
      await addCredit(userId, SIGNUP_BONUS_IDR, "bonus_signup", { note: "Bonus selamat datang untuk member baru" });
    }
  } catch { /* tabel belum ada, skip */ }

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

// ── GET /api/me/billing-summary — saldo + breakdown kategori bulan ini + transaksi terakhir ──
app.get("/api/me/billing-summary", requireAuth, async (req, res) => {
  const userId = (req as any).userId;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [profileRes, txMonthRes, txRecentRes] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("credit_balance_idr, is_premium, premium_expires_at, role, tier")
      .eq("id", userId)
      .single(),
    supabaseAdmin
      .from("credit_transactions")
      .select("amount_idr, type")
      .eq("user_id", userId)
      .gte("created_at", startOfMonth),
    supabaseAdmin
      .from("credit_transactions")
      .select("id, amount_idr, type, metadata, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const profile = profileRes.data;
  const tier = getTier(profile);
  const isAdmin = profile?.role === "admin";
  const isPremium = isAdmin || tier !== "free";

  const byCategory: Record<string, number> = { chat: 0, image: 0, video: 0, voice: 0, hosting: 0, api: 0 };
  let totalSpent = 0;
  let totalIn = 0;

  for (const tx of (txMonthRes.data ?? []) as { amount_idr: number; type: string }[]) {
    const amt = tx.amount_idr ?? 0;
    if (amt < 0) {
      const spent = -amt;
      totalSpent += spent;
      const t = tx.type ?? "";
      if (t.includes("chat"))    byCategory.chat    += spent;
      else if (t.includes("image"))   byCategory.image   += spent;
      else if (t.includes("video"))   byCategory.video   += spent;
      else if (t.includes("voice"))   byCategory.voice   += spent;
      else if (t.includes("hosting")) byCategory.hosting += spent;
      else if (t.includes("api"))     byCategory.api     += spent;
    } else {
      totalIn += amt;
    }
  }

  res.json({
    balance_idr: (profile as any)?.credit_balance_idr ?? 0,
    tier,
    is_premium: isPremium,
    is_admin: isAdmin,
    this_month: {
      total_spent: totalSpent,
      total_in: totalIn,
      by_category: byCategory,
    },
    recent_transactions: txRecentRes.data ?? [],
    pricing: {
      idr_per_token_num: IDR_PER_TOKEN_NUM,
      idr_per_token_den: IDR_PER_TOKEN_DEN,
      image_idr: IMAGE_COST_IDR,
      video_idr: VIDEO_COST_IDR,
    },
  });
});

// ── GET /api/me/transactions?month=YYYY-MM — riwayat transaksi per bulan ──
app.get("/api/me/transactions", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const fromParam = req.query.from as string;
  const toParam   = req.query.to   as string;

  let startDate: Date;
  let endDate: Date;

  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  if (fromParam && toParam && isoRe.test(fromParam) && isoRe.test(toParam)) {
    startDate = new Date(fromParam);
    endDate   = new Date(toParam);
  } else {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  const { data, error } = await supabaseAdmin
    .from("credit_transactions")
    .select("id, amount_idr, type, metadata, created_at")
    .eq("user_id", userId)
    .gte("created_at", startDate.toISOString())
    .lt("created_at", endDate.toISOString())
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const txs = data ?? [];

  // Group by date label
  const groupMap: Record<string, typeof txs> = {};
  for (const tx of txs) {
    const key = new Date(tx.created_at).toLocaleDateString("id-ID", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(tx);
  }

  res.json({
    transactions: txs,
    grouped: Object.entries(groupMap).map(([date, items]) => ({ date, items })),
    total_spent: txs.filter(t => t.amount_idr < 0).reduce((s, t) => s + (-t.amount_idr), 0),
    total_in:    txs.filter(t => t.amount_idr >= 0).reduce((s, t) => s + t.amount_idr, 0),
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

  // Free tier restriction: hanya 3 model yang diizinkan
  if ((req as any).apiIsFreeRestricted) {
    const model = body.model ?? "";
    if (model && !FREE_API_MODELS.has(model)) {
      res.status(403).json({ error: {
        message: `Model "${model}" tidak tersedia untuk tier Free. Model yang bisa dipakai via API: ${[...FREE_API_MODELS].join(", ")}. Upgrade ke Plus untuk akses semua model.`,
        type: "permission_denied",
        free_models: [...FREE_API_MODELS],
      }});
      return;
    }
  }

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

  // Free tier: image gen tidak tersedia via API
  if ((req as any).apiIsFreeRestricted) {
    res.status(403).json({ error: { message: "Image generation via API tidak tersedia untuk tier Free. Upgrade ke Plus.", type: "permission_denied" }});
    return;
  }

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

  // Free tier: video gen tidak tersedia via API
  if ((req as any).apiIsFreeRestricted) {
    res.status(403).json({ error: { message: "Video generation via API tidak tersedia untuk tier Free. Upgrade ke Plus.", type: "permission_denied" }});
    return;
  }

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

// ── HOSTING (Coolify integration) ─────────────────────────────────────────────
const COOLIFY_API_URL = (process.env.COOLIFY_API_URL ?? "").replace(/\/$/, "");
const COOLIFY_API_TOKEN = process.env.COOLIFY_API_TOKEN ?? "";
const COOLIFY_BASE_DOMAIN = process.env.COOLIFY_BASE_DOMAIN ?? "app.pio.codes";
const HOSTING_LIMITS: Record<string, number> = { free: 1, plus: 3, pro: 5 };
const HOSTING_MEMORY_MB: Record<string, number> = { free: 256, plus: 512, pro: 1024 };
const HOSTING_HOURLY_COST_IDR: Record<string, number> = { free: 30, plus: 60, pro: 120 };
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";
const SITE_URL = process.env.SITE_URL ?? (
  IS_PRODUCTION
    ? "https://pio.codes"
    : `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`
);

function getAppBaseUrl(): string {
  // Explicit SITE_URL env var always wins — allows dev to point callbacks at production domain
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (IS_PRODUCTION) return SITE_URL;
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}:${process.env.PORT ?? 5000}`;
  return SITE_URL;
}

function getGithubCallbackUrl(): string {
  return `${getAppBaseUrl()}/api/hosting/github/oauth/callback`;
}

const githubOAuthStates = new Map<string, { userId: string; ts: number }>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of githubOAuthStates.entries()) {
    if (v.ts < cutoff) githubOAuthStates.delete(k);
  }
}, 5 * 60 * 1000);

let _coolifyServerUuid: string | null = null;
let _coolifyProjectUuid: string | null = null;

async function coolifyFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  if (!COOLIFY_API_URL || !COOLIFY_API_TOKEN) throw new Error("Coolify not configured");
  return fetch(`${COOLIFY_API_URL}/api/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${COOLIFY_API_TOKEN}`,
      "Content-Type": "application/json",
      ...((opts.headers as Record<string, string>) ?? {}),
    },
  });
}

async function getCoolifyServerUuid(): Promise<string> {
  if (_coolifyServerUuid) return _coolifyServerUuid;
  const res = await coolifyFetch("/servers");
  if (!res.ok) throw new Error(`Coolify servers error: ${res.status}`);
  const data: { uuid: string }[] = await res.json();
  if (!data?.length) throw new Error("No Coolify servers found");
  _coolifyServerUuid = data[0].uuid;
  return _coolifyServerUuid!;
}

async function getCoolifyProjectUuid(): Promise<string> {
  if (_coolifyProjectUuid) return _coolifyProjectUuid;
  const listRes = await coolifyFetch("/projects");
  if (listRes.ok) {
    const projects: { uuid: string; name: string }[] = await listRes.json();
    const existing = Array.isArray(projects) && projects.find((p) => p.name === "PioCode Hosting");
    if (existing) { _coolifyProjectUuid = existing.uuid; return _coolifyProjectUuid!; }
  }
  const createRes = await coolifyFetch("/projects", {
    method: "POST",
    body: JSON.stringify({ name: "PioCode Hosting", description: "Managed by PioCode" }),
  });
  if (!createRes.ok) throw new Error(`Coolify project create error: ${createRes.status}`);
  const created: { uuid: string } = await createRes.json();
  _coolifyProjectUuid = created.uuid;
  return _coolifyProjectUuid!;
}

function hostingSlugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "app";
}

/**
 * Generate a custom Dockerfile for a Node.js/pnpm project.
 * Uses node:22-alpine from Docker Hub — bypasses Coolify's frozen nixpkgs snapshot
 * which only ships Node 18/22.11.0 (too old for Vite 7 which needs 22.12+).
 *
 * When Coolify uses an inline Dockerfile (not from repo), it does NOT clone the git
 * repository before building — so we include a `git clone` step in the Dockerfile itself.
 */
function generateNodeDockerfile(
  gitRepository: string,
  gitBranch: string,
  installBuildCmd: string,
  startCmd: string,
  port: number,
  userEnvVars: Record<string, string> = {},
): string {
  // NODE_ENV is intentionally NOT set here — pnpm skips devDependencies when
  // NODE_ENV=production, which breaks the build (vite, tailwind etc are in devDeps).
  // Coolify injects NODE_ENV=production at runtime automatically.
  const mergedVars: Record<string, string> = {
    PORT: String(port),
    BASE_PATH: "/",
    ...userEnvVars,
  };
  // ARG + ENV block so vars are available both at build time (RUN steps) and runtime
  const argBlock = Object.keys(mergedVars)
    .map((k) => `ARG ${k}=${JSON.stringify(mergedVars[k])}`)
    .join("\n");
  const envBlock = Object.keys(mergedVars)
    .map((k) => `ENV ${k}=$${k}`)
    .join("\n");

  return [
    "FROM node:22-alpine",
    `ENV PNPM_HOME="/pnpm"`,
    `ENV PATH="$PNPM_HOME:$PATH"`,
    // git is needed to clone the repo; openssh-client for private repos in future
    "RUN apk add --no-cache git openssh-client",
    "RUN corepack enable && corepack prepare pnpm@9 --activate",
    argBlock,
    envBlock,
    // Clone the repo so the build has actual source files
    `RUN git clone --depth=1 --branch ${gitBranch} ${gitRepository} /app`,
    "WORKDIR /app",
    `RUN ${installBuildCmd}`,
    `EXPOSE ${port}`,
    `CMD ["sh", "-c", ${JSON.stringify(startCmd)}]`,
  ].join("\n") + "\n";
}

function generatePythonDockerfile(
  gitRepository: string,
  gitBranch: string,
  installBuildCmd: string,
  startCmd: string,
  port: number,
  userEnvVars: Record<string, string> = {},
): string {
  const mergedVars: Record<string, string> = { PORT: String(port), ...userEnvVars };
  const argBlock = Object.keys(mergedVars).map((k) => `ARG ${k}=${JSON.stringify(mergedVars[k])}`).join("\n");
  const envBlock = Object.keys(mergedVars).map((k) => `ENV ${k}=$${k}`).join("\n");
  return [
    "FROM python:3.12-slim",
    "RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*",
    argBlock,
    envBlock,
    `RUN git clone --depth=1 --branch ${gitBranch} ${gitRepository} /app`,
    "WORKDIR /app",
    `RUN ${installBuildCmd}`,
    `EXPOSE ${port}`,
    `CMD ["sh", "-c", ${JSON.stringify(startCmd)}]`,
  ].join("\n") + "\n";
}

function generateBunDockerfile(
  gitRepository: string,
  gitBranch: string,
  installBuildCmd: string,
  startCmd: string,
  port: number,
  userEnvVars: Record<string, string> = {},
): string {
  const mergedVars: Record<string, string> = { PORT: String(port), ...userEnvVars };
  const argBlock = Object.keys(mergedVars).map((k) => `ARG ${k}=${JSON.stringify(mergedVars[k])}`).join("\n");
  const envBlock = Object.keys(mergedVars).map((k) => `ENV ${k}=$${k}`).join("\n");
  return [
    "FROM oven/bun:1-alpine",
    "RUN apk add --no-cache git",
    argBlock,
    envBlock,
    `RUN git clone --depth=1 --branch ${gitBranch} ${gitRepository} /app`,
    "WORKDIR /app",
    `RUN ${installBuildCmd}`,
    `EXPOSE ${port}`,
    `CMD ["sh", "-c", ${JSON.stringify(startCmd)}]`,
  ].join("\n") + "\n";
}

function generateDenoDockerfile(
  gitRepository: string,
  gitBranch: string,
  installBuildCmd: string,
  startCmd: string,
  port: number,
  userEnvVars: Record<string, string> = {},
): string {
  const mergedVars: Record<string, string> = { PORT: String(port), ...userEnvVars };
  const argBlock = Object.keys(mergedVars).map((k) => `ARG ${k}=${JSON.stringify(mergedVars[k])}`).join("\n");
  const envBlock = Object.keys(mergedVars).map((k) => `ENV ${k}=$${k}`).join("\n");
  return [
    "FROM denoland/deno:alpine",
    "RUN apk add --no-cache git",
    argBlock,
    envBlock,
    `RUN git clone --depth=1 --branch ${gitBranch} ${gitRepository} /app`,
    "WORKDIR /app",
    installBuildCmd ? `RUN ${installBuildCmd}` : "",
    `EXPOSE ${port}`,
    `CMD ["sh", "-c", ${JSON.stringify(startCmd)}]`,
  ].filter(l => l !== "").join("\n") + "\n";
}

function generatePhpDockerfile(
  gitRepository: string,
  gitBranch: string,
  installBuildCmd: string,
  startCmd: string,
  port: number,
  userEnvVars: Record<string, string> = {},
): string {
  const mergedVars: Record<string, string> = { PORT: String(port), ...userEnvVars };
  const argBlock = Object.keys(mergedVars).map((k) => `ARG ${k}=${JSON.stringify(mergedVars[k])}`).join("\n");
  const envBlock = Object.keys(mergedVars).map((k) => `ENV ${k}=$${k}`).join("\n");
  return [
    "FROM php:8.3-cli-alpine",
    "RUN apk add --no-cache git curl",
    "RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer",
    argBlock,
    envBlock,
    `RUN git clone --depth=1 --branch ${gitBranch} ${gitRepository} /app`,
    "WORKDIR /app",
    `RUN ${installBuildCmd}`,
    `EXPOSE ${port}`,
    `CMD ["sh", "-c", ${JSON.stringify(startCmd)}]`,
  ].join("\n") + "\n";
}

function generateStaticDockerfile(
  gitRepository: string,
  gitBranch: string,
  buildCmd: string,
  port: number,
  userEnvVars: Record<string, string> = {},
): string {
  const mergedVars: Record<string, string> = { ...userEnvVars };
  const argBlock = Object.keys(mergedVars).map((k) => `ARG ${k}=${JSON.stringify(mergedVars[k])}`).join("\n");
  const envBlock = Object.keys(mergedVars).map((k) => `ENV ${k}=$${k}`).join("\n");
  // nginx config as a single printf line — single-quotes protect $uri from shell expansion
  const nginxLine = `RUN printf 'server {\\n  listen ${port};\\n  root /usr/share/nginx/html;\\n  index index.html;\\n  location / { try_files $uri $uri/ /index.html; }\\n}\\n' > /etc/nginx/conf.d/default.conf`;
  return [
    "FROM node:22-alpine AS builder",
    `ENV PNPM_HOME="/pnpm"`,
    `ENV PATH="$PNPM_HOME:$PATH"`,
    "RUN apk add --no-cache git",
    "RUN corepack enable && corepack prepare pnpm@9 --activate",
    argBlock || "",
    envBlock || "",
    `RUN git clone --depth=1 --branch ${gitBranch} ${gitRepository} /app`,
    "WORKDIR /app",
    `RUN ${buildCmd}`,
    "",
    "FROM nginx:alpine",
    // Try dist then build then out — pick whichever exists
    "COPY --from=builder /app/dist /usr/share/nginx/html",
    nginxLine,
    `EXPOSE ${port}`,
    `CMD ["nginx", "-g", "daemon off;"]`,
  ].filter(l => l !== undefined).join("\n") + "\n";
}

/**
 * Detect runtime from build/start commands.
 * Returns a runtime key used by generateDockerfile().
 */
function detectRuntimeFromCommands(buildCmd: string, startCmd: string): string {
  const b = (buildCmd || "").toLowerCase();
  const s = (startCmd || "").toLowerCase();
  if (
    b.includes("pip install") || b.includes("pip3") || b.includes("uv pip") || b.includes("uv sync") ||
    s.includes("uvicorn") || s.includes("gunicorn") || s.includes("python ") || s.includes("python3 ")
  ) return "python";
  if (
    b.includes("bun install") || b.startsWith("bun ") || b.includes("bun run") ||
    s.startsWith("bun ") || s.includes("bun run")
  ) return "bun";
  if (
    b.includes("composer install") || b.includes("composer update") ||
    s.includes("php -s") || s.includes("php artisan")
  ) return "php";
  if (
    b.includes("deno cache") || b.includes("deno compile") ||
    s.startsWith("deno ") || s.includes("deno run")
  ) return "deno";
  // Static: nginx serve, or empty start command with a build command (likely a SPA)
  if (s.includes("nginx") || (s === "" && b !== "" && !b.includes("node"))) return "static";
  return "node";
}

/**
 * Dispatcher — pick the right Dockerfile generator based on detected runtime.
 */
function generateDockerfile(
  runtime: string,
  gitRepository: string,
  gitBranch: string,
  buildCmd: string,
  startCmd: string,
  port: number,
  userEnvVars: Record<string, string> = {},
): string {
  switch (runtime) {
    case "python": case "django": case "fastapi": case "flask":
      return generatePythonDockerfile(gitRepository, gitBranch, buildCmd, startCmd, port, userEnvVars);
    case "bun":
      return generateBunDockerfile(gitRepository, gitBranch, buildCmd, startCmd, port, userEnvVars);
    case "deno":
      return generateDenoDockerfile(gitRepository, gitBranch, buildCmd, startCmd, port, userEnvVars);
    case "php": case "laravel":
      return generatePhpDockerfile(gitRepository, gitBranch, buildCmd, startCmd, port, userEnvVars);
    case "static":
      return generateStaticDockerfile(gitRepository, gitBranch, buildCmd, port, userEnvVars);
    default:
      return generateNodeDockerfile(gitRepository, gitBranch, buildCmd, startCmd, port, userEnvVars);
  }
}

/**
 * Push environment variables to a Coolify application.
 * PORT and BASE_PATH are baked into the Dockerfile ARG/ENV for build-time access,
 * but we also sync them here so Coolify injects them as runtime env vars.
 */
async function syncCoolifyEnvVars(
  appUuid: string,
  port: number,
  userEnvVars: Record<string, string> = {},
): Promise<void> {
  const vars: Record<string, string> = {
    PORT: String(port),
    BASE_PATH: "/",
    ...userEnvVars,
  };

  const bulkPayload = {
    data: Object.entries(vars).map(([key, value]) => ({
      key,
      value,
      is_preview: false,
    })),
  };

  // Try bulk endpoint first (Coolify >=4.x)
  const bulkRes = await coolifyFetch(`/applications/${appUuid}/envs/bulk`, {
    method: "PATCH",
    body: JSON.stringify(bulkPayload),
  });

  if (!bulkRes.ok) {
    // Fallback: set each var individually
    for (const [key, value] of Object.entries(vars)) {
      await coolifyFetch(`/applications/${appUuid}/envs`, {
        method: "POST",
        body: JSON.stringify({ key, value, is_preview: false }),
      }).catch((e) => console.warn(`[Hosting] envVar set ${key} failed:`, (e as Error).message));
    }
  }
  console.log(`[Hosting] Synced ${Object.keys(vars).length} env vars to Coolify app ${appUuid}`);
}

function generateSubdomain(name: string): string {
  const base = hostingSlugify(name);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

// GET /api/hosting/detect — auto-detect build/start commands from a Git repo
app.get("/api/hosting/detect", requireAuth, async (req, res) => {
  const { git_url, branch = "main" } = req.query as { git_url?: string; branch?: string };
  if (!git_url) { res.status(400).json({ error: "git_url required" }); return; }

  const ghMatch = git_url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!ghMatch) {
    res.json({ detected: false, reason: "Only public GitHub repos are supported for auto-detect" }); return;
  }
  const [, owner, repo] = ghMatch;

  async function rawFetch(path: string, b: string) {
    const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${b}/${path}`, { signal: AbortSignal.timeout(5000) });
    return r.ok ? r.text() : null;
  }

  const tryBranches = [branch, "main", "master"];
  let pkgRaw: string | null = null;
  let detectedBranch = branch;
  for (const b of tryBranches) {
    pkgRaw = await rawFetch("package.json", b).catch(() => null);
    if (pkgRaw) { detectedBranch = b; break; }
  }

  if (!pkgRaw) {
    // Check for Python
    const hasPy = await rawFetch("requirements.txt", detectedBranch).catch(() => null);
    if (hasPy) {
      const hasDjango = hasPy.toLowerCase().includes("django");
      const hasFastapi = hasPy.toLowerCase().includes("fastapi");
      const hasFlask = hasPy.toLowerCase().includes("flask");
      res.json({
        detected: true,
        framework: hasDjango ? "django" : hasFastapi ? "fastapi" : hasFlask ? "flask" : "python",
        buildCommand: "pip install -r requirements.txt",
        startCommand: hasDjango ? "python manage.py runserver 0.0.0.0:8000" : hasFastapi ? "uvicorn main:app --host 0.0.0.0 --port 8000" : "python app.py",
        port: 8000,
        packageManager: "pip",
        runtime: "python",
      }); return;
    }

    // Check for Deno
    const hasDeno = await rawFetch("deno.json", detectedBranch).catch(() => null)
      ?? await rawFetch("deno.jsonc", detectedBranch).catch(() => null);
    if (hasDeno) {
      let denoConfig: any = {};
      try { denoConfig = JSON.parse(hasDeno); } catch { /**/ }
      const tasks: Record<string, string> = denoConfig.tasks ?? {};
      res.json({
        detected: true,
        framework: "deno",
        buildCommand: tasks["build"] ? "deno task build" : "",
        startCommand: tasks["start"] ? "deno task start" : tasks["dev"] ? "deno task dev" : "deno run --allow-net main.ts",
        port: 8000,
        packageManager: "deno",
        runtime: "deno",
      }); return;
    }

    // Check for PHP (Composer)
    const hasComposer = await rawFetch("composer.json", detectedBranch).catch(() => null);
    if (hasComposer) {
      let composerConfig: any = {};
      try { composerConfig = JSON.parse(hasComposer); } catch { /**/ }
      const isLaravel = !!(composerConfig.require?.["laravel/framework"]);
      res.json({
        detected: true,
        framework: isLaravel ? "laravel" : "php",
        buildCommand: "composer install --no-dev --optimize-autoloader",
        startCommand: isLaravel ? "php artisan serve --host=0.0.0.0 --port=8080" : "php -S 0.0.0.0:8080 -t public",
        port: 8080,
        packageManager: "composer",
        runtime: "php",
      }); return;
    }

    res.json({ detected: false, reason: "No package.json, requirements.txt, deno.json, or composer.json found" }); return;
  }

  let pkg: any = {};
  try { pkg = JSON.parse(pkgRaw); } catch { res.json({ detected: false, reason: "Could not parse package.json" }); return; }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  const scripts: Record<string, string> = pkg.scripts || {};

  // Detect package manager
  let pm = "npm";
  const [hasPnpm, hasYarn, hasBunLock] = await Promise.all([
    rawFetch("pnpm-lock.yaml", detectedBranch).catch(() => null),
    rawFetch("yarn.lock", detectedBranch).catch(() => null),
    rawFetch("bun.lockb", detectedBranch).catch(() => null),
  ]);
  if (hasPnpm) pm = "pnpm";
  else if (hasYarn) pm = "yarn";
  else if (hasBunLock) pm = "bun";

  const installCmd = pm === "pnpm" ? "pnpm install --no-frozen-lockfile" : `${pm} install`;

  // Check if monorepo
  const wsYamlRaw = await rawFetch("pnpm-workspace.yaml", detectedBranch).catch(() => null);
  const isMonorepo = !!(pkg.workspaces || wsYamlRaw);

  function detectFramework(d: Record<string, string>, s: Record<string, string>): { framework: string; port: number } {
    if (d["next"]) return { framework: "nextjs", port: 3000 };
    if (d["nuxt"] || d["nuxt3"]) return { framework: "nuxt", port: 3000 };
    if (d["@sveltejs/kit"] || d["svelte"]) return { framework: "svelte", port: 3000 };
    if (d["vite"] || d["@vitejs/plugin-react"] || d["@vitejs/plugin-vue"]) return { framework: "vite", port: 4173 };
    if (d["react-scripts"]) return { framework: "cra", port: 3000 };
    if (d["express"] || d["fastify"] || d["koa"] || d["hapi"]) return { framework: "node-server", port: 3000 };
    return { framework: "node", port: 3000 };
  }

  function buildCmdsForPkg(subPkg: any, filterName: string, pm: string, installCmd: string) {
    const s = subPkg.scripts || {};
    const d = { ...(subPkg.dependencies || {}), ...(subPkg.devDependencies || {}) };
    const { framework, port } = detectFramework(d, s);
    const buildCommand = s["build"] ? `${installCmd} && ${pm} --filter ${filterName} run build` : installCmd;
    const startCommand = s["serve"] ? `${pm} --filter ${filterName} run serve`
      : s["start"] ? `${pm} --filter ${filterName} run start`
      : s["preview"] ? `${pm} --filter ${filterName} run preview`
      : "";
    const isDeployable = !!(s["build"] || s["start"] || s["serve"] || s["preview"] || d["express"] || d["fastify"] || d["next"] || d["vite"] || d["@vitejs/plugin-react"]);
    return { buildCommand, startCommand, framework, port, isDeployable };
  }

  if (isMonorepo) {
    // Parse workspace patterns
    let patterns: string[] = Array.isArray(pkg.workspaces) ? pkg.workspaces : [];
    if (!patterns.length && wsYamlRaw) {
      const m = wsYamlRaw.match(/^packages:\s*\n((?:[ \t]+-[^\n]+\n?)*)/m);
      if (m) {
        patterns = m[1].split("\n")
          .map(l => l.replace(/^\s*-\s+['"]?|['"]?\s*$/, "").trim())
          .filter(l => l.length > 0 && !l.startsWith("#"));
      }
    }

    // Scan each workspace base dir via GitHub API
    const workspacePackages: { name: string; path: string; framework: string; buildCommand: string; startCommand: string; port: number; isDeployable: boolean }[] = [];
    const scanned = new Set<string>();

    const isWildcard = (p: string) => p.includes("*");

    for (const pattern of patterns.slice(0, 8)) {
      if (isWildcard(pattern)) {
        // Parent folder — list subdirs via GitHub API
        const basePath = pattern.replace(/\/\*\*?$/, "").replace(/\*\*?$/, "").replace(/\/$/, "");
        if (!basePath || scanned.has(basePath)) continue;
        scanned.add(basePath);
        try {
          const apiRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${basePath}?ref=${detectedBranch}`, { signal: AbortSignal.timeout(7000) });
          if (!apiRes.ok) continue;
          const entries: { name: string; type: string }[] = await apiRes.json();
          if (!Array.isArray(entries)) continue;
          const dirs = entries.filter(e => e.type === "dir").slice(0, 12);
          for (const dir of dirs) {
            const subPath = `${basePath}/${dir.name}`;
            const subPkgRaw = await rawFetch(`${subPath}/package.json`, detectedBranch).catch(() => null);
            if (!subPkgRaw) continue;
            let subPkg: any = {};
            try { subPkg = JSON.parse(subPkgRaw); } catch { continue; }
            const filterName = subPkg.name || subPath;
            const cmds = buildCmdsForPkg(subPkg, filterName, pm, installCmd);
            workspacePackages.push({ name: subPkg.name || dir.name, path: subPath, ...cmds });
          }
        } catch { continue; }
      } else {
        // Direct package path (e.g. "scripts")
        const pkgPath = pattern.replace(/\/$/, "");
        if (!pkgPath || scanned.has(pkgPath)) continue;
        scanned.add(pkgPath);
        try {
          const subPkgRaw = await rawFetch(`${pkgPath}/package.json`, detectedBranch).catch(() => null);
          if (!subPkgRaw) continue;
          let subPkg: any = {};
          try { subPkg = JSON.parse(subPkgRaw); } catch { continue; }
          const filterName = subPkg.name || pkgPath;
          const cmds = buildCmdsForPkg(subPkg, filterName, pm, installCmd);
          workspacePackages.push({ name: subPkg.name || pkgPath, path: pkgPath, ...cmds });
        } catch { continue; }
      }
    }
    console.log(`[Hosting Detect] ${owner}/${repo}: isMonorepo=true, patterns=${JSON.stringify(patterns)}, packages found=${workspacePackages.length}`);

    const deployablePackages = workspacePackages.filter(p => p.isDeployable);
    const allPackages = [...deployablePackages, ...workspacePackages.filter(p => !p.isDeployable)];
    res.json({ detected: true, framework: "monorepo", packageManager: pm, buildCommand: "", startCommand: "", port: 3000, isMonorepo: true, workspacePackages: allPackages, branch: detectedBranch }); return;
  }

  let framework = "node";
  let buildCommand = "";
  let startCommand = "";
  let port = 3000;

  const detected = detectFramework(deps, scripts);
  framework = detected.framework;
  port = detected.port;

  if (framework === "nextjs") {
    buildCommand = `${installCmd} && ${pm} run build`;
    startCommand = `${pm} start`;
  } else if (framework === "nuxt") {
    buildCommand = `${installCmd} && ${pm} run build`;
    startCommand = `node .output/server/index.mjs`;
  } else if (framework === "svelte") {
    buildCommand = `${installCmd} && ${pm} run build`;
    startCommand = `node build`;
  } else if (framework === "vite") {
    buildCommand = `${installCmd} && ${pm} run build`;
    startCommand = scripts["preview"] ? `${pm} run preview` : `${pm} run serve`;
  } else if (framework === "cra") {
    buildCommand = `${installCmd} && ${pm} run build`;
    startCommand = `${pm} start`;
  } else {
    buildCommand = scripts["build"] ? `${installCmd} && ${pm} run build` : installCmd;
    startCommand = scripts["start"] ? `${pm} start` : "node index.js";
  }

  res.json({ detected: true, framework, packageManager: pm, buildCommand, startCommand, port, isMonorepo: false, branch: detectedBranch });
});

// GET /api/hosting/status
app.get("/api/hosting/status", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: profile } = await supabaseAdmin.from("profiles").select("tier, role").eq("id", userId).single();
  const isAdminUser = profile?.role === "admin";
  const tier: string = isAdminUser ? "pro" : (profile?.tier ?? "free");
  const { count } = await supabaseAdmin.from("hosting_projects").select("id", { count: "exact", head: true }).eq("user_id", userId);
  let coolifyOk = false;
  if (COOLIFY_API_URL && COOLIFY_API_TOKEN) {
    try { const r = await coolifyFetch("/version"); coolifyOk = r.ok; } catch {}
  }
  res.json({
    coolifyConfigured: !!(COOLIFY_API_URL && COOLIFY_API_TOKEN),
    coolifyReachable: coolifyOk,
    projectCount: count ?? 0,
    projectLimit: isAdminUser ? 999 : (HOSTING_LIMITS[tier] ?? 1),
    tier,
  });
});

// GET /api/hosting/projects
app.get("/api/hosting/projects", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data, error } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ projects: data ?? [] });
});

// POST /api/hosting/projects
app.post("/api/hosting/projects", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { name, description, git_url, git_branch, build_command, start_command, port, env_vars } = req.body;
  if (!name?.trim() || !git_url?.trim()) {
    res.status(400).json({ error: "name dan git_url wajib diisi" }); return;
  }
  const { data: profile } = await supabaseAdmin.from("profiles").select("tier, role").eq("id", userId).single();
  const isAdminUser = profile?.role === "admin";
  const tier: string = isAdminUser ? "pro" : (profile?.tier ?? "free");
  const limit = isAdminUser ? 999 : (HOSTING_LIMITS[tier] ?? 1);
  const { count } = await supabaseAdmin.from("hosting_projects").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count ?? 0) >= limit) {
    res.status(403).json({ error: `Kuota proyek habis (maks ${limit} untuk tier ${tier}). Upgrade untuk lebih banyak.` }); return;
  }
  const subdomain = generateSubdomain(name.trim());
  const publicUrl = `https://${subdomain}.${COOLIFY_BASE_DOMAIN}`;
  const { data: project, error: dbErr } = await supabaseAdmin.from("hosting_projects").insert({
    user_id: userId,
    name: name.trim(),
    description: description?.trim() ?? "",
    git_url: git_url.trim(),
    git_branch: git_branch?.trim() || "main",
    build_command: build_command?.trim() ?? "",
    start_command: start_command?.trim() ?? "",
    port: Number(port) || 3000,
    env_vars: env_vars ?? {},
    subdomain,
    public_url: publicUrl,
    status: "inactive",
  }).select().single();
  if (dbErr) { res.status(500).json({ error: dbErr.message }); return; }
  if (COOLIFY_API_URL && COOLIFY_API_TOKEN) {
    try {
      const [serverUuid, projectUuid] = await Promise.all([getCoolifyServerUuid(), getCoolifyProjectUuid()]);
      const effectivePort = Number(port) || 3000;
      const installBuildCmd = build_command?.trim() || "pnpm install --no-frozen-lockfile";
      const startCmd = start_command?.trim() || "node server/index.js";
      const runtime = detectRuntimeFromCommands(installBuildCmd, startCmd);
      const dockerfile = generateDockerfile(runtime, git_url.trim(), git_branch?.trim() || "main", installBuildCmd, startCmd, effectivePort, env_vars ?? {});
      const body: Record<string, string> = {
        project_uuid: projectUuid,
        server_uuid: serverUuid,
        environment_name: "production",
        git_repository: git_url.trim(),
        git_branch: git_branch?.trim() || "main",
        build_pack: "dockerfile",
        dockerfile,
        name: subdomain,
        domains: publicUrl,
        ports_exposes: String(effectivePort),
      };
      const appRes = await coolifyFetch("/applications/public", { method: "POST", body: JSON.stringify(body) });
      if (appRes.ok) {
        const appData: { uuid?: string } = await appRes.json();
        if (appData.uuid) {
          await supabaseAdmin.from("hosting_projects").update({ coolify_app_uuid: appData.uuid }).eq("id", project!.id);
          (project as any).coolify_app_uuid = appData.uuid;
          // Also PATCH to ensure build_pack + dockerfile are committed (some Coolify versions need this)
          await coolifyFetch(`/applications/${appData.uuid}`, {
            method: "PATCH",
            body: JSON.stringify({ build_pack: "dockerfile", dockerfile }),
          }).catch((e) => console.warn("[Hosting] Dockerfile PATCH failed:", (e as Error).message));
          // Apply memory limit based on tier (256MB Free, 512MB Plus, 1GB Pro)
          const memoryMb = HOSTING_MEMORY_MB[tier] ?? HOSTING_MEMORY_MB.free;
          await coolifyFetch(`/applications/${appData.uuid}`, {
            method: "PATCH",
            body: JSON.stringify({ memory: memoryMb, memory_swap: memoryMb }),
          }).catch((e) => console.warn("[Hosting] Memory limit PATCH failed:", (e as Error).message));
          // Sync PORT and user env vars as runtime env vars
          await syncCoolifyEnvVars(appData.uuid, effectivePort, env_vars ?? {}).catch((e) =>
            console.warn("[Hosting] syncCoolifyEnvVars failed:", (e as Error).message)
          );
        }
      } else {
        console.warn("[Hosting] Coolify create app failed:", appRes.status, await appRes.text().catch(() => ""));
      }
    } catch (e) {
      console.warn("[Hosting] Coolify create app error:", (e as Error).message);
    }
  }
  res.status(201).json({ project });
});

// GET /api/hosting/projects/:id
app.get("/api/hosting/projects/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project, error } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (error || !project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  const { data: deployments } = await supabaseAdmin
    .from("hosting_deployments").select("*").eq("project_id", project.id)
    .order("created_at", { ascending: false }).limit(20);
  res.json({ project, deployments: deployments ?? [] });
});

// DELETE /api/hosting/projects/:id
app.delete("/api/hosting/projects/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  if (project.coolify_app_uuid && COOLIFY_API_URL && COOLIFY_API_TOKEN) {
    try { await coolifyFetch(`/applications/${project.coolify_app_uuid}`, { method: "DELETE" }); } catch {}
  }
  await supabaseAdmin.from("hosting_projects").delete().eq("id", project.id);
  res.json({ ok: true });
});

// POST /api/hosting/projects/:id/deploy
app.post("/api/hosting/projects/:id/deploy", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  if (!project.coolify_app_uuid) {
    res.status(400).json({ error: "Proyek belum terhubung ke Coolify. Hapus dan buat ulang proyek setelah Coolify dikonfigurasi." }); return;
  }

  const { data: deployment } = await supabaseAdmin.from("hosting_deployments").insert({
    project_id: project.id, user_id: userId, status: "queued", triggered_by: "manual",
  }).select().single();
  await supabaseAdmin.from("hosting_projects").update({ status: "deploying", updated_at: new Date().toISOString() }).eq("id", project.id);
  if (COOLIFY_API_URL && COOLIFY_API_TOKEN) {
    try {
      const deployPort = project.port || 3000;
      const deployEnvVars = (project.env_vars as Record<string, string>) ?? {};
      const deployBuildCmd = project.build_command?.trim() || "pnpm install --no-frozen-lockfile";
      const deployStartCmd = project.start_command?.trim() || "node server/index.js";
      const deployRuntime = detectRuntimeFromCommands(deployBuildCmd, deployStartCmd);
      const dockerfile = generateDockerfile(deployRuntime, project.git_url, project.git_branch || "main", deployBuildCmd, deployStartCmd, deployPort, deployEnvVars);

      // Coolify API does NOT allow changing build_pack via PATCH after creation.
      // So we detect if the existing app is still using nixpacks and if so, delete it
      // and recreate it with build_pack: "dockerfile" (node:22-alpine from Docker Hub).
      let activeUuid = project.coolify_app_uuid as string;
      const appInfoRes = await coolifyFetch(`/applications/${activeUuid}`);
      if (appInfoRes.ok) {
        const appInfo = await appInfoRes.json() as { build_pack?: string };
        if (appInfo.build_pack === "nixpacks") {
          console.log(`[Hosting] Migrating ${activeUuid} from nixpacks → dockerfile...`);
          // Delete old nixpacks app
          await coolifyFetch(`/applications/${activeUuid}`, { method: "DELETE" })
            .catch((e) => console.warn("[Hosting] delete old app failed:", (e as Error).message));
          // Recreate with dockerfile build_pack
          const [serverUuid, projectUuid] = await Promise.all([getCoolifyServerUuid(), getCoolifyProjectUuid()]);
          const newBody = {
            project_uuid: projectUuid,
            server_uuid: serverUuid,
            environment_name: "production",
            git_repository: project.git_url,
            git_branch: project.git_branch || "main",
            build_pack: "dockerfile",
            dockerfile,
            name: project.subdomain,
            domains: project.public_url,
            ports_exposes: String(deployPort),
          };
          const newAppRes = await coolifyFetch("/applications/public", {
            method: "POST",
            body: JSON.stringify(newBody),
          });
          if (newAppRes.ok) {
            const newAppData = await newAppRes.json() as { uuid?: string };
            if (newAppData.uuid) {
              activeUuid = newAppData.uuid;
              await supabaseAdmin.from("hosting_projects")
                .update({ coolify_app_uuid: activeUuid })
                .eq("id", project.id);
              console.log(`[Hosting] Recreated Coolify app as ${activeUuid} (dockerfile)`);
            }
          } else {
            console.warn("[Hosting] Recreate app failed:", newAppRes.status, await newAppRes.text().catch(() => ""));
          }
        }
      }

      // Sync runtime env vars (PORT, BASE_PATH, user vars)
      await syncCoolifyEnvVars(activeUuid, deployPort, deployEnvVars)
        .catch((e) => console.warn("[Hosting] pre-deploy syncCoolifyEnvVars failed:", (e as Error).message));

      const deployRes = await coolifyFetch(`/deploy?uuid=${activeUuid}&force=false`);
      const rawText = await deployRes.text();
      console.log("[Hosting] Coolify deploy response:", deployRes.status, rawText.slice(0, 500));
      let coolifyDeploymentUuid: string | undefined;
      try {
        const deployData = JSON.parse(rawText);
        // Coolify may return { deployments: [{deployment_uuid}] } or { deployment_uuid } directly
        coolifyDeploymentUuid = deployData.deployments?.[0]?.deployment_uuid
          ?? deployData.deployment_uuid
          ?? undefined;
      } catch {}
      if (!coolifyDeploymentUuid) {
        // Fallback: fetch the most recent deployment from Coolify's list
        await new Promise(r => setTimeout(r, 1500)); // give Coolify a moment to queue it
        const listRes = await coolifyFetch(`/applications/${project.coolify_app_uuid}/deployments`);
        if (listRes.ok) {
          const listData: { uuid?: string; deployment_uuid?: string }[] = await listRes.json();
          coolifyDeploymentUuid = Array.isArray(listData)
            ? (listData[0]?.deployment_uuid ?? listData[0]?.uuid)
            : undefined;
          console.log("[Hosting] Fallback deployment UUID from list:", coolifyDeploymentUuid);
        }
      }
      if (coolifyDeploymentUuid && deployment) {
        await supabaseAdmin.from("hosting_deployments").update({
          coolify_deployment_uuid: coolifyDeploymentUuid, status: "in_progress",
        }).eq("id", deployment.id);
      }
    } catch (e) {
      console.warn("[Hosting] Deploy trigger error:", (e as Error).message);
    }
  }
  res.json({ deployment, project: { ...project, status: "deploying" } });
});

// PATCH /api/hosting/projects/:id — update build/start command, branch, port, env_vars
app.patch("/api/hosting/projects/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  const { build_command, start_command, git_branch, port, env_vars } = req.body;
  const updates: Record<string, string | number | object> = { updated_at: new Date().toISOString() };
  if (build_command !== undefined) updates.build_command = build_command?.trim() ?? "";
  if (start_command !== undefined) updates.start_command = start_command?.trim() ?? "";
  if (git_branch !== undefined) updates.git_branch = git_branch?.trim() || "main";
  if (port !== undefined) updates.port = Number(port) || 3000;
  if (env_vars !== undefined) updates.env_vars = env_vars ?? {};
  await supabaseAdmin.from("hosting_projects").update(updates).eq("id", project.id);
  // Push updated config to Coolify — regenerate Dockerfile so Node version / cmds stay fresh
  if (project.coolify_app_uuid && COOLIFY_API_URL && COOLIFY_API_TOKEN) {
    try {
      const effectivePort = port !== undefined ? Number(port) || 3000 : project.port || 3000;
      const effectiveEnvVars = env_vars !== undefined ? (env_vars ?? {}) : (project.env_vars ?? {});
      const effectiveBuildCmd = (build_command !== undefined ? build_command?.trim() : project.build_command?.trim())
        || "pnpm install --no-frozen-lockfile";
      const effectiveStartCmd = (start_command !== undefined ? start_command?.trim() : project.start_command?.trim())
        || "node server/index.js";
      const effectiveGitUrl = project.git_url as string;
      const effectiveGitBranch = (git_branch !== undefined ? git_branch?.trim() : project.git_branch?.trim()) || "main";

      const patchRuntime = detectRuntimeFromCommands(effectiveBuildCmd, effectiveStartCmd);
      const dockerfile = generateDockerfile(patchRuntime, effectiveGitUrl, effectiveGitBranch, effectiveBuildCmd, effectiveStartCmd, effectivePort, effectiveEnvVars);
      const body: Record<string, string> = {
        build_pack: "dockerfile",
        dockerfile,
        ports_exposes: String(effectivePort),
      };
      if (git_branch !== undefined) body.git_branch = git_branch?.trim() || "main";
      const patchRes = await coolifyFetch(`/applications/${project.coolify_app_uuid}`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      const patchText = await patchRes.text();
      console.log("[Hosting] Coolify PATCH app:", patchRes.status, patchText.slice(0, 300));
      await syncCoolifyEnvVars(project.coolify_app_uuid, effectivePort, effectiveEnvVars).catch((e) =>
        console.warn("[Hosting] syncCoolifyEnvVars failed on PATCH:", (e as Error).message)
      );
    } catch (e) {
      console.warn("[Hosting] Patch Coolify app error:", (e as Error).message);
    }
  }
  res.json({ project: { ...project, ...updates } });
});

// POST /api/hosting/projects/:id/restart — restart container without rebuilding
app.post("/api/hosting/projects/:id/restart", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  if (!project.coolify_app_uuid || !COOLIFY_API_URL || !COOLIFY_API_TOKEN) {
    res.status(400).json({ error: "Coolify belum dikonfigurasi atau UUID belum tersedia" }); return;
  }
  try {
    const r = await coolifyFetch(`/applications/${project.coolify_app_uuid}/restart`, { method: "POST" });
    if (!r.ok) {
      const errText = await r.text().catch(() => "unknown");
      res.status(500).json({ error: `Gagal restart container: ${errText}` }); return;
    }
    await supabaseAdmin.from("hosting_projects").update({ updated_at: new Date().toISOString() }).eq("id", project.id);
    console.log(`[Hosting] Restarted app ${project.coolify_app_uuid} for project ${project.id}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// POST /api/hosting/projects/:id/resume — nyalakan ulang project yang di-suspend karena kredit habis
app.post("/api/hosting/projects/:id/resume", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  if (project.status !== "suspended") {
    res.status(400).json({ error: "Proyek tidak dalam status suspended" }); return;
  }
  const { data: profile } = await supabaseAdmin.from("profiles").select("credit_balance_idr, tier, role").eq("id", userId).single();
  const isAdminUser = profile?.role === "admin";
  const tier = getTier(profile ?? null);
  const hourlyCost = HOSTING_HOURLY_COST_IDR[tier] ?? HOSTING_HOURLY_COST_IDR.free;
  const balance = profile?.credit_balance_idr ?? 0;
  if (!isAdminUser && balance < hourlyCost) {
    res.status(402).json({
      error: `Saldo tidak cukup untuk menghidupkan kembali project (butuh minimal Rp ${hourlyCost.toLocaleString("id-ID")} untuk 1 jam running, saldo kamu Rp ${balance.toLocaleString("id-ID")}).`,
      required_idr: hourlyCost,
      balance_idr: balance,
    });
    return;
  }
  if (project.coolify_app_uuid && COOLIFY_API_URL && COOLIFY_API_TOKEN) {
    try {
      await coolifyFetch(`/applications/${project.coolify_app_uuid}/start`, { method: "POST" });
    } catch (e) {
      console.warn(`[Hosting] Resume start failed for ${project.id}:`, (e as Error).message);
    }
  }
  await supabaseAdmin.from("hosting_projects").update({
    status: "running",
    updated_at: new Date().toISOString(),
  }).eq("id", project.id);
  console.log(`[Hosting] Project ${project.id} resumed by user ${userId}`);
  res.json({ success: true });
});

// PUT /api/hosting/projects/:id/domain — set custom domain (DB only; Coolify registration happens after DNS verify)
app.put("/api/hosting/projects/:id/domain", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { domain } = req.body as { domain: string };
  if (!domain?.trim()) { res.status(400).json({ error: "Domain wajib diisi" }); return; }
  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(cleanDomain)) {
    res.status(400).json({ error: "Format domain tidak valid (contoh: www.namadomain.com atau namadomain.com)" }); return;
  }
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  await supabaseAdmin.from("hosting_projects").update({
    custom_domain: cleanDomain,
    custom_domain_verified: false,
    updated_at: new Date().toISOString(),
  }).eq("id", project.id);
  console.log(`[Hosting] Domain saved to DB: ${cleanDomain} (Coolify registration deferred until DNS verified)`);
  res.json({ success: true, custom_domain: cleanDomain });
});

// DELETE /api/hosting/projects/:id/domain — remove custom domain
app.delete("/api/hosting/projects/:id/domain", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  await supabaseAdmin.from("hosting_projects").update({
    custom_domain: null,
    custom_domain_verified: false,
    updated_at: new Date().toISOString(),
  }).eq("id", project.id);
  if (project.coolify_app_uuid && COOLIFY_API_URL && COOLIFY_API_TOKEN && project.subdomain) {
    try {
      const domains = `https://${project.subdomain}.${COOLIFY_BASE_DOMAIN}`;
      await coolifyFetch(`/applications/${project.coolify_app_uuid}`, {
        method: "PATCH", body: JSON.stringify({ domains }),
      });
    } catch (e) {
      console.warn("[Hosting] Coolify domain revert error:", (e as Error).message);
    }
  }
  res.json({ success: true });
});

// GET /api/hosting/projects/:id/domain/verify — check DNS propagation, then register domain in Coolify
app.get("/api/hosting/projects/:id/domain/verify", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  const customDomain = (project as any).custom_domain as string | null;
  if (!customDomain) { res.status(400).json({ error: "Belum ada custom domain" }); return; }
  const expectedTarget = `${project.subdomain}.${COOLIFY_BASE_DOMAIN}`;
  try {
    // For root domain: check both the root and www. For www domain: check as-is.
    const isWww = customDomain.startsWith("www.");
    const wwwVariant  = isWww ? customDomain : `www.${customDomain}`;
    const rootVariant = isWww ? customDomain.slice(4) : customDomain;

    const dnsChecks = await Promise.all([
      // CNAME check on www variant
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(wwwVariant)}&type=CNAME`, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : {}),
      // CNAME check on exact domain
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(customDomain)}&type=CNAME`, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : {}),
      // ALIAS/ANAME resolve as A records on root — check if IP matches subdomain
      !isWww ? fetch(`https://dns.google/resolve?name=${encodeURIComponent(rootVariant)}&type=A`, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : {}) : Promise.resolve({}),
    ]) as { Answer?: { type: number; data: string }[] }[];

    const cnameAnswers = [
      ...(dnsChecks[0].Answer ?? []).filter(a => a.type === 5),
      ...(dnsChecks[1].Answer ?? []).filter(a => a.type === 5),
    ];
    const found = cnameAnswers.map(a => a.data.replace(/\.$/, "").toLowerCase());
    const verified = found.some(f => f.includes((project.subdomain ?? "").toLowerCase()));

    if (verified) {
      // Mark as verified in DB
      await supabaseAdmin.from("hosting_projects").update({
        custom_domain_verified: true, updated_at: new Date().toISOString(),
      }).eq("id", project.id);

      // Now register the custom domain in Coolify — DNS is confirmed, so Coolify can provision SSL
      if (project.coolify_app_uuid && COOLIFY_API_URL && COOLIFY_API_TOKEN && project.subdomain) {
        try {
          const domains = `https://${customDomain},https://${project.subdomain}.${COOLIFY_BASE_DOMAIN}`;
          const patchRes = await coolifyFetch(`/applications/${project.coolify_app_uuid}`, {
            method: "PATCH", body: JSON.stringify({ domains }),
          });
          const patchBody = await patchRes.text().catch(() => "");
          if (patchRes.ok) {
            console.log(`[Hosting] Coolify domain registered: ${customDomain} → ${patchRes.status}`);
            // Trigger redeploy so Traefik picks up new domain + SSL
            await coolifyFetch(`/deploy?uuid=${project.coolify_app_uuid}&force=false`, { method: "GET" }).catch(() => {});
          } else {
            console.warn(`[Hosting] Coolify domain PATCH failed: ${patchRes.status}`, patchBody.slice(0, 400));
          }
        } catch (e) {
          console.warn("[Hosting] Coolify domain registration error:", (e as Error).message);
        }
      }
    }

    res.json({
      verified,
      checked_domain: wwwVariant,
      expected: expectedTarget,
      found,
      reason: verified
        ? "DNS terverifikasi — domain sedang didaftarkan ke server (SSL akan aktif dalam 1-2 menit)."
        : "DNS belum mengarah ke subdomain yang benar. Tunggu propagasi DNS (5–30 menit) lalu coba verifikasi lagi.",
    });
  } catch {
    res.json({ verified: false, reason: "Timeout atau gagal menjangkau DNS resolver. Coba beberapa saat lagi." });
  }
});

// GET /api/hosting/projects/:id/sync
app.get("/api/hosting/projects/:id/sync", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  if (!project.coolify_app_uuid || !COOLIFY_API_URL || !COOLIFY_API_TOKEN) {
    res.json({ project, synced: false }); return;
  }
  try {
    // Check latest deployment status from Coolify deployment history
    const { data: latestDeploy } = await supabaseAdmin
      .from("hosting_deployments").select("*").eq("project_id", project.id)
      .order("created_at", { ascending: false }).limit(1).single();

    // Resolve coolify UUID — from DB or fallback to Coolify's deployment list
    let syncCoolifyUuid = latestDeploy?.coolify_deployment_uuid;
    if (!syncCoolifyUuid) {
      const listRes = await coolifyFetch(`/applications/${project.coolify_app_uuid}/deployments`);
      if (listRes.ok) {
        const listData: { uuid?: string; deployment_uuid?: string }[] = await listRes.json();
        syncCoolifyUuid = Array.isArray(listData)
          ? (listData[0]?.deployment_uuid ?? listData[0]?.uuid)
          : undefined;
        if (syncCoolifyUuid && latestDeploy) {
          await supabaseAdmin.from("hosting_deployments").update({ coolify_deployment_uuid: syncCoolifyUuid }).eq("id", latestDeploy.id);
          console.log("[Hosting] Sync: resolved UUID from list:", syncCoolifyUuid);
        }
      }
    }

    const [appRes, deployRes] = await Promise.all([
      coolifyFetch(`/applications/${project.coolify_app_uuid}`),
      syncCoolifyUuid
        ? coolifyFetch(`/deployments/${syncCoolifyUuid}`)
        : Promise.resolve(null),
    ]);

    const updates: Record<string, string> = { updated_at: new Date().toISOString() };

    // Get deployment status first (most accurate for failures)
    let deployStatus: string | null = null;
    if (deployRes?.ok) {
      const dd: { status?: string; finished_at?: string; logs?: string } = await deployRes.json();
      deployStatus = dd.status ?? null;
      if (latestDeploy && dd.status) {
        const deployDbStatus = dd.status === "finished" ? "finished" : dd.status === "failed" ? "failed" : "in_progress";
        await supabaseAdmin.from("hosting_deployments").update({
          status: deployDbStatus,
          ...(dd.finished_at ? { finished_at: dd.finished_at } : {}),
        }).eq("id", latestDeploy.id);
      }
    }

    // Determine project status
    let newStatus: string = project.status;
    let appStatus: string | undefined;
    if (appRes.ok) {
      const appData: { status?: string; fqdn?: string } = await appRes.json();
      appStatus = appData.status;
      console.log("[Hosting] Sync app status from Coolify:", appStatus, "deployStatus:", deployStatus);
      if (appData.fqdn && appData.fqdn !== project.public_url) updates.public_url = appData.fqdn;
    }

    if (deployStatus === "failed") {
      newStatus = "failed";
    } else if (deployStatus === "finished") {
      newStatus = "running";
    } else if (appStatus === "running") {
      newStatus = "running";
    } else if (appStatus === "exited" || appStatus === "stopped") {
      // exited after a successful build = stopped; otherwise = failed
      newStatus = deployStatus === "finished" ? "stopped" : "failed";
    } else if (project.status === "deploying" && !syncCoolifyUuid) {
      // Stuck in deploying with no UUID found — check if it's been too long
      const deployedAt = latestDeploy?.created_at ? new Date(latestDeploy.created_at).getTime() : 0;
      const elapsed = Date.now() - deployedAt;
      if (elapsed > 30 * 60 * 1000) { // stuck > 30 min → mark failed
        newStatus = "failed";
        console.log("[Hosting] Sync: deployment stuck >30min with no UUID, marking failed");
      }
    }

    if (newStatus !== project.status) updates.status = newStatus;
    await supabaseAdmin.from("hosting_projects").update(updates).eq("id", project.id);
    res.json({ project: { ...project, ...updates }, synced: true }); return;
  } catch (e) {
    console.warn("[Hosting] Sync error:", (e as Error).message);
  }
  res.json({ project, synced: false });
});

// PUT /api/hosting/projects/:id/env
app.put("/api/hosting/projects/:id/env", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  const { env_vars } = req.body;
  if (typeof env_vars !== "object" || Array.isArray(env_vars)) {
    res.status(400).json({ error: "env_vars harus berupa object key-value" }); return;
  }
  await supabaseAdmin.from("hosting_projects").update({ env_vars, updated_at: new Date().toISOString() }).eq("id", project.id);
  if (project.coolify_app_uuid && COOLIFY_API_URL && COOLIFY_API_TOKEN) {
    // Use syncCoolifyEnvVars so NODE_VERSION and PORT are always injected alongside user vars
    await syncCoolifyEnvVars(
      project.coolify_app_uuid,
      project.port || 3000,
      env_vars as Record<string, string>,
    ).catch((e) => console.warn("[Hosting] Env push to Coolify error:", (e as Error).message));
  }
  res.json({ success: true });
});

// GET /api/hosting/projects/:id/logs
app.get("/api/hosting/projects/:id/logs", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  const { data: latestDeploy } = await supabaseAdmin
    .from("hosting_deployments").select("*").eq("project_id", project.id)
    .order("created_at", { ascending: false }).limit(1).single();
  if (!COOLIFY_API_URL || !COOLIFY_API_TOKEN) {
    res.json({ logs: "", deploymentId: latestDeploy?.id ?? null, status: latestDeploy?.status ?? null }); return;
  }
  // If we don't have the UUID stored, try to fetch it from Coolify's list
  let coolifyUuid = latestDeploy?.coolify_deployment_uuid;
  if (!coolifyUuid && project.coolify_app_uuid) {
    try {
      const listRes = await coolifyFetch(`/applications/${project.coolify_app_uuid}/deployments`);
      if (listRes.ok) {
        const listData: { uuid?: string; deployment_uuid?: string }[] = await listRes.json();
        coolifyUuid = Array.isArray(listData)
          ? (listData[0]?.deployment_uuid ?? listData[0]?.uuid)
          : undefined;
        if (coolifyUuid && latestDeploy) {
          await supabaseAdmin.from("hosting_deployments").update({ coolify_deployment_uuid: coolifyUuid }).eq("id", latestDeploy.id);
        }
        console.log("[Hosting] Logs: resolved UUID from list:", coolifyUuid);
      }
    } catch {}
  }
  if (!coolifyUuid) {
    res.json({ logs: "Menunggu UUID deployment dari Coolify...", deploymentId: latestDeploy?.id ?? null, status: latestDeploy?.status ?? null }); return;
  }
  try {
    const logsRes = await coolifyFetch(`/deployments/${coolifyUuid}/logs`);
    if (logsRes.ok) {
      const logsData: { logs?: string } = await logsRes.json();
      const logs = logsData.logs ?? "";
      const statusRes = await coolifyFetch(`/deployments/${coolifyUuid}`);
      if (statusRes.ok) {
        const statusData: { status?: string; finished_at?: string } = await statusRes.json();
        const newDeployStatus = statusData.status === "finished" ? "finished" : statusData.status === "failed" ? "failed" : "in_progress";
        await supabaseAdmin.from("hosting_deployments").update({
          logs,
          status: newDeployStatus,
          ...(statusData.finished_at ? { finished_at: statusData.finished_at } : {}),
        }).eq("id", latestDeploy.id);
        if (newDeployStatus === "finished") {
          await supabaseAdmin.from("hosting_projects").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", project.id);
        } else if (newDeployStatus === "failed") {
          await supabaseAdmin.from("hosting_projects").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", project.id);
        }
      }
      res.json({ logs, deploymentId: latestDeploy.id, status: newDeployStatus }); return;
    }
  } catch (e) {
    console.warn("[Hosting] Logs fetch error:", (e as Error).message);
  }
  res.json({ logs: "", deploymentId: latestDeploy?.id ?? null, status: latestDeploy?.status ?? null });
});

// GET /api/hosting/projects/:id/runtime-logs — live container stdout from Coolify
app.get("/api/hosting/projects/:id/runtime-logs", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  if (!project.coolify_app_uuid || !COOLIFY_API_URL || !COOLIFY_API_TOKEN) {
    res.json({ logs: "" }); return;
  }
  try {
    const r = await coolifyFetch(`/applications/${project.coolify_app_uuid}/logs`);
    if (r.ok) {
      const raw = await r.text();
      let logs = "";
      try { logs = (JSON.parse(raw) as { logs?: string }).logs ?? raw; } catch { logs = raw; }
      res.json({ logs }); return;
    }
  } catch (e) {
    console.warn("[Hosting] Runtime logs error:", (e as Error).message);
  }
  res.json({ logs: "" });
});

// ── GITHUB INTEGRATION (Auto Deploy) ──────────────────────────────────────────

// GET /api/hosting/github/repos — list user's GitHub repositories
app.get("/api/hosting/github/repos", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: profile } = await supabaseAdmin
    .from("profiles").select("github_access_token").eq("id", userId).single();

  if (!profile?.github_access_token) {
    res.status(400).json({ error: "GitHub belum dihubungkan" }); return;
  }

  try {
    const repos: any[] = [];
    let page = 1;
    while (repos.length < 200) {
      const ghRes = await fetch(
        `https://api.github.com/user/repos?sort=pushed&per_page=100&page=${page}&affiliation=owner,collaborator`,
        {
          headers: {
            Authorization: `token ${profile.github_access_token}`,
            "User-Agent": "PioCode/1.0",
            Accept: "application/vnd.github+json",
          },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (!ghRes.ok) break;
      const data: any[] = await ghRes.json();
      if (!Array.isArray(data) || !data.length) break;
      repos.push(...data);
      if (data.length < 100) break;
      page++;
    }
    res.json({
      repos: repos.map((r) => ({
        id: r.id,
        full_name: r.full_name,
        name: r.name,
        description: r.description ?? null,
        private: r.private,
        language: r.language ?? null,
        clone_url: r.clone_url,
        html_url: r.html_url,
        default_branch: r.default_branch ?? "main",
        pushed_at: r.pushed_at,
        stargazers_count: r.stargazers_count ?? 0,
        fork: r.fork,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/hosting/github/status
app.get("/api/hosting/github/status", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { data: profile } = await supabaseAdmin
    .from("profiles").select("github_username, github_access_token").eq("id", userId).single();
  res.json({
    connected: !!(profile?.github_access_token),
    username: profile?.github_username ?? null,
  });
});

// GET /api/hosting/github/oauth/start — initiate server-side GitHub OAuth
app.get("/api/hosting/github/oauth/start", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const crypto = await import("crypto");
  const state = crypto.randomBytes(16).toString("hex");
  githubOAuthStates.set(state, { userId, ts: Date.now() });
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: getGithubCallbackUrl(),
    scope: "repo admin:repo_hook",
    state,
  });
  res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
});

// GET /api/hosting/github/oauth/callback — GitHub redirects here after authorization
app.get("/api/hosting/github/oauth/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const redirectBase = getAppBaseUrl();

  if (error || !code || !state) {
    res.redirect(`${redirectBase}/hosting?github_error=${encodeURIComponent(error ?? "cancelled")}`);
    return;
  }

  const stateData = githubOAuthStates.get(state);
  if (!stateData || Date.now() - stateData.ts > 10 * 60 * 1000) {
    githubOAuthStates.delete(state);
    res.redirect(`${redirectBase}/hosting?github_error=invalid_state`);
    return;
  }
  githubOAuthStates.delete(state);

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: getGithubCallbackUrl(),
      }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      res.redirect(`${redirectBase}/hosting?github_error=${encodeURIComponent(tokenData.error ?? "token_exchange_failed")}`);
      return;
    }

    const ghRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${tokenData.access_token}`, "User-Agent": "PioCode/1.0" },
    });
    const ghUser = await ghRes.json() as { login: string };

    await supabaseAdmin.from("profiles").update({
      github_access_token: tokenData.access_token,
      github_username: ghUser.login,
    }).eq("id", stateData.userId);

    res.redirect(`${redirectBase}/hosting?github_connected=1&username=${encodeURIComponent(ghUser.login)}`);
  } catch (e) {
    console.error("[GitHub OAuth callback]", e);
    res.redirect(`${redirectBase}/hosting?github_error=server_error`);
  }
});

// POST /api/hosting/github/connect — store provider_token after OAuth link
app.post("/api/hosting/github/connect", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { provider_token } = req.body;
  if (!provider_token) { res.status(400).json({ error: "provider_token required" }); return; }
  try {
    const ghRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${provider_token}`, "User-Agent": "PioCode/1.0" },
    });
    if (!ghRes.ok) { res.status(400).json({ error: "Token GitHub tidak valid" }); return; }
    const ghUser = await ghRes.json() as { login: string; id: number };
    await supabaseAdmin.from("profiles").update({
      github_access_token: provider_token,
      github_username: ghUser.login,
    }).eq("id", userId);
    res.json({ connected: true, username: ghUser.login });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// DELETE /api/hosting/github/disconnect
app.delete("/api/hosting/github/disconnect", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  await supabaseAdmin.from("profiles").update({
    github_access_token: null,
    github_username: null,
  }).eq("id", userId);
  res.json({ ok: true });
});

// POST /api/hosting/projects/:id/auto-deploy — toggle auto-deploy on/off
app.post("/api/hosting/projects/:id/auto-deploy", requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const { enabled } = req.body as { enabled: boolean };
  const { data: project } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("id", req.params.id).eq("user_id", userId).single();
  if (!project) { res.status(404).json({ error: "Proyek tidak ditemukan" }); return; }
  const { data: profile } = await supabaseAdmin
    .from("profiles").select("github_access_token").eq("id", userId).single();
  if (!profile?.github_access_token) {
    res.status(400).json({ error: "GitHub belum dihubungkan. Hubungkan akun GitHub terlebih dahulu." }); return;
  }
  const match = project.git_url.match(/github\.com[/:]+([\w.-]+)\/([\w.-]+?)(\.git)?$/);
  if (!match) { res.status(400).json({ error: "URL repo bukan GitHub yang valid" }); return; }
  const [, owner, repo] = match;
  const token = profile.github_access_token;
  const webhookUrl = `${SITE_URL}/api/hosting/webhook/github`;

  if (enabled) {
    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "PioCode/1.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: ["push"],
        config: {
          url: webhookUrl,
          content_type: "json",
          secret: GITHUB_WEBHOOK_SECRET,
          insecure_ssl: "0",
        },
      }),
    });
    if (!ghRes.ok) {
      const errData = await ghRes.json() as { message?: string; errors?: { message: string }[] };
      const msg = errData.errors?.[0]?.message ?? errData.message ?? "Gagal mendaftar webhook ke GitHub";
      res.status(400).json({ error: msg }); return;
    }
    const hookData = await ghRes.json() as { id: number };
    await supabaseAdmin.from("hosting_projects").update({
      auto_deploy: true,
      github_webhook_id: hookData.id,
    }).eq("id", project.id);
    console.log(`[GitHub] Webhook registered id=${hookData.id} for ${owner}/${repo} → project ${project.id}`);
    res.json({ auto_deploy: true, webhook_id: hookData.id });
  } else {
    if (project.github_webhook_id) {
      await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks/${project.github_webhook_id}`, {
        method: "DELETE",
        headers: { Authorization: `token ${token}`, "User-Agent": "PioCode/1.0" },
      }).catch((e) => console.warn("[GitHub] Delete webhook error:", (e as Error).message));
    }
    await supabaseAdmin.from("hosting_projects").update({
      auto_deploy: false,
      github_webhook_id: null,
    }).eq("id", project.id);
    res.json({ auto_deploy: false });
  }
});

// POST /api/hosting/webhook/github — receive GitHub push events (no auth, HMAC-verified)
app.post("/api/hosting/webhook/github", async (req, res) => {
  // Verify HMAC signature from X-Hub-Signature-256 header
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  if (GITHUB_WEBHOOK_SECRET && sig) {
    const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));
    const expected = "sha256=" + crypto.createHmac("sha256", GITHUB_WEBHOOK_SECRET).update(rawBody).digest("hex");
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        res.status(401).json({ error: "Invalid signature" }); return;
      }
    } catch { res.status(401).json({ error: "Signature mismatch" }); return; }
  }

  const event = req.headers["x-github-event"] as string;
  if (event !== "push") { res.json({ ok: true, skipped: `event=${event}` }); return; }

  const payload = req.body as {
    ref?: string;
    repository?: { clone_url?: string; html_url?: string; full_name?: string };
    head_commit?: { id?: string; message?: string };
  };
  const pushedBranch = payload.ref?.replace("refs/heads/", "");
  const repoUrl = payload.repository?.clone_url ?? payload.repository?.html_url ?? "";
  if (!pushedBranch || !repoUrl) { res.json({ ok: true, skipped: "missing ref or repo" }); return; }

  const normalizeUrl = (u: string) => u.replace(/\.git$/, "").replace(/^http:/, "https:").toLowerCase();
  const repoNorm = normalizeUrl(repoUrl);

  console.log(`[GitHub Webhook] push to ${repoUrl} branch ${pushedBranch}`);

  // Find all projects with auto_deploy=true matching this repo+branch
  const { data: allAutoProjects } = await supabaseAdmin
    .from("hosting_projects").select("*").eq("auto_deploy", true).eq("git_branch", pushedBranch);
  const matching = (allAutoProjects ?? []).filter(p => normalizeUrl(p.git_url) === repoNorm);
  if (!matching.length) { res.json({ ok: true, triggered: 0, reason: "no matching projects" }); return; }

  // Respond immediately to GitHub (must be within 10s)
  res.json({ ok: true, triggered: matching.length });

  // Trigger deploy for each matching project asynchronously
  for (const project of matching) {
    (async () => {
      try {
        const commitRef = payload.head_commit?.id?.slice(0, 7) ?? "auto";
        const { data: deployment } = await supabaseAdmin.from("hosting_deployments").insert({
          project_id: project.id,
          user_id: project.user_id,
          status: "queued",
          triggered_by: `push:${commitRef}`,
        }).select().single();
        await supabaseAdmin.from("hosting_projects").update({
          status: "deploying", updated_at: new Date().toISOString(),
        }).eq("id", project.id);

        if (!COOLIFY_API_URL || !COOLIFY_API_TOKEN || !project.coolify_app_uuid) return;
        const deployPort = project.port || 3000;
        const deployEnvVars = (project.env_vars as Record<string, string>) ?? {};
        const deployBuildCmd = project.build_command?.trim() || "pnpm install --no-frozen-lockfile";
        const deployStartCmd = project.start_command?.trim() || "node server/index.js";
        const webhookRuntime = detectRuntimeFromCommands(deployBuildCmd, deployStartCmd);
        const dockerfile = generateDockerfile(webhookRuntime, project.git_url, project.git_branch || "main", deployBuildCmd, deployStartCmd, deployPort, deployEnvVars);

        await syncCoolifyEnvVars(project.coolify_app_uuid, deployPort, deployEnvVars).catch(() => {});
        // Update dockerfile on Coolify app
        await coolifyFetch(`/applications/${project.coolify_app_uuid}`, {
          method: "PATCH", body: JSON.stringify({ dockerfile }),
        }).catch(() => {});
        const deployRes = await coolifyFetch(`/deploy?uuid=${project.coolify_app_uuid}&force=false`);
        const deployData = await deployRes.json() as { deployments?: { deployment_uuid?: string }[]; deployment_uuid?: string };
        const coolifyDeploymentUuid = deployData.deployments?.[0]?.deployment_uuid ?? deployData.deployment_uuid;
        if (coolifyDeploymentUuid && deployment) {
          await supabaseAdmin.from("hosting_deployments").update({
            coolify_deployment_uuid: coolifyDeploymentUuid, status: "in_progress",
          }).eq("id", deployment.id);
        }
        console.log(`[GitHub Webhook] Triggered deploy for project ${project.id} (commit ${commitRef})`);
      } catch (e) {
        console.warn(`[GitHub Webhook] Deploy error for project ${project.id}:`, (e as Error).message);
      }
    })();
  }
});

// ── Hourly hosting billing cron ──────────────────────────────────────────────
// Tiap jam: deduct kredit untuk setiap project yang sedang running.
// Kalau saldo kurang → stop container di Coolify + set status = 'suspended'.
async function runHostingBillingCron() {
  try {
    const { data: runningProjects } = await supabaseAdmin
      .from("hosting_projects")
      .select("id, user_id, name, coolify_app_uuid")
      .eq("status", "running");
    if (!runningProjects?.length) return;

    // Ambil semua profile user yang punya project running sekaligus
    const userIds = [...new Set(runningProjects.map((p: any) => p.user_id as string))];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, credit_balance_idr, tier, role")
      .in("id", userIds);
    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    for (const project of runningProjects) {
      try {
        const profile = profileMap.get(project.user_id);
        if (profile?.role === "admin") continue; // admin gratis
        const tier = getTier(profile ?? null);
        const hourlyCost = HOSTING_HOURLY_COST_IDR[tier] ?? HOSTING_HOURLY_COST_IDR.free;
        const balance = profile?.credit_balance_idr ?? 0;

        if (balance < hourlyCost) {
          // Saldo kurang → suspend project
          if (project.coolify_app_uuid && COOLIFY_API_URL && COOLIFY_API_TOKEN) {
            await coolifyFetch(`/applications/${project.coolify_app_uuid}/stop`, { method: "POST" })
              .catch((e: Error) => console.warn(`[Hosting Cron] Stop failed for ${project.id}:`, e.message));
          }
          await supabaseAdmin.from("hosting_projects").update({
            status: "suspended",
            updated_at: new Date().toISOString(),
          }).eq("id", project.id);
          console.log(`[Hosting Cron] Suspended project ${project.id} (${project.name}) — saldo tidak cukup (${balance} < ${hourlyCost})`);
        } else {
          // Deduct kredit per jam
          await deductCredit(project.user_id, hourlyCost, "hosting_hourly", {
            project_id: project.id,
            project_name: project.name,
            tier,
            cost_idr: hourlyCost,
          });
          console.log(`[Hosting Cron] Billed Rp ${hourlyCost} for project ${project.id} (${project.name}), tier=${tier}`);
        }
      } catch (e) {
        console.warn(`[Hosting Cron] Error processing project ${project.id}:`, (e as Error).message);
      }
    }
  } catch (e) {
    console.warn("[Hosting Cron] Fatal error:", (e as Error).message);
  }
}

// Jalankan pertama kali setelah 1 jam, lalu tiap jam
setTimeout(() => {
  runHostingBillingCron();
  setInterval(runHostingBillingCron, 60 * 60 * 1000);
}, 60 * 60 * 1000);

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
