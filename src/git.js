/**
 * Git command adapter. Pure command construction and output parsing; every
 * command goes through the injected runner so tests can substitute a fake and
 * production keeps the Session sandbox.
 *
 * @module dsh-plugin-github-push/git
 */

import { shellQuote, splitNul } from './util.js'

/** Credential helper that reads the host `gh` credential store without writing config. */
const GH_CREDENTIAL_HELPER = '!gh auth git-credential'

/**
 * Parse `git status --porcelain=v2 --branch` output.
 * @param {string} stdout status output.
 * @returns {{ branch: string | null, detached: boolean, upstream: string | null, ahead: number, behind: number, dirty: boolean, staged: number, unstaged: number, untracked: number, unmerged: number }} summary.
 */
export function parseStatus(stdout) {
  const summary = {
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    dirty: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    unmerged: 0,
  }
  for (const line of String(stdout ?? '').split('\n')) {
    if (line.length === 0) continue
    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim()
      if (value === '(detached)') summary.detached = true
      else summary.branch = value
      continue
    }
    if (line.startsWith('# branch.upstream ')) {
      summary.upstream = line.slice('# branch.upstream '.length).trim()
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const match = /^\+\s*(\d+)\s+-\s*(\d+)$/.exec(line.slice('# branch.ab '.length).trim())
      if (match !== null) {
        summary.ahead = Number(match[1])
        summary.behind = Number(match[2])
      }
      continue
    }
    if (line.startsWith('#')) continue
    summary.dirty = true
    const kind = line[0]
    if (kind === '?') {
      summary.untracked += 1
    } else if (kind === 'u') {
      summary.unmerged += 1
    } else if (kind === '1' || kind === '2') {
      const x = line[2]
      const y = line[3]
      if (x !== '.' && x !== ' ') summary.staged += 1
      if (y !== '.' && y !== ' ') summary.unstaged += 1
    }
  }
  return summary
}

/**
 * Parse `git log --pretty=format` records separated by 0x1e, with 0x00 fields:
 * hash, short hash, parents, author, author date, subject, decorations.
 * @param {string} stdout log output.
 * @returns {{ sha: string, shortSha: string, parents: string[], author: string, time: string, subject: string, refs: string[] }[]} commits newest first.
 */
export function parseLogOutput(stdout) {
  const rows = []
  for (const record of String(stdout ?? '').split('\x1e')) {
    const raw = record.replace(/^\n/, '')
    if (raw.length === 0) continue
    const fields = raw.split('\0')
    if (fields.length < 7) continue
    const parentsText = fields[2].trim()
    rows.push({
      sha: fields[0],
      shortSha: fields[1],
      parents: parentsText.length === 0 ? [] : parentsText.split(' '),
      author: fields[3],
      time: fields[4],
      subject: fields[5],
      refs: fields[6].split(',').map(ref => ref.trim()).filter(ref => ref.length > 0),
    })
  }
  return rows
}

/**
 * Parse `git diff --cached --shortstat` output.
 * @param {string} stdout shortstat line.
 * @returns {{ files: number, insertions: number, deletions: number }} counts.
 */
export function parseShortStat(stdout) {
  const text = String(stdout ?? '')
  const files = /(\d+) files? changed/.exec(text)
  const insertions = /(\d+) insertions?\(\+\)/.exec(text)
  const deletions = /(\d+) deletions?\(-\)/.exec(text)
  return {
    files: files === null ? 0 : Number(files[1]),
    insertions: insertions === null ? 0 : Number(insertions[1]),
    deletions: deletions === null ? 0 : Number(deletions[1]),
  }
}

/** Git command adapter bound to one working directory and runner. */
export class Git {
  /**
   * @param {{ run: Function, cwd: string, config: object }} options runner and effective config.
   */
  constructor(options) {
    this.run = options.run
    this.cwd = options.cwd
    this.config = options.config
  }

  /**
   * Run one git subcommand in a directory.
   * @param {string[]} args argument words.
   * @param {{ workdir?: string, stdin?: string, timeoutMs?: number, maxBytes?: number }} [options] command options.
   * @returns {Promise<object>} normalized runner result.
   */
  async git(args, options = {}) {
    const workdir = options.workdir ?? this.cwd
    const command = [shellQuote(this.config.gitCommand), '-C', shellQuote(workdir), ...args].join(' ')
    const request = { command, timeoutMs: options.timeoutMs ?? this.config.timeoutMs }
    if (options.stdin !== undefined) request.stdin = options.stdin
    if (options.maxBytes !== undefined) request.maxBytes = options.maxBytes
    return this.run(request)
  }

  /**
   * Report the git version.
   * @returns {Promise<object>} runner result.
   */
  version() {
    return this.git(['--version'], { workdir: this.cwd })
  }

