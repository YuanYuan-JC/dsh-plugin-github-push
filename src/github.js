/**
 * GitHub CLI adapter. Reads and writes through the host's signed-in `gh`
 * credential store; never accepts, stores, or prints a token itself.
 *
 * @module dsh-plugin-github-push/github
 */

import { shellQuote } from './util.js'

/** Fields requested from `gh repo view` and `gh pr view`. */
const REPO_FIELDS = 'nameWithOwner,defaultBranchRef,isEmpty,visibility,url,isPrivate,description'
const PR_FIELDS = 'url,number,state,isDraft,title,headRefName,baseRefName'

/**
 * Parse JSON output without throwing on malformed text.
 * @param {string} text command stdout.
 * @returns {object | null} parsed value.
 */
function parseJson(text) {
  try {
    const value = JSON.parse(String(text ?? ''))
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * Parse a JSON array output without throwing on malformed text.
 * @param {string} text command stdout.
 * @returns {object[]} parsed array, or an empty array.
 */
function parseJsonArray(text) {
  try {
    const value = JSON.parse(String(text ?? ''))
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/** GitHub CLI adapter bound to one working directory and runner. */
export class Github {
  /**
   * @param {{ run: Function, cwd: string, config: object }} options runner and effective config.
   */
  constructor(options) {
    this.run = options.run
    this.cwd = options.cwd
    this.config = options.config
  }

  /**
   * Run one gh subcommand.
   * @param {string[]} args argument words.
   * @param {{ workdir?: string, stdin?: string, timeoutMs?: number }} [options] command options.
   * @returns {Promise<object>} normalized runner result.
   */
  async gh(args, options = {}) {
    const command = [shellQuote(this.config.ghCommand), ...args].join(' ')
    const request = {
      command,
      workdir: options.workdir ?? this.cwd,
      timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
    }
    if (options.stdin !== undefined) request.stdin = options.stdin
    return this.run(request)
  }

  /**
   * Probe host sign-in.
   * @param {string} [host] GitHub host.
   * @returns {Promise<object>} runner result; exit code 0 means signed in.
   */
  authStatus(host = 'github.com') {
    return this.gh(['auth', 'status', '--hostname', host])
  }

  /**
   * Read the signed-in account.
   * @returns {Promise<{ login: string, name: string | null, email: string | null, id: number | null } | null>} account.
   */
  async user() {
    const result = await this.gh(['api', 'user'])
    if (result.code !== 0) return null
    const value = parseJson(result.stdout)
    if (value === null || typeof value.login !== 'string') return null
    return {
      login: value.login,
      name: typeof value.name === 'string' && value.name.length > 0 ? value.name : null,
      email: typeof value.email === 'string' && value.email.length > 0 ? value.email : null,
      id: typeof value.id === 'number' ? value.id : null,
    }
  }

  /**
   * Read a repository, distinguishing a missing repository from a failed read.
   * @param {string} repo `owner/name`.
   * @param {string} [workdir] command working directory.
   * @returns {Promise<{ info: object | null, notFound: boolean, detail: string }>} repository facts.
   */
  async repoView(repo, workdir = this.cwd) {
    const result = await this.gh(['repo', 'view', repo, '--json', REPO_FIELDS], { workdir })
    if (result.code === 0) {
      const info = parseJson(result.stdout)
      return { info, notFound: false, detail: '' }
    }
    const detail = `${result.stdout}\n${result.stderr}`.trim()
    const notFound = /could not resolve to a repository|not found|http 404|does not exist/i.test(detail)
    return { info: null, notFound, detail }
  }

  /**
   * Create an empty GitHub repository.
   * @param {string} repo `owner/name`.
   * @param {{ visibility: 'private' | 'public', description?: string }} options repository options.
   * @returns {Promise<{ code: number | null, url: string | null, stdout: string, stderr: string }>} creation result.
   */
  async createRepo(repo, options) {
    const args = ['repo', 'create', repo]
    args.push(options.visibility === 'public' ? '--public' : '--private')
    if (typeof options.description === 'string' && options.description.length > 0) {
      args.push('--description', shellQuote(options.description))
    }
    const result = await this.gh(args, { workdir: this.cwd })
    const urls = String(result.stdout ?? '').match(/https:\/\/[^\s]+\/[^\s]+/g)
    return {
      code: result.code,
      url: urls === null ? null : urls[urls.length - 1],
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }

  /**
   * Read the combined checks and commit statuses of one commit.
   * @param {string} repo `owner/name`.
   * @param {string} sha full commit object name.
   * @param {string} [workdir] command working directory.
   * @returns {Promise<{ state: 'none' | 'pending' | 'success' | 'failure', total: number, passed: number, pending: number, failed: number, runs: { name: string, state: 'pending' | 'success' | 'failure' | 'neutral' | 'skipped' | 'cancelled' }[] }>} rollup and per-run facts.
   */
  async commitChecks(repo, sha, workdir = this.cwd) {
    const runsResult = await this.gh(['api', `repos/${repo}/commits/${sha}/check-runs`], { workdir })
    const statusResult = await this.gh(['api', `repos/${repo}/commits/${sha}/statuses`], { workdir })
    if (runsResult.code !== 0 && statusResult.code !== 0) {
      const detail = `${runsResult.stdout}\n${runsResult.stderr}\n${statusResult.stdout}\n${statusResult.stderr}`.trim()
      throw new Error(`GitHub checks could not be read: ${detail}`)
    }
    const runs = []
    let total = 0
    let passed = 0
    let pending = 0
    let failed = 0
    const snapshot = runsResult.code === 0 ? parseJson(runsResult.stdout) : null
    const checkRuns = Array.isArray(snapshot?.check_runs) ? snapshot.check_runs : []
    for (const run of checkRuns) {
      if (run === null || typeof run !== 'object') continue
      const status = typeof run.status === 'string' ? run.status : ''
      const conclusion = typeof run.conclusion === 'string' ? run.conclusion : ''
      let state
      if (status !== 'completed') state = 'pending'
      else if (conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped') state = 'success'
      else if (conclusion === 'cancelled') state = 'cancelled'
      else state = 'failure'
      total += 1
      if (state === 'pending') pending += 1
      else if (state === 'failure') failed += 1
      else if (state === 'success') passed += 1
      if (runs.length < 100 && typeof run.name === 'string') {
        runs.push({ name: run.name, state })
      }
    }
    const statuses = statusResult.code === 0 ? parseJsonArray(statusResult.stdout) : []
    for (const entry of statuses) {
      if (entry === null || typeof entry !== 'object') continue
      const state = entry.state === 'success' ? 'success' : entry.state === 'pending' ? 'pending' : 'failure'
      total += 1
      if (state === 'pending') pending += 1
      else if (state === 'failure') failed += 1
      else passed += 1
      if (runs.length < 100 && typeof entry.context === 'string') {
        runs.push({ name: entry.context, state })
      }
    }
    return {
      state: total === 0 ? 'none' : failed > 0 ? 'failure' : pending > 0 ? 'pending' : 'success',
      total,
      passed,
      pending,
      failed,
      runs,
    }
  }

  /**
   * Read one GitHub release by tag.
   * @param {string} tag tag name.
   * @param {string} [workdir] repository checkout.
   * @returns {Promise<object | null>} release facts, or null when absent.
   */
  async releaseView(tag, workdir = this.cwd) {
    const result = await this.gh(['release', 'view', tag, '--json', 'url,isDraft,isPrerelease,tagName'], { workdir })
    if (result.code !== 0) return null
    const value = parseJson(result.stdout)
    return value !== null && typeof value.url === 'string' ? value : null
  }

  /**
   * Create a GitHub release for an already-pushed tag. Notes travel on stdin.
   * @param {{ tag: string, title: string, notes: string }} request release facts.
   * @param {string} [workdir] repository checkout.
   * @returns {Promise<{ code: number | null, url: string | null, detail: string }>} creation result.
   */
  async releaseCreate(request, workdir = this.cwd) {
    const result = await this.gh([
      'release', 'create', request.tag,
      '--verify-tag',
      '--title', shellQuote(request.title),
      '--notes-file', '-',
    ], { workdir, stdin: request.notes })
    const detail = `${result.stdout}\n${result.stderr}`.trim()
    if (result.code !== 0) return { code: result.code, url: null, detail }
    const urls = String(result.stdout ?? '').match(/https:\/\/github\.com\/[^\s]+\/releases\/tag\/[^\s]+/g)
    return { code: 0, url: urls === null ? null : urls[urls.length - 1], detail }
  }

  /**
   * Read the pull request whose head is one branch.
   * @param {string} branch head branch.
   * @param {string} [workdir] repository checkout.
   * @returns {Promise<object | null>} pull request facts, or null when none exists.
   */
  async prView(branch, workdir = this.cwd) {
    const result = await this.gh(['pr', 'view', branch, '--json', PR_FIELDS], { workdir })
    if (result.code !== 0) return null
    const value = parseJson(result.stdout)
    if (value === null || typeof value.url !== 'string') return null
    // A merged or closed pull request must not be reused for a new push on the
    // same branch name; only an OPEN request can be updated in place.
    if (value.state !== 'OPEN') return null
    return value
  }

  /**
   * Create a pull request. The body travels on stdin to avoid shell quoting.
   * @param {{ base: string, head: string, title: string, body: string, draft: boolean }} request PR facts.
   * @param {string} [workdir] repository checkout.
   * @returns {Promise<{ code: number | null, pr: object | null, detail: string }>} creation result.
   */
  async prCreate(request, workdir = this.cwd) {
    const args = [
      'pr', 'create',
      '--base', shellQuote(request.base),
      '--head', shellQuote(request.head),
      '--title', shellQuote(request.title),
      '--body-file', '-',
    ]
    if (request.draft) args.push('--draft')
    const result = await this.gh(args, { workdir, stdin: request.body })
    const detail = `${result.stdout}\n${result.stderr}`.trim()
    if (result.code !== 0) return { code: result.code, pr: null, detail }
    const urls = String(result.stdout ?? '').match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/g)
    const url = urls === null ? null : urls[urls.length - 1]
    if (url !== null) {
      const number = Number(/\/pull\/(\d+)$/.exec(url)?.[1] ?? 0)
      return {
        code: 0,
        pr: { url, number: Number.isFinite(number) ? number : null, state: 'OPEN', isDraft: request.draft, title: request.title },
        detail,
      }
    }
    const view = await this.prView(request.head, workdir)
    return { code: 0, pr: view, detail }
  }
}
