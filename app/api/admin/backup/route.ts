import { gzipSync } from "node:zlib";
import { fileResponse, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fullBackup } from "@/lib/backup";
import { todayIST } from "@/lib/dates";

export const GET = route(async (req) => {
  const user = await requireUser(req, "backup:export");
  const data = await fullBackup();
  await audit(prisma, user, [{ entity: "System", action: "BACKUP_EXPORT" }]);
  return fileResponse(gzipSync(JSON.stringify(data)), `attendance-backup-${todayIST()}.json.gz`, "application/gzip");
});
