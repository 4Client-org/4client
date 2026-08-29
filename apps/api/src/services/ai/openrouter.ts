import { config } from '../../config.js';
import { createOpenAiCompatibleExtractor } from './openaiCompatible.js';

// OpenRouter's own free tier (no card): a rotating set of models suffixed
// `:free` cost nothing to call, rate-limited (~20 req/min, a modest daily cap
// without adding any credit balance). That roster changes over time - if this
// one gets retired, extraction just fails and falls through to the next
// provider (see services/ai/index.ts) until this model string is swapped for
// a current one from openrouter.ai/models (filter: price = free).
const OPENROUTER_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';

export const extractWithOpenRouter = createOpenAiCompatibleExtractor({
  label: 'OpenRouter',
  url: 'https://openrouter.ai/api/v1/chat/completions',
  model: OPENROUTER_MODEL,
  getApiKey: () => config.OPENROUTER_API_KEY,
});
