import Image from "next/image";
import logo from "@/public/tivor-logo.png";
import { cn } from "@/lib/utils";

export const COMPANY = "Tivor – Altiq";

export function TivorLogo({ size = 28, className }: { size?: number; className?: string }) {
  return <Image src={logo} alt="Tivor – Altiq" width={size} height={size} priority className={cn("select-none dark:invert", className)} />;
}
