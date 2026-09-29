import { z } from 'zod';

/** All API routes live under this prefix. */
export const API_PREFIX = '/api/v1';

/** Uniform error body returned by the API for every non-2xx response. */
export type ApiError = {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
};

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().optional(),
  tab: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

// ── Auth ────────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  workspace: z.string().trim().min(1, 'Workspace is required'),
  email: z.string().trim().toLowerCase().email('Enter your official email'),
  password: z.string().min(1, 'Password is required'),
  client: z.enum(['web', 'mobile', 'tracker']).default('web'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  workspace: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, 'At least 8 characters'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'At least 8 characters'),
});

export type SessionUser = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantDomain: string;
  employeeId: string | null;
  email: string;
  name: string;
  firstName: string;
  initials: string;
  title: string | null;
  roleKey: string;
  roleName: string;
  permissions: string[];
  isPlatformAdmin: boolean;
  workMode: 'OFFICE' | 'REMOTE' | 'HYBRID' | null;
  branding: { accent: string; accent2: string; logoUrl: string | null } | null;
};

export type LoginResponse = {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
};
