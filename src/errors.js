/**
 * Stable failure vocabulary shared by the github-push service, tool, and
 * slash command. Expected operational failures travel as canonical result
 * values with `ok: false`; this error class is for steps that abort the
 * pipeline and for unexpected exceptions.
 *
 * @module dsh-plugin-github-push/errors
 */

/** One operational failure with a stable code and an actionable hint. */
export class PushError extends Error {
  /**
   * @param {string} code stable lowercase code returned to the caller.
   * @param {string} message short human-readable failure.
   * @param {string} [hint] actionable next step for the user.
   */
  constructor(code, message, hint) {
    super(message)
    this.name = 'PushError'
    this.code = code
    this.hint = hint
  }
}

/**
 * Build the canonical failure value of a result object.
 * @param {string} code stable lowercase code.
 * @param {string} message short human-readable failure.
 * @param {string} [hint] actionable next step.
 * @returns {{ ok: false, error: { code: string, message: string, hint?: string } }} failure.
 */
export function failure(code, message, hint) {
  const error = hint === undefined ? { code, message } : { code, message, hint }
  return { ok: false, error }
}

/**
 * Convert any thrown value into a canonical failure value.
 * @param {unknown} thrown caught value.
 * @returns {{ ok: false, error: { code: string, message: string, hint?: string } }} failure.
 */
export function failureOf(thrown) {
  if (thrown instanceof PushError) return failure(thrown.code, thrown.message, thrown.hint)
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  return failure('internal', message)
}

/**
 * Describe a failure value for a slash-command or tool result text.
 * @param {{ code: string, message: string, hint?: string }} error failure detail.
 * @returns {string} one human-readable paragraph.
 */
export function describeFailure(error) {
  const hint = error.hint === undefined ? '' : ` Hint: ${error.hint}`
  return `${error.code}: ${error.message}${hint}`
}
