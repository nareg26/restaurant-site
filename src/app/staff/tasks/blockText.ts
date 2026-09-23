/*
 * The bridge between a block's stored text (a plain string that may contain
 * [[ing:id|name]] tokens) and its contentEditable DOM (text nodes plus
 * non-editable pill spans). Every offset the editor reasons about is a
 * "model" offset into the stored string; these helpers translate.
 */

import type { RecipeRow } from "@/lib/tasks-store";
import { pillLabel, segments } from "@/lib/tasks-recipe";
import styles from "./tasks.module.css";

const ZWSP = "\u200B";
const clean = (s: string) => s.replace(/\u200B/g, "");

const isPill = (n: Node): n is HTMLElement =>
  n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).dataset.token !== undefined;

/** A string that changes whenever the rendered DOM would. */
export function renderKey(text: string, rows: RecipeRow[], scale: number): string {
  return segments(text)
    .map((s) => (s.kind === "text" ? s.text : ` ${pillLabel(s, rows, scale).label} `))
    .join("");
}

/** Replace the element's children with the rendering of `text`. */
export function render(el: HTMLElement, text: string, rows: RecipeRow[], scale: number) {
  const nodes: Node[] = [];
  const segs = segments(text);
  for (const s of segs) {
    if (s.kind === "text") {
      nodes.push(document.createTextNode(s.text));
    } else {
      const { label, missing } = pillLabel(s, rows, scale);
      const span = document.createElement("span");
      span.className = `${styles.pill} ${missing ? styles.pillMissing : ""}`;
      span.contentEditable = "false";
      span.dataset.token = s.token;
      span.textContent = label;
      nodes.push(span);
    }
  }
  // A caret can't sit after a trailing non-editable span in every browser,
  // and a trailing newline (Shift+Enter at the end) renders no empty line to
  // put it on; a zero-width space gives it somewhere to be. Stripped on serialize.
  if ((segs.length && segs[segs.length - 1].kind === "ing") || text.endsWith("\n"))
    nodes.push(document.createTextNode(ZWSP));
  el.replaceChildren(...nodes);
}

const nodeModelLength = (n: Node, isLast: boolean): number => {
  if (isPill(n)) return n.dataset.token!.length;
  if (n.nodeType === Node.TEXT_NODE) return clean(n.textContent ?? "").length;
  if (n.nodeName === "BR") return isLast ? 0 : 1;
  return clean(n.textContent ?? "").length;
};

/** DOM → stored text. */
export function serialize(el: HTMLElement): string {
  let out = "";
  const kids = Array.from(el.childNodes);
  kids.forEach((n, i) => {
    if (isPill(n)) out += n.dataset.token;
    else if (n.nodeType === Node.TEXT_NODE) out += clean(n.textContent ?? "");
    else if (n.nodeName === "BR") out += i === kids.length - 1 ? "" : "\n";
    else out += clean(n.textContent ?? "");
  });
  return out;
}

/** Model offset of the selection start (0 if the selection isn't in `el`). */
export function modelOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return 0;
  const kids = Array.from(el.childNodes);
  if (r.startContainer === el) {
    let acc = 0;
    for (let i = 0; i < r.startOffset && i < kids.length; i++)
      acc += nodeModelLength(kids[i], i === kids.length - 1);
    return acc;
  }
  let acc = 0;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n === r.startContainer || n.contains(r.startContainer)) {
      if (isPill(n)) return acc + n.dataset.token!.length; // inside a pill counts as after it
      if (n.nodeType === Node.TEXT_NODE)
        return acc + clean((n.textContent ?? "").slice(0, r.startOffset)).length;
      const pre = r.cloneRange();
      pre.selectNodeContents(n);
      pre.setEnd(r.startContainer, r.startOffset);
      return acc + clean(pre.toString()).length;
    }
    acc += nodeModelLength(n, i === kids.length - 1);
  }
  return acc;
}

export function hasSelection(): boolean {
  const sel = window.getSelection();
  return Boolean(sel && sel.rangeCount && !sel.getRangeAt(0).collapsed);
}

/** Place the caret at a model offset (snapping to after a pill if inside one). */
export function setCaretModel(el: HTMLElement, offset: number | "end") {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const kids = Array.from(el.childNodes);
  let placed = false;
  if (offset !== "end") {
    let acc = 0;
    for (let i = 0; i < kids.length && !placed; i++) {
      const n = kids[i];
      const len = nodeModelLength(n, i === kids.length - 1);
      if (isPill(n)) {
        if (offset === acc) {
          range.setStart(el, i);
          placed = true;
        } else if (offset <= acc + len) {
          const next = kids[i + 1];
          if (next && next.nodeType === Node.TEXT_NODE) {
            const raw = next.textContent ?? "";
            range.setStart(next, raw.startsWith(ZWSP) ? 1 : 0);
          } else range.setStart(el, i + 1);
          placed = true;
        }
      } else if (n.nodeType === Node.TEXT_NODE) {
        if (offset <= acc + len) {
          // Map the clean offset back onto the raw string, skipping ZWSPs.
          const raw = n.textContent ?? "";
          let want = offset - acc;
          let idx = 0;
          while (idx < raw.length && want > 0) {
            if (raw[idx] !== ZWSP) want--;
            idx++;
          }
          while (raw[idx] === ZWSP) idx++;
          range.setStart(n, idx);
          placed = true;
        }
      }
      acc += len;
    }
  }
  if (!placed) {
    range.selectNodeContents(el);
    range.collapse(false);
  } else range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** The pill immediately before a collapsed caret, if any. */
export function pillBeforeCaret(el: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.getRangeAt(0).collapsed) return null;
  const r = sel.getRangeAt(0);
  let node: Node | null = null;
  if (r.startContainer === el) node = el.childNodes[r.startOffset - 1] ?? null;
  else if (r.startContainer.nodeType === Node.TEXT_NODE) {
    const before = (r.startContainer.textContent ?? "").slice(0, r.startOffset);
    if (clean(before).length === 0) node = r.startContainer.previousSibling;
  }
  return node && isPill(node) ? node : null;
}
