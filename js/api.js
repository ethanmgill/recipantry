/**
 * Pantry Snap: Anthropic Messages API client (browser fetch).
 *
 * The user's key is sent only to CONFIG.API_URL (api.anthropic.com). It is never
 * logged, never put in error messages, and never included in exports.
 */
import { CONFIG, PROMPTS } from './config.js';
import { ApiKey, Settings, Usage } from './storage.js';

/**
 * Error with a `kind` the UI can switch on:
 * no_key | auth | permission | credit | model | too_large | rate | overloaded |
 * server | network | offline | aborted | refusal | bad_request | parse
 */
export class ApiError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** Fired on window when a saved key gets a 401, so the app can return to the key screen. */
export const AUTH_FAILED_EVENT = 'pantrysnap:auth-failed';

// If the API rejects the fallback parameter, stop sending it for this session.
let fallbackRejected = false;

/**
 * POST a Messages API request. Returns the parsed response JSON.
 * @param {object} body  Messages API request body (model, max_tokens, messages, ...)
 * @param {object} opts  { apiKey?, signal?, reportAuthFailure? }
 */
export async function callClaude(body, opts = {}) {
  const { apiKey = ApiKey.get(), signal, reportAuthFailure = true } = opts;
  if (!apiKey) throw new ApiError('no_key', 'Add your Anthropic API key in Settings first.');

  const useFallback = CONFIG.REFUSAL_FALLBACK.enabled && !fallbackRejected &&
    CONFIG.REFUSAL_FALLBACK.models.includes(body.model);

  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': CONFIG.ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const payload = useFallback ? { ...body, fallbacks: 'default' } : body;
  if (useFallback) headers['anthropic-beta'] = CONFIG.REFUSAL_FALLBACK.beta;

  let res;
  try {
    res = await fetch(CONFIG.API_URL, { method: 'POST', headers, body: JSON.stringify(payload), signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new ApiError('aborted', 'Cancelled.');
    if (!navigator.onLine) throw new ApiError('offline', "You're offline. Connect to the internet and try again.");
    throw new ApiError('network', "Couldn't reach Anthropic. Check your connection and try again.");
  }

  Usage.increment();

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    const apiMsg = data?.error?.message || '';
    // The fallback parameter is a beta. If it's refused, retry once without it.
    if (res.status === 400 && useFallback && /fallback/i.test(apiMsg)) {
      fallbackRejected = true;
      return callClaude(body, opts);
    }
    const err = classifyHttpError(res, apiMsg);
    if (err.kind === 'auth' && reportAuthFailure) {
      Settings.update({ keyRejected: true });
      window.dispatchEvent(new CustomEvent(AUTH_FAILED_EVENT));
    }
    throw err;
  }

  if (data?.stop_reason === 'refusal') {
    throw new ApiError('refusal', 'Claude declined to answer this one. Try a different photo or request.');
  }
  return data;
}

/** Map an HTTP error response to a friendly ApiError. */
function classifyHttpError(res, apiMsg) {
  const s = res.status;
  if (s === 401) return new ApiError('auth', "Anthropic didn't accept this API key. It may be mistyped, revoked or expired.", { status: s });
  if (s === 403) return new ApiError('permission', "This API key isn't allowed to make this request. Check its workspace permissions in the Anthropic Console.", { status: s });
  if (/credit balance/i.test(apiMsg)) return new ApiError('credit', 'Your Anthropic account is out of credit. Add credit under Billing at console.anthropic.com, then try again.', { status: s });
  if (s === 404 || (s === 400 && /model/i.test(apiMsg) && /not.*(found|available|exist)/i.test(apiMsg))) {
    return new ApiError('model', "The selected model isn't available to your key. Choose another model in Settings.", { status: s });
  }
  if (s === 413) return new ApiError('too_large', 'That request was too large. Try fewer or smaller photos.', { status: s });
  if (s === 429) {
    const ra = parseInt(res.headers.get('retry-after') || '', 10);
    const wait = Number.isFinite(ra) ? ` Try again in about ${ra} seconds.` : ' Wait a moment and try again.';
    return new ApiError('rate', 'Too many requests right now.' + wait, { status: s, retryAfter: ra || null });
  }
  if (s === 529 || s === 503) return new ApiError('overloaded', 'Anthropic is busy right now. Please try again in a minute.', { status: s });
  if (s >= 500) return new ApiError('server', 'Anthropic had a server error. Please try again shortly.', { status: s });
  return new ApiError('bad_request', 'The request was rejected' + (apiMsg ? `: ${apiMsg}` : '.'), { status: s });
}

/** Join all text blocks in a response. */
export function responseText(data) {
  return (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

/**
 * Validate a key with a tiny call to the chosen model.
 * Resolves on success; throws ApiError (kind 'auth', 'credit', 'network', ...) on failure.
 */
export async function testKey(apiKey, model = Settings.get().model) {
  await callClaude({
    model,
    max_tokens: 64,
    output_config: { effort: CONFIG.EFFORT.keyTest },
    messages: [{ role: 'user', content: PROMPTS.KEY_TEST }],
  }, { apiKey, reportAuthFailure: false });
}
