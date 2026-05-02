import { useEffect, useRef, useState, useId, useCallback } from "react";
import { createPortal } from "react-dom";
import mermaid from "mermaid";
import { Check, Copy, Download, ZoomIn, ZoomOut, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

function initMermaid(isDark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? "dark" : "default",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    fontSize: 13,
    flowchart: {
      curve: "step",
      padding: 24,
      nodeSpacing: 50,
      rankSpacing: 60,
      useMaxWidth: true,
    },
    sequence: { useMaxWidth: true, boxMargin: 8 },
    er: { useMaxWidth: true },
    themeVariables: isDark ? {
      primaryColor: "#6d28d9",
      primaryTextColor: "#f4f4f5",
      primaryBorderColor: "#7c3aed",
      lineColor: "#71717a",
      secondaryColor: "#3f3f46",
      tertiaryColor: "#27272a",
      background: "#18181b",
      mainBkg: "#27272a",
      nodeBorder: "#52525b",
      clusterBkg: "#1c1c1e",
      edgeLabelBackground: "#27272a",
    } : {
      primaryColor: "#ede9fe",
      primaryTextColor: "#1e1b4b",
      primaryBorderColor: "#7c3aed",
      lineColor: "#6b7280",
      secondaryColor: "#f3f4f6",
      tertiaryColor: "#f9fafb",
      background: "#ffffff",
      mainBkg: "#f5f3ff",
      nodeBorder: "#8b5cf6",
      clusterBkg: "#faf5ff",
      edgeLabelBackground: "#ffffff",
    },
  });
}

const btnCls = (isDark: boolean) =>
  cn("p-1.5 rounded-md transition-colors",
    isDark ? "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
           : "text-zinc-500 hover:text-zinc-700 hover:bg-black/[0.06]");

const dividerCls = (isDark: boolean) =>
  cn("w-px h-3.5 mx-1", isDark ? "bg-white/10" : "bg-black/10");

