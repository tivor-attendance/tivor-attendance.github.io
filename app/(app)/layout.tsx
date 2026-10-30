import { TopNav } from "@/components/top-nav";
import { AuthGate } from "@/components/auth-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="min-h-screen">
        <TopNav />
        <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">{children}</main>
      </div>
    </AuthGate>
  );
}
