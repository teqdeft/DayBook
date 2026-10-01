import { z } from 'zod';

export const devLoginSchema = z.object({
  email: z.email('Enter a valid email.').max(190),
});

export const slackCallbackQuerySchema = z.object({
  code: z.string().max(500).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(200).optional(),
});
