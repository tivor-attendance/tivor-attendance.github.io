# Attendance Management System

Payroll-ready attendance for small and mid-size teams. It works on exceptions only: every working day is pre-filled as **Present**, Sundays as **Weekly Off**, and public holidays as **Holiday**. HR only records the exceptions (absences, leave, half days). The month can then be locked and exported for payroll.

**Stack:** Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · PostgreSQL + Prisma 7 · NextAuth (credentials, bcrypt) · Zod · TanStack Virtual · Recharts · ExcelJS · PDFKit · node-cron · Vitest

All dates are handled in **Asia/Kolkata (IST)**. Attendance days are stored as Postgres `DATE`, so they never drift across timezones.

---

## Quick start (Docker)

```bash
cp .env.example .env            # then set NEXTAUTH_SECRET (openssl rand -base64 32)
docker compose up -d --build
```

Open <http://localhost:3000>. On start, the container applies migrations and runs the seed. The seed is idempotent, so restarting is safe.

## Local development

Requirements: Node 20+ and PostgreSQL 14+.

```bash
npm install                     # also runs `prisma generate`
cp .env.example .env            # set DATABASE_URL and NEXTAUTH_SECRET
npx prisma migrate deploy       # or: npm run db:migrate (dev)
npm run db:seed
npm run dev
```

To get a throwaway database: `docker run -d -p 5432:5432 -e POSTGRES_USER=attendance -e POSTGRES_PASSWORD=attendance -e POSTGRES_DB=attendance postgres:16-alpine`

### Default login

| Email | Password |
|---|---|
| `admin@company.local` | `Admin@12345` |

You must change the password the first time you log in. You can override both values with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` before seeding.

The seed also creates:
- employees **EMP001–EMP010**: Uday Vamsi, Dinesh, Adhithya, Abinaya, Kamalam Krishnan, Priyanka, Pranay V, Harshan, Yashwanth, John Bellarmine. Each has a joining date of 1 January of the current year and default leave allotments.
- three fixed national holidays (26 Jan, 15 Aug, 2 Oct).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit tests (paid days/LOP, holiday & weekly-off rules, daily generation, lock rules, leave deltas) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` / `db:deploy` / `db:seed` | Prisma |
| `npm run jobs:daily` | Run the daily attendance job once |
| `npm run backup` | Write a gzipped JSON backup to `BACKUP_DIR` (30-day retention) |

---

## How it works

### Daily automation
- `instrumentation.ts` schedules `runDailyJob()` at **00:05 IST**. It also runs once at startup, to catch up if the server was down.
- The job inserts default records for every employed day, from the start of the previous month up to today, using `ON CONFLICT DO NOTHING`. Because of this it **never overwrites** an existing record, AUTO or MANUAL. Locked months are skipped.
- Opening any month in the grid also backfills missing days up to today.
- On serverless hosts, set `ENABLE_CRON=false` and point the platform's scheduler (for example Vercel Cron) at `GET /api/cron/daily` with `Authorization: Bearer $CRON_SECRET`.

### Default status rules (`lib/calendar.ts`)
The rules are applied in this order:
1. Before joining or after exit → `NA` (not counted)
2. Working-day override → `P` (working) or `WO` (day off)
3. Holiday → `H`
4. Weekly off (Sunday; optionally 2nd & 4th or all Saturdays) → `WO`
5. Otherwise → `P`

When a holiday, override, weekly-off policy, or joining/exit date changes, only **AUTO** cells are recalculated. Cells HR edited by hand are never touched, and every recalculation is written to the audit log.

### Attendance grid
- **Click** a cell to pick a status. **Drag** to select a range, then pick one status for all of it.
- **Keyboard:** arrows move between cells (Shift extends the selection). Letter keys apply a status: `P` Present, `A` Absent, `H` Half Day, `C`/`S`/`E` CL/SL/EL, `L` LOP, `W` WFH, `O` OD. Tab or Enter moves on, Delete resets to the default, Space opens the picker, and Ctrl+Z / Ctrl+Y undo and redo.
- **Row ⋯ menu:** mark the whole month as a status, or reset the row. **Date header:** mark everyone for that day. **Checkboxes + bulk bar:** apply a status to a date range for the selected employees.
- Every change saves automatically and shows on screen immediately. If a save fails, the change is reverted and an error toast appears.
- Cells edited by hand have a violet corner mark. Cells with a remark have an amber dot.
- Future dates are greyed out and accept planned leave only. On mobile, the grid becomes a list for one day at a time.

