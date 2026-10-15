import 'dotenv/config';
import { z } from 'zod';
const configSchema = z.object({
  RESERVA_INK_TOKEN: z.string().trim().min(1).refine(v => !/\s/.test(v)),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DIAGNOSTIC_MAX_PAGES: z.coerce.number().int().min(1).max(10000).default(1000),
});
export function loadConfig() {
  const result = configSchema.safeParse(process.env);
  if (!result.success) throw new Error('Configuração inválida: confira RESERVA_INK_TOKEN, PORT e DIAGNOSTIC_MAX_PAGES no ambiente.');
  return result.data;
}
