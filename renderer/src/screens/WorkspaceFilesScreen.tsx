import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, FolderOpen } from "lucide-react";
import { invoke } from "../lib/api";
import { formatRelativeTime } from "../lib/workspace-view";
import { EmptyState, FileRow, PanelHeader, Surface } from "../components/ui";
import type { FilePreview, WorkspaceEntry } from "../types";

export function WorkspaceFilesScreen({
  title,
  eyebrow,
  primaryEntries,
  secondaryEntries,
  primaryLabel,
  secondaryLabel,
  emptyMessage,
  onAskClaude
}: {
  title: string;
  eyebrow: string;
  primaryEntries: WorkspaceEntry[];
  secondaryEntries: WorkspaceEntry[];
  primaryLabel: string;
  secondaryLabel: string;
  emptyMessage: string;
  onAskClaude: (entry: WorkspaceEntry) => void;
}) {
  const [selectedPath, setSelectedPath] = useState<string>(primaryEntries[0]?.path ?? secondaryEntries[0]?.path ?? "");
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const allEntries = useMemo(() => [...primaryEntries, ...secondaryEntries], [primaryEntries, secondaryEntries]);

  useEffect(() => {
    if (!selectedPath && allEntries[0]) setSelectedPath(allEntries[0].path);
  }, [selectedPath, allEntries]);

  useEffect(() => {
    if (!selectedPath) return;
    invoke<FilePreview>("read_markdown_preview", { path: selectedPath }).then(setPreview).catch(() => setPreview(null));
  }, [selectedPath]);

  return (
    <section className="workspace-screen">
      <div className="two-column-layout">
        <Surface>
          <PanelHeader eyebrow={eyebrow} title={title} detail="Use previews to triage what needs review, refinement, or packaging." />
          <EntryGroup title={primaryLabel} entries={primaryEntries} selectedPath={selectedPath} onSelect={setSelectedPath} />
          <EntryGroup title={secondaryLabel} entries={secondaryEntries} selectedPath={selectedPath} onSelect={setSelectedPath} />
          {!allEntries.length ? <EmptyState title="Nothing here yet" body={emptyMessage} /> : null}
        </Surface>

        <Surface className="preview-surface">
          <PanelHeader
            eyebrow="Preview"
            title={preview?.path ?? "Select a file"}
            detail={preview?.modifiedAt ? formatRelativeTime(preview.modifiedAt) : "No timestamp"}
            action={
              preview ? (
                <div className="button-row">
                  <button className="button button-ghost compact" onClick={() => onAskClaude(allEntries.find((entry) => entry.path === preview.path)!)}>
                    <Bot />
                    Ask Claude
                  </button>
                  <button className="button button-secondary compact" onClick={() => invoke("reveal_in_file_manager", { path: preview.path })}>
                    <FolderOpen />
                    Reveal
                  </button>
                </div>
              ) : null
            }
          />
          {preview ? (
            <div className="markdown-preview">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content || preview.preview || "No preview available."}</ReactMarkdown>
            </div>
          ) : <EmptyState title="No preview selected" body="Choose an output or share from the left to inspect it." />}
        </Surface>
      </div>
    </section>
  );
}

function EntryGroup({
  title,
  entries,
  selectedPath,
  onSelect
}: {
  title: string;
  entries: WorkspaceEntry[];
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="entry-group">
      <div className="inline-header">
        <strong>{title}</strong>
        <span>{entries.length}</span>
      </div>
      <div className="stack-list">
        {entries.length ? entries.map((entry) => (
          <FileRow
            key={entry.path}
            title={entry.name}
            subtitle={formatRelativeTime(entry.modifiedAt)}
            body={entry.preview || "No preview yet."}
            active={selectedPath === entry.path}
            onClick={() => onSelect(entry.path)}
          />
        )) : <EmptyState title={`No ${title.toLowerCase()}`} body="Nothing has been generated for this section yet." />}
      </div>
    </div>
  );
}
