"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  SHARED,
  byPosition,
  bySidebarOrder,
  newId,
  positionBetween,
  store,
  type Block,
  type Page,
  type PagePatch,
  type PageSummary,
} from "@/lib/tasks-store";
import { uploadImage } from "@/lib/tasks-images";
import { occursOn, parseVirtualId, virtualId, type RepeatRule } from "@/lib/tasks-repeat";
import { addDays, fmtMin, fromISODate, toISODate } from "@/lib/time";
import Editor, { type EditorActions, type Focus } from "./Editor";
import NewPageMenu from "./NewPageMenu";
import PageMenu from "./PageMenu";
import styles from "./tasks.module.css";

const POLL_MS = 5000;
const SAVE_DEBOUNCE_MS = 400;

/** `virtual` = an occurrence of a repeating template nobody has touched; the
 *  page and blocks exist only locally (with the ids they'll get on the server). */
type OpenPage = {
  page: Page;
  blocks: Block[];
  virtual?: { templateId: string; day: string; key: string };
};
type Lists = { day: string; dated: PageSummary[]; undated: PageSummary[] };
type Status = { kind: "" | "ok" | "busy" | "err"; msg: string };

const weekdayOf = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", { weekday: "long" });
const dateOf = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const dayShort = (iso: string) => fromISODate(iso).toLocaleDateString("en-GB", { weekday: "short" });

const emptyBlock = (pageId: string): Block => ({
  id: newId(),
  page_id: pageId,
  position: 1,
  kind: "text",
  text: "",
  done: false,
  images: [],
});

/** A fresh, independent copy of a template: new ids, ticks cleared, scale 1. */
function buildCopy(t: { page: Page; blocks: Block[] }, targetDay: string | null) {
  const id = newId();
  const page: Page = {
    id,
    kind: "page",
    day: targetDay,
    title: t.page.title,
    emoji: t.page.emoji,
    start_min: t.page.start_min,
    template_id: t.page.id,
    is_recipe: t.page.is_recipe,
    recipe: t.page.recipe,
    recipe_scale: 1,
    repeat: null,
    created_at: new Date().toISOString(),
  };
  const copied = t.blocks.map((b) => ({ ...b, id: newId(), page_id: id, done: false }));
  return { page, blocks: copied.length ? copied : [emptyBlock(id)] };
}

const stripCreated = (page: Page) => {
  const { created_at: _c, ...rest } = page;
  void _c;
  return rest;
};

