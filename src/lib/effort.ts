import type { EffortLevel } from "./types";

export const EFFORT_LEVELS: {
  key: EffortLevel;
  label: string;
  order: number;
  color: string;
  bg: string;
}[] = [
  { key: "15min", label: "15 minutes", order: 0, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
  { key: "1hr", label: "1 hour", order: 1, color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
  { key: "4hr", label: "4 hours", order: 2, color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
  { key: "8hr", label: "8 hours", order: 3, color: "text-orange-700", bg: "bg-orange-50 border-orange-200" },
  { key: "1-3days", label: "1–3 days", order: 4, color: "text-rose-700", bg: "bg-rose-50 border-rose-200" },
];

export function effortMeta(key: EffortLevel) {
  return EFFORT_LEVELS.find((e) => e.key === key) ?? EFFORT_LEVELS[0];
}

export function effortLabel(key: EffortLevel): string {
  return effortMeta(key).label;
}

export function effortOrder(key: EffortLevel): number {
  return effortMeta(key).order;
}
