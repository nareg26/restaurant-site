"use client";

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  type BlockBrief,
  type PageSummary,
  type TemplateSummary,
} from "@/lib/tasks-store";
import { uploadImage } from "@/lib/tasks-images";
import { occursOn, parseVirtualId, summary, virtualId, type RepeatRule } from "@/lib/tasks-repeat";
import { addDays, fmtMin, fromISODate, toISODate } from "@/lib/time";
import Editor, { type EditorActions, type Focus } from "./Editor";
import NewPageMenu from "./NewPageMenu";
import PageMenu from "./PageMenu";
import type { PickTarget } from "./PagePicker";
import styles from "./tasks.module.css";

const POLL_MS = 5000;
const SAVE_DEBOUNCE_MS = 400;

/** `virtual` = an occurrence of a repeating template nobody has touched; the
 *  page and blocks exist only locally (with the ids they'll get on the server). */
type OpenPage = {
  page: Page;
  blocks: Block[];
  virtual?: { templateId: string; day: string; key: string };
  /** The virtual id this page was opened under, kept after it became real so
   *  the editor stays mounted during the render before the URL catches up. */
  alias?: string;
};
type Lists = {
  day: string;
  dated: PageSummary[];
  undated: PageSummary[];
  templates: TemplateSummary[];
};

/* The Templates section's collapsed state lives in localStorage. Read through
   useSyncExternalStore so the server render (no storage) and the first client
   render agree, then the stored value takes over without a hydration mismatch. */
const TEMPLATES_OPEN_KEY = "tasks-templates-open";
const openListeners = new Set<() => void>();
const subscribeTemplatesOpen = (l: () => void) => {
  openListeners.add(l);
  return () => {
    openListeners.delete(l);
  };
};
const readTemplatesOpen = () => {
  try {
    return localStorage.getItem(TEMPLATES_OPEN_KEY) === "1";
  } catch {
    return false;
  }
};
const writeTemplatesOpen = (v: boolean) => {
  try {
    localStorage.setItem(TEMPLATES_OPEN_KEY, v ? "1" : "0");
  } catch {}
  openListeners.forEach((l) => l());
};
type Status = { kind: "" | "ok" | "busy" | "err"; msg: string };

const weekdayOf = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", { weekday: "long" });
const dateOf = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const dayShort = (iso: string) => fromISODate(iso).toLocaleDateString("en-GB", { weekday: "short" });

const emptyBlock = (pageId: string, lead = 0): Block => ({
  id: newId(),
  page_id: pageId,
  position: 1,
  kind: "text",
  text: "",
  done: false,
  images: [],
  lead_days: lead,
});

/** How far ahead the sidebar looks for prep steps. */
const MAX_LEAD_DAYS = 7;

/** A prep entry's name: its first header, else "<title> prep". */
const prepLabel = (title: string, blocks: BlockBrief[]) => {
  const header = [...blocks]
    .sort((a, b) => a.position - b.position)
    .find((b) => b.kind === "header" && b.text.trim());
  return header ? header.text.trim() : `${title || "Untitled"} prep`;
};

