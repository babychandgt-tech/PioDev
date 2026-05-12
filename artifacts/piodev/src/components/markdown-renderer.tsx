import { memo, useState, Component, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { SourceCitations, parseJsonSources } from "@/components/source-citations";

class MarkdownErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; resetKey?: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  componentDidCatch(error: any) {
    console.error("[PioCode] MarkdownRenderer crash:", error?.message ?? error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <span className="text-sm text-muted-foreground italic">
          [Gagal render — konten akan muncul setelah selesai]
        </span>
      );
    }
    return this.props.children;
  }
}

const LANG_DISPLAY: Record<string, string> = {
  js: "JavaScript", jsx: "JavaScript", ts: "TypeScript", tsx: "TypeScript",
  py: "Python", python: "Python", rs: "Rust", go: "Go", java: "Java",
  cs: "C#", cpp: "C++", c: "C", html: "HTML", css: "CSS", scss: "SCSS",
  json: "JSON", yaml: "YAML", yml: "YAML", md: "Markdown", sh: "Shell",
  bash: "Bash", zsh: "Zsh", sql: "SQL", graphql: "GraphQL", php: "PHP",
  rb: "Ruby", swift: "Swift", kt: "Kotlin", dart: "Dart", r: "R",
  lua: "Lua", vim: "Vim Script", dockerfile: "Dockerfile", toml: "TOML",
  xml: "XML", ini: "INI", makefile: "Makefile", diff: "Diff",
};

const CodeBlock = ({ inline, className, children, ...props }: any) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const match = /language-([\w-]+)/.exec(className || "");
  const lang = match?.[1]?.toLowerCase() ?? "";
  const displayLang = LANG_DISPLAY[lang] ?? (lang ? lang.toUpperCase() : null);
  const [copied, setCopied] = useState(false);

  const codeStr = String(children).replace(/\n$/, "");

  const handleCopy = () => {
    navigator.clipboard.writeText(codeStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!inline && match) {
    if (lang === "mermaid") {
      return <MermaidDiagram code={codeStr} />;
    }

    if (lang === "json-sources") {
      const sources = parseJsonSources(codeStr);
      return sources.length > 0 ? <SourceCitations sources={sources} /> : null;
    }

    return (
      <div className={cn("group relative my-4 rounded-xl overflow-hidden border", isDark ? "bg-[#18181b] border-white/[0.07]" : "bg-zinc-50 border-black/[0.08]")}>
        <div className={cn("flex items-center justify-between px-4 py-2.5 border-b", isDark ? "border-white/[0.07] bg-white/[0.03]" : "border-black/[0.06] bg-black/[0.03]")}>
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            {displayLang ?? "code"}
          </span>
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-all duration-150",
              copied
                ? isDark ? "text-green-400 bg-green-400/10" : "text-green-600 bg-green-500/10"
                : isDark ? "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]" : "text-zinc-500 hover:text-zinc-700 hover:bg-black/[0.06]"
            )}
          >
            {copied ? (
              <><Check className="w-3.5 h-3.5" /> Tersalin</>
            ) : (
              <><Copy className="w-3.5 h-3.5" /> Salin</>
            )}
          </button>
        </div>

        <div style={{ maxHeight: "480px", overflow: "auto" }}>
          <SyntaxHighlighter
            style={isDark ? oneDark : oneLight}
            language={lang}
            PreTag="div"
            showLineNumbers={codeStr.split("\n").length > 8}
            customStyle={{
              margin: 0,
              padding: "1rem 1.25rem",
              background: "transparent",
              fontSize: "0.84rem",
              lineHeight: "1.75",
            }}
            codeTagProps={{ className: "font-mono" }}
            {...props}
          >
            {codeStr}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  }

  return (
    <code
      className={cn(
        "bg-zinc-100 dark:bg-zinc-800 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 rounded-md text-[0.85em] font-mono",
        className
      )}
      {...props}
    >
      {children}
    </code>
  );
};

const StreamingCodeBlock = ({ inline, className, children }: any) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const match = /language-([\w-]+)/.exec(className || "");
  const lang = match?.[1]?.toLowerCase() ?? "";
  const displayLang = LANG_DISPLAY[lang] ?? (lang ? lang.toUpperCase() : null);

  if (!inline && match) {
    if (lang === "json-sources") {
      const sources = parseJsonSources(String(children).replace(/\n$/, ""));
      return sources.length > 0 ? <SourceCitations sources={sources} /> : null;
    }
    return (
      <div className={cn("group relative my-4 rounded-xl overflow-hidden border", isDark ? "bg-[#18181b] border-white/[0.07]" : "bg-zinc-50 border-black/[0.08]")}>
        {displayLang && (
          <div className={cn("flex items-center px-4 py-2.5 border-b text-xs font-semibold uppercase tracking-wider", isDark ? "border-white/[0.07] text-zinc-500 bg-white/[0.03]" : "border-black/[0.06] text-zinc-500 bg-black/[0.03]")}>
            {displayLang}
          </div>
        )}
        <div style={{ maxHeight: "480px", overflow: "auto" }}>
          <pre className={cn("m-0 p-4 text-[0.84rem] leading-[1.75] font-mono overflow-x-auto whitespace-pre", isDark ? "text-zinc-200" : "text-zinc-800")}>
            <code>{children}</code>
          </pre>
        </div>
      </div>
    );
  }

  return (
    <code className={cn("bg-zinc-100 dark:bg-zinc-800 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 rounded-md text-[0.85em] font-mono", className)}>
      {children}
    </code>
  );
};

