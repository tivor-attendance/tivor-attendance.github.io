export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.ENABLE_CRON === "false") return;
  const cron = (await import("node-cron")).default;
  const { runDailyJob } = await import("./lib/jobs");

  const run = () =>
    runDailyJob()
      .then((r) => console.info(`[cron] daily attendance ${r.date}: ${r.inserted} records created`))
      .catch((e) => console.error("[cron] daily attendance failed", e));

  cron.schedule("5 0 * * *", run, { timezone: "Asia/Kolkata" });
  // Catch up on startup in case the server was down at 00:05.
  setTimeout(run, 5_000);
}