  /**
   * Locate the repository top level for a directory.
   * @param {string} [directory] candidate directory.
   * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>} raw result.
   */
  toplevel(directory = this.cwd) {
    return this.git(['rev-parse', '--show-toplevel'], { workdir: directory })
  }

  /**
   * Initialize a repository with a `main` default branch.
   * @returns {Promise<object>} runner result.
   */
  async init() {
    const first = await this.git(['init', '-b', 'main'])
    if (first.code === 0) return first
    const second = await this.git(['init'])
    if (second.code === 0) await this.git(['symbolic-ref', 'HEAD', 'refs/heads/main'])
    return second.code === 0 ? second : first
  }

  /**
   * Read the checked-out branch, or null when detached.
   * @param {string} root repository root.
   * @returns {Promise<{ branch: string | null, detached: boolean, head: string | null }>} branch facts.
   */
  async branch(root) {
    const symbolic = await this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { workdir: root })
    if (symbolic.code === 0) {
      return { branch: symbolic.stdout.trim(), detached: false, head: null }
    }
    const head = await this.git(['rev-parse', '--verify', '--quiet', 'HEAD'], { workdir: root })
    return {
      branch: null,
      detached: true,
      head: head.code === 0 ? head.stdout.trim() : null,
    }
  }

  /**
   * Read the working-tree status summary.
   * @param {string} root repository root.
   * @returns {Promise<ReturnType<typeof parseStatus>>} status summary.
   */
  async status(root) {
    const result = await this.git(['status', '--porcelain=v2', '--branch'], { workdir: root })
    return parseStatus(result.stdout)
  }

  /**
   * Read all refs as one graph-friendly commit list, newest first.
   * @param {string} root repository root.
   * @param {number} [limit] maximum commits.
   * @returns {Promise<ReturnType<typeof parseLogOutput>>} commits.
   */
  async logCommits(root, limit = 80) {
    const format = '%H%x00%h%x00%P%x00%an%x00%aI%x00%s%x00%D%x1e'
    const pretty = shellQuote(`--pretty=format:${format}`)
    const result = await this.git([
      'log', '--all', '--date-order', `--max-count=${limit}`, pretty,
    ], { workdir: root, maxBytes: this.config.maxOutputBytes })
    return parseLogOutput(result.stdout)
  }

  /**
   * Read repository-local and global identity without failing when unset.
   * @param {string} root repository root.
   * @returns {Promise<{ name: string | null, email: string | null }>} identity.
   */
  async identity(root) {
    const name = await this.git(['config', '--get', 'user.name'], { workdir: root })
    const email = await this.git(['config', '--get', 'user.email'], { workdir: root })
    return {
      name: name.code === 0 ? name.stdout.trim() : null,
      email: email.code === 0 ? email.stdout.trim() : null,
    }
  }

  /**
   * Write repository-local author identity. Never touches global config.
   * @param {string} root repository root.
   * @param {string} name author name.
   * @param {string} email author email.
   * @returns {Promise<object>} last runner result.
   */
  async configureIdentity(root, name, email) {
    const first = await this.git(['config', '--local', 'user.name', name], { workdir: root })
    if (first.code !== 0) return first
    return this.git(['config', '--local', 'user.email', email], { workdir: root })
  }

  /**
   * Stage every tracked and untracked change, honoring `.gitignore`.
   * @param {string} root repository root.
   * @returns {Promise<object>} runner result.
   */
  addAll(root) {
    return this.git(['add', '-A'], { workdir: root })
  }

  /**
   * Report whether the index has staged changes.
   * @param {string} root repository root.
   * @returns {Promise<boolean>} staged state.
   */
  async hasStagedChanges(root) {
    const result = await this.git(['diff', '--cached', '--quiet'], { workdir: root })
    if (result.code === 0) return false
    if (result.code === 1) return true
    throw new Error(`git diff --cached failed: ${result.stderr.trim()}`)
  }

  /**
   * List staged paths.
   * @param {string} root repository root.
   * @returns {Promise<string[]>} repository-relative paths.
   */
  async stagedFiles(root) {
    const result = await this.git(['diff', '--cached', '--name-only', '-z'], { workdir: root })
    return splitNul(result.stdout)
  }

  /**
   * Read staged line counts.
   * @param {string} root repository root.
   * @returns {Promise<ReturnType<typeof parseShortStat>>} counts.
   */
  async stagedStat(root) {
    const result = await this.git(['diff', '--cached', '--shortstat'], { workdir: root })
    return parseShortStat(result.stdout)
  }

  /**
   * Create one commit from the staged changes, reading the message from stdin.
   * @param {string} root repository root.
   * @param {string} message commit message.
   * @returns {Promise<object>} runner result.
   */
  commit(root, message) {
    return this.git(['commit', '--file', '-'], { workdir: root, stdin: message })
  }

  /**
   * Read the current commit identity and subject.
   * @param {string} root repository root.
   * @returns {Promise<{ sha: string | null, shortSha: string | null, subject: string | null }>} commit facts.
   */
  async headCommit(root) {
    const sha = await this.git(['rev-parse', '--verify', 'HEAD'], { workdir: root })
    if (sha.code !== 0) return { sha: null, shortSha: null, subject: null }
    const short = await this.git(['rev-parse', '--short', 'HEAD'], { workdir: root })
    const subject = await this.git(['log', '-1', '--pretty=%s'], { workdir: root })
    return {
      sha: sha.stdout.trim(),
      shortSha: short.code === 0 ? short.stdout.trim() : sha.stdout.trim().slice(0, 7),
      subject: subject.code === 0 ? subject.stdout.trim() : null,
    }
  }

  /**
   * Read one remote URL.
   * @param {string} root repository root.
   * @param {string} remote remote name.
   * @returns {Promise<string | null>} remote URL or null.
   */
  async remoteUrl(root, remote) {
    const result = await this.git(['config', '--get', `remote.${remote}.url`], { workdir: root })
    return result.code === 0 ? result.stdout.trim() : null
  }

  /**
   * Add one remote.
   * @param {string} root repository root.
   * @param {string} remote remote name.
   * @param {string} url remote URL.
   * @returns {Promise<object>} runner result.
   */
  addRemote(root, remote, url) {
    return this.git(['remote', 'add', remote, url], { workdir: root })
  }

  /**
   * Count commits ahead of and behind an upstream ref.
   * @param {string} root repository root.
   * @param {string} upstream upstream ref such as `origin/main`.
   * @returns {Promise<{ ahead: number | null, behind: number | null }>} divergence.
   */
  async aheadBehind(root, upstream) {
    const ahead = await this.git(['rev-list', '--count', `${upstream}..HEAD`], { workdir: root })
    const behind = await this.git(['rev-list', '--count', `HEAD..${upstream}`], { workdir: root })
    return {
      ahead: ahead.code === 0 ? Number(ahead.stdout.trim()) : null,
      behind: behind.code === 0 ? Number(behind.stdout.trim()) : null,
    }
  }

  /**
   * Read the remote's default branch from `refs/remotes/<remote>/HEAD`.
   * @param {string} root repository root.
   * @param {string} remote remote name.
   * @returns {Promise<string | null>} branch name.
   */
  async defaultBranchFromRemoteHead(root, remote) {
    const result = await this.git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], { workdir: root })
    if (result.code !== 0) return null
    const value = result.stdout.trim()
    return value.startsWith(`${remote}/`) ? value.slice(remote.length + 1) : value
  }

  /**
   * Push one branch and set its upstream.
   * @param {string} root repository root.
   * @param {{ remote: string, branch: string, force: boolean }} request push facts.
   * @returns {Promise<object>} runner result.
   */
  push(root, request) {
    const args = [
      '-c', 'credential.helper=',
      '-c', `credential.helper=${shellQuote(GH_CREDENTIAL_HELPER)}`,
      'push', '--set-upstream', request.remote, request.branch,
    ]
    if (request.force) args.push('--force-with-lease')
    return this.git(args, { workdir: root, timeoutMs: this.config.pushTimeoutMs ?? this.config.timeoutMs })
  }

  /**
   * Resolve a local tag to its commit.
   * @param {string} root repository root.
   * @param {string} tag tag name.
   * @returns {Promise<string | null>} commit object name, or null when absent.
   */
  async resolveTag(root, tag) {
    const result = await this.git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { workdir: root })
    return result.code === 0 ? result.stdout.trim() : null
  }

  /**
   * Create an annotated tag with the message on stdin.
   * @param {string} root repository root.
   * @param {string} tag tag name.
   * @param {string} message tag message.
   * @returns {Promise<object>} runner result.
   */
  createTag(root, tag, message) {
    return this.git(['tag', '-a', tag, '-F', '-'], { workdir: root, stdin: message })
  }

  /**
   * Push one tag with the gh credential helper, without rewriting config.
   * @param {string} root repository root.
   * @param {string} tag tag name.
   * @returns {Promise<object>} runner result.
   */
  pushTag(root, tag) {
    return this.git([
      '-c', 'credential.helper=',
      '-c', `credential.helper=${shellQuote(GH_CREDENTIAL_HELPER)}`,
      'push', this.config.remoteName, `refs/tags/${tag}`,
    ], { workdir: root, timeoutMs: this.config.pushTimeoutMs ?? this.config.timeoutMs })
  }

  /**
   * Report whether a local branch exists.
   * @param {string} root repository root.
   * @param {string} branch branch name.
   * @returns {Promise<boolean>} existence.
   */
  async branchExists(root, branch) {
    const result = await this.git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { workdir: root })
    return result.code === 0
  }
}
