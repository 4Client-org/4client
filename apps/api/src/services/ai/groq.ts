import { config } from '../../config.js';
import { createOpenAiCompatibleExtractor } from './openaiCompatible.js';

// llama-3.1-8b-instant (this file's original model) and llama-3.3-70b-versatile
// were both deprecated by Groq (confirmed via a live 404 "model_not_found" from
// a real request, not just docs) - openai/gpt-oss-20b is Groq's own recommended
// replacement, still free-tier, confirmed working (including response_format
// json_object) with a real request. If this ever 404s again, check
// console.groq.com/docs/models for the current model list before guessing.
export const extractWithGroq = createOpenAiCompatibleExtractor({
  label: 'Groq',
  url: 'https://api.groq.com/openai/v1/chat/completions',
  model: 'openai/gpt-oss-20b',
  getApiKey: () => config.GROQ_API_KEY,
});
