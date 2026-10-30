import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function maskValue(v: string | null | undefined, visible = 4): string | null {
  if (!v) return null;
  if (v.length <= visible) return "•".repeat(v.length);
  return "•".repeat(Math.max(4, v.length - visible)) + v.slice(-visible);
}

export function formatINR(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
