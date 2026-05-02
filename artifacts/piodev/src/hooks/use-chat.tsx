import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "@/lib/supabase";
import { recordTokenUsageToDB } from "@/hooks/use-token-usage";
import { DEFAULT_PERSONALIZATION, buildSystemPrompt } from "@/hooks/use-personalization";

const API_BASE_URL = "/api/dashscope/compatible-mode/v1";

class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";
  constructor(msg: string) { super(msg); this.name = "QuotaExceededError"; }
}

class ModelRestrictedError extends Error {
  readonly code = "MODEL_RESTRICTED";
  constructor(msg: string) { super(msg); this.name = "ModelRestrictedError"; }
}

class ImageQuotaError extends Error {
  readonly code = "IMAGE_QUOTA_EXCEEDED";
  constructor(msg: string) { super(msg); this.name = "ImageQuotaError"; }
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

// Pioo Plus — flagship models, kualitas terbaik (umum)
// Urutan: Qwen3.6 (terbaru) → Qwen3 Max → Qwen3.5 → Qwen3 → fallback
const PLUS_CHAIN = [
  // Qwen3.6 — generasi terbaru (April 2026)
  "qwen3.6-max-preview",
  "qwen3.6-plus-2026-04-02",
  "qwen3.6-plus",
  "qwen3.6-27b",
  "qwen3.6-35b-a3b",
  // Qwen3 Max — frontier sebelumnya
  "qwen3-max",
  "qwen3-max-preview",
  "qwen3-max-2026-01-23",
  "qwen3-max-2025-09-23",
  // Qwen3.5 — workhorse besar
  "qwen3.5-397b-a17b",
  "qwen3.5-122b-a10b",
  "qwen3-235b-a22b",
  "qwen3-235b-a22b-instruct-2507",
  "qwen3-235b-a22b-thinking-2507",
  "qwen3-next-80b-a3b-instruct",
  "qwen3-next-80b-a3b-thinking",
  "qwq-plus",
  "deepseek-v3.2",
  "qwen3.5-35b-a3b",
  "qwen3.5-27b",
  "qwen3.5-plus-2026-04-20",
  "qwen3.5-plus-2026-02-15",
  "qwen3.5-plus",
  // Qwen3 — fallback dense / MoE
  "qwen3-32b",
  "qwen3-30b-a3b",
  "qwen3-30b-a3b-instruct-2507",
  "qwen3-30b-a3b-thinking-2507",
  "qwen3-14b",
  "qwen2.5-72b-instruct",
  "qwen-max",
  "qwen-max-2025-01-25",
];

// Pioo Coder — spesialis coding & programming
// Urutan: 480B raksasa → coder-plus dated → next → mid → flash → fallback
const CODER_CHAIN = [
  "qwen3-coder-480b-a35b-instruct",
  "qwen3-coder-plus-2025-09-23",
  "qwen3-coder-plus",
  "qwen3-coder-plus-2025-07-22",
  "qwen3-coder-next",
  "qwen3-coder-30b-a3b-instruct",
  "qwen3-coder-flash",
  "qwen3-coder-flash-2025-07-28",
  // Fallback ke flagship umum kalo coder lagi down
  "qwen3.6-max-preview",
  "qwen3-max",
  "deepseek-v3.2",
];

// Pioo Mini — model cepat dan ringan
const MINI_CHAIN = [
  // Qwen3.6 flash — generasi terbaru (April 2026)
  "qwen3.6-flash-2026-04-16",
  "qwen3.6-flash",
  // Fallback flash & small
  "qwen3-8b",
  "qwen2.5-32b-instruct",
  "qwen3.5-flash",
  "qwen3.5-flash-2026-02-23",
  "qwen-plus",
  "qwen-plus-latest",
  "qwen-plus-2025-07-28",
  "qwen-plus-2025-09-11",
  "qwen-plus-2025-07-14",
  "qwen-plus-2025-04-28",
  "qwen-plus-character",
  "qwen-flash-character",
  "qwen2.5-14b-instruct",
  "qwen2.5-14b-instruct-1m",
  "qwen3-4b",
  "qwen2.5-7b-instruct",
  "qwen2.5-7b-instruct-1m",
  "qwen-turbo",
  "qwen-turbo-latest",
  "qwen-turbo-2025-04-28",
  "qwen3-1.7b",
  "qwen-flash",
  "qwen-flash-2025-07-28",
  "qwen3-0.6b",
];

// Gabungan fallback lengkap (Plus dulu, lalu Mini)
const LLM_CHAIN = [...PLUS_CHAIN, ...MINI_CHAIN];

const VISION_CHAIN = [
  // QVQ Visual Reasoning
  "qvq-max",
  "qvq-max-latest",
  "qvq-max-2025-03-25",
  // Qwen3 VL Large
  "qwen3-vl-235b-a22b-instruct",
  "qwen3-vl-235b-a22b-thinking",
  "qwen3-vl-30b-a3b-instruct",
  "qwen3-vl-30b-a3b-thinking",
  // Qwen3 VL Plus
  "qwen3-vl-plus",
  "qwen3-vl-plus-2025-12-19",
  "qwen3-vl-plus-2025-09-23",
  // Qwen2.5 VL Large
  "qwen2.5-vl-72b-instruct",
  "qwen2.5-vl-32b-instruct",
  // Qwen VL Max
  "qwen-vl-max",
  "qwen-vl-max-latest",
  "qwen-vl-max-2025-08-13",
  "qwen-vl-max-2025-04-08",
  // Qwen2.5 VL Mid
  "qwen2.5-vl-7b-instruct",
  // Qwen VL Plus
  "qwen-vl-plus",
  "qwen-vl-plus-latest",
  "qwen-vl-plus-2025-08-15",
  "qwen-vl-plus-2025-05-07",
  "qwen-vl-plus-2025-01-25",
  // Qwen3 VL Flash
  "qwen3-vl-flash",
  "qwen3-vl-flash-2026-01-22",
  "qwen3-vl-flash-2025-10-15",
  // Qwen3 VL Small
  "qwen3-vl-8b-instruct",
  "qwen3-vl-8b-thinking",
  // Qwen VL OCR
  "qwen-vl-ocr",
  "qwen-vl-ocr-2025-11-20",
  // Qwen2.5 VL Small
  "qwen2.5-vl-3b-instruct",
  // Qwen3.5 Omni — multimodal generasi 3.5 (Maret 2026, frontier multimodal)
  "qwen3.5-omni-plus",
  "qwen3.5-omni-plus-2026-03-15",
  "qwen3.5-omni-flash",
  "qwen3.5-omni-flash-2026-03-15",
  // Qwen3.5 Omni Realtime
  "qwen3.5-omni-plus-realtime",
  "qwen3.5-omni-plus-realtime-2026-03-15",
  "qwen3.5-omni-flash-realtime",
  "qwen3.5-omni-flash-realtime-2026-03-15",
  // Qwen Omni klasik — multimodal (text + image + audio/video), non-realtime
  "qwen-omni-turbo",
  "qwen-omni-turbo-latest",
  "qwen-omni-turbo-2025-03-26",
  "qwen3-omni-flash",
  "qwen3-omni-flash-2025-09-15",
  "qwen2.5-omni-7b",
  // Qwen Omni klasik Realtime (voice/audio streaming)
  "qwen-omni-turbo-realtime",
  "qwen-omni-turbo-realtime-latest",
  "qwen-omni-turbo-realtime-2025-05-08",
  "qwen3-omni-flash-realtime",
  "qwen3-omni-flash-realtime-2025-09-15",
];

// Image generation models (text → image)
const IMAGE_GEN_MODELS = [
  // Qwen Image 2.0 Pro (newest dated April 2026 di depan sebagai flagship)
  "qwen-image-2.0-pro-2026-04-22",
  "qwen-image-2.0-pro-2026-03-03",
  "qwen-image-2.0-pro",
  "qwen-image-max",
  "qwen-image-max-2025-12-30",
  "qwen-image-plus",
  "qwen-image-plus-2026-01-09",
  "qwen-image-2.0",
  "qwen-image-2.0-2026-03-03",
  "qwen-image",
  "z-image-turbo",
];

// Image editing models (image + prompt → new image)
const IMAGE_EDIT_MODELS = [
  "qwen-image-edit-max",
  "qwen-image-edit-max-2026-01-16",
  "qwen-image-edit-plus",
  "qwen-image-edit-plus-2025-12-15",
  "qwen-image-edit-plus-2025-10-30",
  "qwen-image-edit",
];

// Video generation models (text/image → video)
const VIDEO_GEN_MODELS = [
  // HappyHorse 1.0 (family video baru — Juli 2026, super limited quota)
  "happyhorse-1.0-t2v",
  "happyhorse-1.0-i2v",
  "happyhorse-1.0-r2v",
  "happyhorse-1.0-video-edit",
  // Wan 2.7 (generasi terbaru — April 2026, di depan sebagai flagship)
  "wan2.7-t2v-2026-04-25",
  "wan2.7-t2v",
  "wan2.7-i2v-2026-04-25",
  "wan2.7-i2v",
  "wan2.7-r2v",
  "wan2.7-videoedit",
  // Text to video
  "wan2.2-t2v-plus",
  "wan2.6-t2v",
  "wan2.1-t2v-plus",
  "wan2.1-t2v-turbo",
  "wan2.5-t2v-preview",
  // Image to video
  "wan2.2-i2v-plus",
  "wan2.2-i2v-flash",
  "wan2.6-i2v",
  "wan2.6-i2v-flash",
  "wan2.1-i2v-plus",
  "wan2.1-i2v-turbo",
  "wan2.5-i2v-preview",
  // Keyframe to video
  "wan2.2-kf2v-flash",
  "wan2.1-kf2v-plus",
  // Reference to video
  "wan2.6-r2v",
  "wan2.6-r2v-flash",
  // Video editing
  "wan2.1-vace-plus",
  "wan2.2-animate-move",
  "wan2.2-animate-mix",
];

// Image generation from text (Wan series — image only)
const WAN_IMAGE_MODELS = [
  // Wan 2.7 image (generasi terbaru — April 2026)
  "wan2.7-image-pro",
  "wan2.7-image",
  "wan2.6-image",
  "wan2.6-t2i",
  "wan2.2-t2i-plus",
  "wan2.2-t2i-flash",
  "wan2.1-t2i-plus",
  "wan2.1-t2i-turbo",
  "wan2.5-t2i-preview",
  "wan2.5-i2i-preview",
];

// Machine translation models (dedicated translation, not general chat)
const TRANSLATION_MODELS = [
  "qwen-mt-plus",
  "qwen-mt-turbo",
  "qwen-mt-flash",
  "qwen-mt-lite",
];

const WEB_SEARCH_CHAIN = [
  "qwen-max",
  "qwen-max-2025-01-25",
  "qwen-plus",
  "qwen-plus-latest",
  "qwen-plus-2025-07-28",
  "qwen-plus-2025-09-11",
  "qwen-plus-2025-07-14",
  "qwen-plus-2025-04-28",
  "qwen-turbo",
  "qwen-turbo-latest",
  "qwen-turbo-2025-04-28",
  "qwen-flash",
  "qwen-flash-2025-07-28",
];

const THINKING_CHAIN = [
  "qwen3-max",
  "qwen3-max-preview",
  "qwen3-max-2026-01-23",
  "qwen3-max-2025-09-23",
  "qwen3-235b-a22b",
  "qwen3-235b-a22b-instruct-2507",
  "qwen3-next-80b-a3b-instruct",
  "qwen3-next-80b-a3b-thinking",
  "qwq-plus",
  "qwen3-32b",
  "qwen3-30b-a3b",
  "qwen3-30b-a3b-instruct-2507",
  "qwen3-14b",
  "qwen3-8b",
  "qwen3-coder-plus",
  "qwen3-coder-flash",
  "qwen3-4b",
  "qwen3-1.7b",
  "qwen3-0.6b",
];

async function generateImage(prompt: string, signal?: AbortSignal): Promise<string> {
  for (const model of IMAGE_GEN_MODELS) {
    try {
      const submitRes = await fetch(
        `/api/dashscope/api/v1/services/aigc/text2image/image-synthesis`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${await getToken()}`,
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
          },
          body: JSON.stringify({
            model,
            input: { prompt },
            parameters: { size: "1024*1024", n: 1 },
          }),
          signal,
        }
      );

      if (submitRes.status === 429 && submitRes.headers.get("X-Pioo-Error") === "IMAGE_QUOTA_EXCEEDED") {
        const body = await submitRes.json();
        throw new ImageQuotaError(body.error ?? "Kuota generate gambar habis.");
      }
      if (!submitRes.ok) continue;
      const submitData = await submitRes.json();
      const taskId = submitData.output?.task_id;
      if (!taskId) continue;

      for (let i = 0; i < 30; i++) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        await new Promise((r) => setTimeout(r, 2000));

        const pollRes = await fetch(`/api/dashscope/api/v1/tasks/${taskId}`, {
          headers: { "Authorization": `Bearer ${await getToken()}` },
          signal,
        });

        if (!pollRes.ok) continue;
        const pollData = await pollRes.json();
        const status = pollData.output?.task_status;

        if (status === "SUCCEEDED") {
          const url = pollData.output?.results?.[0]?.url;
          if (url) return url;
        }
        if (status === "FAILED") break;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      continue;
    }
  }
  throw new Error("Gagal generate gambar. Coba lagi nanti.");
}

async function getSystemPrompt(voiceMode = false): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const p = { ...DEFAULT_PERSONALIZATION, ...session?.user?.user_metadata?.personalization };
  const base = buildSystemPrompt(p);
  if (!voiceMode) return base;
  const voiceSuffix = `

[MODE TELEPON SUARA AKTIF]
Kamu lagi ngobrol lewat suara, BUKAN chat tertulis. Jawab harus:
- Singkat & natural: maksimal 1-3 kalimat pendek per giliran
- Gaya ngobrol santai sehari-hari, kayak nelpon temen
- TANPA markdown, TANPA bullet/list/heading, TANPA emoji
- TANPA blok kode (kalau ditanya kode, jelasin singkat secara verbal)
- TANPA simbol aneh, tanda kutip, atau ASCII art
- Pakai bahasa yang user pakai
- Kalau pertanyaan kompleks, kasih jawaban inti aja dulu, terus tanya balik kalau perlu detail`;
  return base + voiceSuffix;
}

const MAX_RETRIES = 2;

// Generate judul singkat dari pesan pertama user (non-blocking, best-effort)
// Pakai LLM_CHAIN yang sama biar ada fallback kalau model utama fail
async function generateTitle(userMessage: string, aiReply: string): Promise<string> {
  const titleModels = ["qwen-turbo", "qwen-turbo-latest", "qwen-plus"];
  for (const model of titleModels) {
    try {
      const r = await fetch(`${API_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${await getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "Kamu membuat judul singkat untuk percakapan chat. " +
                "Buat judul 3-5 kata yang menggambarkan topik percakapan dengan jelas. " +
                "Balas HANYA judulnya saja, tanpa tanda kutip, tanpa tanda baca di akhir, tanpa penjelasan tambahan.",
            },
            {
              role: "user",
              content: `Pesan user: "${userMessage.slice(0, 200)}"\nBalasan AI: "${aiReply.slice(0, 200)}"`,
            },
          ],
          max_tokens: 30,
          stream: false,
        }),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const title = data.choices?.[0]?.message?.content?.trim();
      if (title) return title;
    } catch {
      continue;
    }
  }
  return "";
}

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type Message = {
  id: string;
  role: "user" | "ai";
  content: string;
  thinking?: string;
  imageUrls?: string[];
  attachedFileNames?: string[];
  timestamp: Date;
  tokenUsage?: TokenUsage;
};

