import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  DATA_ENCRYPTION_KEY: z.string().min(16),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Lexisora HRMS <no-reply@lexisora.hrms.app>'),
  ROOT_DOMAIN: z.string().default('hrms.app'),
  GITLAB_URL: z.string().optional(),
  GITLAB_TOKEN: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_ID: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  CCTV_GATEWAY_URL: z.string().optional(),
  ESIGN_PROVIDER: z.string().optional(),
  /** Disable BullMQ workers (tests). */
  JOBS_DISABLED: z.coerce.boolean().default(false),
  /**
   * Mark the refresh cookie `Secure`. Defaults to true in production. Set false only when the app is
   * served over plain HTTP on a LAN address (browsers drop Secure cookies there; localhost is fine).
   */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* no .env file — rely on the real environment */
  }
  // Empty strings in .env mean "not set".
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}

export const env: Env = load();
