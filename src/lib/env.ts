import { z } from "zod";

const emailList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(z.email()));

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

const envSchema = z.object({
  PAYPAL_ENV: z.literal("sandbox", {
    error: "PAYPAL_ENV must be \"sandbox\". This project never sends live money.",
  }),
  PAYPAL_CLIENT_ID: z.string().trim().min(1),
  PAYPAL_CLIENT_SECRET: z.string().trim().min(1),
  PAYPAL_WEBHOOK_ID: optionalText,
  GEMINI_API_KEY: z.string().trim().min(1),
  GEMINI_MODEL: z.string().trim().min(1),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_BASE_URL: z.url({ protocol: /^https?$/ }),
  SESSION_SECRET: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64,}$/i, "SESSION_SECRET must be at least 32 random bytes as hex (64+ characters)."),
  AI_DAILY_CALL_LIMIT: z.coerce.number().int().positive(),
  SANDBOX_RECEIVERS: emailList.optional(),
});

export type Env = z.infer<typeof envSchema>;

export type EnvProblem = { variable: string; message: string };

export type EnvResult = { ok: true; env: Env } | { ok: false; problems: EnvProblem[] };

export const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";

export function readEnv(source: NodeJS.ProcessEnv = process.env): EnvResult {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) {
    return { ok: true, env: parsed.data };
  }
  const problems = parsed.error.issues.map((issue) => {
    const variable = String(issue.path[0] ?? "environment");
    const missing = source[variable] === undefined || source[variable]?.trim() === "";
    return { variable, message: missing ? "Not set." : issue.message };
  });
  return { ok: false, problems };
}

let cached: Env | undefined;

export function env(): Env {
  if (cached) {
    return cached;
  }
  const result = readEnv();
  if (!result.ok) {
    const names = result.problems.map((problem) => problem.variable).join(", ");
    throw new Error(`Environment is not configured: ${names}`);
  }
  cached = result.env;
  return cached;
}
