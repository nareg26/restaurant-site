"use client";

import React, { useEffect, useRef, useState } from "react";
import type { TemplateSummary } from "@/lib/tasks-store";
import { presetRule, summary, type RepeatRule } from "@/lib/tasks-repeat";
import RepeatDialog from "./RepeatDialog";
import styles from "./tasks.module.css";

type Props = {
  label: string;
  /** Anchor for repeat presets (today). */
  today: string;
  loadTemplates: () => Promise<TemplateSummary[]>;
  onBlank: () => void;
  onFromTemplate: (templateId: string) => void;
  onEditTemplate: (templateId: string) => void;
  onCreateTemplate: (name: string, isRecipe: boolean, repeat: RepeatRule | null) => void;
};

type View = "main" | "templates" | "new";

/** The "+" button: blank page, or from a template (use / edit / create one). */
export default function NewPageMenu({
  label,
  today,
  loadTemplates,
  onBlank,
  onFromTemplate,
  onEditTemplate,
  onCreateTemplate,
}: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("main");
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [isRecipe, setIsRecipe] = useState(false);
  const [repeat, setRepeat] = useState<RepeatRule | null>(null);
  const [dialog, setDialog] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setView("main");
    setName("");
    setIsRecipe(false);
    setRepeat(null);
    setDialog(false);
  };
  const showTemplates = () => {
    setTemplates(null);
    setLoadError(false);
    setView("templates");
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (dialog) return; // the repeat dialog sits outside the popover
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dialog) close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, dialog]);

  // Templates are fetched when the list is shown, so it's always current.
  useEffect(() => {
    if (view !== "templates") return;
    let cancelled = false;
    loadTemplates()
      .then((t) => {
        if (!cancelled) setTemplates(t);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [view, loadTemplates]);

  useEffect(() => {
    if (view === "new") nameRef.current?.focus();
  }, [view]);

  const submitNew = () => {
    const n = name.trim();
    if (!n) return;
    onCreateTemplate(n, isRecipe, repeat);
    close();
  };

  return (
    <div className={styles.menuRoot} ref={rootRef}>
      <button
        type="button"
        className={styles.addBtn}
        aria-label={label}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        +
      </button>
      {open && (
        <div className={`${styles.popover} ${styles.popRight} ${styles.newPop}`}>
          {view === "main" && (
            <>
              <button
                type="button"
                className={styles.popItem}
                onClick={() => {
                  close();
                  onBlank();
                }}
              >
                Blank page
              </button>
              <button type="button" className={styles.popItem} onClick={showTemplates}>
                From template ›
              </button>
            </>
          )}

          {view === "templates" && (
            <>
              <div className={styles.popHead}>Templates</div>
              {loadError ? (
                <p className={styles.popNote}>Couldn’t load templates.</p>
              ) : templates === null ? (
                <p className={styles.popNote}>Loading…</p>
              ) : templates.length === 0 ? (
                <p className={styles.popNote}>No templates yet.</p>
              ) : (
                <ul className={styles.popList}>
                  {templates.map((t) => (
                    <li key={t.id} className={styles.popRow}>
                      <button
                        type="button"
                        className={styles.popRowMain}
                        onClick={() => {
                          close();
                          onFromTemplate(t.id);
                        }}
                        title="Create a page from this template"
                      >
                        <span className={styles.popRowEmoji}>{t.emoji || "📄"}</span>
                        <span className={styles.popRowTitle}>{t.title || "Untitled"}</span>
                        {t.is_recipe && <span className={styles.tag}>Recipe</span>}
                        {t.repeat && (
                          <span className={styles.repeatMark} title={summary(t.repeat)}>
                            ↻
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        className={styles.popRowEdit}
                        aria-label={`Edit template ${t.title || "Untitled"}`}
                        title="Edit template"
                        onClick={() => {
                          close();
                          onEditTemplate(t.id);
                        }}
                      >
                        ✎
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className={styles.popItem} onClick={() => setView("new")}>
                ＋ New template…
              </button>
            </>
          )}

          {view === "new" && (
            <form
              className={styles.popForm}
              onSubmit={(e) => {
                e.preventDefault();
                submitNew();
              }}
            >
              <div className={styles.popHead}>New template</div>
              <input
                ref={nameRef}
                value={name}
                placeholder="Template name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitNew();
                  }
                }}
                aria-label="Template name"
              />
              <label className={styles.popCheck}>
                <input
                  type="checkbox"
                  checked={isRecipe}
                  onChange={(e) => setIsRecipe(e.target.checked)}
                />
                This is a recipe
              </label>
              <label className={styles.popCheck}>
                <input
                  type="checkbox"
                  checked={repeat !== null}
                  onChange={(e) => {
                    if (e.target.checked) setDialog(true); // pick the rule in the dialog
                    else setRepeat(null);
                  }}
                />
                Repeats
              </label>
              {repeat && (
                <button
                  type="button"
                  className={styles.popSummary}
                  onClick={() => setDialog(true)}
                  title="Change the rule"
                >
                  ↻ {summary(repeat)}
                </button>
              )}
              <div className={styles.popActions}>
                <button type="button" className={styles.popItemSmall} onClick={showTemplates}>
                  Back
                </button>
                <button type="submit" className={styles.popGo} disabled={!name.trim()}>
                  Create
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {dialog && (
        <RepeatDialog
          value={repeat ?? presetRule("daily", today)} // ticking "Repeats" starts from Daily
          defaultStart={today}
          onDone={(rule) => {
            setRepeat(rule);
            setDialog(false);
          }}
          onCancel={() => setDialog(false)}
        />
      )}
    </div>
  );
}
