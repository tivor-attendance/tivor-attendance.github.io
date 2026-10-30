"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { DatabaseBackup, LogOut, Moon, Sun, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOCAL_MODE, saveBlob } from "@/lib/client";
import { logout } from "@/lib/admin-auth";
import { todayIST } from "@/lib/dates";
import { useConfirm } from "./confirm";
import { COMPANY, TivorLogo } from "./brand";

const LINKS = [
  { href: "/", label: "Attendance" },
  { href: "/report", label: "Report" },
  { href: "/holidays", label: "Holidays" },
  { href: "/payroll", label: "Payroll" },
];

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* storage unavailable */ }
    setDark(next);
  };
  return { dark, toggle };
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const { dark, toggle } = useTheme();

  const activeIdx = LINKS.findIndex((l) => (l.href === "/" ? pathname === "/" : pathname.startsWith(l.href)));

  // Sliding active pill behind the current tab.
  useLayoutEffect(() => {
    const el = navRef.current?.querySelectorAll<HTMLElement>("[data-tab]")[activeIdx];
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeIdx]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const backup = async () => {
    const { exportDb } = await import("@/lib/local-api");
    saveBlob(new Blob([exportDb()], { type: "application/json" }), `tivor-altiq-attendance-${todayIST()}.json`);
    toast.success("Backup downloaded");
  };
  const restore = async (file: File | undefined) => {
    if (!file) return;
    if (!(await confirm({ title: "Restore from backup?", body: "This replaces all attendance, employees, holidays and salaries with the backup file — on every device.", danger: true, confirmLabel: "Restore" }))) return;
    try {
      const { importDb } = await import("@/lib/local-api");
      await importDb(await file.text());
      toast.success("Backup restored");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const iconBtn = "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition duration-200 hover:bg-subtle hover:text-fg active:scale-90";

  return (
    <header className={cn("sticky top-0 z-40 border-b bg-bg/80 backdrop-blur-xl transition-shadow duration-300", scrolled ? "shadow-[0_6px_20px_-12px_rgb(0_0_0/0.25)]" : "border-transparent")}>
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <TivorLogo size={24} className="animate-logo-in transition-transform duration-500 group-hover:rotate-[120deg]" />
          <span className="hidden leading-tight sm:block">
            <span className="block text-[14px] font-semibold tracking-tight">{COMPANY}</span>
            <span className="block text-[11px] text-muted">Attendance</span>
          </span>
        </Link>

        <nav ref={navRef} className="relative flex items-center gap-1">
          {pill && (
            <span className="absolute inset-y-0 rounded-lg border border-border-strong bg-subtle transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
              style={{ left: pill.left, width: pill.width }} />
          )}
          {LINKS.map((l, i) => (
            <Link key={l.href} href={l.href} data-tab
              className={cn("relative z-10 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-200",
                i === activeIdx ? "text-fg" : "text-muted hover:text-fg")}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-0.5">
          {LOCAL_MODE && (
            <>
              <button onClick={backup} className={iconBtn} title="Download backup" aria-label="Download backup"><DatabaseBackup className="h-4 w-4" /></button>
              <button onClick={() => fileRef.current?.click()} className={iconBtn} title="Restore backup" aria-label="Restore backup"><Upload className="h-4 w-4" /></button>
              <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ""; }} />
            </>
          )}
          <button onClick={toggle} className={iconBtn} title={dark ? "Light mode" : "Dark mode"} aria-label="Toggle dark mode">
            <span key={dark ? "d" : "l"} className="inline-flex animate-logo-in">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</span>
          </button>
          <span className="mx-1.5 h-5 w-px bg-border" />
          <button onClick={() => { logout(); router.replace("/login"); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-fg-2 transition hover:bg-subtle hover:text-fg active:scale-95" title="Sign out">
            <LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