let renderSeq = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const uid = useId().replace(/:/g, "");

  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsZoom, setFsZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const renderId = `mermaid-${uid}-${++renderSeq}`;

    // Suppress mermaid's own parseError UI output
    (mermaid as any).parseError = () => {};

    async function render() {
      // Clean up any stale hidden elements mermaid may have left in DOM
      document.getElementById(renderId)?.remove();
      try {
        initMermaid(isDark);
        const { svg: rendered } = await mermaid.render(renderId, code.trim());
        if (!cancelled) { setSvg(rendered); setError(""); }
      } catch (e: any) {
        if (!cancelled) {
          const msg = (e?.message ?? "").replace(/\n.*$/s, "").trim();
          setError(msg || "Syntax error pada diagram");
        }
      } finally {
        // Always clean up the hidden container mermaid creates
        document.getElementById(renderId)?.remove();
      }
    }
    render();
    return () => { cancelled = true; document.getElementById(renderId)?.remove(); };
  }, [code, isDark, uid]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "diagram.svg"; a.click();
    URL.revokeObjectURL(url);
  };

  const headerActions = (
    <div className="flex items-center gap-1">
      <button onClick={() => setZoom(z => Math.max(0.4, z - 0.2))} className={btnCls(isDark)} title="Zoom out"><ZoomOut size={13} /></button>
      <button
        onClick={() => setZoom(1)}
        className={cn("px-2 py-1 text-xs rounded-md transition-colors font-mono min-w-[44px] text-center",
          isDark ? "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]" : "text-zinc-500 hover:text-zinc-700 hover:bg-black/[0.06]")}
        title="Reset zoom"
      >{Math.round(zoom * 100)}%</button>
      <button onClick={() => setZoom(z => Math.min(2.5, z + 0.2))} className={btnCls(isDark)} title="Zoom in"><ZoomIn size={13} /></button>
      <div className={dividerCls(isDark)} />
      <button onClick={() => { setFsZoom(1); setFullscreen(true); }} disabled={!svg} className={btnCls(isDark)} title="Fullscreen"><Maximize2 size={13} /></button>
      <button onClick={handleDownload} disabled={!svg} className={btnCls(isDark)} title="Download SVG"><Download size={13} /></button>
      <button
        onClick={handleCopyCode}
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-all duration-150",
          copied
            ? isDark ? "text-green-400 bg-green-400/10" : "text-green-600 bg-green-500/10"
            : isDark ? "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]" : "text-zinc-500 hover:text-zinc-700 hover:bg-black/[0.06]"
        )}
      >
        {copied ? <><Check size={13} />Tersalin</> : <><Copy size={13} />Salin</>}
      </button>
    </div>
  );

  const diagramContent = (z: number) => (
    error ? (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Gagal render diagram</span>
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-w-sm">{error}</pre>
        <pre className={cn("text-xs mt-2 p-3 rounded-lg w-full text-left font-mono whitespace-pre-wrap", isDark ? "bg-zinc-800 text-zinc-300" : "bg-zinc-100 text-zinc-700")}>{code}</pre>
      </div>
    ) : svg ? (
      <div
        style={{ transform: `scale(${z})`, transformOrigin: "top center", transition: "transform 0.15s ease" }}
        dangerouslySetInnerHTML={{ __html: svg }}
        className="[&_svg]:max-w-full [&_svg]:mx-auto [&_svg]:block"
      />
    ) : (
      <div className="flex items-center justify-center h-24">
        <div className="flex gap-1.5">
          <span className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "120ms" }} />
          <span className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "240ms" }} />
        </div>
      </div>
    )
  );

  return (
    <>
      {/* Inline card */}
      <div className={cn("my-4 rounded-xl border overflow-hidden", isDark ? "bg-zinc-900 border-white/[0.07]" : "bg-white border-black/[0.08]")}>
        <div className={cn("flex items-center justify-between px-4 py-2.5 border-b", isDark ? "border-white/[0.07] bg-white/[0.03]" : "border-black/[0.06] bg-zinc-50")}>
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Diagram</span>
          {headerActions}
        </div>
        <div className="overflow-auto p-4" style={{ maxHeight: 500 }}>
          {diagramContent(zoom)}
        </div>
      </div>

      {/* Fullscreen modal */}
      {fullscreen && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex flex-col"
          style={{ background: isDark ? "rgba(9,9,11,0.97)" : "rgba(250,250,250,0.97)" }}
        >
          {/* Modal header */}
          <div className={cn(
            "flex items-center justify-between px-5 py-3 border-b shrink-0",
            isDark ? "border-white/[0.07] bg-zinc-900/80" : "border-black/[0.06] bg-white/80"
          )}>
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Diagram — Fullscreen</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setFsZoom(z => Math.max(0.3, z - 0.15))} className={btnCls(isDark)} title="Zoom out"><ZoomOut size={14} /></button>
              <button
                onClick={() => setFsZoom(1)}
                className={cn("px-2 py-1 text-xs rounded-md transition-colors font-mono min-w-[44px] text-center",
                  isDark ? "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]" : "text-zinc-500 hover:text-zinc-700 hover:bg-black/[0.06]")}
              >{Math.round(fsZoom * 100)}%</button>
              <button onClick={() => setFsZoom(z => Math.min(3, z + 0.15))} className={btnCls(isDark)} title="Zoom in"><ZoomIn size={14} /></button>
              <div className={dividerCls(isDark)} />
              <button onClick={handleDownload} disabled={!svg} className={btnCls(isDark)} title="Download SVG"><Download size={14} /></button>
              <div className={dividerCls(isDark)} />
              <button
                onClick={() => setFullscreen(false)}
                className={cn("flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors",
                  isDark ? "text-zinc-300 hover:text-white hover:bg-white/[0.08]" : "text-zinc-600 hover:text-zinc-900 hover:bg-black/[0.06]")}
                title="Tutup (Esc)"
              >
                <X size={13} /> Tutup
              </button>
            </div>
          </div>

          {/* Modal diagram area */}
          <div className="flex-1 overflow-auto p-8">
            {diagramContent(fsZoom)}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
