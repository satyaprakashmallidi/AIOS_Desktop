import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Music,
  Star,
  Trash2,
  Upload,
  Video,
  X
} from "lucide-react";
import { invoke } from "../lib/api";
import { EmptyState, ConfirmModal } from "../components/ui";

interface ImportFile {
  name: string;
  path: string;
  size: number;
  extension: string;
  modifiedAt: string;
}

interface ImportFolder {
  name: string;
  path: string;
  fileCount: number;
  totalSize: number;
  modifiedAt: string;
  // True when the user has starred this folder so it appears in the chat
  // composer's @ palette. Toggled via toggle_import_marker.
  isMarked?: boolean;
}

// Folder that lives anywhere on the user's filesystem and was picked via the
// "Pick folder" button — referenced by absolute path, never copied. Always
// available for @-mention in chat (linking IS the opt-in), unlike local
// import folders which need to be starred explicitly.
interface LinkedFolder {
  absolutePath: string;
  name: string;
  addedAt: string;
}

const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "txt", "csv", "tsv", "json", "ndjson", "yaml", "yml", "toml",
  "html", "xml", "css", "scss", "sh", "ps1", "js", "ts", "tsx", "jsx",
  "py", "rb", "go", "rs", "java", "kt", "swift"
]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = diffMs / (1000 * 60 * 60);
    if (diffH < 1) return "Just now";
    if (diffH < 24) return `${Math.floor(diffH)}h ago`;
    const diffD = diffH / 24;
    if (diffD < 7) return `${Math.floor(diffD)}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return window.btoa(binary);
}

export function ImportsScreen({
  onAskClaude
}: {
  onAskClaude: (prompt: string) => void;
}) {
  const [folders, setFolders] = useState<ImportFolder[]>([]);
  const [linkedFolders, setLinkedFolders] = useState<LinkedFolder[]>([]);
  const [looseFiles, setLooseFiles] = useState<ImportFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openFolder, setOpenFolder] = useState<ImportFolder | null>(null);
  const [openLinked, setOpenLinked] = useState<LinkedFolder | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    try {
      const [importsRes, linkedRes] = await Promise.all([
        invoke<{ folders: ImportFolder[]; entries: ImportFile[] }>("list_imports"),
        invoke<{ folders: LinkedFolder[] }>("list_linked_folders"),
      ]);
      setFolders(importsRes?.folders ?? []);
      setLooseFiles(importsRes?.entries ?? []);
      setLinkedFolders(linkedRes?.folders ?? []);
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : "Failed to load imports");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  // Keep this page in sync when other surfaces (chat composer @-mentions,
  // workspace events) mutate the linked-folder table.
  useEffect(() => {
    const unsubscribe = window.aios.onHostEvent((event) => {
      const e = event as { event?: string } | null;
      if (e?.event === "imports_changed") refresh();
    });
    return () => unsubscribe();
  }, []);

  function flashStatus(message: string) {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 1800);
  }

  async function uploadFiles(files: FileList | File[] | null, intoFolder: string | null = null) {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    setBusy(true);
    let added = 0;
    try {
      const prefix = intoFolder ? `context/import/${intoFolder}/` : "context/import/";
      for (const file of list) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const ext = safeName.split(".").pop()?.toLowerCase() ?? "";
        const path = `${prefix}${safeName}`;
        if (TEXT_EXTENSIONS.has(ext)) {
          const text = await file.text();
          await invoke("write_file", { path, content: text });
        } else {
          const data = await blobToBase64(file);
          await invoke("write_binary_file", { path, data });
        }
        added += 1;
      }
      await refresh();
      flashStatus(added === 1 ? "Imported 1 file" : `Imported ${added} files`);
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function createFolder() {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await invoke("create_import_folder", { name: trimmed });
      setNewFolderName("");
      setCreating(false);
      await refresh();
      flashStatus(`Created folder "${trimmed}"`);
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : "Failed to create folder");
    } finally {
      setBusy(false);
    }
  }

  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<ImportFolder | null>(null);
  function deleteFolder(folder: ImportFolder) {
    setConfirmDeleteFolder(folder);
  }
  async function handleConfirmDeleteFolder() {
    const folder = confirmDeleteFolder;
    if (!folder) return;
    setConfirmDeleteFolder(null);
    setBusy(true);
    try {
      await invoke("delete_import_folder", { name: folder.name });
      if (openFolder?.name === folder.name) setOpenFolder(null);
      await refresh();
      flashStatus(`Deleted folder "${folder.name}"`);
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  // "Pick folder" button — opens the native OS folder picker via the main
  // process, then registers the picked path so it appears as a card on this
  // page AND becomes mentionable in the chat @ palette.
  async function pickAndLinkFolder() {
    setBusy(true);
    try {
      const pick = await invoke<{ canceled: boolean; path: string | null; requiresTccPrompt: boolean }>(
        "pick_folder"
      );
      if (!pick || pick.canceled || !pick.path) return;
      const absolutePath = pick.path;
      const segments = absolutePath.split(/[\\/]/).filter(Boolean);
      const fallbackName = segments.length ? segments[segments.length - 1] : absolutePath;
      try {
        await invoke("link_folder", { absolutePath, name: fallbackName });
        await refresh();
        const tccSuffix = pick.requiresTccPrompt
          ? " — macOS may prompt the first time Claude reads from it"
          : "";
        flashStatus(`Linked folder "${fallbackName}"${tccSuffix}`);
      } catch (error) {
        flashStatus(error instanceof Error ? error.message : "Failed to link folder");
      }
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : "Folder picker failed");
    } finally {
      setBusy(false);
    }
  }

  async function unlinkFolder(folder: LinkedFolder) {
    setBusy(true);
    try {
      await invoke("unlink_folder", { absolutePath: folder.absolutePath });
      await refresh();
      flashStatus(`Removed "${folder.name}" from linked folders`);
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : "Failed to remove folder");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMarker(folder: ImportFolder) {
    // Optimistic flip — refresh re-confirms with the server (will also catch
    // the case where the row was nuked by a concurrent delete).
    const nextMarked = !folder.isMarked;
    setFolders((cur) =>
      cur.map((f) => (f.name === folder.name ? { ...f, isMarked: nextMarked } : f))
    );
    try {
      await invoke("toggle_import_marker", { name: folder.name, marked: nextMarked });
      flashStatus(nextMarked ? `Starred "${folder.name}" for chat` : `Unstarred "${folder.name}"`);
    } catch (error) {
      // Roll back on failure so the UI matches reality.
      setFolders((cur) =>
        cur.map((f) => (f.name === folder.name ? { ...f, isMarked: !nextMarked } : f))
      );
      flashStatus(error instanceof Error ? error.message : "Failed to toggle marker");
    }
  }

  async function deleteFile(file: ImportFile, folderName: string | null) {
    setBusy(true);
    try {
      const namePart = folderName ? `${folderName}/${file.name}` : file.name;
      await invoke("delete_import", { name: namePart });
      await refresh();
      flashStatus(`Deleted ${file.name}`);
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }


  return (
    <section className="imports-screen">
      <div className="imports-shell">
        <header className="imports-hero">
          <div className="imports-hero-text">
            <p className="layer-badge"><span className="layer-dot" aria-hidden="true" />Layer · Imports</p>
            <h1>Imports <em>inbox</em></h1>
            <p className="imports-hero-detail">
              Organize raw material into folders. Each folder holds files Claude can read on demand and merge into your context.
            </p>
          </div>
          <div className="imports-hero-right">
            <div className="imports-overview">
              <Inbox size={13} />
              <span><strong>{folders.length}</strong> {folders.length === 1 ? "folder" : "folders"}</span>
              {linkedFolders.length > 0 ? (
                <>
                  <span className="imports-overview-dot">·</span>
                  <span><strong>{linkedFolders.length}</strong> linked</span>
                </>
              ) : null}
              {looseFiles.length > 0 ? (
                <>
                  <span className="imports-overview-dot">·</span>
                  <span><strong>{looseFiles.length}</strong> loose</span>
                </>
              ) : null}
            </div>
            {creating ? (
              <form
                className="imports-create-form imports-create-form-hero"
                onSubmit={(event) => {
                  event.preventDefault();
                  createFolder();
                }}
              >
                <FolderPlus size={14} />
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="Folder name (e.g. Q4 contracts)"
                  autoFocus
                />
                <button
                  type="submit"
                  className="imports-create-submit"
                  disabled={busy || !newFolderName.trim()}
                >
                  Create
                </button>
                <button
                  type="button"
                  className="imports-create-cancel"
                  onClick={() => { setCreating(false); setNewFolderName(""); }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="imports-hero-actions">
                <button
                  type="button"
                  className="imports-new-folder-btn imports-new-folder-btn-hero is-ghost"
                  onClick={pickAndLinkFolder}
                  disabled={busy}
                  title="Pick a folder anywhere on disk — Claude reads it as project context when @mentioned"
                >
                  <FolderOpen size={14} />
                  <span>Pick folder</span>
                </button>
                <button
                  type="button"
                  className="imports-new-folder-btn imports-new-folder-btn-hero"
                  onClick={() => setCreating(true)}
                >
                  <FolderPlus size={14} />
                  <span>New folder</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="imports-section">
          {folders.length > 0 ? (
            <div className="imports-section-row">
              <h2 className="imports-section-label">Folders</h2>
              <span className="imports-section-count">{folders.length}</span>
            </div>
          ) : null}
          {loading ? (
            <div className="imports-loading">
              <Loader2 size={16} className="spin" />
              Loading…
            </div>
          ) : folders.length === 0 ? (
            <EmptyState
              title="No folders yet"
              body='Click "New folder" above to organize your imports — e.g. "Customer interviews", "Q4 reports", "Legal".'
            />
          ) : (
            <div className="imports-folder-grid">
              {folders.map((folder) => (
                <FolderCard
                  key={folder.name}
                  folder={folder}
                  onOpen={() => setOpenFolder(folder)}
                  onDelete={() => deleteFolder(folder)}
                  onToggleMarker={() => toggleMarker(folder)}
                  busy={busy}
                />
              ))}
            </div>
          )}
        </div>

        {linkedFolders.length > 0 ? (
          <div className="imports-section">
            <div className="imports-section-row">
              <h2 className="imports-section-label">Linked folders</h2>
              <span className="imports-section-sub">On-disk references</span>
              <span className="imports-section-count">{linkedFolders.length}</span>
            </div>
            <div className="imports-folder-grid">
              {linkedFolders.map((folder) => (
                <LinkedFolderCard
                  key={folder.absolutePath}
                  folder={folder}
                  busy={busy}
                  onOpen={() => setOpenLinked(folder)}
                  onUnlink={() => unlinkFolder(folder)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {looseFiles.length > 0 ? (
          <div className="imports-section">
            <div className="imports-section-row">
              <h2 className="imports-section-label">Loose files</h2>
              <span className="imports-section-sub">At the root, not in any folder.</span>
              <span className="imports-section-count">{looseFiles.length}</span>
            </div>
            <div className="imports-loose-list">
              {looseFiles.map((file) => (
                <LooseFileRow
                  key={file.path}
                  file={file}
                  onAskClaude={onAskClaude}
                  onDelete={() => deleteFile(file, null)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {openFolder ? (
        <FolderDetailModal
          folder={openFolder}
          busy={busy}
          onClose={() => setOpenFolder(null)}
          onUpload={(files) => uploadFiles(files, openFolder.name)}
          onDelete={() => deleteFolder(openFolder)}
          onAskClaude={onAskClaude}
          deleteFile={(file) => deleteFile(file, openFolder.name)}
        />
      ) : null}

      {openLinked ? (
        <LinkedFolderBrowserModal
          folder={openLinked}
          onClose={() => setOpenLinked(null)}
        />
      ) : null}

      {status ? <div className="imports-toast">{status}</div> : null}

      <ConfirmModal
        open={!!confirmDeleteFolder}
        title="Delete import folder?"
        message={
          confirmDeleteFolder
            ? `Delete folder "${confirmDeleteFolder.name}" and all ${confirmDeleteFolder.fileCount} file${confirmDeleteFolder.fileCount === 1 ? "" : "s"} inside? This can't be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        onConfirm={handleConfirmDeleteFolder}
        onCancel={() => setConfirmDeleteFolder(null)}
      />
    </section>
  );
}

