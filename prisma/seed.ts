import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { DEFAULT_SETTINGS } from "../lib/settings-types";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const EMPLOYEES = [
  "Uday Vamsi", "Dinesh", "Adhithya", "Abinaya", "Kamalam Krishnan",
  "Priyanka", "Pranay V", "Harshan", "Yashwanth", "John Bellarmine",
];

const istYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date()));
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@company.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: "Administrator", email, passwordHash: await bcrypt.hash(password, 12), role: "ADMIN", mustChangePassword: true, canViewSensitive: true },
  });

  await prisma.setting.upsert({ where: { key: "app" }, update: {}, create: { key: "app", value: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) } });

  for (const [i, name] of EMPLOYEES.entries()) {
    const empCode = `EMP${String(i + 1).padStart(3, "0")}`;
    const emp = await prisma.employee.upsert({
      where: { empCode },
      update: {},
      create: { empCode, name, dateOfJoining: d(`${istYear}-01-01`) },
    });
    await prisma.leaveBalance.createMany({
      data: (["CL", "SL", "EL"] as const).map((leaveType) => ({
        employeeId: emp.id, year: istYear, leaveType, allotted: DEFAULT_SETTINGS.leaveAllotment[leaveType],
      })),
      skipDuplicates: true,
    });
  }

  // Fixed-date national holidays; HR adds festival dates (which move every year) from the Holidays page.
  const holidays = [
    { date: `${istYear}-01-26`, name: "Republic Day" },
    { date: `${istYear}-08-15`, name: "Independence Day" },
    { date: `${istYear}-10-02`, name: "Gandhi Jayanti" },
  ];
  for (const h of holidays) {
    await prisma.holiday.upsert({
      where: { date: d(h.date) },
      update: {},
      create: { date: d(h.date), name: h.name, type: "NATIONAL", createdById: admin.id },
    });
  }

  console.info(`Seed complete. Admin login: ${email} (password from SEED_ADMIN_PASSWORD; change required on first login)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
