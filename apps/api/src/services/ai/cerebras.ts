import { config } from '../../config.js';
import { createOpenAiCompatibleExtractor } from './openaiCompatible.js';

export const extractWithCerebras = createOpenAiCompatibleExtractor({
  label: 'Cerebras',
  url: 'https://api.cerebras.ai/v1/chat/completions',
  model: 'llama3.1-8b',
  getApiKey: () => config.CEREBRAS_API_KEY,
});
