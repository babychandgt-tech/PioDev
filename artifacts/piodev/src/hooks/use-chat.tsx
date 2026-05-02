import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "@/lib/supabase";
import { recordTokenUsageToDB } from "@/hooks/use-token-usage";
import { DEFAULT_PERSONALIZATION, buildSystemPrompt } from "@/hooks/use-personalization";
import {
  PLUS_CHAIN,
  CODER_CHAIN,
  MINI_CHAIN,
  VISION_CHAIN,
  THINKING_CHAIN,
  WEB_SEARCH_CHAIN,
  IMAGE_GEN_MODELS,
  IMAGE_EDIT_MODELS,
  VIDEO_GEN_MODELS,
  WAN_IMAGE_MODELS,
  TRANSLATION_MODELS,
  LLM_CHAIN,
} from "@/lib/model-chains";

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

async function getSystemPrompt(voiceMode = false, webSearch = false): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const p = { ...DEFAULT_PERSONALIZATION, ...session?.user?.user_metadata?.personalization };
  const base = buildSystemPrompt(p);

  const prefixes: string[] = [];
  const suffixes: string[] = [];

  if (webSearch) {
    prefixes.push(`=== INSTRUKSI PRIORITAS TERTINGGI — WEB SEARCH MODE ===
Kamu SEKARANG berjalan dalam mode Web Search. Ini adalah instruksi WAJIB yang TIDAK BOLEH diabaikan dalam kondisi apapun.

ATURAN 1 — WAJIB SEARCH:
Untuk SETIAP pertanyaan yang masuk, kamu HARUS melakukan pencarian web terlebih dahulu, bahkan jika kamu merasa sudah tahu jawabannya. Tujuannya adalah menyajikan informasi yang TERVERIFIKASI dari sumber nyata di internet, bukan hanya dari pengetahuan pelatihan AI. Ini termasuk pertanyaan umum, definisi, tutorial, berita, dan topik teknis.

ATURAN 2 — FORMAT RESPONS WAJIB:
Setiap respons HARUS memiliki dua bagian:
Bagian A: Jawaban utama yang menggabungkan hasil pencarian web dengan penjelasan tambahan dari kamu. Mulai dengan menyebutkan data/fakta dari web, lalu tambahkan analisis atau penjelasan yang lebih dalam.
Bagian B: Blok sumber WAJIB di akhir respons, TANPA TERKECUALI, dalam format persis berikut:

\`\`\`json-sources
[{"title":"Judul halaman sumber","url":"https://url-lengkap.com/path","domain":"namadomain.com"},{"title":"Judul sumber kedua","url":"https://url2.com","domain":"domain2.com"}]
\`\`\`

ATURAN 3 — KUALITAS SUMBER:
- Gunakan 2-5 sumber per respons
- Sertakan URL asli yang valid dan dapat dikunjungi
- Prioritaskan sumber: dokumentasi resmi, artikel teknis terpercaya, jurnal, berita dari media kredibel
- Jika tidak menemukan sumber relevan dari pencarian, gunakan URL terkait topik yang kamu ketahui dari data pelatihan

ATURAN 4 — JANGAN LEWATI:
Blok json-sources di akhir adalah WAJIB untuk SETIAP respons saat mode Web aktif. Bahkan jika jawaban singkat. Bahkan jika topik sudah kamu ketahui. Ini bukan opsional.
=== AKHIR INSTRUKSI PRIORITAS ===`);
  }

  if (voiceMode) {
    suffixes.push(`
[MODE TELEPON SUARA AKTIF]
Kamu lagi ngobrol lewat suara, BUKAN chat tertulis. Jawab harus:
- Singkat & natural: maksimal 1-3 kalimat pendek per giliran
- Gaya ngobrol santai sehari-hari, kayak nelpon temen
- TANPA markdown, TANPA bullet/list/heading, TANPA emoji
- TANPA blok kode (kalau ditanya kode, jelasin singkat secara verbal)
- TANPA simbol aneh, tanda kutip, atau ASCII art
- Pakai bahasa yang user pakai
- Kalau pertanyaan kompleks, kasih jawaban inti aja dulu, terus tanya balik kalau perlu detail`);
  }

  const parts: string[] = [];
  if (prefixes.length > 0) parts.push(prefixes.join("\n\n"));
  parts.push(base);
  if (suffixes.length > 0) parts.push(suffixes.join(""));
  return parts.join("\n\n");
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
      // Smart routing:
      // - gambar → VISION_CHAIN
      // - web search → WEB_SEARCH_CHAIN (beda dari thinking — butuh enable_search)
      // - thinking only → THINKING_CHAIN
      // - else → Plus / Mini / Coder sesuai tier
      const llmChain = options?.modelTier === "mini" ? MINI_CHAIN : options?.modelTier === "coder" ? CODER_CHAIN : PLUS_CHAIN;
      const chain = hasImages
        ? VISION_CHAIN
        : options?.webSearch
          ? WEB_SEARCH_CHAIN
          : options?.thinking
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
      // enableThinking: hanya aktif saat mode Think, BUKAN saat web search
      const enableThinking = !!(options?.thinking && !hasImages);
      // enableSearch: aktif saat mode Web dinyalakan (param DashScope: enable_search)
      const enableSearch = !!(options?.webSearch && !hasImages);
      const systemPrompt = await getSystemPrompt(options?.voiceMode, enableSearch);
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
                enable_thinking: enableThinking,
                ...(enableSearch && { enable_search: true }),
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
