import { useState, useRef, useEffect } from "react";
import { ExternalLink, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

export type WebSource = {
  title: string;
  url: string;
  domain: string;
};

export function parseJsonSources(raw: string): WebSource[] {
  try {
    const arr = JSON.parse(raw.trim());
    if (!Array.isArray(arr)) return [];
    return arr.map((s: any) => ({
      title: s.title ?? s.url ?? "",
      url: s.url ?? "",
      domain: s.domain ?? (() => {
        try { return new URL(s.url).hostname.replace(/^www\./, ""); } catch { return s.url; }
      })(),
    })).filter((s: WebSource) => s.url);
  } catch {
    return [];
  }
}

function FaviconImg({ domain }: { domain: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <span className="w-3.5 h-3.5 rounded-sm bg-zinc-300 dark:bg-zinc-600 flex items-center justify-center text-[8px] font-bold text-zinc-500 dark:text-zinc-400 uppercase shrink-0">
        {domain[0]}
      </span>
    );
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt=""
      className="w-3.5 h-3.5 rounded-sm shrink-0"
      onError={() => setErrored(true)}
    />
  );
}

export function SourceCitations({ sources }: { sources: WebSource[] }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!sources.length) return null;

  const visible = sources.slice(0, 3);
  const extra = sources.length - 3;
  const current = sources[page] ?? sources[0];

  const handleBadgeClick = (i: number) => {
    setPage(i);
    setOpen(true);
  };

  return (
    <div className="relative mt-2.5 flex items-center gap-1.5 flex-wrap">
      {visible.map((src, i) => (
        <button
          key={i}
          onClick={() => handleBadgeClick(i)}
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
            isDark
              ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/60 hover:border-zinc-600"
              : "bg-zinc-100 hover:bg-zinc-200 text-zinc-600 border border-zinc-200 hover:border-zinc-300"
          )}
        >
          <FaviconImg domain={src.domain} />
          <span className="max-w-[120px] truncate">{src.domain}</span>
        </button>
      ))}
      {extra > 0 && (
        <button
          onClick={() => { setPage(3); setOpen(true); }}
          className={cn(
            "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-all",
            isDark
              ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700/60"
              : "bg-zinc-100 hover:bg-zinc-200 text-zinc-500 border border-zinc-200"
          )}
        >
          +{extra}
        </button>
      )}

      {/* Popover card */}
      {open && (
        <div
          ref={popoverRef}
          className={cn(
            "absolute left-0 top-8 z-50 w-72 rounded-xl border shadow-xl overflow-hidden",
            isDark ? "bg-zinc-900 border-zinc-700/60" : "bg-white border-zinc-200"
          )}
        >
          {/* Nav header */}
          <div className={cn(
            "flex items-center justify-between px-3 py-2 border-b",
            isDark ? "border-zinc-800" : "border-zinc-100"
          )}>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  page === 0
                    ? "text-zinc-500 opacity-40 cursor-not-allowed"
                    : isDark ? "text-zinc-300 hover:bg-zinc-800" : "text-zinc-600 hover:bg-zinc-100"
                )}
              ><ChevronLeft size={14} /></button>
              <button
                onClick={() => setPage(p => Math.min(sources.length - 1, p + 1))}
                disabled={page === sources.length - 1}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  page === sources.length - 1
                    ? "text-zinc-500 opacity-40 cursor-not-allowed"
                    : isDark ? "text-zinc-300 hover:bg-zinc-800" : "text-zinc-600 hover:bg-zinc-100"
                )}
              ><ChevronRight size={14} /></button>
            </div>
            <span className={cn("text-xs", isDark ? "text-zinc-500" : "text-zinc-400")}>
              {page + 1}/{sources.length}
            </span>
            <button
              onClick={() => setOpen(false)}
              className={cn("p-1 rounded-md transition-colors", isDark ? "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800" : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100")}
            ><X size={13} /></button>
          </div>

          {/* Source info */}
          <div className="p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <FaviconImg domain={current.domain} />
              <span className={cn("text-xs font-medium", isDark ? "text-zinc-400" : "text-zinc-500")}>
                {current.domain}
              </span>
            </div>
            <p className={cn("text-sm font-semibold leading-snug line-clamp-3", isDark ? "text-zinc-100" : "text-zinc-800")}>
              {current.title}
            </p>
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors",
                isDark
                  ? "bg-violet-600/20 text-violet-400 hover:bg-violet-600/30"
                  : "bg-violet-50 text-violet-600 hover:bg-violet-100"
              )}
            >
              <ExternalLink size={11} />
              Buka sumber
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
