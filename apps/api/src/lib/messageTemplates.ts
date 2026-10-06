import { z } from 'zod';

// Mensajes que el staff manda con botones del chat (no automáticos del webhook).
// Cada org puede editar su propio texto desde Configuración > Mensajes; si no lo
// editó, cae a estos valores por defecto. Al cambiar un default, revisar que
// siga siendo texto que la org quiera mandar (no hay migración de datos).
export const DEFAULT_MESSAGE_TEMPLATES = {
  form_warning:
    '*Este link es solo para hacer tu pedido. Nunca te pediremos dinero ni datos bancarios.*\n'
    + 'Ahorros Bancolombia: 27900010068, a nombre de Fruver San Gabriel SAS.',
  form_followup:
    'Diligencia por favor el pedido por el link. El monto mínimo para el domicilio es de $10.000 y el domicilio tiene un costo de $2.000. Cualquier duda con gusto.',
  bank_account:
    'Ahorros Bancolombia: 27900010068, a nombre de Fruver San Gabriel SAS.',
} as const;

export type MessageTemplateKey = keyof typeof DEFAULT_MESSAGE_TEMPLATES;
export type MessageTemplates = Record<MessageTemplateKey, string>;

export const MESSAGE_TEMPLATE_KEYS = Object.keys(DEFAULT_MESSAGE_TEMPLATES) as MessageTemplateKey[];

// Lo que se guarda en Organization.message_templates: solo las claves editadas.
export const messageTemplatesPatchSchema = z.object({
  form_warning:  z.string().trim().min(1).max(1000).nullable().optional(),
  form_followup: z.string().trim().min(1).max(1000).nullable().optional(),
  bank_account:  z.string().trim().min(1).max(1000).nullable().optional(),
});

// Texto efectivo por clave: lo guardado si existe y no está vacío, si no el default.
export function resolveMessageTemplates(stored: unknown): MessageTemplates {
  const saved = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<MessageTemplateKey, unknown>>;
  const out = { ...DEFAULT_MESSAGE_TEMPLATES } as MessageTemplates;
  for (const key of MESSAGE_TEMPLATE_KEYS) {
    const value = saved[key];
    if (typeof value === 'string' && value.trim() !== '') out[key] = value;
  }
  return out;
}
