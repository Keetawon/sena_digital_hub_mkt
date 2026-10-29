// Only names belong in source. Never inspect or print a provider key's value.
export const PROVIDER_KEY_NAMES = Object.freeze(['OPENAI_API_KEY','HUB_MEDIA_OPENAI_API_KEY','HUB_TRANSLATION_OPENAI_API_KEY']);
export const WORKER_SECRET_NAMES = Object.freeze(['HUB_MEDIA_WORKER_DATABASE_URL','HUB_SUPABASE_TEST_MEDIA_WORKER_PASSWORD']);
export function scrubProviderKeys(env) {
  for (const key of Object.keys(env)) if (/(^|_)OPENAI_API_KEY$/.test(key)||WORKER_SECRET_NAMES.includes(key)) delete env[key];
  return env;
}
