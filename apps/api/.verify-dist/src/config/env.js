"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "env", {
    enumerable: true,
    get: function() {
        return env;
    }
});
const _zod = require("zod");
const envSchema = _zod.z.object({
    NODE_ENV: _zod.z.enum([
        'development',
        'test',
        'production'
    ]).default('development'),
    PORT: _zod.z.coerce.number().default(4000),
    WEB_ORIGIN: _zod.z.string().default('http://localhost:5173'),
    DATABASE_URL: _zod.z.string(),
    REDIS_URL: _zod.z.string().default('redis://localhost:6380'),
    JWT_ACCESS_SECRET: _zod.z.string().min(8),
    JWT_REFRESH_SECRET: _zod.z.string().min(8),
    ACCESS_TOKEN_TTL_SEC: _zod.z.coerce.number().default(900),
    REFRESH_TOKEN_TTL_DAYS: _zod.z.coerce.number().default(30),
    DATA_ENCRYPTION_KEY: _zod.z.string().min(16),
    STORAGE_DRIVER: _zod.z.enum([
        'local',
        's3'
    ]).default('local'),
    STORAGE_DIR: _zod.z.string().default('./storage'),
    S3_ENDPOINT: _zod.z.string().optional(),
    S3_BUCKET: _zod.z.string().optional(),
    S3_ACCESS_KEY: _zod.z.string().optional(),
    S3_SECRET_KEY: _zod.z.string().optional(),
    S3_REGION: _zod.z.string().default('ap-south-1'),
    SMTP_HOST: _zod.z.string().default('localhost'),
    SMTP_PORT: _zod.z.coerce.number().default(1025),
    SMTP_USER: _zod.z.string().optional(),
    SMTP_PASS: _zod.z.string().optional(),
    MAIL_FROM: _zod.z.string().default('Lexisora HRMS <no-reply@lexisora.hrms.app>'),
    ROOT_DOMAIN: _zod.z.string().default('hrms.app'),
    GITLAB_URL: _zod.z.string().optional(),
    GITLAB_TOKEN: _zod.z.string().optional(),
    LIVEKIT_URL: _zod.z.string().optional(),
    LIVEKIT_API_KEY: _zod.z.string().optional(),
    LIVEKIT_API_SECRET: _zod.z.string().optional(),
    WHATSAPP_TOKEN: _zod.z.string().optional(),
    WHATSAPP_PHONE_ID: _zod.z.string().optional(),
    RAZORPAY_KEY_ID: _zod.z.string().optional(),
    RAZORPAY_KEY_SECRET: _zod.z.string().optional(),
    CCTV_GATEWAY_URL: _zod.z.string().optional(),
    ESIGN_PROVIDER: _zod.z.string().optional(),
    /** Disable BullMQ workers (tests). */ JOBS_DISABLED: _zod.z.coerce.boolean().default(false),
    /**
   * Mark the refresh cookie `Secure`. Defaults to true in production. Set false only when the app is
   * served over plain HTTP on a LAN address (browsers drop Secure cookies there; localhost is fine).
   */ COOKIE_SECURE: _zod.z.enum([
        'true',
        'false'
    ]).optional()
});
function load() {
    try {
        process.loadEnvFile('.env');
    } catch  {
    /* no .env file — rely on the real environment */ }
    // Empty strings in .env mean "not set".
    const raw = Object.fromEntries(Object.entries(process.env).filter(([, v])=>v !== ''));
    const parsed = envSchema.safeParse(raw);
    if (!parsed.success) {
        // eslint-disable-next-line no-console
        console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
        throw new Error('Invalid environment configuration');
    }
    return parsed.data;
}
const env = load();

//# sourceMappingURL=env.js.map