export default function Tasks() {
  const router = useRouter();
  const params = useSearchParams();

  // Computed on the client at mount (this subtree is client-rendered under Suspense).
  const [today] = useState(() => toISODate(new Date()));

  const day = params.get("day") || today;
  const pageId = params.get("page");

  // Sidebar lists, tagged with the day they were loaded for so a day change
  // never shows the previous day's pages while the new ones load.
  const [lists, setLists] = useState<Lists>({ day: "", dated: [], undated: [] });
  const dated = lists.day === day ? lists.dated : [];
  const undated = lists.undated;
  const [open, setOpenState] = useState<OpenPage | null>(null);
  const [openState, setOpenStateKind] = useState<"idle" | "missing">("idle");
  const [status, setStatus] = useState<Status>({ kind: "", msg: "" });
  const [banner, setBanner] = useState<React.ReactNode>(null);
  const [focus, setFocus] = useState<Focus>(null);

  /* ----- refs so callbacks always see the latest state ----- */
  const openRef = useRef<OpenPage | null>(null);
  const setOpen = (next: OpenPage | null) => {
    openRef.current = next;
    setOpenState(next);
  };
  const focusedBlockRef = useRef<string | null>(null);
  const dayRef = useRef(day);
  useEffect(() => {
    dayRef.current = day;
  }, [day]);
  // What the URL says (or is about to say): two go() calls in one tick must
  // build on each other, not on a stale searchParams snapshot.
  const urlRef = useRef({ day: params.get("day"), page: params.get("page") });
  useEffect(() => {
    urlRef.current = { day: params.get("day"), page: params.get("page") };
  }, [params]);

  // Writes run one after another, in order, so an insert can never race a
  // patch to the same row. `inflight` counts queued+running writes.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const inflightRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const enqueue = useCallback((work: () => Promise<void>) => {
    inflightRef.current += 1;
    setSaving(true);
    chainRef.current = chainRef.current
      .then(work)
      .catch((e) => {
        console.error(e);
        setStatus({ kind: "err", msg: "Save failed — check the connection" });
      })
      .finally(() => {
        inflightRef.current -= 1;
        if (inflightRef.current === 0) {
          setSaving(false);
          setStatus((s) => (s.kind === "err" ? s : { kind: "ok", msg: "Synced" }));
        }
      });
  }, []);

  // Debounced saves: block text and page fields.
  const textTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingText = useRef(new Map<string, string>());
  const pageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPage = useRef<{ id: string; patch: PagePatch } | null>(null);

  const flushBlock = useCallback(
    (id: string) => {
      const t = textTimers.current.get(id);
      if (t) clearTimeout(t);
      textTimers.current.delete(id);
      const text = pendingText.current.get(id);
      if (text === undefined) return;
      pendingText.current.delete(id);
      enqueue(() => store.updateBlock(id, { text }));
    },
    [enqueue]
  );
  const flushPage = useCallback(() => {
    if (pageTimer.current) clearTimeout(pageTimer.current);
    pageTimer.current = null;
    const p = pendingPage.current;
    if (!p) return;
    pendingPage.current = null;
    enqueue(() => store.updatePage(p.id, p.patch));
  }, [enqueue]);
  const flushAll = useCallback(() => {
    for (const id of [...pendingText.current.keys()]) flushBlock(id);
    flushPage();
  }, [flushBlock, flushPage]);

  const hasPending = () => pendingText.current.size > 0 || pendingPage.current !== null;

  /* ----- navigation (URL is the source of truth for day + open page) ----- */
  const go = useCallback(
    (next: { day?: string | null; page?: string | null }) => {
      flushAll();
      const d = next.day === undefined ? urlRef.current.day || today : next.day;
      const p = next.page === undefined ? urlRef.current.page : next.page;
      urlRef.current = { day: d, page: p };
      const q = new URLSearchParams();
      if (d) q.set("day", d);
      if (p) q.set("page", p);
      const qs = q.toString();
      router.replace(`/staff/tasks${qs ? "?" + qs : ""}`, { scroll: false });
    },
    [flushAll, router, today]
  );

  /* ----- loading ----- */
  const refreshLists = useCallback(async (quiet = true) => {
    const d = dayRef.current;
    try {
      const [a, b, repeating] = await Promise.all([
        store.listDay(d),
        store.listUndated(),
        store.listRepeating(),
      ]);
      if (dayRef.current !== d) return; // day changed while loading
      // Occurrences the rules produce for this day, minus the ones already
      // started (they're real pages in `a`) or skipped.
      const virtual: PageSummary[] = repeating
        .filter((t) => occursOn(t.repeat, d) && !t.exceptions.some((e) => e.occurrence_day === d))
        .map((t) => ({
          id: virtualId(t.id, d),
          day: d,
          title: t.title,
          emoji: t.emoji,
          start_min: t.start_min,
          template_id: t.id,
          created_at: t.created_at,
          todo_total: t.todo_total,
          todo_done: 0,
          virtual: { templateId: t.id, day: d },
        }));
      setLists({ day: d, dated: [...a, ...virtual].sort(bySidebarOrder), undated: b });
      setBanner(null);
      // A quiet poll that succeeds also clears an earlier connection error.
      setStatus((s) => (quiet && s.kind !== "err" ? s : { kind: "ok", msg: "Synced" }));
    } catch (e) {
      console.error(e);
      setStatus({ kind: "err", msg: "Can’t reach Supabase" });
      if (!quiet)
        setBanner(
          <>
            <b>Couldn’t load from Supabase.</b> Usually this means the <code>task_pages</code>{" "}
            tables don’t exist yet — the SQL to create them is in the README.
            <br />
            <small>{String(e instanceof Error ? e.message : e)}</small>
          </>
        );
    }
  }, []);

  const refreshOpen = useCallback(async () => {
    const cur = openRef.current;
    if (!cur || cur.virtual) return; // a virtual page has nothing on the server yet
    // Never overwrite local edits that haven't reached the server yet.
    if (inflightRef.current > 0 || hasPending()) return;
    try {
      const fresh = await store.getPage(cur.page.id);
      if (openRef.current?.page.id !== cur.page.id) return; // switched meanwhile
      if (inflightRef.current > 0 || hasPending()) return;
      if (!fresh) return; // deleted elsewhere; the list refresh drops it
      const focused = focusedBlockRef.current;
      const blocks = fresh.blocks.map((b) => {
        if (b.id !== focused) return b;
        const local = openRef.current?.blocks.find((x) => x.id === b.id);
        return local ? { ...b, text: local.text } : b;
      });
      setOpen({ page: fresh.page, blocks });
    } catch (e) {
      console.error(e);
    }
  }, []);

  // First load + whenever the day changes. Runs after any queued writes, so
  // a page that was just moved here is already on the server when we ask.
  useEffect(() => {
    if (!SHARED) return;
    let cancelled = false;
    chainRef.current.then(() => {
      if (!cancelled) refreshLists(false);
    });
    return () => {
      cancelled = true;
    };
  }, [day, refreshLists]);

  // Open page follows the URL. A page we already hold (e.g. one just created)
  // isn't refetched; the poll keeps it fresh.
  useEffect(() => {
    if (!SHARED || !pageId) return;
    if (openRef.current?.page.id === pageId || openRef.current?.virtual?.key === pageId) return;
    let cancelled = false;
    const v = parseVirtualId(pageId);
    if (v) {
      // Show the template's content as this day's page; it becomes real on first edit.
      store
        .getPage(v.templateId)
        .then((t) => {
          if (cancelled) return;
          if (!t || t.page.kind !== "template") {
            setOpenStateKind("missing");
            return;
          }
          setOpen({ ...buildCopy(t, v.day), virtual: { ...v, key: pageId } });
          setOpenStateKind("idle");
        })
        .catch((e) => {
          console.error(e);
          if (!cancelled) setOpenStateKind("missing");
        });
      return () => {
        cancelled = true;
      };
    }
    store
      .getPage(pageId)
      .then((res) => {
        if (cancelled) return;
        setOpen(res);
        setOpenStateKind(res ? "idle" : "missing");
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setOpenStateKind("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  // The page shown is whatever we hold, as long as the URL still points at it.
  const shown = open && (open.page.id === pageId || open.virtual?.key === pageId) ? open : null;

  // Poll while visible, and flush unsaved edits when the tab goes away.
  useEffect(() => {
    if (!SHARED) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (inflightRef.current > 0 || hasPending()) return;
      refreshLists();
      refreshOpen();
    };
    const interval = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
      else flushAll();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flushAll);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flushAll);
    };
  }, [refreshLists, refreshOpen, flushAll]);

  /* ----- mutations ----- */

  const commitBlocks = (fn: (blocks: Block[]) => Block[]) => {
    const cur = openRef.current;
    if (!cur) return;
    setOpen({ ...cur, blocks: fn(cur.blocks).sort(byPosition) });
  };
  const closeOpen = () => {
    setOpen(null);
    setOpenStateKind("idle");
    go({ page: null });
  };

  /** Show a page we just built locally, persist it, and open it. */
  const openNew = (page: Page, blocks: Block[], focusTitle: boolean) => {
    const newPage = stripCreated(page);
    setOpen({ page, blocks });
    setOpenStateKind("idle");
    enqueue(async () => {
      await store.createPage(newPage, blocks);
      await refreshLists();
    });
    go({ page: page.id });
    if (focusTitle) setFocus({ id: "title", offset: 0 });
  };

  const createBlank = (targetDay: string | null) => {
    const id = newId();
    const page: Page = {
      id,
      kind: "page",
      day: targetDay,
      title: "",
      emoji: "",
      start_min: null,
      template_id: null,
      is_recipe: false,
      recipe: [],
      recipe_scale: 1,
      repeat: null,
      created_at: new Date().toISOString(),
    };
    openNew(page, [emptyBlock(id)], true);
  };

  const createTemplate = (name: string, isRecipe: boolean, repeat: RepeatRule | null) => {
    const id = newId();
    const page: Page = {
      id,
      kind: "template",
      day: null,
      title: name,
      emoji: "",
      start_min: null,
      template_id: null,
      is_recipe: isRecipe,
      recipe: [],
      recipe_scale: 1,
      repeat,
      created_at: new Date().toISOString(),
    };
    openNew(page, [emptyBlock(id)], false);
  };

  /** Copy a template into a new, independent page. Checklist ticks start clear. */
  const createFromTemplate = (templateId: string, targetDay: string | null) => {
    flushAll();
    enqueue(async () => {
      const t = await store.getPage(templateId);
      if (!t) {
        setStatus({ kind: "err", msg: "That template no longer exists" });
        return;
      }
      // A repeating template already covers the days its rule hits: open that
      // day's occurrence (started or not) rather than adding a duplicate.
      if (t.page.repeat && targetDay && occursOn(t.page.repeat, targetDay)) {
        const ex = await store.getException(templateId, targetDay);
        if (!ex) {
          go({ page: virtualId(templateId, targetDay) });
          return;
        }
        if (ex.page_id) {
          go({ page: ex.page_id });
          return;
        }
        // Skipped earlier; they want it after all, so a fresh copy is right.
      }
      const { page, blocks } = buildCopy(t, targetDay);
      await store.createPage(stripCreated(page), blocks);
      setOpen({ page, blocks });
      setOpenStateKind("idle");
      go({ page: page.id });
      await refreshLists();
    });
  };

  /* ----- repeating occurrences ----- */

  /** First edit of a virtual page: write it (and its exception) to the server. */
  const ensureReal = () => {
    const cur = openRef.current;
    if (!cur?.virtual) return;
    const { templateId, day: occDay } = cur.virtual;
    const { page, blocks } = cur;
    setOpen({ page, blocks });
    go({ page: page.id });
    enqueue(async () => {
      await store.createPage(stripCreated(page), blocks);
      const res = await store.addException(templateId, occDay, page.id);
      if (res === "exists") {
        // Another device started this occurrence first: keep theirs, drop ours.
        const ex = await store.getException(templateId, occDay);
        await store.deletePage(page.id);
        setStatus({ kind: "err", msg: "Someone else started this page first — showing theirs" });
        if (openRef.current?.page.id === page.id) {
          setOpen(null);
          go({ page: ex?.page_id ?? null });
        }
      }
      await refreshLists();
    });
  };

  /** "Skip this day": the rule stops producing this occurrence. */
  const skipOccurrence = (templateId: string, occDay: string, key: string, label: string) => {
    if (!confirm(`Skip “${label || "Untitled"}” for ${dateOf(occDay)}? It won’t come back on that day.`))
      return;
    setLists((l) => ({ ...l, dated: l.dated.filter((p) => p.id !== key) }));
    if (openRef.current?.virtual?.key === key) closeOpen();
    enqueue(async () => {
      await store.addException(templateId, occDay, null);
      await refreshLists();
    });
  };

  /** Moving an untouched occurrence makes it a real page on the new day. */
  const moveOccurrence = (templateId: string, occDay: string, key: string, targetDay: string | null) => {
    setLists((l) => ({ ...l, dated: l.dated.filter((p) => p.id !== key) }));
    if (openRef.current?.virtual?.key === key) closeOpen();
    enqueue(async () => {
      const t = await store.getPage(templateId);
      if (!t) return;
      const { page, blocks } = buildCopy(t, targetDay);
      await store.createPage(stripCreated(page), blocks);
      await store.addException(templateId, occDay, page.id); // "exists" = already handled elsewhere
      await refreshLists();
    });
    if (targetDay && targetDay !== day) go({ day: targetDay });
  };

  const movePageById = (id: string, targetDay: string | null) => {
    const v = parseVirtualId(id);
    if (v) {
      moveOccurrence(v.templateId, v.day, id, targetDay);
      return;
    }
    flushAll();
    const cur = openRef.current;
    if (cur?.page.id === id) setOpen({ ...cur, page: { ...cur.page, day: targetDay } });
    // Show the result right away; the server confirms it after the write.
    const summary = [...lists.dated, ...lists.undated].find((p) => p.id === id);
    const moved = summary ? { ...summary, day: targetDay } : null;
    const without = (l: PageSummary[]) => l.filter((p) => p.id !== id);
    setLists((l) => {
      const next: Lists = { ...l, dated: without(l.dated), undated: without(l.undated) };
      if (!moved) return next;
      if (targetDay === null)
        return { ...next, undated: [...next.undated, moved].sort(bySidebarOrder) };
      if (targetDay === l.day)
        return { ...next, dated: [...next.dated, moved].sort(bySidebarOrder) };
      return { day: targetDay, dated: [moved], undated: next.undated };
    });
    enqueue(async () => {
      await store.updatePage(id, { day: targetDay });
      await refreshLists();
    });
    if (targetDay && targetDay !== day) go({ day: targetDay });
  };

  const deletePageById = (id: string, label: string, repeats = false) => {
    const v = parseVirtualId(id);
    if (v) {
      skipOccurrence(v.templateId, v.day, id, label);
      return;
    }
    const msg = repeats
      ? `Delete “${label || "Untitled"}”? Future repeats stop appearing; pages already started stay.`
      : `Delete “${label || "Untitled"}”? This can’t be undone.`;
    if (!confirm(msg)) return;
    for (const b of openRef.current?.page.id === id ? openRef.current.blocks : []) {
      const t = textTimers.current.get(b.id);
      if (t) clearTimeout(t);
      textTimers.current.delete(b.id);
      pendingText.current.delete(b.id);
    }
    if (pendingPage.current?.id === id) pendingPage.current = null;
    setLists((l) => ({
      ...l,
      dated: l.dated.filter((p) => p.id !== id),
      undated: l.undated.filter((p) => p.id !== id),
    }));
    enqueue(async () => {
      await store.deletePage(id);
      await refreshLists();
    });
    if (openRef.current?.page.id === id) closeOpen();
  };

  const actions: EditorActions = {
    patchPage(patch) {
      ensureReal();
      const cur = openRef.current;
      if (!cur) return;
      setOpen({ ...cur, page: { ...cur.page, ...patch } });
      const prev = pendingPage.current?.id === cur.page.id ? pendingPage.current.patch : {};
      pendingPage.current = { id: cur.page.id, patch: { ...prev, ...patch } };
      if (pageTimer.current) clearTimeout(pageTimer.current);
      setSaving(true);
      pageTimer.current = setTimeout(() => {
        flushPage();
        enqueue(refreshLists);
      }, SAVE_DEBOUNCE_MS);
    },
    setBlockText(id, text) {
      ensureReal();
      commitBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, text } : b)));
      pendingText.current.set(id, text);
      const t = textTimers.current.get(id);
      if (t) clearTimeout(t);
      setSaving(true);
      textTimers.current.set(
        id,
        setTimeout(() => flushBlock(id), SAVE_DEBOUNCE_MS)
      );
    },
    setBlockKind(id, kind) {
      ensureReal();
      commitBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, kind } : b)));
      flushBlock(id);
      enqueue(async () => {
        await store.updateBlock(id, { kind });
        await refreshLists();
      });
    },
    toggleDone(id, done) {
      ensureReal();
      commitBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, done } : b)));
      enqueue(async () => {
        await store.updateBlock(id, { done });
        await refreshLists();
      });
    },
    insertAfter(afterId, kind, text) {
      ensureReal();
      const cur = openRef.current;
      if (!cur) return "";
      const blocks = cur.blocks;
      const idx = afterId ? blocks.findIndex((b) => b.id === afterId) : blocks.length - 1;
      const before = idx >= 0 ? blocks[idx]?.position : undefined;
      const after = blocks[idx + 1]?.position;
      const block: Block = {
        id: newId(),
        page_id: cur.page.id,
        position: positionBetween(before, after),
        kind,
        text,
        done: false,
        images: [],
      };
      if (afterId) flushBlock(afterId); // the split left new text in the block above
      commitBlocks((bs) => [...bs, block]);
      enqueue(async () => {
        await store.insertBlocks([block]);
        if (kind === "todo") await refreshLists();
      });
      return block.id;
    },
    deleteBlock(id) {
      ensureReal();
      const t = textTimers.current.get(id);
      if (t) clearTimeout(t);
      textTimers.current.delete(id);
      pendingText.current.delete(id);
      const wasTodo = openRef.current?.blocks.find((b) => b.id === id)?.kind === "todo";
      commitBlocks((bs) => bs.filter((b) => b.id !== id));
      enqueue(async () => {
        await store.deleteBlock(id);
        if (wasTodo) await refreshLists();
      });
    },
    mergeIntoPrevious(id) {
      ensureReal();
      const cur = openRef.current;
      if (!cur) return null;
      const idx = cur.blocks.findIndex((b) => b.id === id);
      if (idx <= 0) return null;
      const prev = cur.blocks[idx - 1];
      const me = cur.blocks[idx];
      const offset = prev.text.length;
      const merged = prev.text + me.text;
      const images = [...prev.images, ...me.images];
      // Drop any pending text saves for both; we write the final state directly.
      for (const bid of [prev.id, me.id]) {
        const t = textTimers.current.get(bid);
        if (t) clearTimeout(t);
        textTimers.current.delete(bid);
        pendingText.current.delete(bid);
      }
      commitBlocks((bs) =>
        bs
          .filter((b) => b.id !== me.id)
          .map((b) => (b.id === prev.id ? { ...b, text: merged, images } : b))
      );
      enqueue(async () => {
        await store.updateBlock(prev.id, { text: merged, images });
        await store.deleteBlock(me.id);
        if (me.kind === "todo") await refreshLists();
      });
      return { prevId: prev.id, offset };
    },
    movePage(targetDay) {
      ensureReal();
      const cur = openRef.current;
      if (cur) movePageById(cur.page.id, targetDay);
    },
    deletePage() {
      const cur = openRef.current;
      if (!cur) return;
      const label = `${cur.page.emoji} ${cur.page.title}`.trim();
      if (cur.virtual) skipOccurrence(cur.virtual.templateId, cur.virtual.day, cur.virtual.key, label);
      else deletePageById(cur.page.id, label, cur.page.kind === "template" && Boolean(cur.page.repeat));
    },
    setFocusedBlock(id) {
      focusedBlockRef.current = id;
    },
    async addImages(id, files) {
      ensureReal();
      // Uploads run in parallel; the block is updated once they've all landed.
      const refs = await Promise.all(files.map(uploadImage));
      const b = openRef.current?.blocks.find((x) => x.id === id);
      if (!b) return; // block went away meanwhile; the objects just sit unreferenced
      const images = [...b.images, ...refs];
      commitBlocks((bs) => bs.map((x) => (x.id === id ? { ...x, images } : x)));
      enqueue(() => store.updateBlock(id, { images }));
    },
    useTemplate() {
      const cur = openRef.current;
      if (cur?.page.kind === "template") createFromTemplate(cur.page.id, day);
    },
    editTemplate() {
      const cur = openRef.current;
      if (cur?.page.template_id) go({ page: cur.page.template_id });
    },
    removeImage(id, imageId) {
      ensureReal();
      const b = openRef.current?.blocks.find((x) => x.id === id);
      if (!b) return;
      const images = b.images.filter((i) => i.id !== imageId);
      commitBlocks((bs) => bs.map((x) => (x.id === id ? { ...x, images } : x)));
      enqueue(() => store.updateBlock(id, { images }));
    },
  };

  /* ----- render ----- */

  if (!SHARED)
    return (
      <div className={styles.page}>
        <div className={styles.needCard}>
          <h1>Tasks needs Supabase</h1>
          <p>
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
            in <code>.env.local</code> (see the README), then run the Tasks SQL in the Supabase SQL
            editor.
          </p>
          <Link href="/">← Staff tools</Link>
        </div>
      </div>
    );

  const isToday = day === today;
  const statusText = saving ? "Saving…" : status.msg;
  const dotClass =
    status.kind === "err" ? styles.dotErr : saving ? styles.dotBusy : status.kind === "ok" ? styles.dotOk : "";

  return (
    <div className={`${styles.page} ${pageId ? styles.hasOpen : ""}`}>
      <aside className={styles.sidebar}>
        <div className={styles.dateBar}>
          <button
            type="button"
            className={styles.navBtn}
            aria-label="Previous day"
            onClick={() => go({ day: toISODate(addDays(fromISODate(day), -1)) })}
          >
            ‹
          </button>
          <div className={styles.dateLabel}>
            <span className={styles.weekday}>{isToday ? "Today" : weekdayOf(day)}</span>
            <span className={styles.dateText}>
              {isToday ? `${weekdayOf(day)} ${dateOf(day)}` : dateOf(day)}
            </span>
            <input
              type="date"
              className={styles.dateInput}
              value={day}
              onChange={(e) => e.target.value && go({ day: e.target.value })}
              aria-label="Pick a day"
            />
          </div>
          <button
            type="button"
            className={styles.navBtn}
            aria-label="Next day"
            onClick={() => go({ day: toISODate(addDays(fromISODate(day), 1)) })}
          >
            ›
          </button>
        </div>
        {!isToday && today && (
          <button type="button" className={styles.todayBtn} onClick={() => go({ day: today })}>
            ↩ Back to today
          </button>
        )}

        {banner && <div className={styles.banner}>{banner}</div>}

        <Section
          title={isToday ? "Today’s pages" : "Pages"}
          items={dated}
          openId={pageId}
          empty={lists.day === day ? "Nothing planned for this day." : ""}
          onBlank={() => createBlank(day)}
          onFromTemplate={(tid) => createFromTemplate(tid, day)}
          onEditTemplate={(tid) => go({ page: tid })}
          onCreateTemplate={createTemplate}
          onOpen={(id) => go({ page: id })}
          onMove={movePageById}
          onDelete={deletePageById}
          today={today}
        />
        <Section
          title="Ongoing"
          items={undated}
          openId={pageId}
          empty="Pages that aren’t tied to a day live here."
          onBlank={() => createBlank(null)}
          onFromTemplate={(tid) => createFromTemplate(tid, null)}
          onEditTemplate={(tid) => go({ page: tid })}
          onCreateTemplate={createTemplate}
          onOpen={(id) => go({ page: id })}
          onMove={movePageById}
          onDelete={deletePageById}
          today={today}
        />

        <div className={styles.sideFoot}>
          <span className={styles.status}>
            <span className={`${styles.dot} ${dotClass}`} />
            {statusText}
          </span>
          <Link href="/">Staff tools</Link>
        </div>
      </aside>

      <main className={styles.main}>
        {shown ? (
          <Editor
            key={shown.page.id}
            page={shown.page}
            blocks={shown.blocks}
            actions={actions}
            focus={focus}
            onFocusHandled={() => setFocus(null)}
            onBack={closeOpen}
            dayLabel={isToday ? "today" : `${dayShort(day)} ${dateOf(day)}`}
            today={today}
            virtual={Boolean(shown.virtual)}
          />
        ) : pageId && openState !== "missing" ? (
          <div className={styles.placeholder} />
        ) : pageId ? (
          <div className={styles.placeholder}>
            <p>That page doesn’t exist any more.</p>
            <button type="button" className={styles.linkBtn} onClick={closeOpen}>
              Back to the list
            </button>
          </div>
        ) : (
          <div className={styles.placeholder}>
            <p>Pick a page on the left, or add one with +.</p>
          </div>
        )}
      </main>
    </div>
  );
}