// KaTeX options: throwOnError:false prevents crashes on partial/invalid LaTeX during streaming
const KATEX_OPTIONS = { throwOnError: false, errorColor: "inherit" };

const REMARK_PLUGINS_FULL = [remarkGfm, remarkMath] as any;
const REMARK_PLUGINS_STREAMING = [remarkGfm] as any;
const REHYPE_PLUGINS_FULL = [[rehypeKatex, KATEX_OPTIONS]] as any;
const REHYPE_PLUGINS_STREAMING = [] as any;

const MarkdownContent = ({ content, isStreaming }: { content: string; isStreaming?: boolean }) => (
  <div className="markdown-body text-[15px] leading-[1.85] text-foreground">
    <ReactMarkdown
      remarkPlugins={isStreaming ? REMARK_PLUGINS_STREAMING : REMARK_PLUGINS_FULL}
      rehypePlugins={isStreaming ? REHYPE_PLUGINS_STREAMING : REHYPE_PLUGINS_FULL}
      components={{
        code: isStreaming ? StreamingCodeBlock : CodeBlock,

        p: ({ children }) => (
          <p className="my-3 leading-[1.85]">{children}</p>
        ),

        h1: ({ children }) => (
          <h1 className="text-xl font-bold mt-7 mb-3.5 text-foreground leading-tight">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold mt-6 mb-3 text-foreground leading-tight">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold mt-5 mb-2.5 text-foreground leading-tight">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-sm font-semibold mt-4 mb-2 text-foreground uppercase tracking-wide">{children}</h4>
        ),

        ul: ({ children }) => (
          <ul className="my-3 ml-1 space-y-1.5 list-none">{children}</ul>
        ),
        ol: ({ children, start }) => (
          <ol className="my-3 ml-1 space-y-1.5 list-none" style={{ counterReset: `list-item ${(start ?? 1) - 1}` }}>{children}</ol>
        ),
        li: ({ children, node }: any) => {
          const isTaskItem =
            node?.children?.[0]?.tagName === "input" &&
            node.children[0].properties?.type === "checkbox";

          if (isTaskItem) {
            return (
              <li className="flex items-start gap-2.5 py-1 list-none">{children}</li>
            );
          }

          return (
            <li className="flex items-start gap-2.5 py-1 list-none">
              <span className="mt-[11px] flex-shrink-0 w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
              <span className="leading-[1.85]">{children}</span>
            </li>
          );
        },

        input: ({ type, checked }: any) => {
          if (type === "checkbox") {
            return (
              <span
                className={cn(
                  "inline-flex flex-shrink-0 mt-[3px] mr-0.5 w-4 h-4 rounded border items-center justify-center",
                  checked
                    ? "bg-violet-500 border-violet-500"
                    : "border-zinc-400 dark:border-zinc-600 bg-transparent"
                )}
              >
                {checked && <Check className="w-2.5 h-2.5 text-white" />}
              </span>
            );
          }
          return <input type={type} checked={checked} readOnly />;
        },

        blockquote: ({ children }) => (
          <blockquote className="my-3 pl-4 border-l-[3px] border-violet-400/60 dark:border-violet-500/50 bg-violet-50/50 dark:bg-violet-950/20 rounded-r-lg py-2 pr-3">
            <div className="text-zinc-600 dark:text-zinc-400 italic text-[0.95em]">{children}</div>
          </blockquote>
        ),

        hr: () => (
          <hr className="my-5 border-0 border-t border-zinc-200 dark:border-zinc-700/60" />
        ),

        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-violet-600 dark:text-violet-400 underline underline-offset-2 decoration-violet-400/50 hover:decoration-violet-400 transition-all font-medium"
          >
            {children}
            <ExternalLink className="w-3 h-3 opacity-60 flex-shrink-0 ml-0.5" />
          </a>
        ),

        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),

        em: ({ children }) => (
          <em className="italic text-zinc-700 dark:text-zinc-300">{children}</em>
        ),

        del: ({ children }) => (
          <del className="line-through text-muted-foreground">{children}</del>
        ),

        table: ({ children }) => (
          <div className="my-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700/60">
            <table className="w-full text-sm border-collapse">
              {children}
            </table>
          </div>
        ),

        thead: ({ children }) => (
          <thead className="bg-zinc-50 dark:bg-zinc-800/60">
            {children}
          </thead>
        ),

        tbody: ({ children }) => (
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
            {children}
          </tbody>
        ),

        tr: ({ children }) => (
          <tr className="transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
            {children}
          </tr>
        ),

        th: ({ children }) => (
          <th className="px-4 py-2.5 text-left font-semibold text-zinc-700 dark:text-zinc-300 text-xs uppercase tracking-wide whitespace-nowrap border-b border-zinc-200 dark:border-zinc-700/60">
            {children}
          </th>
        ),

        td: ({ children }) => (
          <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300 align-top">
            {children}
          </td>
        ),

        img: ({ src, alt }) => (
          <span className="block my-3">
            <img
              src={src}
              alt={alt || "Image"}
              className="rounded-xl border border-border shadow-md max-w-[420px] w-full"
              loading="lazy"
            />
          </span>
        ),

        pre: ({ children }) => <>{children}</>,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

export const MarkdownRenderer = memo(({ content, isStreaming }: {
  content: string;
  isStreaming?: boolean;
}) => (
  <MarkdownErrorBoundary resetKey={isStreaming ? "streaming" : "done"}>
    <MarkdownContent content={content} isStreaming={isStreaming} />
  </MarkdownErrorBoundary>
));

MarkdownRenderer.displayName = "MarkdownRenderer";
