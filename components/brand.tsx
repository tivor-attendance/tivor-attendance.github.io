import Image from "next/image";
import logo from "@/public/tivor-logo.png";
import { cn } from "@/lib/utils";

export function TivorLogo({ size = 28, className }: { size?: number; className?: string }) {
  return <Image src={logo} alt="Tivor" width={size} height={size} priority className={cn("select-none", className)} />;
}
