/**
 * Shell runner used by the git and GitHub adapters. Commands run through
 * `ctx.shell` so the calling Session's sandbox mode and workspace boundary
 * apply, and through `ctx.sandboxPolicy` so that policy is resolved per call.
 *
 * @module dsh-plugin-github-push/runner
 */

/** Environment shared by every child command: non-interactive, no pager. */
const BASE_ENV = Object.freeze({
  GH_PROMPT_DISABLED: '1',
  GH_PAGER: 'cat',
  GH_NO_UPDATE_NOTIFIER: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  NO_COLOR: '1',
  PAGER: 'cat',
})

/**
 * Build the runner for one invocation.
 * @param {{ shell: object, sandboxPolicy?: object, session?: object, config: object, signal: AbortSignal }} options
 *   resolved services and invocation facts.
 * @returns {{ run: (invocation: { command: string, workdir?: string, stdin?: string, env?: Record<string, string>, timeoutMs?: number, maxBytes?: number }) => Promise<object> }} runner.
 */
export function createRunner(options) {
  const { shell, sandboxPolicy, session, config, signal } = options
  let policy
  if (sandboxPolicy !== undefined && sandboxPolicy !== null) {
    const request = session === undefined ? {} : { session }
    policy = sandboxPolicy.resolve(request)
  }
  /**
   * Run one command and normalize its outcome.
   * @param {{ command: string, workdir?: string, stdin?: string, env?: Record<string, string>, timeoutMs?: number, maxBytes?: number }} invocation command facts.
   * @returns {Promise<{ code: number | null, stdout: string, stderr: string, timedOut: boolean, aborted: boolean, sandbox?: object }>} outcome.
   */
  async function run(invocation) {
    const request = {
      command: invocation.command,
      timeoutMs: invocation.timeoutMs ?? config.timeoutMs,
      stdoutMaxBytes: invocation.maxBytes ?? config.maxOutputBytes,
      env: { ...BASE_ENV, ...invocation.env },
      signal,
    }
    if (invocation.workdir !== undefined) request.workdir = invocation.workdir
    if (invocation.stdin !== undefined) request.stdin = invocation.stdin
    if (policy !== undefined) request.sandboxPolicy = policy
    const spec = shell.resolve(request)
    const handle = await shell.execute(spec)
    const result = await handle.result()
    return {
      code: result.exitCode,
      stdout: result.stdout.text,
      stderr: result.stderr.text,
      timedOut: result.timedOut,
      aborted: result.aborted,
      sandbox: result.sandbox,
    }
  }
  return { run, policy }
}