export type Chat = {
  id: string;
  title: string;
  updatedAt: Date;
  messages: Message[];
};

export function useChat(userId: string | undefined) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, _setActiveChatId] = useState<string | null>(() => {
    return sessionStorage.getItem("piodev_active_chat_id") || null;
  });
  const setActiveChatId = (id: string | null) => {
    _setActiveChatId(id);
    if (id) sessionStorage.setItem("piodev_active_chat_id", id);
    else sessionStorage.removeItem("piodev_active_chat_id");
  };
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeChat = chats.find((c) => c.id === activeChatId) || null;

  // ── Polling helper untuk background generation ────────────────────────────
  // Dipake saat sendMessage (live polling) dan saat loadChats untuk resume
  // pesan AI yang masih in-progress (kasus user refresh saat generating).
  const pollingMsgIdsRef = useRef<Set<string>>(new Set());
  const pollGeneration = async (
    chatId: string,
    aiMsgId: string,
    abortSignal?: AbortSignal,
  ): Promise<{ content: string; tokenUsage: TokenUsage | null; timedOut: boolean }> => {
    if (pollingMsgIdsRef.current.has(aiMsgId)) {
      return { content: "", tokenUsage: null, timedOut: false };
    }
    pollingMsgIdsRef.current.add(aiMsgId);
    let lastContent = "";
    let lastUsage: TokenUsage | null = null;
    try {
      const startTime = Date.now();
      const maxWait = 5 * 60 * 1000;
      let firstPoll = true;
      while (Date.now() - startTime < maxWait) {
        if (abortSignal?.aborted) throw new DOMException("aborted", "AbortError");
        // First poll: 200ms (server butuh waktu insert + fire bg). Selanjutnya 800ms.
        await new Promise((r) => setTimeout(r, firstPoll ? 200 : 800));
        firstPoll = false;
        try {
          const resp = await fetch(`/api/chat/bg-poll/${aiMsgId}`, {
            headers: { "Authorization": `Bearer ${await getToken()}` },
            signal: abortSignal,
          });
          if (!resp.ok) continue;
          const data = await resp.json();
          lastContent = data.content || "";
          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === aiMsgId ? { ...m, content: lastContent } : m
                ),
              };
            })
          );
          if (data.status === "done") {
            lastUsage = data.tokenUsage || null;
            if (lastUsage) {
              setChats((prev) =>
                prev.map((c) => {
                  if (c.id !== chatId) return c;
                  return {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === aiMsgId ? { ...m, tokenUsage: lastUsage! } : m
                    ),
                  };
                })
              );
            }
            return { content: lastContent, tokenUsage: lastUsage, timedOut: false };
          }
        } catch (e: any) {
          if (e?.name === "AbortError") throw e;
          console.warn("[PioCode] poll error:", e);
        }
      }
      return { content: lastContent, tokenUsage: lastUsage, timedOut: true };
    } finally {
      pollingMsgIdsRef.current.delete(aiMsgId);
    }
  };

  useEffect(() => {
    if (!userId) { setIsLoading(false); return; }
    loadChats();
  }, [userId]);

  const loadChats = async () => {
    setIsLoading(true);
    const { data: convos } = await supabase
      .from("conversations")
      .select("*, messages(*)")
      .order("updated_at", { ascending: false });

    // Detect in-progress AI messages → resume polling untuk lanjut nampilin
    // hasil generation yang masih jalan di server (kasus user refresh saat AI generating).
    const resumeTargets: Array<{ chatId: string; msgId: string }> = [];
    const RESUME_THRESHOLD_MS = 10 * 60 * 1000; // 10 menit
    const now = Date.now();

    if (convos) {
      setChats(convos.map((c: any) => ({
        id: c.id,
        title: c.title,
        updatedAt: new Date(c.updated_at),
        messages: (c.messages || [])
          .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .map((m: any) => {
            const isAi = m.role === "ai";
            const hasUsage = m.prompt_tokens != null || m.total_tokens != null;
            const createdAt = new Date(m.created_at).getTime();
            const isRecent = now - createdAt < RESUME_THRESHOLD_MS;
            // AI message tanpa token data + masih recent = generation lagi jalan di server
            if (isAi && !hasUsage && isRecent) {
              resumeTargets.push({ chatId: c.id, msgId: m.id });
            }
            return {
              id: m.id,
              role: m.role as "user" | "ai",
              content: m.content,
              timestamp: new Date(m.created_at),
              tokenUsage: isAi && hasUsage
                ? { promptTokens: m.prompt_tokens || 0, completionTokens: m.completion_tokens || 0, totalTokens: m.total_tokens || 0 }
                : undefined,
            };
          }),
      })));
    }
    setIsLoading(false);

    // Spawn polling untuk tiap in-progress msg (fire-and-forget)
    for (const target of resumeTargets) {
      pollGeneration(target.chatId, target.msgId).catch((e) => {
        console.warn(`[PioCode] resume polling ${target.msgId} failed:`, e);
      });
    }
  };

  const createNewChat = () => setActiveChatId(null);
  const selectChat = (id: string) => setActiveChatId(id);

  const deleteChat = async (id: string) => {
    await supabase.from("conversations").delete().eq("id", id);
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (activeChatId === id) setActiveChatId(null);
  };

  const deleteAllChats = async () => {
    if (!userId) return;
    await supabase.from("conversations").delete().eq("user_id", userId);
    setChats([]);
    setActiveChatId(null);
  };

  const updateChatTitle = async (id: string, title: string) => {
    await supabase.from("conversations").update({ title }).eq("id", id);
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  };

  const sendMessage = useCallback(async (
    content: string,
    imageUrls?: string[],
    fileDatas?: { name: string; content: string }[],
    options?: { webSearch?: boolean; thinking?: boolean; imageGen?: boolean; modelTier?: "plus" | "mini" | "coder"; voiceMode?: boolean },
  ) => {
    if (!userId) return;
    let chatId = activeChatId;
    const isNewChat = !chatId;

    const hasImages = !!imageUrls?.length;
    const hasFiles = !!fileDatas?.length;
    const titleBase = content.trim()
      || (hasImages ? "Analisis gambar" : hasFiles ? `File: ${fileDatas![0].name}` : "");
    const fallbackTitle = titleBase.slice(0, 40) + (titleBase.length > 40 ? "..." : "");

    if (!chatId) {
      const { data: newConvo, error } = await supabase
        .from("conversations")
        .insert({ user_id: userId, title: fallbackTitle })
        .select()
        .single();

      if (error || !newConvo) return;
      chatId = newConvo.id;
      setChats((prev) => [{ id: chatId!, title: fallbackTitle, updatedAt: new Date(), messages: [] }, ...prev]);
      setActiveChatId(chatId);
    }

    const storedContent = content
      || (hasImages ? `[${imageUrls!.length} gambar]` : hasFiles ? `[${fileDatas!.length} file]` : "");

    const { data: savedUserMsg } = await supabase
      .from("messages")
      .insert({ conversation_id: chatId, role: "user", content: storedContent })
      .select()
      .single();

    const userMessage: Message = {
      id: savedUserMsg?.id || uuidv4(),
      role: "user",
      content,
      imageUrls,
      attachedFileNames: fileDatas?.map((f) => f.name),
      timestamp: new Date(),
    };

    let currentMessages: Message[] = [];
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        const updated = { ...c, updatedAt: new Date(), messages: [...c.messages, userMessage] };
        currentMessages = updated.messages;
        return updated;
      })
    );

    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", chatId);

    setIsTyping(true);

    const aiMsgId = uuidv4();
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? { ...c, messages: [...c.messages, { id: aiMsgId, role: "ai", content: "", timestamp: new Date() }] }
          : c
      )
    );

    abortControllerRef.current = new AbortController();

    let fullContent = "";
    let fullThinking = "";
    let capturedUsage: TokenUsage | null = null;

    // Image generation path
    if (options?.imageGen && content.trim()) {
      try {
        const imageUrl = await generateImage(content.trim(), abortControllerRef.current.signal);
        fullContent = `![${content.trim()}](${imageUrl})\n\n*Tip: tekan & tahan gambar (mobile) atau klik kanan (desktop) untuk menyimpan.*`;

        setChats((prev) =>
          prev.map((c) => {
            if (c.id !== chatId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === aiMsgId ? { ...m, content: fullContent } : m
              ),
            };
          })
        );

        await supabase.from("messages").insert({
          id: aiMsgId,
          conversation_id: chatId!,
          role: "ai",
          content: fullContent,
        });

        if (isNewChat) {
          generateTitle(content.trim(), "Generated image").then((generatedTitle) => {
            if (!generatedTitle) return;
            supabase.from("conversations").update({ title: generatedTitle }).eq("id", chatId!);
            setChats((prev) =>
              prev.map((c) => (c.id === chatId ? { ...c, title: generatedTitle } : c))
            );
          });
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        const errorMsg = err?.code === "IMAGE_QUOTA_EXCEEDED"
          ? err.message
          : "Gagal generate gambar. Coba lagi atau gunakan deskripsi yang lebih jelas.";
        setChats((prev) =>
          prev.map((c) => {
            if (c.id !== chatId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === aiMsgId ? { ...m, content: errorMsg } : m
              ),
            };
          })
        );
      } finally {
        setIsTyping(false);
        abortControllerRef.current = null;
      }
      return;
    }

    try {
      // Smart routing: gambar → vision, web/thinking → thinking chain, else → Plus atau Mini
      const llmChain = options?.modelTier === "mini" ? MINI_CHAIN : options?.modelTier === "coder" ? CODER_CHAIN : PLUS_CHAIN;
      const chain = hasImages
        ? VISION_CHAIN
        : (options?.webSearch || options?.thinking)
          ? THINKING_CHAIN
          : llmChain;

      const buildHistory = () => currentMessages.map((m, idx) => {
        const isLast = idx === currentMessages.length - 1;

        if (m.imageUrls && m.imageUrls.length > 0) {
          return {
            role: "user",
            content: [
              ...m.imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
              ...(m.content ? [{ type: "text", text: m.content }] : []),
            ],
          };
        }

        if (isLast && hasFiles && m.role === "user") {
          const filesBlock = fileDatas!
            .map((f) => `[File: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``)
            .join("\n\n");
          return { role: "user", content: m.content ? `${m.content}\n\n${filesBlock}` : filesBlock };
        }

        return {
          role: m.role === "ai" ? "assistant" : "user",
          content: m.content,
        };
      });

      // ── DIRECT STREAMING ──────────────────────────────────────────────────
      const enableThinking = !!((options?.webSearch || options?.thinking) && !hasImages);
      const systemPrompt = await getSystemPrompt(options?.voiceMode);
      const fullHistory = [
        { role: "system" as const, content: systemPrompt },
        ...buildHistory(),
      ];

      let response: Response | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          fullContent = "";
          fullThinking = "";
          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === aiMsgId ? { ...m, content: "", thinking: undefined } : m
                ),
              };
            })
          );
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }

        for (const model of chain) {
          try {
            const r = await fetch(`${API_BASE_URL}/chat/completions`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${await getToken()}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model,
                messages: fullHistory,
                stream: true,
                stream_options: { include_usage: true },
                ...(enableThinking && { enable_thinking: true }),
              }),
              signal: abortControllerRef.current!.signal,
            });

            if (r.status === 429 && r.headers.get("X-Pioo-Error") === "QUOTA_EXCEEDED") {
              const body = await r.json();
              throw new QuotaExceededError(body.error ?? "Limit harian tercapai.");
            }
            if (r.status === 403 && r.headers.get("X-Pioo-Error") === "MODEL_RESTRICTED") {
              const body = await r.json();
              throw new ModelRestrictedError(body.error ?? "Model ini hanya untuk pengguna Plus.");
            }
            if (r.status === 403 || r.status === 429 || r.status >= 500) {
              console.warn(`[PioCode] Model ${model} returned ${r.status}`);
              continue;
            }
            if (!r.ok) {
              const text = await r.text();
              console.warn(`[PioCode] Model ${model} not ok (${r.status}):`, text);
              throw new Error(text);
            }

            response = r;
            break;
          } catch (err: any) {
            if (err?.name === "AbortError") throw err;
            if (err?.code === "QUOTA_EXCEEDED") throw err;
            if (err?.code === "MODEL_RESTRICTED") throw err;
            console.warn(`[PioCode] Model ${model} exception:`, err?.message);
            continue;
          }
        }

        if (!response) {
          if (attempt >= MAX_RETRIES) throw new Error("Semua model tidak tersedia saat ini. Coba lagi nanti.");
          continue;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let lastFlush = 0;
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              const thinkingDelta = delta?.reasoning_content || "";
              const contentDelta = delta?.content || "";

              if (!thinkingDelta && !contentDelta) {
                if (parsed.usage) {
                  capturedUsage = {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                  };
                }
                continue;
              }

              if (thinkingDelta) fullThinking += thinkingDelta;
              if (contentDelta) fullContent += contentDelta;

              const now = Date.now();
              if (now - lastFlush < 30) continue;
              lastFlush = now;

              const snapshot = fullContent;
              const thinkingSnapshot = fullThinking;
              setChats((prev) =>
                prev.map((c) => {
                  if (c.id !== chatId) return c;
                  return {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === aiMsgId
                        ? { ...m, content: snapshot, thinking: thinkingSnapshot || undefined }
                        : m
                    ),
                  };
                })
              );
            } catch {
              // skip malformed chunks
            }
          }
        }

        break;
      }

      // Final state update — pastikan konten terakhir tampil di UI
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === aiMsgId
                ? { ...m, content: fullContent, thinking: fullThinking || undefined }
                : m
            ),
          };
        })
      );

      // Simpan AI message ke DB
      await supabase.from("messages").upsert({
        id: aiMsgId,
        conversation_id: chatId!,
        role: "ai",
        content: fullContent,
        ...(capturedUsage && {
          prompt_tokens: capturedUsage.promptTokens,
          completion_tokens: capturedUsage.completionTokens,
          total_tokens: capturedUsage.totalTokens,
        }),
      });

      // Fallback estimasi token
      if (!capturedUsage) {
        const estimatedCompletion = Math.ceil(fullContent.length / 4);
        const estimatedPrompt = Math.ceil(content.length / 4);
        capturedUsage = {
          promptTokens: estimatedPrompt,
          completionTokens: estimatedCompletion,
          totalTokens: estimatedPrompt + estimatedCompletion,
        };
      }

      const finalUsage = capturedUsage;
      // Update token usage di UI
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === aiMsgId ? { ...m, tokenUsage: finalUsage } : m
            ),
          };
        })
      );

      // Optimistic bump untuk UI counter
      if (typeof window !== "undefined" && finalUsage.totalTokens > 0) {
        window.dispatchEvent(new CustomEvent("pioo:token-usage-bump", {
          detail: {
            promptTokens: finalUsage.promptTokens,
            completionTokens: finalUsage.completionTokens,
            totalTokens: finalUsage.totalTokens,
            messages: 1,
          },
        }));
      }

      // Auto-generate judul untuk chat baru (fire-and-forget)
      if (isNewChat && (content.trim() || fullContent)) {
        generateTitle(content.trim(), fullContent).then((generatedTitle) => {
          if (!generatedTitle) return;
          supabase.from("conversations").update({ title: generatedTitle }).eq("id", chatId!);
          setChats((prev) =>
            prev.map((c) => (c.id === chatId ? { ...c, title: generatedTitle } : c))
          );
        });
      }

    } catch (err: any) {
      if (err?.name === "AbortError") return;

      console.error("[PioCode] Chat error:", err?.message, err);
      const errorMsg = err instanceof QuotaExceededError || err instanceof ModelRestrictedError
        ? err.message
        : `Gagal: ${err?.message || "error tidak diketahui"}`;
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === aiMsgId ? { ...m, content: errorMsg } : m
            ),
          };
        })
      );
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  }, [activeChatId, userId]);

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsTyping(false);
  }, []);

  const regenerateLastMessage = useCallback(async () => {
    if (!userId || !activeChatId) return;

    const chat = chats.find((c) => c.id === activeChatId);
    if (!chat || chat.messages.length === 0) return;

    const lastMsg = chat.messages.at(-1);
    if (!lastMsg || lastMsg.role !== "ai") return;

    const lastAiMsgId = lastMsg.id;
    const chatId = activeChatId;

    // Context = all messages except the last AI response
    const currentMessages = chat.messages.filter((m) => m.id !== lastAiMsgId);

    // Detect images in the most recent user message
    const lastUserMsg = [...currentMessages].reverse().find((m) => m.role === "user");
    const hasImages = !!(lastUserMsg?.imageUrls?.length);

    // Remove old AI response from DB
    await supabase.from("messages").delete().eq("id", lastAiMsgId);

    setIsTyping(true);
    const newAiMsgId = uuidv4();

    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        return {
          ...c,
          messages: [
            ...c.messages.filter((m) => m.id !== lastAiMsgId),
            { id: newAiMsgId, role: "ai", content: "", timestamp: new Date() },
          ],
        };
      })
    );

    abortControllerRef.current = new AbortController();
    let fullContent = "";
    let fullThinking = "";

    const buildHistory = () =>
      currentMessages.map((m) => {
        if (m.imageUrls && m.imageUrls.length > 0) {
          return {
            role: "user",
            content: [
              ...m.imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
              ...(m.content ? [{ type: "text", text: m.content }] : []),
            ],
          };
        }
        return {
          role: m.role === "ai" ? "assistant" : "user",
          content: m.content,
        };
      });

    try {
      const chain = hasImages ? VISION_CHAIN : LLM_CHAIN;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          fullContent = "";
          fullThinking = "";
          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === newAiMsgId ? { ...m, content: "", thinking: undefined } : m
                ),
              };
            })
          );
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }

        try {
          let response: Response | null = null;

          for (const model of chain) {
            try {
              const r = await fetch(`${API_BASE_URL}/chat/completions`, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${await getToken()}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model,
                  messages: [
                    { role: "system", content: await getSystemPrompt() },
                    ...buildHistory(),
                  ],
                  stream: true,
                }),
                signal: abortControllerRef.current!.signal,
              });

              if (r.status === 429 && r.headers.get("X-Pioo-Error") === "QUOTA_EXCEEDED") {
                const body = await r.json();
                throw new QuotaExceededError(body.error ?? "Limit harian tercapai.");
              }
              if (r.status === 403 && r.headers.get("X-Pioo-Error") === "MODEL_RESTRICTED") {
                const body = await r.json();
                throw new ModelRestrictedError(body.error ?? "Model ini hanya untuk pengguna Plus.");
              }
              if (r.status === 429 && r.headers.get("X-Pioo-Error") === "IMAGE_QUOTA_EXCEEDED") {
                const body = await r.json();
                throw new ImageQuotaError(body.error ?? "Kuota generate gambar habis.");
              }
              if (r.status === 403 || r.status === 429 || r.status >= 500) {
                console.warn(`[PioCode] Model ${model} returned ${r.status}`);
                continue;
              }
              if (!r.ok) {
                const text = await r.text();
                console.warn(`[PioCode] Model ${model} not ok (${r.status}):`, text);
                throw new Error(text);
              }

              response = r;
              break;
            } catch (err: any) {
              if (err?.name === "AbortError") throw err;
              if (err?.code === "QUOTA_EXCEEDED") throw err;
              if (err?.code === "MODEL_RESTRICTED") throw err;
              if (err?.code === "IMAGE_QUOTA_EXCEEDED") throw err;
              console.warn(`[PioCode] Model ${model} exception:`, err?.message);
              continue;
            }
          }

          if (!response) throw new Error("Semua model tidak tersedia saat ini. Coba lagi nanti.");

          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let lastFlushRegen = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data).choices?.[0]?.delta;
                const thinkingDelta = parsed?.reasoning_content || "";
                const contentDelta = parsed?.content || "";
                if (!thinkingDelta && !contentDelta) continue;

                if (thinkingDelta) fullThinking += thinkingDelta;
                if (contentDelta) fullContent += contentDelta;

                const now = Date.now();
                if (now - lastFlushRegen < 30) continue;
                lastFlushRegen = now;

                const snapshot = fullContent;
                const thinkingSnapshot = fullThinking;
                setChats((prev) =>
                  prev.map((c) => {
                    if (c.id !== chatId) return c;
                    return {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === newAiMsgId
                          ? { ...m, content: snapshot, thinking: thinkingSnapshot || undefined }
                          : m
                      ),
                    };
                  })
                );
              } catch {
                // skip malformed chunks
              }
            }
          }

          break;
        } catch (err: any) {
          if (err?.name === "AbortError") throw err;
          if (attempt >= MAX_RETRIES) throw err;
        }
      }

      await supabase.from("messages").insert({
        id: newAiMsgId,
        conversation_id: chatId,
        role: "ai",
        content: fullContent,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") return;

      const errorMsg = "Maaf, terjadi kesalahan. Coba lagi atau periksa koneksi kamu.";
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === newAiMsgId ? { ...m, content: errorMsg } : m
            ),
          };
        })
      );
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  }, [activeChatId, userId, chats]);

  return {
    chats,
    activeChat,
    isTyping,
    isLoading,
    createNewChat,
    selectChat,
    deleteChat,
    deleteAllChats,
    updateChatTitle,
    sendMessage,
    stopGeneration,
    regenerateLastMessage,
    refreshChats: loadChats,
  };
}
