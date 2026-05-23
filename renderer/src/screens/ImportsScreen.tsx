import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  Folder,
  FolderOpen,
  FolderPlus,
  Inbox,
  Loader2,
  Star,
  Trash2,
  Upload,
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
  onUnlink,
}: {
  folder: LinkedFolder;
  busy: boolean;
  onUnlink: () => void;
}) {
  return (
    <article className="import-folder-card is-linked">
      <div className="import-folder-card-main is-linked">
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
      </div>
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