### Payroll
- `LOP days = Σ(1 − paid fraction)` over counted days, which with the default codes equals `A + LOP + 0.5 × HD`.
- **Calendar basis:** `Paid days = (days in month − NA) − LOP days` and `per-day = gross ÷ days in month`.
- **Working basis:** `Paid days = (company working days employed) − LOP days` and `per-day = gross ÷ company working days`.
- `Payable = per-day × paid days`, capped at gross. Mid-month joiners and leavers are pro-rated automatically.
- **Month lock:** HR or Admin can lock a month. You are warned if the month isn't over yet, or if some days contain only automatic data. A locked month is read-only for everyone, holiday changes to it are rejected, and recalculations skip it. Only an Admin can unlock, and must give a reason. Locks and unlocks are recorded in the lock history and the audit log.

### Status codes
You can configure status codes under **Settings → Status codes**: label, colors, paid fraction, whether the day counts toward payroll, which leave balance it deducts, keyboard shortcut, whether it can be planned for future dates, and which summary column it appears in. The built-in codes (P, A, HD, H, WO, NA) can be restyled but not removed.

### Leave balances
Leave balances change in the **same database transaction** as the attendance edit, for example P→CL uses one CL day and CL→P returns it. Negative balances produce a warning by default. Turn off "Allow leave beyond balance" to block them instead.

### Security
- Every API route re-reads the user from the database and checks permissions server-side (`lib/api.ts`, `lib/permissions.ts`). `proxy.ts` only handles redirects.
- **Roles:** **Admin** can do everything. **HR** manages attendance, employees, holidays, reports and month locking, but sees salary and bank data only if an Admin grants it. **Manager/Viewer** are read-only.
- Salary, bank account, IFSC, PAN and UAN are masked for anyone without permission, both in API responses and in the audit log.
- Login is rate-limited to 5 attempts per 15 minutes per IP and email.
- Sessions are JWTs that expire after `SESSION_MAX_AGE` (8 hours by default). Users are signed out after `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES` of inactivity.
- **Password reset:** users can request an emailed link (valid 1 hour, single use). If SMTP is not configured, the link is written to the server log. An Admin can also set a temporary password, which forces a change at the next login.
- **Database guards** in the migration: `audit_logs` is append-only (UPDATE and DELETE are blocked by a trigger), deleting from `attendance_records` or `employees` is blocked, and only one active lock per month is allowed.

### Backups
- **Admin → Settings → Backup → Export full backup** downloads every table as gzipped JSON (password hashes excluded).
- The `db-backup` service in Docker Compose runs `pg_dump -Fc` nightly at 01:00 IST into `./backups` and keeps 14 days. To restore: `pg_restore -h <host> -U attendance -d attendance --clean attendance-YYYYMMDD.dump`.
- `npm run backup` gives a JSON backup for cron or Task Scheduler on non-Docker installs.

### Employee import
On **Employees → Import**, download the template, fill it in, and choose **Validate** to check it. Errors are listed per row, and the import is all-or-nothing. Leave Employee ID blank to auto-generate it, and use `Reporting Manager Emp ID` to link managers, including employees in the same file.

---

## Project layout

```
app/(auth)/          login, forgot/reset/change password
app/(app)/           dashboard, attendance, employees, holidays, payroll, reports, audit, settings
app/api/             REST route handlers (Zod-validated, permission-checked)
components/          UI kit, app shell, attendance grid, employee form
lib/                 domain logic: calendar, payroll, leave, attendance service, holidays, employees, exports
prisma/              schema, migrations (with integrity triggers), seed
scripts/             daily job & backup CLIs
tests/               Vitest unit tests
proxy.ts             auth redirects (Next 16 "proxy", formerly middleware)
instrumentation.ts   in-process daily cron
```

## Deploying
- **Docker / VM** (recommended, because it keeps the in-process cron): `docker compose up -d --build` behind a TLS reverse proxy. Set `NEXTAUTH_URL` to the public URL.
- **Vercel or other serverless:** use a managed Postgres, run `npx prisma migrate deploy && npm run db:seed` once, set `ENABLE_CRON=false`, and add a cron that calls `/api/cron/daily` at `35 18 * * *` UTC (00:05 IST) with the bearer secret.
- The login rate limiter is in-memory and applies per instance. If you run several replicas, back it with Redis.
