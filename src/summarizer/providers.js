const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const PROVIDERS = {
  openai: { name: 'OpenAI', baseUrl: OPENAI_BASE_URL, protocol: 'openai-compatible' },
  anthropic: { name: 'Anthropic', baseUrl: ANTHROPIC_BASE_URL, protocol: 'anthropic' },
  openrouter: { name: 'OpenRouter', baseUrl: OPENROUTER_BASE_URL, protocol: 'openai-compatible' },
  custom: { name: 'Custom', baseUrl: null, protocol: 'openai-compatible' }
};

export function providerDefinition(provider) {
  const definition = PROVIDERS[String(provider).toLowerCase()];
  if (!definition) throw new Error(`Unsupported AI provider: ${provider}`);
  return { provider: String(provider).toLowerCase(), ...definition };
}

function assertSafeCustomUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Custom base URL must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:') throw new Error('Custom base URL must use HTTPS.');
  if (url.username || url.password) throw new Error('Custom base URL must not contain embedded credentials.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === 'localhost.localdomain' || host === '::1' || host.endsWith('.local') || host.endsWith('.internal') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === 'metadata.google.internal') throw new Error('Custom base URL must not target localhost, private, link-local, or metadata addresses.');
  return url.toString().replace(/\/$/, '');
}

export function resolveProvider(provider, baseUrl) {
  const definition = providerDefinition(provider);
  return { ...definition, baseUrl: definition.baseUrl ?? assertSafeCustomUrl(baseUrl) };
}

function authHeaders(provider, apiKey) {
  if (provider === 'anthropic') return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  return { authorization: `Bearer ${apiKey}` };
}

function authFailure(status) { return [401, 403].includes(status); }

export async function fetchProviderModels({ provider, baseUrl, apiKey, fetchImpl = fetch }) {
  const resolved = resolveProvider(provider, baseUrl);
  const endpoint = `${resolved.baseUrl}/models`;
  const response = await fetchImpl(endpoint, { method: 'GET', headers: { ...authHeaders(resolved.provider, apiKey), accept: 'application/json' } });
  if (!response.ok) { const error = new Error(`${resolved.name} model-list request failed: ${response.status}`); error.code = authFailure(response.status) ? 'AI_AUTH_FAILURE' : 'AI_FAILURE'; throw error; }
  const json = await response.json();
  const rawModels = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  const models = rawModels.map((model) => { const id = typeof model === 'string' ? model : model.id ?? model.name; const name = typeof model === 'string' ? undefined : model.name; const contextLength = typeof model === 'string' ? undefined : model.context_length ?? model.contextLength; return { ...(id ? { id } : {}), ...(name ? { name } : {}), ...(contextLength ? { contextLength } : {}) }; }).filter((model) => model.id).slice(0, 500);
  if (!models.length) { const error = new Error(`${resolved.name} returned no models.`); error.code = 'AI_FAILURE'; throw error; }
  return { ...resolved, models };
}

export function credentialDisplayName(credential) {
  return credential.label || PROVIDERS[credential.provider]?.name || credential.provider;
}
