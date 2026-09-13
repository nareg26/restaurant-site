"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Block, BlockKind, Page, RecipeRow } from "@/lib/tasks-store";
import { imageUrl } from "@/lib/tasks-images";
import { fmtAmount, makeToken } from "@/lib/tasks-recipe";
import { summary, type RepeatRule } from "@/lib/tasks-repeat";
import { fmtMin, parseTime } from "@/lib/time";
import {
  hasSelection,
  modelOffset,
  pillBeforeCaret,
  render,
  renderKey,
  serialize,
  setCaretModel,
} from "./blockText";
import EmojiPicker from "./EmojiPicker";
import Lightbox from "./Lightbox";
import PageMenu from "./PageMenu";
import RecipeTable from "./RecipeTable";
import RepeatDialog from "./RepeatDialog";
import styles from "./tasks.module.css";

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

const filterIngredients = (rows: RecipeRow[], query: string) => {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => r.name.trim() && (!q || r.name.toLowerCase().includes(q)));
};

/* ---------- types ---------- */

export type Focus = { id: string; offset: number | "end" } | null;

export type EditorActions = {
  patchPage: (
    patch: Partial<Pick<Page, "title" | "emoji" | "start_min" | "recipe" | "recipe_scale" | "repeat">>
  ) => void;
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
  /** Non-repeating templates: make a page from this template on the sidebar's day. */
  useTemplate: () => void;
  /** Pages made from a template: open that template. */
  editTemplate: () => void;
};

const onlyImages = (files: Iterable<File>) =>
  Array.from(files).filter((f) => f.type.startsWith("image/"));

type SlashState = { id: string; query: string; index: number } | null;
/** The "[" ingredient picker: anchor is the model offset of the "[". */
type IngState = { id: string; anchor: number; query: string; index: number } | null;

type Props = {
  page: Page;
  blocks: Block[];
  actions: EditorActions;
  focus: Focus;
  onFocusHandled: () => void;
  /** Mobile only: go back to the list. */
  onBack: () => void;
  /** "today" or "Mon 14 Sept" — for the template's "Use for …" button. */
  dayLabel: string;
  /** Today's ISO date: the anchor for new repeat rules. */
  today: string;
  /** An occurrence of a repeating template that nobody has touched yet. */
  virtual: boolean;
};

/* ---------- editor ---------- */

