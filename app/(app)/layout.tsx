import { TopNav } from "@/components/top-nav";
import { AuthGate } from "@/components/auth-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="min-h-screen">
        <TopNav />
        <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
    </AuthGate>
  );
}
