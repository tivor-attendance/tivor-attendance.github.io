"use client";

import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusDef } from "@/lib/status";

type Variant = "primary" | "ghost" | "outline" | "accent" | "danger";
type Size = "sm" | "md" | "icon";

/** Material-style ripple from the click point. */
export function addRipple(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) / 2;
  const span = document.createElement("span");
  span.className = "ripple";
  span.style.width = span.style.height = `${size}px`;
  span.style.left = `${e.clientX - rect.left - size / 2}px`;
  span.style.top = `${e.clientY - rect.top - size / 2}px`;
  el.appendChild(span);
  setTimeout(() => span.remove(), 600);
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }>(
  function Button({ className, variant = "primary", size = "md", loading, disabled, children, onClick, ...props }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        onClick={(e) => { addRipple(e); onClick?.(e); }}
        className={cn(
          "relative inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-lg font-medium transition-all duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] whitespace-nowrap",
          size === "sm" && "h-8 px-3 text-[13px]",
          size === "md" && "h-9 px-3.5 text-sm",
          size === "icon" && "h-9 w-9",
          variant === "primary" && "bg-primary text-primary-fg shadow-soft hover:opacity-90",
          variant === "ghost" && "text-fg-2 hover:bg-subtle hover:text-fg",
          variant === "outline" && "border border-border-strong bg-card text-fg-2 shadow-soft hover:bg-subtle hover:text-fg",
          variant === "accent" && "bg-primary text-primary-fg hover:opacity-90",
          variant === "danger" && "bg-danger text-white hover:opacity-90",
          className,
        )}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  },
);

const fieldCls = "h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm text-fg shadow-soft outline-none transition placeholder:text-muted focus:border-fg/40 focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(fieldCls, className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cn(fieldCls, "cursor-pointer pr-8", className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(fieldCls, "h-auto min-h-20 py-2", className)} {...p} />;
});

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-[13px] font-medium text-fg-2">{label}</span>
      {children}
      {error ? <span className="block animate-slide-down text-xs text-danger">{error}</span> : hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-card shadow-soft", className)} {...p}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, className, tone = "neutral" }: { children: ReactNode; className?: string; tone?: "neutral" | "accent" | "success" | "warning" | "danger" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
      tone === "neutral" && "border bg-subtle text-fg-2",
      tone === "accent" && "bg-primary text-primary-fg",
      tone === "success" && "st st-P",
      tone === "warning" && "st st-HD",
      tone === "danger" && "st st-AB",
      className,
    )}>{children}</span>
  );
}

export function StatusChip({ def, code, className }: { def?: StatusDef; code: string; className?: string }) {
  return (
    <span className={cn("st inline-flex min-w-8 items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold", `st-${code}`, className)} title={def?.label}>
      {code}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-lg", className)} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex animate-fade-up flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
      {icon && <div className="mb-2 rounded-xl border bg-subtle p-2.5 text-fg-2">{icon}</div>}
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/40 p-0 backdrop-blur-[3px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={cn("max-h-[92vh] w-full animate-scale-in overflow-hidden rounded-t-2xl border bg-raised shadow-pop sm:rounded-xl", wide ? "sm:max-w-3xl" : "sm:max-w-md")}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm disabled:opacity-50">
      <span className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-primary" : "bg-border-strong")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-4.5" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto scrollbar-thin", className)}>
      <table className="w-full text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted [&_thead]:border-b [&_thead]:bg-subtle [&_tbody_tr]:border-b [&_tbody_tr:last-child]:border-0 [&_tbody_tr:hover]:bg-subtle/60">
        {children}
      </table>
    </div>
  );
}

export function Stat({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{label}</p>
        {icon && <div className="rounded-lg border bg-subtle p-1.5">{icon}</div>}
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </Card>
  );
}
