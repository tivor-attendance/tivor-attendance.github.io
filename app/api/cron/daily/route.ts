import { NextResponse, type NextRequest } from "next/server";
import { runDailyJob } from "@/lib/jobs";

/** For external schedulers (Vercel Cron etc.): `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDailyJob());
}
