import path from "node:path";
import fs from "node:fs";
import { app, BrowserWindow } from "electron";

// Lightweight Markdown → HTML conversion sufficient for chat-driven artifacts
// (plans, outputs, exported answers). Not a full CommonMark engine; we only
// support the subset Claude actually emits: headings, paragraphs, code fences,
// inline `code`, **bold**, *italic*, lists, blockquotes.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCode = false;
  let codeLines: string[] = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        flushParagraph();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "ul" : "ol";
      if (listType !== nextType) {
        closeList();
        html.push(`<${nextType}>`);
        listType = nextType;
      }
      html.push(`<li>${renderInlineMarkdown((unordered || ordered)![1])}</li>`);
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(trimmed.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  flushParagraph();
  closeList();
  return html.join("\n");
}

export function pdfHtmlForMarkdown(markdown: string, title: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; margin: 0; padding: 40px; line-height: 1.58; }
    main { max-width: 760px; margin: 0 auto; }
    h1 { font-size: 28px; margin: 0 0 18px; letter-spacing: -0.02em; }
    h2 { font-size: 20px; margin: 28px 0 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    h3 { font-size: 16px; margin: 22px 0 8px; }
    h4 { font-size: 14px; margin: 18px 0 6px; color: #374151; }
    p { margin: 8px 0 13px; }
    ul, ol { margin: 8px 0 14px; padding-left: 24px; }
    li { margin: 4px 0; }
    code { background: #f3f4f6; padding: 2px 5px; border-radius: 4px; font-size: 0.92em; }
    pre { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; overflow: hidden; white-space: pre-wrap; }
    blockquote { margin: 14px 0; padding: 8px 14px; border-left: 3px solid #6b7d72; background: #f8faf7; color: #374151; }
  </style>
</head>
<body><main>${markdownToHtml(markdown)}</main></body>
</html>`;
}

// Render an arbitrary markdown string to a PDF on disk via an offscreen
// BrowserWindow + printToPDF. Generic — used by:
//   - WhatsApp scanner (rendering plan/output artifacts to PDF for delivery)
//   - export_to_pdf IPC (chat-bubble "save as PDF" tool the agent can invoke)
export async function renderMarkdownStringToPdf(opts: {
  markdown: string;
  outputPath: string;
  title?: string;
  parentWindow?: BrowserWindow | null;
}): Promise<void> {
  const html = pdfHtmlForMarkdown(opts.markdown, opts.title ?? path.basename(opts.outputPath, ".pdf"));
  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
  const pdfWindow = new BrowserWindow({
    show: false,
    parent: opts.parentWindow ?? undefined,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await pdfWindow.loadURL(`data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}`);
    const pdf = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: "default" },
      pageSize: "A4",
    });
    fs.writeFileSync(opts.outputPath, pdf);
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
  }
}

// Convenience: render markdown read from a file (the WhatsApp artifact flow).
export async function renderMarkdownFileToPdf(opts: {
  sourcePath: string;
  outputDir?: string;
  parentWindow?: BrowserWindow | null;
}): Promise<{ path: string; filename: string }> {
  const markdown = fs.readFileSync(opts.sourcePath, "utf8");
  const baseName = path.basename(opts.sourcePath, path.extname(opts.sourcePath));
  const filename = `${baseName}.pdf`;
  const outputDir = opts.outputDir ?? path.join(app.getPath("userData"), "whatsapp-pdfs");
  const outputPath = path.join(outputDir, filename);
  await renderMarkdownStringToPdf({
    markdown,
    outputPath,
    title: baseName,
    parentWindow: opts.parentWindow,
  });
  return { path: outputPath, filename };
}
