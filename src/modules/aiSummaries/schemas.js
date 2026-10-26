// Search params of the /summaries pages. A bad value falls back instead of failing the page.
import { z } from 'zod';

/** /summaries?page=2 → { page: 2 }; anything else is page 1. */
export const summariesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
