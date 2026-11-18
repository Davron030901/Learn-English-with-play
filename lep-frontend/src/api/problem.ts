/**
 * RFC 9457 problems, as the running backend emits them (lep-backend app/errors.py).
 *
 * Rules (brief §4.2, DECISIONS §7.2):
 *   * switch on `type`, never on `title` or `detail` — those are human text and are never shown;
 *   * every problem keeps its `request_id` so the learner can report it;
 *   * `errors[]` never contains the submitted value, and the client never echoes one either;
 *   * failures without a problem body (no network, a timeout, a proxy's HTML 502) become local
 *     `client/*` types so the interface has exactly one error path.
 */

/** Every `type` slug the backend can send today (app/errors.py, including _STATUS_TYPES). */
export const SERVER_PROBLEM_TYPES = [
  'validation_error',
  'age_requirement_not_met',
  'unauthorized',
  'invalid_credentials',
  'invalid_token',
  'session_revoked',
  'not_found',
  'conflict',
  'email_taken',
  'payload_too_large',
  'rate_limited',
  'dependency_unavailable',
  'internal_error',
  'bad_request',
  'forbidden',
  'method_not_allowed',
  'not_acceptable',
  'unsupported_media_type',
  'ai_unavailable',
  'ai_allowance',
  'ai_ended',
  'ai_busy',
  'tier_locked',
  'new_items_capped',
  'assessment_conflict',
  'media_refused',
  'media_unavailable',
  'password_refused',
  'reset_link_invalid',
  'password_reset_unavailable',
  'origin_refused',
  'shop_refused',
  'streak_rule',
  'leagues_not_for_minors',
  'display_name_required',
] as const;

/** Failures the client names itself because no problem document arrived. */
export const CLIENT_PROBLEM_TYPES = [
  'client/offline',
  'client/timeout',
  'client/bad-gateway',
  'client/unknown',
] as const;

export type ServerProblemType = (typeof SERVER_PROBLEM_TYPES)[number];
export type ClientProblemType = (typeof CLIENT_PROBLEM_TYPES)[number];
export type KnownProblemType = ServerProblemType | ClientProblemType;

export interface FieldError {
  field: string;
  message: string;
}

export interface ApiProblem {
  /** The server's slug, a `client/*` type, or `http_NNN` for a status the server has no slug for. */
  type: string;
  status: number;
  requestId: string | null;
  errors: FieldError[];
  retryAfterS: number | null;
  /** When a locked thing opens (e.g. `tier_locked` for tier 3): an ISO timestamp, never more. */
  availableAt?: string | null;
  /** Why a refusal happened (`assessment_conflict`, `media_refused`): a slug, never text. */
  reason?: string;
}

export class ApiError extends Error {
  readonly problem: ApiProblem;
  constructor(problem: ApiProblem) {
    // The message is the type only: never the server's title/detail, never a value.
    super(problem.type);
    this.name = 'ApiError';
    this.problem = problem;
  }
}

export function isKnownProblemType(t: string): t is KnownProblemType {
  return (
    (SERVER_PROBLEM_TYPES as readonly string[]).includes(t) ||
    (CLIENT_PROBLEM_TYPES as readonly string[]).includes(t)
  );
}

export function clientProblem(
  type: ClientProblemType,
  requestId: string | null = null,
): ApiProblem {
  return { type, status: 0, requestId, errors: [], retryAfterS: null };
}

function parseRetryAfter(header: string | null, body: unknown): number | null {
  const fromBody =
    body &&
    typeof body === 'object' &&
    typeof (body as { retry_after_s?: unknown }).retry_after_s === 'number'
      ? (body as { retry_after_s: number }).retry_after_s
      : null;
  if (fromBody !== null) return fromBody;
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - Date.now()) / 1000)) : null;
}

function isFieldError(v: unknown): v is FieldError {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as FieldError).field === 'string' &&
    typeof (v as FieldError).message === 'string'
  );
}

/**
 * Builds an ApiProblem from a problem body that has already been parsed (openapi-fetch hands
 * us `error`) plus the response's headers.
 */
export function problemFromBody(
  body: unknown,
  res: Response,
  sentRequestId: string | null,
): ApiProblem {
  const headerId = res.headers.get('x-request-id');
  const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const type = obj && typeof obj.type === 'string' ? obj.type : null;
  if (!type) {
    // A proxy or load balancer answered (HTML 502/504, empty 503…): no problem document.
    const t: ClientProblemType = res.status >= 500 ? 'client/bad-gateway' : 'client/unknown';
    return { ...clientProblem(t, headerId ?? sentRequestId), status: res.status };
  }
  const errors = Array.isArray(obj?.errors) ? obj.errors.filter(isFieldError) : [];
  return {
    type,
    status: typeof obj?.status === 'number' ? obj.status : res.status,
    requestId:
      (typeof obj?.request_id === 'string' ? obj.request_id : null) ?? headerId ?? sentRequestId,
    // Only the field name and the server's message are kept; nothing the learner typed.
    errors: errors.map((e) => ({ field: e.field, message: e.message })),
    retryAfterS: parseRetryAfter(res.headers.get('retry-after'), obj),
    // only when the server sent one: a lock's opening time, a timestamp and nothing else
    ...(typeof obj?.available_at === 'string' && !Number.isNaN(Date.parse(obj.available_at))
      ? { availableAt: obj.available_at }
      : {}),
    // only a slug: the copy is chosen by it, nothing the server wrote is shown
    ...(typeof obj?.reason === 'string' && /^[a-z_]{1,32}$/.test(obj.reason)
      ? { reason: obj.reason }
      : {}),
  };
}

/**
 * Turns a non-2xx response into an ApiProblem. Reads the body once; pass a clone if the caller
 * still needs the response.
 */
export async function problemFromResponse(
  res: Response,
  sentRequestId: string | null,
): Promise<ApiProblem> {
  const contentType = res.headers.get('content-type') ?? '';
  let body: unknown = null;
  if (contentType.includes('json')) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  }
  return problemFromBody(body, res, sentRequestId);
}

export function toApiProblem(e: unknown): ApiProblem {
  if (e instanceof ApiError) return e.problem;
  return clientProblem('client/unknown');
}
