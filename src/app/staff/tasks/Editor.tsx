"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Block, BlockKind, Page } from "@/lib/tasks-store";
import { imageUrl } from "@/lib/tasks-images";
import { fmtMin, parseTime } from "@/lib/time";
import EmojiPicker from "./EmojiPicker";
import Lightbox from "./Lightbox";
import PageMenu from "./PageMenu";
import styles from "./tasks.module.css";

/* ---------- caret helpers for plain-text contentEditable ---------- */

function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return 0;
  const pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

function hasSelection(): boolean {
  const sel = window.getSelection();
  return Boolean(sel && sel.rangeCount && !sel.getRangeAt(0).collapsed);
}

function setCaret(el: HTMLElement, offset: number | "end") {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (offset === "end") {
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    let remaining = offset;
    let placed = false;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
        break;
      }
      remaining -= len;
    }
    if (!placed) {
      range.selectNodeContents(el);
      range.collapse(false);
    }
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ---------- slash menu ---------- */

const SLASH_OPTIONS: { kind: BlockKind; label: string; hint: string }[] = [
  { kind: "text", label: "Text", hint: "Plain paragraph" },
  { kind: "header", label: "Header", hint: "Section title" },
  { kind: "todo", label: "Checklist", hint: "Item with a checkbox" },
];

const filterSlash = (query: string) => {
  const q = query.trim().toLowerCase();
  return q ? SLASH_OPTIONS.filter((o) => o.label.toLowerCase().startsWith(q)) : SLASH_OPTIONS;
};

/* ---------- types ---------- */

export type Focus = { id: string; offset: number | "end" } | null;

export type EditorActions = {
  patchPage: (patch: Partial<Pick<Page, "title" | "emoji" | "start_min">>) => void;
  setBlockText: (id: string, text: string) => void;
  setBlockKind: (id: string, kind: BlockKind) => void;
  toggleDone: (id: string, done: boolean) => void;
  /** Insert a new block after `afterId` (or at the end when null). Returns its id. */
  insertAfter: (afterId: string | null, kind: BlockKind, text: string) => string;
  deleteBlock: (id: string) => void;
  /** Merge block `id` into the one before it; returns the previous block's old length, or null. */
  mergeIntoPrevious: (id: string) => { prevId: string; offset: number } | null;
  movePage: (day: string | null) => void;
  deletePage: () => void;
  setFocusedBlock: (id: string | null) => void;
  /** Upload files and attach them to the block. Rejects with a readable message. */
  addImages: (id: string, files: File[]) => Promise<void>;
  removeImage: (id: string, imageId: string) => void;
};

const onlyImages = (files: Iterable<File>) =>
  Array.from(files).filter((f) => f.type.startsWith("image/"));

type Props = {
  page: Page;
  blocks: Block[];
  actions: EditorActions;
  focus: Focus;
  onFocusHandled: () => void;
  /** Mobile only: go back to the list. */
  onBack: () => void;
};

/* ---------- editor ---------- */