const prepId = (open: string, lead: number) => `prep:${open}:${lead}`;

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
  /** > 0 when a prep entry is open: show the blocks due that many days early. */
  const lead = Math.max(0, Math.floor(Number(params.get("lead") || 0)) || 0);

  // Sidebar lists, tagged with the day they were loaded for so a day change
  // never shows the previous day's pages while the new ones load.
  const [lists, setLists] = useState<Lists>({ day: "", dated: [], undated: [], templates: [] });
  // The Templates section starts collapsed; the choice sticks per device.
  const templatesOpen = useSyncExternalStore(subscribeTemplatesOpen, readTemplatesOpen, () => false);
  const toggleTemplates = () => writeTemplatesOpen(!templatesOpen);
  const dated = lists.day === day ? lists.dated : [];
  const undated = lists.undated;
  const [open, setOpenState] = useState<OpenPage | null>(null);
  const [openState, setOpenStateKind] = useState<"idle" | "missing">("idle");
  const [status, setStatus] = useState<Status>({ kind: "", msg: "" });
  const [banner, setBanner] = useState<React.ReactNode>(null);
  const [focus, setFocus] = useState<Focus>(null);
  /** Short confirmation after moving/copying blocks, with a link to the target. */
  const [toast, setToast] = useState<{ msg: string; page?: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string, page?: string) => {
    setToast({ msg, page });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 7000);
  };

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
  const urlRef = useRef({
    day: params.get("day"),
    page: params.get("page"),
    lead: params.get("lead"),
  });
  useEffect(() => {
    urlRef.current = { day: params.get("day"), page: params.get("page"), lead: params.get("lead") };
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
    (next: { day?: string | null; page?: string | null; lead?: number }) => {
      flushAll();
      const d = next.day === undefined ? urlRef.current.day || today : next.day;
      const p = next.page === undefined ? urlRef.current.page : next.page;
      const l = next.lead === undefined ? urlRef.current.lead : next.lead > 0 ? String(next.lead) : null;
      urlRef.current = { day: d, page: p, lead: p ? l : null };
      const q = new URLSearchParams();
      if (d) q.set("day", d);
      if (p) q.set("page", p);
      if (p && l) q.set("lead", l);
      const qs = q.toString();
      router.replace(`/staff/tasks${qs ? "?" + qs : ""}`, { scroll: false });
    },
    [flushAll, router, today]
  );

  /* ----- loading ----- */
  const refreshLists = useCallback(async (quiet = true) => {
    const d = dayRef.current;
    try {
      const dd = fromISODate(d);
      const [a, b, repeating, templates, upcoming] = await Promise.all([
        store.listDay(d),
        store.listUndated(),
        store.listRepeating(),
        store.listTemplates(),
        store.listUpcoming(toISODate(addDays(dd, 1)), toISODate(addDays(dd, MAX_LEAD_DAYS))),
      ]);
      if (dayRef.current !== d) return; // day changed while loading
      const daysAhead = (iso: string) =>
        Math.round((fromISODate(iso).getTime() - dd.getTime()) / 86400000);
      const prepSummary = (
        open: string,
        forDay: string,
        base: Pick<PageSummary, "title" | "emoji" | "template_id" | "created_at">,
        blocks: BlockBrief[],
        virtual?: PageSummary["virtual"]
      ): PageSummary | null => {
        const n = daysAhead(forDay);
        const mine = blocks.filter((x) => x.lead_days === n);
        if (n < 1 || !mine.length) return null;
        const todos = mine.filter((x) => x.kind === "todo");
        return {
          id: prepId(open, n),
          day: d,
          title: base.title,
          emoji: base.emoji,
          start_min: null,
          template_id: base.template_id,
          created_at: base.created_at,
          todo_total: todos.length,
          todo_done: virtual ? 0 : todos.filter((x) => x.done).length,
          virtual,
          prep: { forDay, leadDays: n, label: prepLabel(base.title, mine), open },
        };
      };
      // Prep steps of pages in the coming days ("soak beans" the day before).
      const prep: PageSummary[] = [];
      for (const u of upcoming) {
        if (!u.day) continue;
        const ps = prepSummary(u.id, u.day, u, u.blocks);
        if (ps) prep.push(ps);
      }
      // …and of repeat occurrences that haven't been started yet.
      for (const t of repeating) {
        for (let n = 1; n <= MAX_LEAD_DAYS; n++) {
          const forDay = toISODate(addDays(dd, n));
          if (!occursOn(t.repeat, forDay)) continue;
          if (t.exceptions.some((e) => e.occurrence_day === forDay)) continue; // started or skipped
          const ps = prepSummary(
            virtualId(t.id, forDay),
            forDay,
            { ...t, template_id: t.id },
            t.blocks,
            { templateId: t.id, day: forDay }
          );
          if (ps) prep.push(ps);
        }
      }
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
      setLists({
        day: d,
        dated: [...a, ...virtual, ...prep].sort(bySidebarOrder),
        undated: b,
        templates,
      });
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

  // The "where to start" focus helper is declared with the other mutations
  // below; the load effect reaches it through a ref kept current each render.
  const prepareStartRef = useRef<(o: OpenPage) => void>(() => {});

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
          const copy = { ...buildCopy(t, v.day), virtual: { ...v, key: pageId } };
          setOpen(copy);
          setOpenStateKind("idle");
          prepareStartRef.current(copy);
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
        if (res) prepareStartRef.current(res);
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
  const shown =
    open && (open.page.id === pageId || open.virtual?.key === pageId || open.alias === pageId)
      ? open
      : null;

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
    go({ page: null, lead: 0 });
  };

  /** On opening a page: give it an empty block if it has none, so there's
   *  somewhere to tap. The caret goes into the trailing empty block only when
   *  `focus` is set (a page just created from scratch); otherwise a tablet
   *  would pop its keyboard on every page opened. Recipes open on the
   *  Ingredients table, so they're left alone. */
  const prepareStart = (o: OpenPage, focus: boolean) => {
    if (o.page.is_recipe) return;
    const last = o.blocks[o.blocks.length - 1];
    if (last && last.kind === "text" && !last.text) {
      if (focus) setFocus({ id: last.id, offset: 0 });
    } else if (o.blocks.length === 0) {
      const block = emptyBlock(o.page.id);
      setOpen({ ...o, blocks: [block] });
      if (!o.virtual) enqueue(() => store.insertBlocks([block]));
      if (focus) setFocus({ id: block.id, offset: 0 });
    }
  };
  useEffect(() => {
    prepareStartRef.current = (o) => prepareStart(o, false);
  });

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
    else prepareStart({ page, blocks }, true);
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
      prepareStart({ page, blocks }, false);
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
    setOpen({ page, blocks, alias: cur.virtual.key });
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
      return { ...next, day: targetDay, dated: [moved] };
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
      templates: l.templates.filter((t) => t.id !== id),
    }));
    enqueue(async () => {
      await store.deletePage(id);
      await refreshLists();
    });
    if (openRef.current?.page.id === id) closeOpen();
  };

  /** Pages blocks can be sent to: this week's pages, untouched occurrences, Ongoing, Templates. */
  const loadTargets = useCallback(async (): Promise<PickTarget[]> => {
    const d = dayRef.current;
    const dd = fromISODate(d);
    const to = toISODate(addDays(dd, 7));
    const [pages, undated, templates, repeating] = await Promise.all([
      store.listUpcoming(d, to),
      store.listUndated(),
      store.listTemplates(),
      store.listRepeating(),
    ]);
    const here = openRef.current?.page.id;
    const groupFor = (iso: string) =>
      iso === today ? "Today" : iso === toISODate(addDays(fromISODate(today), 1)) ? "Tomorrow" : forDayLabel(iso);
    const out: PickTarget[] = [
      { key: "new", title: `New page (${groupFor(d).toLowerCase()})`, emoji: "", group: "New", isNew: true },
    ];
    const dated: (PickTarget & { sort: string })[] = [];
    for (const p of pages)
      if (p.id !== here && p.day)
        dated.push({ key: p.id, title: p.title, emoji: p.emoji, group: groupFor(p.day), pageId: p.id, sort: p.day });
    for (const t of repeating)
      for (let n = 0; n <= 7; n++) {
        const day = toISODate(addDays(dd, n));
        if (!occursOn(t.repeat, day) || t.exceptions.some((e) => e.occurrence_day === day)) continue;
        if (openRef.current?.virtual?.templateId === t.id && openRef.current.virtual.day === day) continue;
        dated.push({
          key: virtualId(t.id, day),
          title: t.title,
          emoji: t.emoji,
          group: groupFor(day),
          virtual: { templateId: t.id, day },
          sort: day,
        });
      }
    dated.sort((a, b) => a.sort.localeCompare(b.sort) || a.title.localeCompare(b.title));
    out.push(...dated);
    for (const p of undated)
      if (p.id !== here) out.push({ key: p.id, title: p.title, emoji: p.emoji, group: "Ongoing", pageId: p.id });
    for (const t of templates)
      if (t.id !== here)
        out.push({ key: t.id, title: t.title, emoji: t.emoji, group: "Templates", pageId: t.id, isTemplate: true });
    return out;
  }, [today]);

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
    insertAfter(afterId, kind, text, leadDays) {
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
        lead_days: leadDays ?? (idx >= 0 ? (blocks[idx]?.lead_days ?? 0) : 0),
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
      if (cur?.page.template_id) go({ page: cur.page.template_id, lead: 0 });
    },
    setLead(id, days, wholeSection) {
      ensureReal();
      const cur = openRef.current;
      if (!cur) return;
      const bs = cur.blocks; // position order
      const i = bs.findIndex((b) => b.id === id);
      if (i < 0) return;
      const ids = [id];
      if (wholeSection) {
        // A header carries the blocks under it, up to the next header.
        for (let k = i + 1; k < bs.length && bs[k].kind !== "header"; k++) ids.push(bs[k].id);
      }
      commitBlocks((all) => all.map((b) => (ids.includes(b.id) ? { ...b, lead_days: days } : b)));
      for (const bid of ids) enqueue(() => store.updateBlock(bid, { lead_days: days }));
    },
    deleteBlocks(ids) {
      ensureReal();
      for (const id of ids) {
        const t = textTimers.current.get(id);
        if (t) clearTimeout(t);
        textTimers.current.delete(id);
        pendingText.current.delete(id);
      }
      commitBlocks((bs) => bs.filter((b) => !ids.includes(b.id)));
      enqueue(async () => {
        await store.deleteBlocks(ids);
        await refreshLists();
      });
    },
    transferBlocks(ids, target, mode) {
      const cur = openRef.current;
      if (!cur) return;
      if (mode === "move") ensureReal();
      flushAll();
      const chosen = cur.blocks.filter((b) => ids.includes(b.id)); // position order
      if (!chosen.length) return;
      if (mode === "move") commitBlocks((bs) => bs.filter((b) => !ids.includes(b.id)));
      const n = chosen.length;
      const sourceDay = dayRef.current;
      enqueue(async () => {
        // Resolve the destination: an existing page, a new one, or an occurrence to start.
        let pageId: string;
        let title = target.title;
        if (target.isNew) {
          const page: Page = {
            id: newId(),
            kind: "page",
            day: sourceDay,
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
          await store.createPage(stripCreated(page), []);
          pageId = page.id;
          title = "a new page";
        } else if (target.virtual) {
          const t = await store.getPage(target.virtual.templateId);
          if (!t) throw new Error("That template no longer exists");
          const copy = buildCopy(t, target.virtual.day);
          await store.createPage(stripCreated(copy.page), copy.blocks);
          const res = await store.addException(target.virtual.templateId, target.virtual.day, copy.page.id);
          if (res === "exists") {
            const ex = await store.getException(target.virtual.templateId, target.virtual.day);
            await store.deletePage(copy.page.id);
            if (!ex?.page_id) throw new Error("That occurrence was skipped meanwhile");
            pageId = ex.page_id;
          } else pageId = copy.page.id;
        } else {
          pageId = target.pageId!;
        }
        const dest = await store.getPage(pageId);
        const last = dest?.blocks.length ? dest.blocks[dest.blocks.length - 1].position : 0;
        const rows: Block[] = chosen.map((b, i) => ({
          ...b,
          id: mode === "copy" ? newId() : b.id,
          page_id: pageId,
          position: last + i + 1,
          done: target.isTemplate ? false : b.done, // templates start clean
        }));
        await store.insertBlocks(rows); // upsert: a move rewrites the same ids under the new page
        await refreshLists();
        showToast(`${mode === "move" ? "Moved" : "Copied"} ${n} block${n === 1 ? "" : "s"} to ${title || "Untitled"}`, pageId);
      });
    },
    moveBlock(id, dir) {
      ensureReal();
      const cur = openRef.current;
      if (!cur) return false;
      const bs = cur.blocks;
      const i = bs.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= bs.length) return false;
      // Slot in on the far side of the neighbour we're swapping with.
      const position =
        dir < 0
          ? positionBetween(bs[j - 1]?.position, bs[j].position)
          : positionBetween(bs[j].position, bs[j + 1]?.position);
      commitBlocks((all) => all.map((b) => (b.id === id ? { ...b, position } : b)));
      enqueue(() => store.updateBlock(id, { position }));
      return true;
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
          openId={lead > 0 && pageId ? prepId(pageId, lead) : pageId}
          empty={lists.day === day ? "Nothing planned for this day." : ""}
          onBlank={() => createBlank(day)}
          onFromTemplate={(tid) => createFromTemplate(tid, day)}
          onEditTemplate={(tid) => go({ page: tid })}
          onCreateTemplate={createTemplate}
          onOpen={(id, l) => go({ page: id, lead: l ?? 0 })}
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
          onOpen={(id, l) => go({ page: id, lead: l ?? 0 })}
          onMove={movePageById}
          onDelete={deletePageById}
          today={today}
        />

        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2>
              <button
                type="button"
                className={styles.collapseBtn}
                onClick={toggleTemplates}
                aria-expanded={templatesOpen}
              >
                Templates
                <span className={styles.chev} aria-hidden="true">
                  {templatesOpen ? "▾" : "▸"}
                </span>
              </button>
            </h2>
            <NewPageMenu
              mode="template"
              label="New template"
              today={today}
              loadTemplates={loadTemplates}
              onBlank={() => {}}
              onFromTemplate={(tid) => createFromTemplate(tid, day)}
              onEditTemplate={(tid) => go({ page: tid })}
              onCreateTemplate={createTemplate}
            />
          </header>
          {templatesOpen &&
            (lists.templates.length === 0 ? (
              <p className={styles.empty}>No templates yet. Add one with +.</p>
            ) : (
              <ul className={styles.list}>
                {lists.templates.map((t) => {
                  const label = `${t.emoji} ${t.title}`.trim();
                  return (
                    <li key={t.id} className={`${styles.item} ${t.id === pageId ? styles.itemOn : ""}`}>
                      <button
                        type="button"
                        className={styles.itemMain}
                        onClick={() => go({ page: t.id, lead: 0 })}
                      >
                        <span className={styles.itemEmoji}>{t.emoji || "📄"}</span>
                        <span className={styles.itemBody}>
                          <span className={`${styles.itemTitle} ${t.title ? "" : styles.untitled}`}>
                            {t.title || "Untitled"}
                          </span>
                          {(t.repeat || t.is_recipe) && (
                            <span className={styles.itemMeta}>
                              {t.repeat && <span>↻ {summary(t.repeat)}</span>}
                              {t.is_recipe && <span>Recipe</span>}
                            </span>
                          )}
                        </span>
                      </button>
                      <PageMenu
                        currentDay={null}
                        canMove={false}
                        onMove={() => {}}
                        onDelete={() => deletePageById(t.id, label, Boolean(t.repeat))}
                        align="right"
                        label={`Menu for template ${label || "Untitled"}`}
                      />
                    </li>
                  );
                })}
              </ul>
            ))}
        </section>

        <div className={styles.sideFoot}>
          <span className={styles.status}>
            <span className={`${styles.dot} ${dotClass}`} />
            {statusText}
          </span>
          <Link href="/">Staff tools</Link>
        </div>
      </aside>

      <main className={styles.main}>
        {toast && (
          <div className={styles.toast} role="status">
            <span>{toast.msg}</span>
            {toast.page && (
              <button
                type="button"
                onClick={() => {
                  setToast(null);
                  go({ page: toast.page, lead: 0 });
                }}
              >
                Open
              </button>
            )}
          </div>
        )}
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
            lead={lead}
            onOpenMain={() => go({ lead: 0 })}
            loadTargets={loadTargets}
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
  onOpen: (id: string, lead?: number) => void;
  today: string;
  onMove: (id: string, day: string | null) => void;
  onDelete: (id: string, label: string) => void;
};

const forDayLabel = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

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
            if (p.prep) {
              const { prep } = p;
              return (
                <li
                  key={p.id}
                  className={`${styles.item} ${styles.itemPrep} ${p.id === openId ? styles.itemOn : ""} ${
                    p.virtual ? styles.itemVirtual : ""
                  }`}
                >
                  <button
                    type="button"
                    className={styles.itemMain}
                    onClick={() => onOpen(prep.open, prep.leadDays)}
                    title={`Prep for ${forDayLabel(prep.forDay)}'s ${p.title || "Untitled"}`}
                  >
                    <span className={styles.itemEmoji}>{p.emoji || "📄"}</span>
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitle}>
                        {p.virtual && <span className={styles.virtIcon}>↻</span>}
                        {prep.label}
                      </span>
                      <span className={styles.itemMeta}>
                        <span>
                          for {forDayLabel(prep.forDay)} · {p.title || "Untitled"}
                        </span>
                        {p.todo_total > 0 && (
                          <span className={p.todo_done === p.todo_total ? styles.metaDone : ""}>
                            {p.todo_done}/{p.todo_total}
                          </span>
                        )}
                      </span>
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
                </li>
              );
            }
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
                  onClick={() => onOpen(p.id, 0)}
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
