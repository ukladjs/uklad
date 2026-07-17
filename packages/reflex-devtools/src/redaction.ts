export type RedactionDataKind =
  | 'state'
  | 'trace'
  | 'subscription'
  | 'subscription-result';

export interface RedactionContext {
  readonly dataKind: RedactionDataKind;
  readonly eventType: string;
  readonly location: 'runtime' | 'server';
}

export type StateRedactor = (
  value: unknown,
  context: RedactionContext,
) => unknown;

export type TraceRedactor = (
  trace: unknown,
  context: RedactionContext,
) => unknown;

export interface DevtoolsRedaction {
  /**
   * Called before state-like values cross the DevTools trust boundary.
   * The hook must return the value that may be transported or retained.
   */
  readonly state?: StateRedactor;
  /**
   * Called once per trace before it crosses the DevTools trust boundary.
   * Return `null` or `undefined` to omit that trace.
   */
  readonly trace?: TraceRedactor;
}

export interface KeyRedactorOptions {
  /**
   * Exact key names or regular expressions. The defaults target common
   * credential fields; add application-specific PII keys explicitly.
   */
  readonly keys?: readonly (string | RegExp)[];
  readonly replacement?: unknown;
  readonly maxDepth?: number;
}

export const DEFAULT_SENSITIVE_KEYS: readonly RegExp[] = Object.freeze([
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /pass(word|phrase)?/i,
  /secret/i,
  /(^|[_-])tokens?($|[_-])/i,
  /[A-Za-z0-9]Tokens?(?=$|[A-Z0-9_-])/,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /session[_-]?id/i,
  /credit[_-]?card/i,
  /card[_-]?number/i,
  /^cvv$/i,
  /social[_-]?security/i,
  /^ssn$/i,
]);

const ERROR_CREDENTIAL_REPLACEMENT = '[REDACTED:CREDENTIAL]';
const ERROR_TEXT_TRUNCATION_MARKER = '\n[TRUNCATED]';
const MAX_ERROR_NAME_LENGTH = 256;
const MAX_ERROR_MESSAGE_LENGTH = 4 * 1024;
const MAX_ERROR_STACK_LENGTH = 32 * 1024;

const PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g;
const COOKIE_HEADER_PATTERN = /\b((?:set-)?cookie)(\s*:)[^\r\n]*/gi;
const AUTHORIZATION_PATTERN =
  /\b((?:proxy[- ]?)?authorization)(\s*[:=]\s*)((?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const AUTH_SCHEME_PATTERN =
  /\b((?:bearer|basic)\s+)(?=[^\s]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]{8,}/gi;
const QUOTED_CREDENTIAL_PATTERN =
  /\b((?:(?:access|refresh|auth|id|csrf|session)[ _-]?tokens?|tokens?|api[ _-]?keys?|client[ _-]?secrets?|secret[ _-]?(?:access[ _-]?)?keys?|passwords?|passphrases?|private[ _-]?keys?|session[ _-]?ids?|connection[ _-]?strings?|dsn))\b(\s*[:=]\s*)(["'])([^\r\n]*?)\3/gi;
const UNQUOTED_CREDENTIAL_PATTERN =
  /\b((?:(?:access|refresh|auth|id|csrf|session)[ _-]?tokens?|tokens?|api[ _-]?keys?|client[ _-]?secrets?|secret[ _-]?(?:access[ _-]?)?keys?|passwords?|passphrases?|private[ _-]?keys?|session[ _-]?ids?|connection[ _-]?strings?|dsn))\b(\s*[:=]\s*)[^\s,;&]+/gi;
const CREDENTIAL_URL_PATTERN =
  /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi;
const INCOMPLETE_PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*$/g;
const INCOMPLETE_DOUBLE_QUOTED_CREDENTIAL_PATTERN =
  /\b((?:(?:access|refresh|auth|id|csrf|session)[ _-]?tokens?|tokens?|api[ _-]?keys?|client[ _-]?secrets?|secret[ _-]?(?:access[ _-]?)?keys?|passwords?|passphrases?|private[ _-]?keys?|session[ _-]?ids?|connection[ _-]?strings?|dsn))\b(\s*[:=]\s*)"[^"\r\n]*$/gi;
const INCOMPLETE_SINGLE_QUOTED_CREDENTIAL_PATTERN =
  /\b((?:(?:access|refresh|auth|id|csrf|session)[ _-]?tokens?|tokens?|api[ _-]?keys?|client[ _-]?secrets?|secret[ _-]?(?:access[ _-]?)?keys?|passwords?|passphrases?|private[ _-]?keys?|session[ _-]?ids?|connection[ _-]?strings?|dsn))\b(\s*[:=]\s*)'[^'\r\n]*$/gi;
const INCOMPLETE_CREDENTIAL_URL_PATTERN =
  /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):[^@\s/]*$/gi;
const INCOMPLETE_HIGH_CONFIDENCE_CREDENTIAL_PATTERN =
  /(?:\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]*|\b(?:AKIA|ASIA)[A-Z0-9]*|\beyJ[A-Za-z0-9_.-]*|\bgh(?:[pousr]|ithub_pat)_[A-Za-z0-9_]*|\bxox[baprs]-[A-Za-z0-9-]*)$/g;
