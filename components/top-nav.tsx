"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck2, DatabaseBackup, LogOut, Moon, Sun, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOCAL_MODE, saveBlob } from "@/lib/client";
import { logout } from "@/lib/admin-auth";
import { todayIST } from "@/lib/dates";
import { useConfirm } from "./confirm";

const LINKS = [
  { href: "/", label: "Attendance" },
  { href: "/report", label: "Report" },
  { href: "/holidays", label: "Holidays" },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* storage unavailable */ }
    setDark(next);
  };

  const backup = async () => {
    const { exportDb } = await import("@/lib/local-api");
    saveBlob(new Blob([exportDb()], { type: "application/json" }), `attendance-backup-${todayIST()}.json`);
    toast.success("Backup downloaded");
  };
  const restore = async (file: File | undefined) => {
    if (!file) return;
    if (!(await confirm({ title: "Restore from backup?", body: "This replaces all attendance, employees and holidays in this browser with the backup file.", danger: true, confirmLabel: "Restore" }))) return;
    try {
      const { importDb } = await import("@/lib/local-api");
      importDb(await file.text());
      toast.success("Backup restored");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const iconBtn = "rounded-lg p-2 text-muted transition hover:bg-subtle hover:text-fg";

  return (
    <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-fg shadow-sm"><CalendarCheck2 className="h-4 w-4" /></div>
          <span className="hidden font-display text-[15px] font-semibold tracking-tight sm:inline">Attendance</span>
        </Link>
        <nav className="flex h-full items-stretch gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href}
                className={cn("relative flex items-center px-2.5 text-sm font-medium transition-colors sm:px-3", active ? "text-fg" : "text-muted hover:text-fg")}>
                {l.label}
                <span className={cn("absolute inset-x-2 -bottom-px h-0.5 origin-center rounded-full bg-fg transition-transform duration-300", active ? "scale-x-100" : "scale-x-0")} />
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {LOCAL_MODE && (
            <>
              <button onClick={backup} className={iconBtn} title="Download backup" aria-label="Download backup"><DatabaseBackup className="h-4 w-4" /></button>
              <button onClick={() => fileRef.current?.click()} className={iconBtn} title="Restore backup" aria-label="Restore backup"><Upload className="h-4 w-4" /></button>
              <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ""; }} />
            </>
          )}
          <button onClick={toggle} className={iconBtn} aria-label="Toggle dark mode">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
          <button onClick={() => { logout(); router.replace("/login"); }} className={cn(iconBtn, "flex items-center gap-1.5 text-sm")} title="Sign out">
            <LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
