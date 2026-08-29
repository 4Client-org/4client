import { config } from '../../config.js';
import { createOpenAiCompatibleExtractor } from './openaiCompatible.js';

// Small, fast model - plenty for extracting a handful of items from a short
// chat message, keeps this comfortably inside Groq's free-tier rate limit.
export const extractWithGroq = createOpenAiCompatibleExtractor({
  label: 'Groq',
  url: 'https://api.groq.com/openai/v1/chat/completions',
  model: 'llama-3.1-8b-instant',
  getApiKey: () => config.GROQ_API_KEY,
});
