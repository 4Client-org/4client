import { config } from '../../config.js';
import { createOpenAiCompatibleExtractor } from './openaiCompatible.js';

// NOT currently wired into services/ai/index.ts's PROVIDERS chain - kept here,
// working code, disabled at the call site instead of deleted (see index.ts's
// comment for why). llama3.1-8b (this file's original model) is gone -
// confirmed via a live 404. The only two models Cerebras's public endpoint
// still lists (gpt-oss-120b, gemma-4-31b) both returned a live 402 "Payment
// required to access this resource" on this account - i.e. Cerebras's actual
// free trial no longer covers either one, at least not without whatever step
// (billing, a quota request) unlocks it. If that changes, gpt-oss-120b is the
// one to try first (also on Groq, so already known to behave well for this
// prompt) - re-add an entry for 'cerebras' in index.ts's PROVIDERS array.
export const extractWithCerebras = createOpenAiCompatibleExtractor({
  label: 'Cerebras',
  url: 'https://api.cerebras.ai/v1/chat/completions',
  model: 'gpt-oss-120b',
  getApiKey: () => config.CEREBRAS_API_KEY,
});
