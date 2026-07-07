import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { EMPLOYEE_STATUS_OPTIONS, GENDER_OPTIONS, type EmployeeStatus, type Gender } from "@shared/types/employee";

const employeeStatusValues = EMPLOYEE_STATUS_OPTIONS.map((option) => option.value) as [
  EmployeeStatus,
  ...EmployeeStatus[]
];
const genderValues = GENDER_OPTIONS.map((option) => option.value) as [Gender, ...Gender[]];

const nullableId = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

const genderSchema = z
  .enum(genderValues)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

const pinSchema = z.string().trim().regex(/^\d{6}$/, "PIN must be exactly 6 digits");
const optionalPinSchema = z
  .union([z.literal(""), pinSchema])
  .optional()
  .transform((value) => (value ? value : undefined));

const employeeBaseFields = {
  employeeCode: z
    .string()
    .trim()
    .min(1, "Employee code is required")
    .max(30)
    .transform((value) => value.toUpperCase()),
  firstName: z.string().trim().min(1, "First name is required").max(80),
  middleName: optionalText(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  gender: genderSchema,
  dateOfBirth: optionalText(20),
  phone: optionalText(50),
  alternativePhone: optionalText(50),
  email: optionalText(150),
  branchId: nullableId,
  department: optionalText(100),
  jobTitle: optionalText(100),
  hireDate: optionalText(20),
  roleId: nullableId,
  username: optionalText(50),
  status: z.enum(employeeStatusValues)
};

export const employeeCreateSchema = z
  .object({
    ...employeeBaseFields,
    pin: pinSchema,
    confirmPin: pinSchema,
    password: optionalText(200)
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: "PIN and confirmation do not match",
    path: ["confirmPin"]
  })
  .refine((data) => !data.password || data.password.length >= 8, {
    message: "Password must be at least 8 characters",
    path: ["password"]
  });

export const employeeUpdateSchema = z
  .object({
    ...employeeBaseFields,
    pin: optionalPinSchema,
    confirmPin: optionalPinSchema,
    password: optionalText(200)
  })
  .refine((data) => !data.pin || data.pin === data.confirmPin, {
    message: "PIN and confirmation do not match",
    path: ["confirmPin"]
  })
  .refine((data) => !data.password || data.password.length >= 8, {
    message: "Password must be at least 8 characters",
    path: ["password"]
  });

export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