export default function Editor({
  page,
  blocks,
  actions,
  focus,
  onFocusHandled,
  onBack,
  dayLabel,
  today,
  virtual,
}: Props) {
  const isTemplate = page.kind === "template";
  const [repeatDialog, setRepeatDialog] = useState(false);
  const [slash, setSlash] = useState<SlashState>(null);
  const [ing, setIng] = useState<IngState>(null);
  const [viewer, setViewer] = useState<{ blockId: string; index: number } | null>(null);
  const [viewerAdding, setViewerAdding] = useState(false);
  const [view, setView] = useState<"table" | "content">("table");
  const titleRef = useRef<HTMLInputElement>(null);
  const viewerBlock = viewer ? blocks.find((b) => b.id === viewer.blockId) ?? null : null;
  const closeViewer = useCallback(() => setViewer(null), []);

  // Ingredient pills follow the page's own rows and scale (templates: ×1).
  const rows = page.recipe;
  const scale = isTemplate ? 1 : page.recipe_scale;
  const showContent = !page.is_recipe || view === "content";

  // Focus the title of a brand-new page.
  useEffect(() => {
    if (focus?.id === "title") {
      titleRef.current?.focus();
      onFocusHandled();
    }
  }, [focus, onFocusHandled]);

  const focusFirstOrCreate = () => {
    if (blocks.length) {
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
        {isTemplate && (
          <div className={styles.templateBar}>
            <span className={styles.tag}>Template</span>
            {page.is_recipe && <span className={styles.tag}>Recipe</span>}
            <button
              type="button"
              className={`${styles.repeatChip} ${page.repeat ? styles.repeatOn : ""}`}
              onClick={() => setRepeatDialog(true)}
              title="Change how this template repeats"
            >
              ↻ {page.repeat ? summary(page.repeat) : "Does not repeat"}
            </button>
            {/* A repeating template puts its pages on the right days itself. */}
            {!page.repeat && (
              <button type="button" className={styles.useBtn} onClick={actions.useTemplate}>
                Add to {dayLabel}
              </button>
            )}
          </div>
        )}
        {!isTemplate && page.template_id && (
          <div className={styles.templateBar}>
            {virtual && (
              <span className={styles.tag} title="Edits turn this into a real page">
                ↻ Not started
              </span>
            )}
            <button type="button" className={styles.linkBtn} onClick={actions.editTemplate}>
              ✎ Edit template
            </button>
          </div>
        )}
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
            canMove={!isTemplate}
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
              if (showContent) focusFirstOrCreate();
            }
          }}
          aria-label="Title"
        />
      </div>

      {page.is_recipe && (
        <div className={styles.segmented} role="tablist" aria-label="Recipe view">
          <button
            type="button"
            role="tab"
            aria-selected={view === "table"}
            className={view === "table" ? styles.segOn : ""}
            onClick={() => setView("table")}
          >
            Ingredients
            {!isTemplate && page.recipe_scale !== 1 && (
              <span className={styles.segBadge}>×{fmtAmount(page.recipe_scale)}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "content"}
            className={view === "content" ? styles.segOn : ""}
            onClick={() => setView("content")}
          >
            Steps
          </button>
        </div>
      )}

      {page.is_recipe && view === "table" && (
        <RecipeTable
          rows={rows}
          scale={scale}
          editable={isTemplate}
          onRows={(recipe) => actions.patchPage({ recipe })}
          onScale={(recipe_scale) => actions.patchPage({ recipe_scale })}
        />
      )}

      {showContent && (
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
              ing={ing?.id === b.id ? ing : null}
              setIng={setIng}
              ingredients={page.is_recipe ? rows : null}
              rows={rows}
              scale={scale}
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
            {blocks.length === 0
              ? page.is_recipe
                ? "Tap here to write the steps. Type / for a header or checklist, [ for an ingredient."
                : "Tap here to start writing. Type / for a header or checklist."
              : ""}
          </div>
        </div>
      )}

      {repeatDialog && (
        <RepeatDialog
          value={page.repeat}
          defaultStart={today}
          onDone={(repeat: RepeatRule | null) => {
            actions.patchPage({ repeat });
            setRepeatDialog(false);
          }}
          onCancel={() => setRepeatDialog(false)}
        />
      )}

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
  slash: SlashState;
  setSlash: React.Dispatch<React.SetStateAction<SlashState>>;
  ing: IngState;
  setIng: React.Dispatch<React.SetStateAction<IngState>>;
  /** Rows offered by the "[" picker; null on pages that aren't recipes. */
  ingredients: RecipeRow[] | null;
  /** Rows + scale used to label pills already in the text. */
  rows: RecipeRow[];
  scale: number;
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
  ing,
  setIng,
  ingredients,
  rows,
  scale,
  onUpToTitle,
  onOpenImages,
}: RowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const paintedKey = useRef<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [imgError, setImgError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  /** Render `text` into the DOM (pills included) and remember what was painted. */
  const paint = useCallback(
    (text: string) => {
      const el = ref.current;
      if (!el) return;
      render(el, text, rows, scale);
      paintedKey.current = renderKey(text, rows, scale);
    },
    [rows, scale]
  );

  /** Replace the block's text, repaint, and put the caret at a model offset. */
  const replaceText = (text: string, caret: number | "end") => {
    actions.setBlockText(block.id, text);
    paint(text);
    if (ref.current) setCaretModel(ref.current, caret);
  };

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

  // Push server/local text into the DOM only when the block isn't being typed
  // in. Pills also repaint when the rows or scale change.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = renderKey(block.text, rows, scale);
    if (paintedKey.current === key) return;
    if (document.activeElement === el && serialize(el) === block.text) {
      // Same text, different pill labels (scale changed elsewhere): repaint, keep caret.
      const off = modelOffset(el);
      paint(block.text);
      setCaretModel(el, off);
      return;
    }
    if (document.activeElement === el) return;
    paint(block.text);
  }, [block.text, rows, scale, paint]);

  useLayoutEffect(() => {
    if (!focus || !ref.current) return;
    setCaretModel(ref.current, focus.offset);
    onFocusHandled();
  }, [focus, onFocusHandled]);

  const applySlash = useCallback(
    (kind: BlockKind) => {
      setSlash(null);
      actions.setBlockKind(block.id, kind);
      replaceText("", 0);
      requestFocus(block.id, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, block.id, requestFocus, setSlash, paint]
  );

  const applyIngredient = (row: RecipeRow) => {
    const el = ref.current;
    if (!el || !ing) return;
    const text = serialize(el);
    const end = ing.anchor + 1 + ing.query.length;
    const token = makeToken(row);
    const nextText = text.slice(0, ing.anchor) + token + text.slice(end);
    setIng(null);
    replaceText(nextText, ing.anchor + token.length);
  };

  /** After any DOM change: store the text and run the "/" and "[" triggers. */
  const afterInput = () => {
    const el = ref.current;
    if (!el) return;
    const text = serialize(el);
    actions.setBlockText(block.id, text);
    paintedKey.current = renderKey(text, rows, scale); // what's on screen is the truth now

    if (text.startsWith("/") && !text.includes(" ")) {
      setSlash({ id: block.id, query: text.slice(1), index: 0 });
    } else if (slash) {
      setSlash(null);
    }

    if (!ingredients) return;
    const off = modelOffset(el);
    if (ing) {
      const q = text.slice(ing.anchor + 1, off);
      const stillOpen = off > ing.anchor && text[ing.anchor] === "[" && !/[\]\n[]/.test(q);
      if (stillOpen) setIng({ ...ing, query: q, index: 0 });
      else setIng(null);
      return;
    }
    if (text[off - 1] === "[" && text[off - 2] !== "[") {
      setIng({ id: block.id, anchor: off - 1, query: "", index: 0 });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const text = serialize(el);

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

    if (ing && ingredients) {
      const opts = filterIngredients(ingredients, ing.query);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setIng({ ...ing, index: (ing.index + d + opts.length) % Math.max(1, opts.length) });
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && opts.length) {
        e.preventDefault();
        applyIngredient(opts[ing.index] ?? opts[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setIng(null);
        return;
      }
    }

    if (e.key === "Enter" && e.shiftKey) {
      // Soft line break inside the block.
      e.preventDefault();
      const off = modelOffset(el);
      replaceText(text.slice(0, off) + "\n" + text.slice(off), off + 1);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const off = modelOffset(el);
      const before = text.slice(0, off);
      const after = text.slice(off);
      if (block.kind === "todo" && !text) {
        // Enter on an empty checklist item ends the list (Notion behaviour).
        actions.setBlockKind(block.id, "text");
        return;
      }
      if (before !== text) replaceText(before, "end");
      const kind: BlockKind = block.kind === "todo" ? "todo" : "text";
      const id = actions.insertAfter(block.id, kind, after);
      requestFocus(id, 0);
      return;
    }

    if (e.key === "Backspace" && !hasSelection()) {
      // A pill goes as one unit.
      const pill = pillBeforeCaret(el);
      if (pill) {
        e.preventDefault();
        const off = modelOffset(el);
        const len = pill.dataset.token?.length ?? 0;
        replaceText(text.slice(0, off - len) + text.slice(off), off - len);
        return;
      }
      if (modelOffset(el) === 0) {
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
    }

    if (e.key === "Delete" && !hasSelection() && next && modelOffset(el) === text.length) {
      e.preventDefault();
      const merged = actions.mergeIntoPrevious(next.id);
      if (merged) requestFocus(merged.prevId, merged.offset);
      return;
    }

    if (e.key === "ArrowUp" && modelOffset(el) === 0) {
      e.preventDefault();
      if (prev) requestFocus(prev.id, "end");
      else onUpToTitle();
      return;
    }
    if (e.key === "ArrowDown" && modelOffset(el) === text.length) {
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
    const off = modelOffset(el);
    const text = serialize(el);
    const first = text.slice(0, off) + lines[0] + (lines.length === 1 ? text.slice(off) : "");
    replaceText(first, off + lines[0].length);
    if (lines.length === 1) return;
    let afterId = block.id;
    for (let i = 1; i < lines.length; i++) {
      const tail = i === lines.length - 1 ? lines[i] + text.slice(off) : lines[i];
      afterId = actions.insertAfter(afterId, block.kind === "header" ? "text" : block.kind, tail);
    }
    requestFocus(afterId, lines[lines.length - 1].length);
  };

  const slashOpts = slash ? filterSlash(slash.query) : [];
  const ingOpts = ing && ingredients ? filterIngredients(ingredients, ing.query) : [];

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
          block.kind === "header"
            ? "Header"
            : block.kind === "todo"
              ? "To-do"
              : ingredients
                ? "Type / for options, [ for an ingredient"
                : "Type / for options"
        }
        onInput={afterInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => actions.setFocusedBlock(block.id)}
        onBlur={() => {
          actions.setFocusedBlock(null);
          // Let a click on a menu option land before the menu closes.
          setTimeout(() => {
            setSlash((s) => (s?.id === block.id ? null : s));
            setIng((s) => (s?.id === block.id ? null : s));
          }, 150);
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
      {slash && slashOpts.length > 0 && (
        <div className={styles.slashMenu} role="listbox">
          {slashOpts.map((o, i) => (
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
      {ing && ingredients && (
        <div className={styles.slashMenu} role="listbox" aria-label="Ingredients">
          {ingOpts.length === 0 ? (
            <div className={styles.slashEmpty}>
              {ingredients.length ? "No ingredient matches" : "No ingredients on this recipe yet"}
            </div>
          ) : (
            ingOpts.map((r, i) => (
              <button
                type="button"
                key={r.id}
                role="option"
                aria-selected={i === ing.index}
                className={`${styles.slashItem} ${styles.ingItem} ${i === ing.index ? styles.slashOn : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyIngredient(r)}
              >
                <b>{r.name}</b>
                <span>
                  {fmtAmount(r.amount * scale)} {r.unit}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
