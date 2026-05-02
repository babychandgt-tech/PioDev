import { useEffect, useRef, useState, useId } from "react";
import mermaid from "mermaid";
import { Check, Copy, Download, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

let mermaidInitialized = false;

function initMermaid(isDark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? "dark" : "default",
    fontFamily: "inherit",
    fontSize: 14,
    flowchart: { curve: "basis", padding: 20 },
    sequence: { useMaxWidth: true },
    er: { useMaxWidth: true },
  });
  mermaidInitialized = true;
}

export function MermaidDiagram({ code }: { code: string }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const uid = useId().replace(/:/g, "");
  const diagramId = `mermaid-${uid}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        initMermaid(isDark);
        mermaidInitialized = false;
        initMermaid(isDark);
        const { svg: rendered } = await mermaid.render(diagramId, code.trim());
        if (!cancelled) {
          setSvg(rendered);
          setError("");
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Gagal render diagram");
      }
    }
    render();
    return () => { cancelled = true; };
  }, [code, isDark, diagramId]);

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
    a.href = url;
    a.download = "diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn(
      "my-4 rounded-xl border overflow-hidden",
      isDark ? "bg-zinc-900 border-white/[0.07]" : "bg-white border-black/[0.08]"
    )}>
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-4 py-2.5 border-b",
        isDark ? "border-white/[0.07] bg-white/[0.03]" : "border-black/[0.06] bg-zinc-50"
      )}>
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Diagram</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(z => Math.max(0.4, z - 0.2))}
            className={cn("p-1.5 rounded-md transition-colors", isDark ? "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]" : "text-zinc-500 hover:text-zinc-700 hover:bg-black/[0.06]")}
            title="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className={cn("px-2 py-1 text-xs rounded-md transition-colors font-mono", isDark ? "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]" : "text-zinc-500 hover:text-zinc-700 hover:bg-black/[0.06]")}
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => setZoom(z => Math.min(2.5, z + 0.2))}
            className={cn("p-1.5 rounded-md transition-colors", isDark ? "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]" : "text-zinc-500 hover:text-zinc-700 hover:bg-black/[0.06]")}
            title="Zoom in"
          >
            <ZoomIn size={13} />
          </button>
          <div className={cn("w-px h-3.5 mx-1", isDark ? "bg-white/10" : "bg-black/10")} />
          <button
            onClick={handleDownload}
            disabled={!svg}
            className={cn("p-1.5 rounded-md transition-colors", isDark ? "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]" : "text-zinc-500 hover:text-zinc-700 hover:bg-black/[0.06]")}
            title="Download SVG"
          >
            <Download size={13} />
          </button>
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
      </div>

      {/* Diagram area */}
      <div
        ref={containerRef}
        className="overflow-auto p-4"
        style={{ maxHeight: 500 }}
      >
        {error ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Gagal render diagram</span>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-w-sm">{error}</pre>
            <pre className={cn("text-xs mt-2 p-3 rounded-lg w-full text-left font-mono whitespace-pre-wrap", isDark ? "bg-zinc-800 text-zinc-300" : "bg-zinc-100 text-zinc-700")}>{code}</pre>
          </div>
        ) : svg ? (
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: "top center", transition: "transform 0.15s ease" }}
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
        )}
      </div>
    </div>
  );
}
