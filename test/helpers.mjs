/**
 * Test helpers: temporary repositories, a local shell executor with the same
 * shape as `ctx.shell`, a fake `gh` CLI, and a minimal plugin context.
 *
 * @module test/helpers
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Create a fresh temporary directory.
 * @param {string} [prefix] directory prefix.
 * @returns {string} absolute path.
 */
export function tempDir(prefix = 'dsh-ghp-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/**
 * Run one shell command synchronously.
 * @param {string} command shell command.
 * @param {{ cwd?: string, stdin?: string, env?: Record<string, string> }} [options] command facts.
 * @returns {{ code: number | null, stdout: string, stderr: string }} outcome.
 */
export function run(command, options = {}) {
  const result = spawnSync('bash', ['-c', command], {
    cwd: options.cwd,
    input: options.stdin,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * Write one executable shell script.
 * @param {string} directory parent directory.
 * @param {string} name file name.
 * @param {string} body script body.
 * @returns {string} absolute script path.
 */
export function writeExecutable(directory, name, body) {
  const file = path.join(directory, name)
  fs.writeFileSync(file, body)
  fs.chmodSync(file, 0o755)
  return file
}

/**
 * Create a shell executor matching `ctx.shell`'s resolve/execute/result shape.
 * @returns {{ resolve: Function, execute: Function }} executor.
 */
export function createRealShell() {
  const resolve = request => ({
    command: request.command,
    workdir: request.workdir ?? process.cwd(),
    timeoutMs: request.timeoutMs ?? 120000,
    onExpiry: request.onExpiry ?? 'kill',
    stdoutMaxBytes: request.stdoutMaxBytes ?? 1048576,
    signal: request.signal,
    stdin: request.stdin,
    env: request.env,
    sandboxPolicy: request.sandboxPolicy,
  })
  const execute = async spec => {
    const result = run(spec.command, { cwd: spec.workdir, stdin: spec.stdin, env: spec.env })
    const stdout = { text: result.stdout, truncated: false }
    const stderr = { text: result.stderr, truncated: false }
    return {
      status: 'completed',
      exitCode: result.code,
      signal: null,
      done: Promise.resolve(),
      readOutput: () => ({ delta: '', lossy: false }),
      observed: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      kill: () => false,
      async result() {
        return {
          exitCode: result.code,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: spec.timeoutMs,
          stdout,
          stderr,
        }
      },
    }
  }
  return { resolve, execute }
}

/**
 * Create a bare repository usable as a push target.
 * @param {string} parent parent directory.
 * @returns {string} bare repository path.
 */
export function createBareRemote(parent) {
  const bare = path.join(parent, 'remote.git')
  const created = run(`git init --bare -q '${bare}'`)
  if (created.code !== 0) throw new Error(`could not create bare remote: ${created.stderr}`)
  return bare
}

/**
 * Point a global git config at a host mapping so `https://github.com/...`
 * pushes and fetches resolve to a local bare repository.
 * @param {string} directory directory holding the config file.
 * @param {string} bare bare repository path.
 * @param {string} githubUrl URL that should be rewritten.
 * @returns {string} config file path.
 */
export function useLocalRemote(directory, bare, githubUrl) {
  const file = path.join(directory, 'gitconfig')
  fs.writeFileSync(file, `[url "file://${bare}"]\n\tinsteadOf = ${githubUrl}\n`)
  process.env.GIT_CONFIG_GLOBAL = file
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  return file
}

/**
 * Initialize a project repository with one commit.
 * @param {string} directory project directory.
 * @param {{ branch?: string }} [options] repository options.
 * @returns {void}
 */
export function initProject(directory, options = {}) {
  fs.mkdirSync(directory, { recursive: true })
  const branch = options.branch ?? 'main'
  const init = run(`git init -q -b '${branch}'`, { cwd: directory })
  if (init.code !== 0) throw new Error(init.stderr)
  run('git config user.name Tester', { cwd: directory })
  run('git config user.email tester@example.com', { cwd: directory })
  fs.writeFileSync(path.join(directory, 'README.md'), '# Project\n')
  const added = run('git add -A', { cwd: directory })
  if (added.code !== 0) throw new Error(added.stderr)
  const committed = run('git commit -q -m "chore: initial"', { cwd: directory })
  if (committed.code !== 0) throw new Error(committed.stderr)
}

/**
 * Create a fake `gh` executable.
 * @param {string} directory parent directory.
 * @returns {string} script path.
 */
export function writeFakeGh(directory) {
  const body = `#!/bin/bash
set -u
case "$1 $2" in
  "auth status")
    if [ "\${FAKE_GHP_AUTH:-ok}" = "ok" ]; then
      echo "github.com"
      exit 0
    fi
    echo "You are not logged into any GitHub hosts." >&2
    exit 1
    ;;
  "api user")
    echo '{"login":"tester","name":"Tester","email":"tester@example.com","id":12345}'
    exit 0
    ;;
  "api repos/"*"/check-runs")
    if [ -n "\${FAKE_GHP_CHECKS:-}" ]; then echo "\$FAKE_GHP_CHECKS"; else echo '{"check_runs":[]}'; fi
    exit 0
    ;;
  "api repos/"*"/statuses")
    if [ -n "\${FAKE_GHP_STATUSES:-}" ]; then echo "\$FAKE_GHP_STATUSES"; else echo '[]'; fi
    exit 0
    ;;
  "repo view")
    if [ "\${FAKE_GHP_REPO_EXISTS:-0}" = "1" ]; then
      echo '{"nameWithOwner":"tester/proj","defaultBranchRef":{"name":"main"},"isEmpty":false,"visibility":"private","url":"https://github.com/tester/proj","isPrivate":true}'
      exit 0
    fi
    echo "Could not resolve to a Repository with the name 'tester/proj'." >&2
    exit 1
    ;;
  "release view")
    if [ "\${FAKE_GHP_RELEASE:-0}" = "1" ]; then
      echo '{"url":"https://github.com/tester/project/releases/tag/v0.1.0","tagName":"v0.1.0","isDraft":false,"isPrerelease":false}'
      exit 0
    fi
    echo "release not found" >&2
    exit 1
    ;;
  "release create")
    echo "https://github.com/tester/project/releases/tag/\$3"
    exit 0
    ;;
  "repo create")
    echo "https://github.com/tester/proj"
    exit 0
    ;;
  "pr view")
    if [ "\${FAKE_GHP_PR_EXISTS:-0}" = "1" ]; then
      echo '{"url":"https://github.com/tester/proj/pull/7","number":7,"state":"OPEN","isDraft":false,"title":"chore: update","headRefName":"feat","baseRefName":"main"}'
      exit 0
    fi
    echo "no pull requests found" >&2
    exit 1
    ;;
  "pr create")
    echo "https://github.com/tester/proj/pull/7"
    exit 0
    ;;
esac
echo "unexpected gh invocation: $*" >&2
exit 1
`
  return writeExecutable(directory, 'gh', body)
}

/**
 * Build a minimal plugin context around one project directory.
 * @param {{ projectDir: string, sessionId?: string, mode?: string, forgeSession?: object | null }} options context facts.
 * @returns {{ ctx: object, tracked: string[], shell: object }} context, tracked bindings, executor.
 */
export function makeContext(options) {
  const sessionId = options.sessionId ?? 'session-test'
  const projectDir = options.projectDir
  const mode = options.mode ?? 'danger-full-access'
  const shell = createRealShell()
  const tracked = []
  const forgeSession = options.forgeSession === null
    ? null
    : options.forgeSession ?? {
      track: (_session, url) => {
        tracked.push(url)
      },
      changeRequests: () => options.changeRequests ?? [],
    }
  const session = { id: sessionId, header: { cwd: projectDir } }
  const ctx = {
    get(key) {
      if (key === 'sessions') return { get: id => (id === sessionId ? session : undefined) }
      if (key === 'workingDirectory') return { get: () => projectDir }
      if (key === 'shell') return shell
      if (key === 'sandboxPolicy') return { resolve: () => ({ mode, workspaceRoot: projectDir }) }
      if (key === 'forgeSession') return forgeSession
      return undefined
    },
  }
  return { ctx, tracked, shell, session }
}
