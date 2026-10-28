// Only names belong in source. Never inspect or print a provider key's value.
export const PROVIDER_KEY_NAMES = Object.freeze(['OPENAI_API_KEY','HUB_MEDIA_OPENAI_API_KEY','HUB_TRANSLATION_OPENAI_API_KEY']);
export function scrubProviderKeys(env) {
  for (const key of Object.keys(env)) if (/(^|_)OPENAI_API_KEY$/.test(key)) delete env[key];
  return env;
}
