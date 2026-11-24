/** The words agents use when their provider blocks a request outright, as opposed to an answer that only mentions a limit. */
const REFUSED = [/appears to violate (?:our|the) usage polic(?:y|ies)/i, /\bis unable to respond to this request\b/i, /\bAPI Error:.*\brefus/i];

export function refusedReply(text: string): boolean {
  return REFUSED.some((pattern) => pattern.test(text));
}
