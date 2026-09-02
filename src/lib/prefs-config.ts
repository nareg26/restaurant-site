/* The round of open shifts being voted on. Edit this when a new round opens. */

export const WANT_BUDGET = 10; // points each person can spend
export const PER_SLOT_MAX = 5; // max points on a single slot

export type Day = { id: string; label: string; short: string };
export type Slot = { id: string; day: string; label: string; dur: string; need: number; note?: string };
export type MarkKind = "want" | "fine" | "no" | "cant";

export const DAYS: Day[] = [
  { id: "mon", label: "Monday 7 Sept", short: "Mon" },
  { id: "tue", label: "Tuesday 8 Sept", short: "Tue" },
  { id: "wed", label: "Wednesday 9 Sept", short: "Wed" },
  { id: "thu", label: "Thursday 10 Sept", short: "Thu" },
  { id: "fri", label: "Friday 11 Sept", short: "Fri" },
  { id: "sat", label: "Saturday 12 Sept", short: "Sat" },
];

export const SLOTS: Slot[] = [
  { id: "mon-m", day: "mon", label: "10–15h", dur: "5h", need: 1, note: "overlaps 14–17h" },
  { id: "mon-a", day: "mon", label: "14–17h", dur: "3h", need: 1 },
  { id: "mon-b", day: "mon", label: "17–20h", dur: "3h", need: 1 },
  { id: "tue-a", day: "tue", label: "14–17h", dur: "3h", need: 1 },
  { id: "tue-c", day: "tue", label: "15–20h", dur: "5h", need: 1, note: "overlaps the other two" },
  { id: "tue-b", day: "tue", label: "17–20h", dur: "3h", need: 1 },
  { id: "wed-m", day: "wed", label: "10–15h", dur: "5h", need: 1, note: "overlaps 14–17h" },
  { id: "wed-a", day: "wed", label: "14–17h", dur: "3h", need: 1 },
  { id: "wed-b", day: "wed", label: "17–20h", dur: "3h", need: 1 },
  { id: "thu-a", day: "thu", label: "14–17h", dur: "3h", need: 1 },
  { id: "thu-b", day: "thu", label: "17–20h", dur: "3h", need: 1 },
  { id: "fri-a", day: "fri", label: "14–17h", dur: "3h", need: 1 },
  { id: "fri-b", day: "fri", label: "17–20h", dur: "3h", need: 1 },
  { id: "sat-m", day: "sat", label: "9–14h", dur: "5h", need: 1 },
  { id: "sat-n", day: "sat", label: "10–15h", dur: "5h", need: 1, note: "overlaps 9–14h" },
  { id: "sat-a", day: "sat", label: "14–17h", dur: "3h", need: 1 },
  { id: "sat-b", day: "sat", label: "17–20h", dur: "3h", need: 2, note: "two people needed" },
];

export const MARKS: { k: MarkKind; label: string }[] = [
  { k: "want", label: "Want" },
  { k: "fine", label: "Fine" },
  { k: "no", label: "Rather not" },
  { k: "cant", label: "Can't" },
];