export default function Editor({ page, blocks, actions, focus, onFocusHandled, onBack }: Props) {
  const [slash, setSlash] = useState<{ id: string; query: string; index: number } | null>(null);
  const [viewer, setViewer] = useState<{ blockId: string; index: number } | null>(null);
  const [viewerAdding, setViewerAdding] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const viewerBlock = viewer ? blocks.find((b) => b.id === viewer.blockId) ?? null : null;
  const closeViewer = useCallback(() => setViewer(null), []);

  // Focus the title of a brand-new page.
  useEffect(() => {
    if (focus?.id === "title") {
      titleRef.current?.focus();
      onFocusHandled();
    }
  }, [focus, onFocusHandled]);

  const focusFirstOrCreate = () => {
    if (blocks.length) {
      // handled via focus request by the parent
      requestFocus(blocks[0].id, 0);
    } else {
      const id = actions.insertAfter(null, "text", "");
      requestFocus(id, 0);
    }
  };

  // The parent owns the focus request so it survives re-renders from inserts.
  const [localFocus, setLocalFocus] = useState<Focus>(null);
  const requestFocus = (id: string, offset: number | "end") => setLocalFocus({ id, offset });
  const effectiveFocus = focus && focus.id !== "title" ? focus : localFocus;
  const focusHandled = () => {
    if (focus && focus.id !== "title") onFocusHandled();
    setLocalFocus(null);
  };

  const timeValue = page.start_min === null ? "" : fmtMin(page.start_min);

  return (
    <div className={styles.editor}>
      <div className={styles.editorTop}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          ‹ Pages
        </button>
        <div className={styles.editorMeta}>
          <label className={styles.timeField}>
            <span>Start</span>
            <input
              type="time"
              value={timeValue}
              onChange={(e) =>
                actions.patchPage({ start_min: e.target.value ? parseTime(e.target.value) : null })
              }
              aria-label="Start time"
            />
            {page.start_min !== null && (
              <button
                type="button"
                className={styles.clearTime}
                aria-label="Clear start time"
                onClick={() => actions.patchPage({ start_min: null })}
              >
                ×
              </button>
            )}
          </label>
          <PageMenu
            currentDay={page.day}
            onMove={actions.movePage}
            onDelete={actions.deletePage}
            align="right"
          />
        </div>
      </div>

      <div className={styles.titleRow}>
        <EmojiPicker value={page.emoji} onChange={(emoji) => actions.patchPage({ emoji })} />
        <input
          ref={titleRef}
          className={styles.titleInput}
          value={page.title}
          placeholder="Untitled"
          onChange={(e) => actions.patchPage({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "ArrowDown") {
              e.preventDefault();
              focusFirstOrCreate();
            }
          }}
          aria-label="Title"
        />
      </div>

      <div className={styles.blocks}>
        {blocks.map((b, i) => (
          <BlockRow
            key={b.id}
            block={b}
            prev={blocks[i - 1] ?? null}
            next={blocks[i + 1] ?? null}
            actions={actions}
            focus={effectiveFocus?.id === b.id ? effectiveFocus : null}
            onFocusHandled={focusHandled}
            requestFocus={requestFocus}
            slash={slash?.id === b.id ? slash : null}
            setSlash={setSlash}
            onUpToTitle={() => titleRef.current?.focus()}
            onOpenImages={(index) => setViewer({ blockId: b.id, index })}
          />
        ))}
        <div
          className={styles.addArea}
          onClick={() => {
            const last = blocks[blocks.length - 1];
            if (last && last.kind === "text" && !last.text) requestFocus(last.id, 0);
            else requestFocus(actions.insertAfter(last?.id ?? null, "text", ""), 0);
          }}
        >
          {blocks.length === 0 ? "Tap here to start writing. Type / for a header or checklist." : ""}
        </div>
      </div>

      {viewer && viewerBlock && viewerBlock.images.length > 0 && (
        <Lightbox
          images={viewerBlock.images}
          index={viewer.index}
          onIndex={(index) => setViewer({ blockId: viewerBlock.id, index })}
          onClose={closeViewer}
          onRemove={(img) => actions.removeImage(viewerBlock.id, img.id)}
          adding={viewerAdding}
          onAdd={async (files) => {
            setViewerAdding(true);
            try {
              await actions.addImages(viewerBlock.id, onlyImages(files));
            } catch (e) {
              alert(e instanceof Error ? e.message : "Upload failed");
            } finally {
              setViewerAdding(false);
            }
          }}
        />
      )}
    </div>
  );
}

/* ---------- one block ---------- */

type RowProps = {
  block: Block;
  prev: Block | null;
  next: Block | null;
  actions: EditorActions;
  focus: Focus;
  onFocusHandled: () => void;
  requestFocus: (id: string, offset: number | "end") => void;
  slash: { id: string; query: string; index: number } | null;
  setSlash: React.Dispatch<React.SetStateAction<{ id: string; query: string; index: number } | null>>;
  onUpToTitle: () => void;
  onOpenImages: (index: number) => void;
};