const HIGH_CONFIDENCE_CREDENTIAL_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
]);

type ErrorTextKind = 'message' | 'stack';

interface VisitContext {
  readonly errorContainer: boolean;
  readonly errorTextKind?: ErrorTextKind;
}

interface CloneRedactionOptions {
  readonly matchesKey: (key: string) => boolean;
  readonly replacement: unknown;
  readonly maxDepth: number;
}

const ROOT_VISIT_CONTEXT: VisitContext = { errorContainer: false };
const ERROR_SANITIZING_REDACTORS = new WeakSet<Function>();

function scrubCredentialText(value: string, inputWasTruncated: boolean): string {
  let scrubbed = value.replace(PRIVATE_KEY_PATTERN, ERROR_CREDENTIAL_REPLACEMENT);

  if (inputWasTruncated) {
    // A bounded prefix may cut through a multi-line block or quoted value.
    // Remove those partial forms before the generic unquoted matcher can
    // consume only their first word and leave the remainder behind.
    scrubbed = scrubbed
      .replace(INCOMPLETE_PRIVATE_KEY_PATTERN, ERROR_CREDENTIAL_REPLACEMENT)
      .replace(
        INCOMPLETE_DOUBLE_QUOTED_CREDENTIAL_PATTERN,
        (_match, label: string, separator: string) =>
          `${label}${separator}"${ERROR_CREDENTIAL_REPLACEMENT}"`,
      )
      .replace(
        INCOMPLETE_SINGLE_QUOTED_CREDENTIAL_PATTERN,
        (_match, label: string, separator: string) =>
          `${label}${separator}'${ERROR_CREDENTIAL_REPLACEMENT}'`,
      )
      .replace(
        INCOMPLETE_CREDENTIAL_URL_PATTERN,
        (_match, scheme: string, username: string) =>
          `${scheme}${username}:${ERROR_CREDENTIAL_REPLACEMENT}@`,
      )
      .replace(
        INCOMPLETE_HIGH_CONFIDENCE_CREDENTIAL_PATTERN,
        ERROR_CREDENTIAL_REPLACEMENT,
      );
  }

  scrubbed = scrubbed
    .replace(
      COOKIE_HEADER_PATTERN,
      (_match, label: string, separator: string) =>
        `${label}${separator} ${ERROR_CREDENTIAL_REPLACEMENT}`,
    )
    .replace(
      AUTHORIZATION_PATTERN,
      (
        _match,
        label: string,
        separator: string,
        scheme: string,
      ) => `${label}${separator}${scheme}${ERROR_CREDENTIAL_REPLACEMENT}`,
    )
    .replace(
      AUTH_SCHEME_PATTERN,
      (_match, scheme: string) => `${scheme}${ERROR_CREDENTIAL_REPLACEMENT}`,
    )
    .replace(
      QUOTED_CREDENTIAL_PATTERN,
      (
        _match,
        label: string,
        separator: string,
        quote: string,
      ) =>
        `${label}${separator}${quote}${ERROR_CREDENTIAL_REPLACEMENT}${quote}`,
    )
    .replace(
      UNQUOTED_CREDENTIAL_PATTERN,
      (_match, label: string, separator: string) =>
        `${label}${separator}${ERROR_CREDENTIAL_REPLACEMENT}`,
    )
    .replace(
      CREDENTIAL_URL_PATTERN,
      (_match, scheme: string, username: string) =>
        `${scheme}${username}:${ERROR_CREDENTIAL_REPLACEMENT}@`,
    );

  for (const pattern of HIGH_CONFIDENCE_CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    scrubbed = scrubbed.replace(pattern, ERROR_CREDENTIAL_REPLACEMENT);
  }
  return scrubbed;
}

