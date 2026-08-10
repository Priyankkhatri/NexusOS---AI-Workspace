import { z } from 'zod';

export function validatePayload<T>(schema: z.ZodType<T>, rawData: unknown): T {
  const result = schema.safeParse(rawData);
  if (!result.success) {
    const details = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`[ValidationError] Contract validation failed: ${details}`);
  }
  return result.data;
}