function BlockRow({
  block,
  prev,
  next,
  actions,
  focus,
  onFocusHandled,
  requestFocus,
  slash,
  setSlash,
  onUpToTitle,
  onOpenImages,
}: RowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [imgError, setImgError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (files: Iterable<File>) => {
    const list = onlyImages(files);
    if (!list.length) return;
    setImgError("");
    setUploading((n) => n + list.length);
    try {
      await actions.addImages(block.id, list);
    } catch (e) {
      setImgError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading((n) => n - list.length);
    }
  };

  // Push server/local text into the DOM only when the block isn't being typed in.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== block.text) el.textContent = block.text;
  }, [block.text]);

  useLayoutEffect(() => {
    if (!focus || !ref.current) return;
    setCaret(ref.current, focus.offset);
    onFocusHandled();
  }, [focus, onFocusHandled]);

  const applySlash = useCallback(
    (kind: BlockKind) => {
      setSlash(null);
      actions.setBlockKind(block.id, kind);
      actions.setBlockText(block.id, "");
      if (ref.current) ref.current.textContent = "";
      requestFocus(block.id, 0);
    },
    [actions, block.id, requestFocus, setSlash]
  );

  const onInput = () => {
    const el = ref.current;
    if (!el) return;
    const text = el.textContent ?? "";
    actions.setBlockText(block.id, text);
    if (text.startsWith("/") && !text.includes(" ")) {
      setSlash({ id: block.id, query: text.slice(1), index: 0 });
    } else if (slash) {
      setSlash(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const text = el.textContent ?? "";

    if (slash) {
      const opts = filterSlash(slash.query);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSlash({ ...slash, index: (slash.index + d + opts.length) % Math.max(1, opts.length) });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const opt = opts[slash.index] ?? opts[0];
        if (opt) applySlash(opt.kind);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const off = caretOffset(el);
      const before = text.slice(0, off);
      const after = text.slice(off);
      if (block.kind === "todo" && !text) {
        // Enter on an empty checklist item ends the list (Notion behaviour).
        actions.setBlockKind(block.id, "text");
        return;
      }
      if (before !== text) {
        actions.setBlockText(block.id, before);
        el.textContent = before;
      }
      const kind: BlockKind = block.kind === "todo" ? "todo" : "text";
      const id = actions.insertAfter(block.id, kind, after);
      requestFocus(id, 0);
      return;
    }

    if (e.key === "Backspace" && !hasSelection() && caretOffset(el) === 0) {
      if (block.kind !== "text") {
        e.preventDefault();
        actions.setBlockKind(block.id, "text");
        requestFocus(block.id, 0);
        return;
      }
      if (prev) {
        e.preventDefault();
        const merged = actions.mergeIntoPrevious(block.id);
        if (merged) requestFocus(merged.prevId, merged.offset);
        return;
      }
      if (!text) {
        e.preventDefault();
        if (block.images.length) return; // keep the photos; remove them from the viewer first
        if (next) {
          actions.deleteBlock(block.id);
          requestFocus(next.id, 0);
        } else onUpToTitle();
      }
      return;
    }

    if (e.key === "Delete" && !hasSelection() && next && caretOffset(el) === text.length) {
      e.preventDefault();
      const merged = actions.mergeIntoPrevious(next.id);
      if (merged) requestFocus(merged.prevId, merged.offset);
      return;
    }

    if (e.key === "ArrowUp" && caretOffset(el) === 0) {
      e.preventDefault();
      if (prev) requestFocus(prev.id, "end");
      else onUpToTitle();
      return;
    }
    if (e.key === "ArrowDown" && caretOffset(el) === text.length) {
      if (next) {
        e.preventDefault();
        requestFocus(next.id, 0);
      }
      return;
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.clipboardData.files.length) {
      handleFiles(e.clipboardData.files);
      return;
    }
    const plain = e.clipboardData.getData("text/plain");
    const lines = plain.split(/\r?\n/);
    const el = ref.current;
    if (!el) return;
    // First line goes into this block at the caret; further lines become new blocks.
    const off = caretOffset(el);
    const text = el.textContent ?? "";
    const first = text.slice(0, off) + lines[0] + (lines.length === 1 ? text.slice(off) : "");
    el.textContent = first;
    actions.setBlockText(block.id, first);
    if (lines.length === 1) {
      setCaret(el, off + lines[0].length);
      return;
    }
    let afterId = block.id;
    for (let i = 1; i < lines.length; i++) {
      const tail = i === lines.length - 1 ? lines[i] + text.slice(off) : lines[i];
      afterId = actions.insertAfter(afterId, block.kind === "header" ? "text" : block.kind, tail);
    }
    requestFocus(afterId, lines[lines.length - 1].length);
  };

  const opts = slash ? filterSlash(slash.query) : [];

  const first = block.images[0];
  const hasImages = block.images.length > 0;

  return (
    <div
      className={`${styles.block} ${styles["k_" + block.kind]} ${hasImages ? styles.hasImages : ""} ${
        dragOver ? styles.dropOver : ""
      }`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
      }}
    >
      {block.kind === "todo" && (
        <input
          type="checkbox"
          className={styles.check}
          checked={block.done}
          onChange={(e) => actions.toggleDone(block.id, e.target.checked)}
          aria-label={block.done ? "Mark not done" : "Mark done"}
        />
      )}
      <div
        ref={ref}
        className={`${styles.blockText} ${block.done ? styles.doneText : ""}`}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={
          block.kind === "header" ? "Header" : block.kind === "todo" ? "To-do" : "Type / for options"
        }
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => actions.setFocusedBlock(block.id)}
        onBlur={() => {
          actions.setFocusedBlock(null);
          // Let a click on a slash option land before the menu closes.
          setTimeout(() => setSlash((s) => (s?.id === block.id ? null : s)), 150);
        }}
      />
      {!hasImages && !uploading && (
        <button
          type="button"
          className={styles.camBtn}
          aria-label="Add a photo to this block"
          title="Add a photo"
          onMouseDown={(e) => e.preventDefault()} // keep the text focused
          onClick={() => fileRef.current?.click()}
        >
          📷
        </button>
      )}
      {(hasImages || uploading > 0) && (
        <div className={styles.thumbWrap}>
          {first ? (
            <button
              type="button"
              className={styles.thumbBtn}
              onClick={() => onOpenImages(0)}
              aria-label={`Open ${block.images.length} photo${block.images.length === 1 ? "" : "s"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.thumb} src={imageUrl(first.path)} alt="" width={first.w} height={first.h} />
              {block.images.length > 1 && (
                <span className={styles.thumbBadge}>+{block.images.length - 1}</span>
              )}
            </button>
          ) : null}
          {uploading > 0 && <div className={styles.thumbUploading}>Uploading…</div>}
          {imgError && <div className={styles.imgError}>{imgError}</div>}
        </div>
      )}
      {!hasImages && imgError && <div className={styles.imgError}>{imgError}</div>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) handleFiles(files);
        }}
      />
      {slash && opts.length > 0 && (
        <div className={styles.slashMenu} role="listbox">
          {opts.map((o, i) => (
            <button
              type="button"
              key={o.kind}
              role="option"
              aria-selected={i === slash.index}
              className={`${styles.slashItem} ${i === slash.index ? styles.slashOn : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applySlash(o.kind)}
            >
              <b>{o.label}</b>
              <span>{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