function FolderCard({
  folder,
  onOpen,
  onDelete,
  onToggleMarker,
  busy
}: {
  folder: ImportFolder;
  onOpen: () => void;
  onDelete: () => void;
  onToggleMarker: () => void;
  busy: boolean;
}) {
  const marked = !!folder.isMarked;
  return (
    <article className={`import-folder-card ${marked ? "is-marked" : ""}`}>
      <button type="button" className="import-folder-card-main" onClick={onOpen}>
        <div className="import-folder-card-icon"><Folder size={18} /></div>
        <div className="import-folder-card-text">
          <strong title={folder.name}>{folder.name}</strong>
          <div className="import-folder-card-meta">
            <span>{folder.fileCount} {folder.fileCount === 1 ? "file" : "files"}</span>
            {folder.totalSize > 0 ? (
              <>
                <span className="import-folder-card-dot">·</span>
                <span>{formatBytes(folder.totalSize)}</span>
              </>
            ) : null}
            <span className="import-folder-card-dot">·</span>
            <span>{formatDate(folder.modifiedAt)}</span>
            {marked ? (
              <>
                <span className="import-folder-card-dot">·</span>
                <span className="import-folder-card-marked-hint">@mentionable in chat</span>
              </>
            ) : null}
          </div>
        </div>
      </button>
      <div className="import-folder-card-actions" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={`import-folder-card-btn star ${marked ? "is-active" : ""}`}
          onClick={onToggleMarker}
          disabled={busy}
          title={marked ? "Unmark for chat @mention" : "Mark for chat @mention"}
          aria-label={marked ? "Unmark folder for chat" : "Mark folder for chat"}
          aria-pressed={marked}
        >
          <Star size={13} fill={marked ? "currentColor" : "none"} strokeWidth={marked ? 1.5 : 1.75} />
        </button>
        <button
          type="button"
          className="import-folder-card-btn danger"
          onClick={onDelete}
          disabled={busy}
          title="Delete folder"
          aria-label="Delete folder"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  );
}

