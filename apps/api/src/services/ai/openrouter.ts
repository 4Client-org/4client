import { config } from '../../config.js';
import { createOpenAiCompatibleExtractor } from './openaiCompatible.js';

// OpenRouter's own free tier (no card): a rotating set of models suffixed
// `:free` cost nothing to call. That roster changes CONSTANTLY - the original
// pick here (meta-llama/llama-3.1-8b-instruct:free) was already retired by the
// time this got tested for real ("This model is unavailable for free... use
// this slug instead: meta-llama/llama-3.1-8b-instruct" - i.e. the paid one).
// inclusionai/ling-3.0-flash-fin:free is confirmed working with a real request
// as of the same test. If THIS one also gets retired, check openrouter.ai/models
// (filter: price = free) for whatever's currently free before guessing again.
const OPENROUTER_MODEL = 'inclusionai/ling-3.0-flash-fin:free';

export const extractWithOpenRouter = createOpenAiCompatibleExtractor({
  label: 'OpenRouter',
  url: 'https://openrouter.ai/api/v1/chat/completions',
  model: OPENROUTER_MODEL,
  getApiKey: () => config.OPENROUTER_API_KEY,
  // This specific free model 400s on response_format:json_object ("does not
  // support feature: structured-outputs") - confirmed live. Falls back to
  // prompt-only JSON (still zod-validated afterward, same as every provider).
  useJsonMode: false,
});