function sanitizeBoundedCredentialText(value: string, maxLength: number): string {
  const inputWasTruncated = value.length > maxLength;
  const contentLimit = inputWasTruncated
    ? Math.max(0, maxLength - ERROR_TEXT_TRUNCATION_MARKER.length)
    : maxLength;
  const boundedInput = inputWasTruncated ? value.slice(0, contentLimit) : value;
  const scrubbed = scrubCredentialText(boundedInput, inputWasTruncated);
  const boundedScrubbed = scrubbed.slice(0, contentLimit);
  return inputWasTruncated
    ? `${boundedScrubbed}${ERROR_TEXT_TRUNCATION_MARKER}`
    : boundedScrubbed;
}

function sanitizeErrorText(value: string, kind: ErrorTextKind): string {
  return sanitizeBoundedCredentialText(
    value,
    kind === 'stack' ? MAX_ERROR_STACK_LENGTH : MAX_ERROR_MESSAGE_LENGTH,
  );
}

function readErrorString(
  error: Error,
  property: 'name' | 'message' | 'stack',
): string | undefined {
  try {
    const value = error[property];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function errorKeyWords(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isErrorContainerKey(key: string): boolean {
  return errorKeyWords(key).some((word) => word === 'error' || word === 'errors');
}

function looksLikeStructuredError(value: Record<string, unknown>): boolean {
  if (typeof value.message !== 'string') return false;
  return (
    typeof value.stack === 'string'
    || typeof value.phase === 'string'
    || typeof value.name === 'string'
    || typeof value.effect === 'string'
    || typeof value.interceptor === 'string'
  );
}

function contextForProperty(
  key: string,
  value: unknown,
  parentIsError: boolean,
): VisitContext {
  if (parentIsError && key === 'stack') {
    return { errorContainer: false, errorTextKind: 'stack' };
  }
  if (parentIsError && key === 'message') {
    return { errorContainer: false, errorTextKind: 'message' };
  }
  if (parentIsError && key === 'cause') {
    return typeof value === 'string'
      ? { errorContainer: false, errorTextKind: 'message' }
      : { errorContainer: true };
  }
  if (isErrorContainerKey(key)) {
    return typeof value === 'string'
      ? { errorContainer: false, errorTextKind: 'message' }
      : { errorContainer: true };
  }
  return ROOT_VISIT_CONTEXT;
}

function cloneAndRedact(
  value: unknown,
  options: CloneRedactionOptions,
): unknown {
  const seen = new WeakMap<object, unknown>();

  const visit = (
    current: unknown,
    depth: number,
    context: VisitContext,
  ): unknown => {
    if (typeof current === 'string') {
      return context.errorTextKind
        ? sanitizeErrorText(current, context.errorTextKind)
        : current;
    }
    if (
      current === null
      || typeof current !== 'object'
      || current instanceof Date
      || current instanceof RegExp
    ) {
      return current;
    }

    if (depth > options.maxDepth) return '[REDACTED:MAX_DEPTH]';

    const existing = seen.get(current);
    if (existing !== undefined) return existing;

    if (current instanceof Error) {
      const clone: Record<string, unknown> = Object.create(null);
      const details: Record<string, unknown> = Object.create(null);
      clone['[Error]'] = details;
      seen.set(current, clone);

      const name = readErrorString(current, 'name') ?? 'Error';
      const message = readErrorString(current, 'message') ?? '[Unprintable error]';
      const stack = readErrorString(current, 'stack');
      details.name = sanitizeBoundedCredentialText(
        name,
        MAX_ERROR_NAME_LENGTH,
      );
      details.message = sanitizeErrorText(message, 'message');
      if (stack !== undefined) details.stack = sanitizeErrorText(stack, 'stack');
      return clone;
    }

    if (Array.isArray(current)) {
      const clone: unknown[] = [];
      seen.set(current, clone);
      for (const item of current) {
        clone.push(visit(item, depth + 1, context));
      }
      return clone;
    }

    if (current instanceof Map) {
      const clone = new Map<unknown, unknown>();
      seen.set(current, clone);
      for (const [key, item] of current) {
        const keyContext = typeof key === 'string'
          ? contextForProperty(key, item, context.errorContainer)
          : ROOT_VISIT_CONTEXT;
        clone.set(
          visit(key, depth + 1, ROOT_VISIT_CONTEXT),
          typeof key === 'string' && options.matchesKey(key)
            ? options.replacement
            : visit(item, depth + 1, keyContext),
        );
      }
      return clone;
    }

    if (current instanceof Set) {
      const clone = new Set<unknown>();
      seen.set(current, clone);
      for (const item of current) {
        clone.add(visit(item, depth + 1, context));
      }
      return clone;
    }

    const record = current as Record<string, unknown>;
    const currentIsError =
      context.errorContainer || looksLikeStructuredError(record);
    const clone: Record<string, unknown> = Object.create(null);
    seen.set(current, clone);
    const patchPath = Array.isArray(record.path) ? record.path : null;
    const redactPatchValue = patchPath?.some(
      (segment) => typeof segment === 'string' && options.matchesKey(segment),
    ) ?? false;
    for (const [key, item] of Object.entries(record)) {
      if (key === 'toJSON' && typeof item === 'function') {
        clone[key] = '[Function]';
        continue;
      }
      clone[key] =
        options.matchesKey(key) || (key === 'value' && redactPatchValue)
          ? options.replacement
          : visit(
              item,
              depth + 1,
              contextForProperty(key, item, currentIsError),
            );
    }
    return clone;
  };

  return visit(value, 0, ROOT_VISIT_CONTEXT);
}

function sanitizeErrorDetails(value: unknown): unknown {
  return cloneAndRedact(value, {
    matchesKey: () => false,
    replacement: ERROR_CREDENTIAL_REPLACEMENT,
    maxDepth: 100,
  });
}

/**
 * Build a non-mutating recursive redactor suitable for both state and traces.
 * It preserves arrays, Maps, Sets, Dates, shared references, and cycles.
 */
export function createKeyRedactor(
  options: KeyRedactorOptions = {},
): StateRedactor & TraceRedactor {
  const keys = options.keys ?? DEFAULT_SENSITIVE_KEYS;
  const replacement = options.replacement ?? '[REDACTED]';
  const maxDepth = options.maxDepth ?? 100;

  const matches = (key: string): boolean =>
    keys.some((candidate) => {
      if (typeof candidate === 'string') return candidate === key;
      candidate.lastIndex = 0;
      return candidate.test(key);
    });

  const redactor: StateRedactor & TraceRedactor = (value: unknown): unknown =>
    cloneAndRedact(value, {
      matchesKey: matches,
      replacement,
      maxDepth,
    });
  ERROR_SANITIZING_REDACTORS.add(redactor);
  return redactor;
}

export function redactDevtoolsEvent<T extends { type: string; payload?: any }>(
  event: T,
  redaction: DevtoolsRedaction | undefined,
  location: RedactionContext['location'],
): T {
  if (!redaction?.state && !redaction?.trace) return event;

  const apply = (
    value: unknown,
    redactor: StateRedactor | TraceRedactor | undefined,
    context: RedactionContext,
  ): unknown => {
    const redacted = redactor ? redactor(value, context) : value;
    return redactor && ERROR_SANITIZING_REDACTORS.has(redactor)
      ? redacted
      : sanitizeErrorDetails(redacted);
  };

  const withState = (
    value: unknown,
    dataKind: RedactionDataKind,
  ): unknown =>
    apply(value, redaction.state, {
      dataKind,
      eventType: event.type,
      location,
    });
  const withTrace = (trace: unknown): unknown => apply(
    trace,
    redaction.trace,
    {
      dataKind: 'trace',
      eventType: event.type,
      location,
    },
  );

  switch (event.type) {
    case 'reflex-app-db':
      return { ...event, payload: withState(event.payload, 'state') };
    case 'reflex-active-subs':
      return { ...event, payload: withState(event.payload, 'subscription') };
    case 'reflex-traces':
      return {
        ...event,
        payload: Array.isArray(event.payload)
          ? event.payload
              .map(withTrace)
              .filter((trace) => trace !== null && trace !== undefined)
          : [],
      };
    case 'reflex-dispatch-result':
      return event.payload?.trace
        ? {
            ...event,
            payload: { ...event.payload, trace: withTrace(event.payload.trace) },
          }
        : event;
    case 'reflex-eval-sub-result':
      if (!event.payload || typeof event.payload !== 'object') return event;
      if ('error' in event.payload) {
        return {
          ...event,
          payload: {
            ...event.payload,
            error: withState(
              event.payload.error,
              'subscription-result',
            ),
          },
        };
      }
      return 'value' in event.payload
        ? {
            ...event,
            payload: {
              ...event.payload,
              value: withState(event.payload.value, 'subscription-result'),
            },
          }
        : event;
    default:
      return event;
  }
}
