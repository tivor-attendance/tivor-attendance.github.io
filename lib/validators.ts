// Zod schemas shared by API routes (authoritative) and client forms.
import { z } from "zod";

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(
  (s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
  "Invalid date",
);
const optStr = (max = 120) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const monthQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const cellChangeSchema = z.object({
  employeeId: z.string().min(1),
  date: isoDateSchema,
  status: z.string().min(1).max(4).optional(),
  reset: z.boolean().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
});
export const bulkChangeSchema = z.object({ changes: z.array(cellChangeSchema).min(1).max(20_000) });

export const bulkRangeSchema = z.object({
  employeeIds: z.array(z.string()).min(1),
  from: isoDateSchema,
  to: isoDateSchema,
  status: z.string().min(1).max(4).optional(),
  reset: z.boolean().optional(),
}).refine((v) => v.from <= v.to, "From date must be on or before To date");

export const employeeSchema = z.object({
  empCode: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, - and _ only").optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.union([z.email(), z.literal("")]).nullish().transform((v) => (v ? v : null)),
  phone: z.string().trim().regex(/^[0-9+\-\s]{0,20}$/, "Invalid phone").nullish().transform((v) => (v ? v : null)),
  department: optStr(),
  designation: optStr(),
  managerId: optStr(40),
  dateOfJoining: isoDateSchema,
  dateOfExit: isoDateSchema.nullish().or(z.literal("")).transform((v) => (v ? v : null)),
  dateOfBirth: isoDateSchema.nullish().or(z.literal("")).transform((v) => (v ? v : null)),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "INTERN", "CONTRACT"]).default("FULL_TIME"),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  monthlySalary: z.coerce.number().min(0).max(100_000_000).nullish().or(z.literal("")).transform((v) => (v === "" || v === undefined ? null : v)),
  bankAccount: z.string().trim().regex(/^[0-9]{6,20}$/, "6–20 digits").nullish().or(z.literal("")).transform((v) => (v ? v : null)),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC").nullish().or(z.literal("")).transform((v) => (v ? v : null)),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN").nullish().or(z.literal("")).transform((v) => (v ? v : null)),
  uan: z.string().trim().regex(/^[0-9]{12}$/, "UAN is 12 digits").nullish().or(z.literal("")).transform((v) => (v ? v : null)),
  leave: z.object({ CL: z.coerce.number().min(0), SL: z.coerce.number().min(0), EL: z.coerce.number().min(0) }).optional(),
}).refine((v) => !v.dateOfExit || v.dateOfExit >= v.dateOfJoining, { message: "Exit date must be after joining date", path: ["dateOfExit"] });
export type EmployeeInput = z.input<typeof employeeSchema>;

export const holidaySchema = z.object({
  date: isoDateSchema,
  name: z.string().trim().min(1).max(100),
  type: z.enum(["NATIONAL", "FESTIVAL", "COMPANY", "OPTIONAL"]),
});

export const overrideSchema = z.object({
  date: isoDateSchema,
  isWorking: z.boolean(),
  reason: z.string().trim().max(200).nullish(),
});

export const lockSchema = z.object({
  year: z.number().int(), month: z.number().int().min(1).max(12),
  acknowledgeAutoOnly: z.boolean().optional(),
});
export const unlockSchema = z.object({
  year: z.number().int(), month: z.number().int().min(1).max(12),
  reason: z.string().trim().min(5, "Reason must be at least 5 characters").max(500),
});

export const passwordSchema = z.string().min(8, "At least 8 characters")
  .regex(/[A-Z]/, "Include an uppercase letter").regex(/[a-z]/, "Include a lowercase letter").regex(/[0-9]/, "Include a number");

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export const userSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().transform((v) => v.toLowerCase()),
  role: z.enum(["ADMIN", "HR", "MANAGER", "VIEWER"]),
  active: z.boolean().default(true),
  canViewSensitive: z.boolean().default(false),
  password: passwordSchema.optional(),
});