function LinkedFolderCard({
  folder,
  busy,
  onOpen,
  onUnlink,
}: {
  folder: LinkedFolder;
  busy: boolean;
  onOpen: () => void;
  onUnlink: () => void;
}) {
  return (
    <article className="import-folder-card is-linked">
      <button type="button" className="import-folder-card-main" onClick={onOpen}>
        <div className="import-folder-card-icon"><FolderOpen size={18} /></div>
        <div className="import-folder-card-text">
          <strong title={folder.absolutePath}>{folder.name}</strong>
          <span className="import-folder-card-path" title={folder.absolutePath}>
            {folder.absolutePath}
          </span>
          <span className="import-folder-card-hint">
            @mentionable in chat · added {formatDate(folder.addedAt)}
          </span>
        </div>
      </button>
      <div className="import-folder-card-actions" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="import-folder-card-btn danger"
          onClick={onUnlink}
          disabled={busy}
          title="Remove this linked folder"
          aria-label="Remove linked folder"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  );
}

function LooseFileRow({
  file,
  onAskClaude,
  onDelete
}: {
  file: ImportFile;
  onAskClaude: (prompt: string) => void;
  onDelete: () => void;
}) {
  return (
    <article className="loose-file-row">
      <div className="loose-file-meta">
        <strong title={file.name}>{file.name}</strong>
        <div className="loose-file-meta-row">
          <span>{formatBytes(file.size)}</span>
          <span>·</span>
          <span>{formatDate(file.modifiedAt)}</span>
          {file.extension ? (
            <>
              <span>·</span>
              <span className="loose-file-ext">.{file.extension}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="loose-file-actions">
        <button
          type="button"
          className="import-card-btn"
          title="Ask Claude about this file"
          onClick={() => onAskClaude(`Read ${file.path} and tell me what's important. If anything belongs in the core context files, merge it.`)}
        >
          <Bot size={13} />
        </button>
        <button
          type="button"
          className="import-card-btn danger"
          title="Delete file"
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  );
}

function FolderDetailModal({
  folder,
  busy,
  onClose,
  onUpload,
  onDelete,
  onAskClaude,
  deleteFile
}: {
  folder: ImportFolder;
  busy: boolean;
  onClose: () => void;
  onUpload: (files: FileList | File[]) => Promise<void> | void;
  onDelete: () => void;
  onAskClaude: (prompt: string) => void;
  deleteFile: (file: ImportFile) => Promise<void> | void;
}) {
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const result = await invoke<{ entries: ImportFile[] }>("list_import_folder", { name: folder.name });
      setFiles(result?.entries ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [folder.name]);

  // Refresh when busy clears (means an action completed)
  useEffect(() => {
    if (!busy) refresh();
  }, [busy, folder.name]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files?.length) {
      onUpload(event.dataTransfer.files);
    }
  }

  return (
    <div
      className="detail-modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="detail-modal-card detail-modal-folder" onClick={(event) => event.stopPropagation()}>
        <header className="detail-modal-head">
          <div className="detail-modal-head-left">
            <button
              type="button"
              className="detail-modal-back"
              onClick={onClose}
              title="Back to folders"
              aria-label="Back to folders"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="detail-modal-icon folder"><Folder size={18} /></span>
            <div>
              <p className="detail-modal-eyebrow">Folder</p>
              <h2>{folder.name}</h2>
              <div className="detail-modal-meta">
                <span>{files.length} {files.length === 1 ? "file" : "files"}</span>
                {folder.totalSize > 0 ? (
                  <>
                    <span className="detail-modal-dot">·</span>
                    <span>{formatBytes(folder.totalSize)}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="detail-modal-head-actions">
            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              multiple
              onChange={(event) => {
                if (event.target.files) onUpload(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="button button-primary compact"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <Upload size={13} />
              Upload
            </button>
            <button
              type="button"
              className="detail-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div
          className={`detail-modal-body folder-modal-body ${dragOver ? "drag-over" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {loading ? (
            <div className="imports-loading">
              <Loader2 size={14} className="spin" />
              Loading…
            </div>
          ) : files.length === 0 ? (
            <p className="folder-modal-empty">This folder is empty. Upload files above or drop them in.</p>
          ) : (
            <div className="folder-modal-files">
              {files.map((file) => (
                <article key={file.path} className="folder-file-row">
                  <div className="folder-file-meta">
                    <strong title={file.name}>{file.name}</strong>
                    <div className="folder-file-meta-row">
                      <span>{formatBytes(file.size)}</span>
                      <span>·</span>
                      <span>{formatDate(file.modifiedAt)}</span>
                      {file.extension ? (
                        <>
                          <span>·</span>
                          <span className="folder-file-ext">.{file.extension}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="folder-file-actions">
                    <button
                      type="button"
                      className="import-card-btn"
                      title="Ask Claude about this file"
                      onClick={() => onAskClaude(`Read ${file.path} and tell me what's important. If anything belongs in the core context files, merge it.`)}
                    >
                      <Bot size={13} />
                    </button>
                    <button
                      type="button"
                      className="import-card-btn danger"
                      title="Delete file"
                      onClick={() => deleteFile(file)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="detail-modal-footer">
          <button
            type="button"
            className="button button-ghost compact"
            onClick={() => onAskClaude(`Read everything in ${folder.path}/ and tell me the key takeaways. Merge anything important into the core context files.`)}
            disabled={files.length === 0}
          >
            <Bot size={13} />
            Ask Claude about this folder
          </button>
          <button
            type="button"
            className="button button-ghost compact danger-text"
            onClick={onDelete}
            disabled={busy}
          >
            <Trash2 size={13} />
            Delete folder
          </button>
        </footer>
      </div>
    </div>
  );
}

interface BrowserEntry {
  name: string;
  path: string;
  kind: "file" | "folder";
  size: number;
  extension: string;
  modifiedAt: string;
}

const IS_MAC = typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh");

function fileIconFor(extension: string) {
  const ext = extension.toLowerCase();
  if (["md", "markdown", "txt", "rtf", "log", "rst"].includes(ext)) return FileText;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "heic", "tiff"].includes(ext)) return ImageIcon;
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac", "wma"].includes(ext)) return Music;
  if (["mp4", "mov", "avi", "webm", "mkv", "m4v", "wmv"].includes(ext)) return Video;
  if (["zip", "tar", "gz", "tgz", "7z", "rar", "bz2", "xz"].includes(ext)) return FileArchive;
  if (["csv", "tsv", "xls", "xlsx", "numbers", "ods"].includes(ext)) return FileSpreadsheet;
  if ([
    "js", "ts", "tsx", "jsx", "py", "go", "rs", "java", "kt", "swift", "c", "cpp", "h", "hpp",
    "rb", "php", "cs", "scala", "lua", "sh", "ps1", "bat", "json", "yaml", "yml", "toml",
    "html", "css", "scss", "xml", "sql", "vue", "svelte", "dart", "ex", "exs", "ml"
  ].includes(ext)) return FileCode;
  return File;
}

function pathSeparator(absPath: string): "\\" | "/" {
  return absPath.includes("\\") && !absPath.includes("/") ? "\\" : (absPath.startsWith("/") ? "/" : "\\");
}

function splitPath(absPath: string): { segments: string[]; sep: "\\" | "/" } {
  const sep = pathSeparator(absPath);
  if (sep === "\\") {
    // Windows: "C:\Users\foo\bar" → ["C:", "Users", "foo", "bar"]
    const parts = absPath.replace(/\\+$/, "").split("\\").filter((p) => p.length > 0);
    return { segments: parts, sep };
  }
  // POSIX: "/Users/foo/bar" → ["/", "Users", "foo", "bar"]
  const parts = absPath.replace(/\/+$/, "").split("/").filter((p) => p.length > 0);
  return { segments: ["/", ...parts], sep };
}

function joinSegments(segments: string[], sep: "\\" | "/"): string {
  if (sep === "\\") return segments.join("\\");
  if (segments[0] === "/") return "/" + segments.slice(1).join("/");
  return segments.join("/");
}

function LinkedFolderBrowserModal({ folder, onClose }: { folder: LinkedFolder; onClose: () => void }) {
  const rootPath = folder.absolutePath;
  const [currentPath, setCurrentPath] = useState<string>(rootPath);
  const [entries, setEntries] = useState<BrowserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<{ entries: BrowserEntry[]; error?: string; truncated?: boolean }>(
      "browse_external_directory",
      { path: currentPath, limit: 500 }
    )
      .then((res) => {
        if (cancelled) return;
        setEntries(res?.entries ?? []);
        setError(res?.error ?? null);
        setTruncated(!!res?.truncated);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { segments: rootSegments, sep } = splitPath(rootPath);
  const { segments: currentSegments } = splitPath(currentPath);
  // Breadcrumb shows the folder name first (instead of "C:" or "/"), then any
  // subfolders the user has drilled into. Each crumb jumps back to that level.
  const crumbStartIndex = rootSegments.length - 1;
  const crumbs = currentSegments.slice(crumbStartIndex).map((name, idx) => {
    const upTo = currentSegments.slice(0, crumbStartIndex + idx + 1);
    const fullPath = joinSegments(upTo, sep);
    const label = idx === 0 ? folder.name : name;
    return { label, path: fullPath };
  });

  const canGoUp = currentPath !== rootPath;
  function goUp() {
    if (!canGoUp) return;
    const next = currentSegments.slice(0, -1);
    setCurrentPath(joinSegments(next, sep));
  }

  function openEntry(entry: BrowserEntry) {
    if (entry.kind === "folder") {
      setCurrentPath(entry.path);
    } else {
      invoke<{ ok: boolean; error?: string }>("open_external_path", { path: entry.path }).catch(() => {});
    }
  }

  function revealCurrentInNative() {
    invoke<{ ok: boolean; error?: string }>("open_external_path", { path: currentPath }).catch(() => {});
  }

  const folderCount = entries.filter((e) => e.kind === "folder").length;
  const fileCount = entries.length - folderCount;
  const nativeLabel = IS_MAC ? "Open in Finder" : "Open in Explorer";

  return (
    <div className="detail-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="detail-modal-card linked-browser-card" onClick={(e) => e.stopPropagation()}>
        <header className="linked-browser-head">
          <div className="linked-browser-head-row">
            <button
              type="button"
              className="linked-browser-up"
              onClick={goUp}
              disabled={!canGoUp}
              title="Go up one folder"
              aria-label="Go up one folder"
            >
              <ChevronLeft size={14} />
            </button>
            <nav className="linked-browser-crumbs" aria-label="Folder path">
              {crumbs.map((c, idx) => (
                <span key={c.path} className="linked-browser-crumb-group">
                  {idx > 0 ? <ChevronRight size={11} className="linked-browser-crumb-sep" /> : null}
                  <button
                    type="button"
                    className={`linked-browser-crumb ${idx === crumbs.length - 1 ? "is-current" : ""}`}
                    onClick={() => idx < crumbs.length - 1 && setCurrentPath(c.path)}
                    disabled={idx === crumbs.length - 1}
                    title={c.path}
                  >
                    {c.label}
                  </button>
                </span>
              ))}
            </nav>
            <button
              type="button"
              className="detail-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <p className="linked-browser-fullpath" title={currentPath}>{currentPath}</p>
        </header>

        <div className="linked-browser-body">
          {loading ? (
            <div className="linked-browser-state">
              <Loader2 size={16} className="spin" /> Loading…
            </div>
          ) : error ? (
            <div className="linked-browser-state is-error">{error}</div>
          ) : entries.length === 0 ? (
            <div className="linked-browser-state">This folder is empty.</div>
          ) : (
            <ul className="linked-browser-list">
              {entries.map((entry) => {
                const Icon = entry.kind === "folder" ? Folder : fileIconFor(entry.extension);
                return (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className={`linked-browser-row is-${entry.kind}`}
                      onClick={() => openEntry(entry)}
                      title={entry.kind === "folder" ? "Open folder" : "Open in default app"}
                    >
                      <span className="linked-browser-row-icon">
                        <Icon size={16} />
                      </span>
                      <span className="linked-browser-row-name">{entry.name}</span>
                      <span className="linked-browser-row-meta">
                        {entry.kind === "file" ? formatBytes(entry.size) : ""}
                      </span>
                      <span className="linked-browser-row-date">
                        {formatDate(entry.modifiedAt)}
                      </span>
                      {entry.kind === "folder" ? (
                        <ChevronRight size={13} className="linked-browser-row-chevron" />
                      ) : (
                        <ExternalLink size={12} className="linked-browser-row-open" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {truncated ? (
            <div className="linked-browser-truncated">Showing first 500 items only.</div>
          ) : null}
        </div>

        <footer className="linked-browser-foot">
          <span className="linked-browser-count">
            {entries.length > 0
              ? `${folderCount} ${folderCount === 1 ? "folder" : "folders"} · ${fileCount} ${fileCount === 1 ? "file" : "files"}`
              : ""}
          </span>
          <button
            type="button"
            className="button button-ghost compact"
            onClick={revealCurrentInNative}
          >
            <ExternalLink size={13} />
            {nativeLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