/* ---------- sidebar section ---------- */

type SectionProps = {
  title: string;
  items: PageSummary[];
  openId: string | null;
  empty: string;
  onBlank: () => void;
  onFromTemplate: (templateId: string) => void;
  onEditTemplate: (templateId: string) => void;
  onCreateTemplate: (name: string, isRecipe: boolean, repeat: RepeatRule | null) => void;
  onOpen: (id: string) => void;
  today: string;
  onMove: (id: string, day: string | null) => void;
  onDelete: (id: string, label: string) => void;
};

const loadTemplates = () => store.listTemplates();

function Section({
  title,
  items,
  openId,
  empty,
  onBlank,
  onFromTemplate,
  onEditTemplate,
  onCreateTemplate,
  onOpen,
  onMove,
  onDelete,
  today,
}: SectionProps) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h2>{title}</h2>
        <NewPageMenu
          label={`Add page: ${title}`}
          today={today}
          loadTemplates={loadTemplates}
          onBlank={onBlank}
          onFromTemplate={onFromTemplate}
          onEditTemplate={onEditTemplate}
          onCreateTemplate={onCreateTemplate}
        />
      </header>
      {items.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <ul className={styles.list}>
          {items.map((p) => {
            const pct = p.todo_total ? Math.round((p.todo_done / p.todo_total) * 100) : 0;
            const label = `${p.emoji} ${p.title}`.trim();
            return (
              <li
                key={p.id}
                className={`${styles.item} ${p.id === openId ? styles.itemOn : ""} ${
                  p.virtual ? styles.itemVirtual : ""
                }`}
              >
                <button
                  type="button"
                  className={styles.itemMain}
                  onClick={() => onOpen(p.id)}
                  title={p.virtual ? "Repeats from a template — not started yet" : undefined}
                >
                  <span className={styles.itemEmoji}>{p.emoji || "📄"}</span>
                  <span className={styles.itemBody}>
                    <span className={`${styles.itemTitle} ${p.title ? "" : styles.untitled}`}>
                      {p.virtual && <span className={styles.virtIcon}>↻</span>}
                      {p.title || "Untitled"}
                    </span>
                    {(p.start_min !== null || p.todo_total > 0) && (
                      <span className={styles.itemMeta}>
                        {p.start_min !== null && <span>{fmtMin(p.start_min)}</span>}
                        {p.todo_total > 0 && (
                          <span className={p.todo_done === p.todo_total ? styles.metaDone : ""}>
                            {p.todo_done}/{p.todo_total}
                          </span>
                        )}
                      </span>
                    )}
                    {p.todo_total > 0 && (
                      <span className={styles.bar}>
                        <span
                          className={`${styles.barFill} ${pct === 100 ? styles.barDone : ""}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    )}
                  </span>
                </button>
                <PageMenu
                  currentDay={p.day}
                  onMove={(d) => onMove(p.id, d)}
                  onDelete={() => onDelete(p.id, label)}
                  align="right"
                  label={`Menu for ${label || "Untitled"}`}
                  deleteLabel={p.virtual ? "Skip this day" : "Delete"}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
