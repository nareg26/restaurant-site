/* Settings for the preferences round. The shifts themselves are no longer
 * here — they live in the `pref_slots` table and are set up each week from
 * /admin/preferences. See prefs-slots.ts. */

export const WANT_BUDGET = 10; // points each person can spend
export const PER_SLOT_MAX = 5; // max points on a single slot

export type MarkKind = "want" | "fine" | "no" | "cant";

export const MARKS: { k: MarkKind; label: string }[] = [
  { k: "want", label: "Want" },
  { k: "fine", label: "Fine" },
  { k: "no", label: "Rather not" },
  { k: "cant", label: "Can't" },
];
