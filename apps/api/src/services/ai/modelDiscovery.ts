// Shared by groq.ts and openrouter.ts: instead of hardcoding ONE model id
// (which broke 3 times in one day when providers renamed/retired their
// models - see those files' own comments), each queries its provider's own
// `/models` endpoint for what's CURRENTLY available, filters to what's
// actually usable for this task, and tries a few candidates in order until
// one works. This doesn't make model churn impossible to notice (if every
// provider drops ALL its usable free models at once, extraction still fails
// and index.ts's error message still says so) - it just means a single model
// getting retired stops being a same-day emergency.
interface DiscoveryConfig {
  modelsUrl: string;
  headers: () => Record<string, string>;
  isEligible: (model: any) => boolean;
  // Known-good from a real, manually-verified request (see the calling
  // file's own comment for when/what) - tried first if the provider still
  // lists it, since a proven model beats a random pick from a large list.
  preferredIds?: string[];
  maxCandidates?: number;
  // Groq/OpenRouter both return `{ data: [...] }` (OpenAI-style) - the
  // default. Gemini's own /models response is shaped differently
  // (`{ models: [...] }`, id under `name`) - these two let a provider
  // override just the shape-reading, not duplicate the whole cache/ordering
  // logic below for one different JSON key.
  extractList?: (data: any) => any[];
  getId?: (model: any) => string;
}

const TTL_MS = 60 * 60 * 1000; // re-check each provider's model list at most once an hour
const cache = new Map<string, { ids: string[]; at: number }>();

export async function discoverCandidateModels(cacheKey: string, cfg: DiscoveryConfig): Promise<string[]> {
  const now = Date.now();
  const hit = cache.get(cacheKey);
  // An empty cached list (every candidate got dropped after failing, see
  // dropFromCache below) is treated as a miss too - no point waiting out the
  // rest of the TTL when there's nothing left to try.
  if (hit && hit.ids.length > 0 && now - hit.at < TTL_MS) return hit.ids;

  const res = await fetch(cfg.modelsUrl, { headers: cfg.headers() });
  if (!res.ok) throw new Error(`${cacheKey}: models list failed (${res.status})`);
  const data = await res.json();

  const list = (cfg.extractList ?? ((d: any) => d.data ?? []))(data);
  const getId = cfg.getId ?? ((m: any) => m.id as string);
  const eligible = list.filter(cfg.isEligible).map(getId);
  const preferred = (cfg.preferredIds ?? []).filter((id) => eligible.includes(id));
  const rest = eligible.filter((id) => !preferred.includes(id));
  const ordered = [...preferred, ...rest].slice(0, cfg.maxCandidates ?? 4);

  if (ordered.length === 0) throw new Error(`${cacheKey}: no eligible models found`);
  cache.set(cacheKey, { ids: ordered, at: now });
  return ordered;
}

// Called when a candidate model actually fails a real extraction call (not
// just "wasn't first choice") - so the NEXT call for this provider (within
// the same TTL window) doesn't waste a request retrying something already
// known dead this run. Cache still resets fully on the next natural refresh
// (TTL expiry, or a redeploy - this is in-memory, not persisted).
export function dropFromCache(cacheKey: string, modelId: string): void {
  const hit = cache.get(cacheKey);
  if (hit) hit.ids = hit.ids.filter((id) => id !== modelId);
}

// Test-only: forces the next discoverCandidateModels call for every key to
// re-fetch instead of reusing whatever a previous test cached.
export function clearDiscoveryCache(): void {
  cache.clear();
}
