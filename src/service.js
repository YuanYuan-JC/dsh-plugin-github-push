/**
 * Host service behind both the `github_push` tool and the `/github-push`
 * slash command. One explicit invocation surveys the working tree, commits
 * once, ensures the GitHub remote, pushes, opens a pull request, and binds it
 * to the Session for the official change-request panel.
 *
 * Nothing in this module registers automatic behavior: a commit can only be
 * produced while handling an explicit push request.
 *
 * @module dsh-plugin-github-push/service
 */

import { readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { normalizeConfig } from './config.js'
import { PushError, describeFailure, failureOf } from './errors.js'
import { Git } from './git.js'
import { Github } from './github.js'
import { chooseMessage, prBody, prTitle } from './message.js'
import { deniedBy, featureBranchName, hostAllowed, isInside, ownerAllowed, parseRemote, repositoryName } from './policy.js'
import { projectDisplayName } from './project-name.js'
import { createRunner } from './runner.js'
import { clip, describeStat, jsonSafe, normalizeMessage, redact } from './util.js'

/** Default empty change counts. */
function emptyCounts() {
  return { staged: 0, unstaged: 0, untracked: 0, dirty: false }
}

/** Zero staged stat. */
function emptyStat() {
  return { files: 0, insertions: 0, deletions: 0 }
}

/**
 * Resolve a real filesystem path without failing on a missing target.
 * @param {string} target absolute or relative path.
 * @returns {string | null} real path or null.
 */
function safeRealpath(target) {
  try {
    return realpathSync(target)
  } catch {
    return null
  }
}

/**
 * Parse an `owner/name` repository selector.
 * @param {unknown} value candidate.
 * @returns {{ owner: string, name: string } | null} coordinates; null for empty input.
 */
function parseRepoSelector(value) {
  if (value === undefined || value === null || value === '') return null
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(String(value).trim())
  if (match === null) {
    throw new PushError('invalid-repo', `"${String(value)}" is not an owner/name repository selector.`, 'Pass repo as owner/name, for example octocat/hello-world.')
  }
  return { owner: match[1], name: match[2] }
}

/**
 * Render one checks rollup compactly.
 * @param {{ state: string, total: number, passed: number, pending: number, failed: number }} checks checks facts.
 * @returns {string} summary such as "pending (2/5)".
 */
function describeChecks(checks) {
  const counts = checks.state === 'none' ? '' : ` (${checks.passed}/${checks.total} passed)`
  return `${checks.state}${counts}`
}

/**
 * Read a non-empty default branch name from a `gh repo view` value.
 * An empty repository reports an empty name, which must fall back like null.
 * @param {object | null} repoInfo repository facts.
 * @returns {string | null} default branch name.
 */
function repoDefaultBranch(repoInfo) {
  const name = repoInfo?.defaultBranchRef?.name
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null
}

/**
 * Report whether a GitHub repository is still empty.
 * @param {object | null} repoInfo repository facts.
 * @returns {boolean} empty state.
 */
function repoIsEmpty(repoInfo) {
  return repoInfo?.isEmpty === true
}

/**
 * Render one result for model content or slash-command text.
 * @param {object} result canonical result value.
 * @returns {string} human-readable summary.
 */
export function summarizeResult(result) {
  if (result === null || typeof result !== 'object') return String(result)
  if (result.ok === false) return `GitHub push failed: ${describeFailure(result.error)}`
  const lines = []
  if (result.action === 'plan') {
    const label = result.repository?.nameWithOwner ?? (result.repository === null ? 'a new repository' : `${result.repository.owner}/${result.repository.name}`)
    lines.push(`Push plan for ${label}:`)
    lines.push(`- Branch: ${result.branch ?? '(detached)'} (base ${result.baseBranch ?? 'unknown'})`)
    lines.push(`- Repository: ${result.repository?.webUrl ?? 'will be created'}`)
    lines.push(`- Changes: ${result.changes.dirty ? `${result.changes.staged + result.changes.unstaged} tracked, ${result.changes.untracked} untracked` : 'none'}`)
    lines.push(`- Commit message: ${result.commitMessage}`)
    if (result.willCreateRepo) lines.push('- Will create the GitHub repository')
    if (result.willCreateBranch === true) lines.push(`- Will create branch ${result.proposedBranch} from ${result.baseBranch} for pull-request tracking`)
    if (result.tag !== null && result.tag !== undefined) lines.push(`- Tag: ${result.tag.name}${result.release === null || result.release === undefined ? '' : ' (with GitHub release)'}`)
    if (result.pullRequest?.create === true) lines.push(`- Will create a pull request into ${result.pullRequest.base}`)
    if (result.pullRequest?.url !== undefined) lines.push(`- Will update the existing pull request ${result.pullRequest.url}`)
    lines.push(`- GitHub CLI ready: ${result.ready?.gh === true ? 'yes' : 'no'}`)
  } else if (result.action === 'status') {
    lines.push(`GitHub status for ${result.repository?.nameWithOwner ?? result.cwd}:`)
    lines.push(result.isRepository === false ? '- Not a Git repository in this directory' : `- Branch: ${result.branch ?? '(detached)'}`)
    if (result.commit?.sha !== null && result.commit?.sha !== undefined) lines.push(`- Commit: ${result.commit.shortSha ?? result.commit.sha.slice(0, 7)}`)
    if (result.checks !== null && result.checks !== undefined) lines.push(`- Checks: ${describeChecks(result.checks)}`)
    if (result.changeRequests.length === 0) lines.push('- No change requests bound to this session')
    for (const entry of result.changeRequests) {
      const state = entry.state === undefined ? 'not polled yet' : entry.state
      lines.push(`- ${entry.url} — ${state}${entry.checksRollup === undefined ? '' : `, checks ${entry.checksRollup}`}`)
    }
  } else if (result.action === 'graph') {
    lines.push(`Git graph for ${result.repository?.nameWithOwner ?? 'no GitHub repository'}:`)
    lines.push(`- Commits: ${Array.isArray(result.commits) ? result.commits.length : 0}`)
    if (result.branch !== null && result.branch !== undefined) lines.push(`- Branch: ${result.branch}`)
  } else {
    lines.push(`Pushed ${result.repository.nameWithOwner} (${result.branch}) to GitHub.`)
    if (result.pushed?.newCommit === false) lines.push('- No new commit was created')
    if (result.commit !== null) lines.push(`- Commit: ${result.commit.shortSha} ${result.commit.subject ?? ''}`.trim())
    if (result.pushed?.commitUrl !== undefined) lines.push(`- Commit URL: ${result.pushed.commitUrl}`)
    if (result.pullRequest !== null) lines.push(`- Pull request: ${result.pullRequest.url}`)
    if (result.tracking?.bound === true) lines.push('- Bound to the change-request panel for tracking')
    if (result.checks !== null && result.checks !== undefined) lines.push(`- Checks: ${describeChecks(result.checks)}`)
    if (result.tag !== null && result.tag !== undefined) lines.push(`- Tag: ${result.tag.name}`)
    if (result.release !== null && result.release !== undefined) lines.push(`- Release: ${result.release.url}`)
    if (result.pushed?.upToDate === true) lines.push('- Already up to date')
  }
  for (const warning of result.warnings ?? []) lines.push(`Warning: ${warning}`)
  return lines.join('\n')
}

/** Host service implementation shared by the tool and the slash command. */
export class GithubPushService {
  /**
   * @param {object} ctx Cordis plugin context.
   * @param {unknown} rawConfig bundle-row config.
   */
  constructor(ctx, rawConfig) {
    const normalized = normalizeConfig(rawConfig)
    this.ctx = ctx
    this.config = normalized.config
    this.configWarnings = normalized.warnings
    this.busy = new Map()
  }

  /**
   * Read the optional services this plugin can use.
   * @returns {{ sessions?: object, workingDirectory?: object, shell?: object, sandboxPolicy?: object, forgeSession?: object }} services.
   */
  _services() {
    return {
      sessions: this.ctx.get('sessions'),
      workingDirectory: this.ctx.get('workingDirectory'),
      shell: this.ctx.get('shell'),
      sandboxPolicy: this.ctx.get('sandboxPolicy'),
      forgeSession: this.ctx.get('forgeSession'),
    }
  }

  /**
   * Resolve the calling agent's Session and effective directory.
   * @param {object | undefined} agent calling agent.
   * @returns {{ session: object, cwd: string }} session context.
   */
  _context(agent) {
    if (agent === undefined || agent === null) {
      throw new PushError('agent-required', 'This operation needs a Session.', 'Run it from a conversation, not from a standalone service call.')
    }
    const { sessions, workingDirectory } = this._services()
    const session = sessions?.get?.(agent.id)
    if (session === undefined || session === null) {
      throw new PushError('session-unavailable', 'The calling Session is not live in this Host.', 'Open the conversation again and retry.')
    }
    const cwd = workingDirectory?.get?.(session) ?? session.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) {
      throw new PushError('workspace-unavailable', 'The Session has no working directory.', 'Open a workspace directory for this conversation and retry.')
    }
    return { session, cwd }
  }

  /**
   * Resolve the per-call sandbox policy and refuse unusable modes.
   * @param {object} session calling Session.
   * @returns {{ policy: object | undefined, runner: object, shell: object }} resolved execution facts.
   */
  _execution(session, signal) {
    const { shell, sandboxPolicy } = this._services()
    if (shell === undefined || shell === null) {
      throw new PushError('shell-unavailable', 'The shell executor is not mounted in this deployment.', 'Compose a shell provider to use GitHub push.')
    }
    let policy
    try {
      policy = sandboxPolicy?.resolve?.({ session }) ?? undefined
    } catch (error) {
      throw new PushError('workspace-blocked', `The Session working directory cannot be used: ${error instanceof Error ? error.message : String(error)}`, 'Move the Session into a valid workspace directory and retry.')
    }
    if (policy?.mode === 'read-only') {
      throw new PushError('read-only-session', 'This Session is read-only, so the plugin cannot commit or push.', 'Switch the session permission preset to workspace-write or danger-full-access, then retry.')
    }
    let runner
    try {
      runner = createRunner({ shell, sandboxPolicy, session, config: this.config, signal })
    } catch (error) {
      throw new PushError('workspace-blocked', `The per-call sandbox policy could not be resolved: ${error instanceof Error ? error.message : String(error)}`, 'Move the Session into a valid workspace directory and retry.')
    }
    return { policy, runner, shell }
  }

  /**
   * Pick a branch name that does not exist yet.
   * @param {Git} git Git adapter.
   * @param {string} root repository root.
   * @param {string} base proposed name.
   * @returns {Promise<string>} unused branch name.
   */
  async _uniqueBranchName(git, root, base) {
    for (let index = 1; index <= 9; index += 1) {
      const candidate = index === 1 ? base : `${base}-${index}`
      if (!(await git.branchExists(root, candidate))) return candidate
    }
    return `${base}-${Date.now().toString(36)}`
  }

  /**
   * Bounded file count used only to preview changes before a repository exists.
   * @param {string} root directory to scan.
   * @param {number} [limit] maximum entries counted.
   * @returns {number} non-directory entries, excluding `.git` and `node_modules`.
   */
  _countFiles(root, limit = 500) {
    let count = 0
    const stack = [root]
    while (stack.length > 0 && count < limit) {
      const directory = stack.pop()
      let entries
      try {
        entries = readdirSync(directory, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        if (entry.isDirectory()) stack.push(path.join(directory, entry.name))
        else count += 1
        if (count >= limit) break
      }
    }
    return count
  }

  /**
   * Refuse a repository root the Session sandbox may not write.
   * @param {object | undefined} policy resolved sandbox policy.
   * @param {string} root repository root or intended root.
   * @returns {void}
   */
  _checkWritable(policy, root) {
    if (policy === undefined || policy.mode === 'danger-full-access') return
    const realRoot = safeRealpath(root) ?? root
    const candidates = [policy.workspaceRoot, ...(policy.additionalWritableRoots ?? [])]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      const real = safeRealpath(candidate) ?? candidate
      if (isInside(real, realRoot)) return
    }
    throw new PushError('workspace-blocked', `The repository root ${realRoot} lies outside the Session's writable workspace.`, 'Open the workspace at the project directory, or switch to danger-full-access and retry.')
  }

  /**
   * Run one command, converting infrastructure failures into a stable error.
   * @param {object} runner shell runner.
   * @param {object} invocation command facts.
   * @returns {Promise<object>} normalized result.
   */
  async _run(runner, invocation) {
    try {
      return await runner.run(invocation)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/SANDBOX_UNAVAILABLE|sandbox/i.test(message)) {
        throw new PushError('sandbox-unavailable', `The sandbox refused the command: ${redact(message)}`, 'Retry under a Session permission preset whose sandbox backend works.')
      }
      throw new PushError('command-failed', `Command could not run: ${redact(message)}`, 'Check that git and the GitHub CLI are installed and reachable.')
    }
  }

  /**
   * Run one command and return its clipped output detail.
   * @param {object} result runner result.
   * @returns {string} clipped, redacted output.
   */
  _detail(result) {
    return clip(redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()), 4000).text
  }

  /**
   * Verify git and gh are present and gh is signed in.
   * @param {{ git: Git, github: Github, runner: object, cwd: string }} tools adapters.
   * @returns {Promise<{ authed: boolean, user: object | null, warnings: string[] }>} readiness.
   */
  async _preflight(tools) {
    const warnings = []
    const gitVersion = await this._run(tools.runner, { command: `${tools.quoteGit()} --version`, workdir: tools.cwd })
    if (gitVersion.code === 127 || /command not found|no such file/i.test(`${gitVersion.stdout}${gitVersion.stderr}`)) {
      throw new PushError('git-missing', 'git is not available to the Host.', 'Install git or make it available on PATH.')
    }
    if (gitVersion.code !== 0) {
      throw new PushError('git-missing', `git could not run: ${this._detail(gitVersion)}`, 'Install a working git and retry.')
    }
    const auth = await this._run(tools.runner, {
      command: `${tools.quoteGh()} auth status --hostname github.com`,
      workdir: tools.cwd,
    })
    if (auth.code === 127 || /command not found|no such file/i.test(`${auth.stdout}${auth.stderr}`)) {
      throw new PushError('gh-missing', 'The GitHub CLI (gh) is not available to the Host.', 'Install gh (https://cli.github.com) or make it available on PATH.')
    }
    const authed = auth.code === 0
    let user = null
    if (authed) {
      user = await tools.github.user()
      if (user === null) warnings.push('Could not read the signed-in GitHub account; repository creation and identity setup may fail.')
    } else {
      warnings.push(`GitHub CLI is not signed in for github.com: ${this._detail(auth)}`)
    }
    return { authed, user, warnings }
  }

  /**
   * Inspect the repository, remote, and GitHub state without modifying anything.
   * @param {object} agent calling agent.
   * @param {object} options normalized options.
   * @param {AbortSignal} signal invocation cancellation.
   * @returns {Promise<object>} plan result.
   */
  async plan(agent, options, signal) {
    try {
      const { session, cwd } = this._context(agent)
      const { policy, runner } = this._execution(session, signal)
      const git = new Git({ run: runner.run.bind(runner), cwd, config: this.config })
      const github = new Github({ run: runner.run.bind(runner), cwd, config: this.config })
      const tools = {
        git,
        github,
        runner,
        cwd,
        quoteGit: () => quoteCommand(this.config.gitCommand),
        quoteGh: () => quoteCommand(this.config.ghCommand),
      }
      const warnings = [...this.configWarnings]
      const readiness = await this._preflight(tools)
      warnings.push(...readiness.warnings)

      const top = await git.toplevel(cwd)
      const isRepository = top.code === 0
      const root = safeRealpath(isRepository ? top.stdout.trim() : cwd) ?? (isRepository ? top.stdout.trim() : cwd)
      this._checkWritable(policy, root)

      const branchInfo = isRepository ? await git.branch(root) : { branch: 'main', detached: false, head: null }
      const status = isRepository ? await git.status(root) : { ...emptyCounts(), branch: null, detached: false, ahead: 0, behind: 0, upstream: null, unmerged: 0 }
      const identity = isRepository ? await git.identity(root) : { name: null, email: null }
      const remoteUrl = isRepository ? await git.remoteUrl(root, this.config.remoteName) : null
      const remote = remoteUrl === null ? null : parseRemote(remoteUrl)
      if (remote !== null && !hostAllowed(remote.host, this.config.hosts)) {
        throw new PushError('unsupported-remote', `The existing remote ${remoteUrl} is not a configured GitHub host.`, `Configured hosts: ${this.config.hosts.join(', ')}.`)
      }

      const requested = parseRepoSelector(options.repo)
      const repo = this._resolveRepository({
        requested,
        remote,
        user: readiness.user,
        root,
        createRemote: this.config.createRemote,
      })
      if (repo !== null) {
        const owner = repo.owner
        if (!ownerAllowed(owner, this.config.allowedOwners, readiness.user?.login ?? '')) {
          throw new PushError('owner-not-allowed', `Pushing to ${owner}/${repo.name} is not allowed by this plugin's configuration.`, 'Add the owner to allowedOwners, or push to your own account.')
        }
      }

      let repoView = null
      if (repo !== null && readiness.authed) {
        const view = await github.repoView(`${repo.owner}/${repo.name}`, root)
        repoView = view.info
      }
      const defaultBranch = repoDefaultBranch(repoView)
        ?? (isRepository && remote !== null ? await git.defaultBranchFromRemoteHead(root, this.config.remoteName) : null)
        ?? 'main'
      const branch = branchInfo.branch ?? options.branch ?? null
      const tagRequested = typeof options.tag === 'string' && options.tag.length > 0
      const effectiveBranchPolicy = tagRequested ? 'current' : options.branchPolicy ?? this.config.branchPolicy
      const wantsPr = (options.createPr ?? this.config.createPullRequest) === true
      const featureBranchPossible = !tagRequested
        && wantsPr
        && isRepository
        && remote !== null
        && !repoIsEmpty(repoView)
        && branch !== null
        && !branchInfo.detached
        && branch === defaultBranch
      const featureBranchAvailable = effectiveBranchPolicy === 'feature' && featureBranchPossible
      let proposedBranch = null
      if (featureBranchAvailable) {
        proposedBranch = await this._uniqueBranchName(git, root, featureBranchName(projectDisplayName(root, this.config.branchNaming)))
      }
      if (tagRequested) {
        if (branch === null || branch !== defaultBranch) {
          throw new PushError('release-requires-default-branch', `Tag and release must be created on the repository default branch (${defaultBranch}), not ${branch ?? 'a detached HEAD'}.`, 'Merge the pull request, check out the default branch, then push again with the tag.')
        }
        warnings.push('Tag and GitHub release are created on the default branch; feature-branch creation is skipped for this push.')
      }
      const createPr = wantsPr && branch !== null && branch !== defaultBranch
      let existingPr = null
      if (createPr && readiness.authed && isRepository && remote !== null) {
        existingPr = await github.prView(branch, root)
      }

      const changes = { dirty: status.dirty, staged: status.staged, unstaged: status.unstaged, untracked: status.untracked, unmerged: status.unmerged }
      let approximate = false
      if (!isRepository) {
        const files = this._countFiles(root)
        changes.dirty = files > 0
        changes.untracked = files
        approximate = true
        warnings.push('Change counts are approximate until the repository is initialized; .gitignore rules are not applied yet.')
      }
      const files = changes.staged + changes.unstaged + changes.untracked
      const commitMessage = chooseMessage({ message: options.message, files, branch: branch ?? 'main' })
      const repository = repo === null
        ? null
        : {
          host: this.config.hosts[0],
          owner: repo.owner,
          name: repo.name,
          nameWithOwner: `${repo.owner}/${repo.name}`,
          webUrl: `https://${this.config.hosts[0]}/${repo.owner}/${repo.name}`,
          exists: repoView !== null,
          visibility: repoView?.visibility ?? this.config.visibility,
          created: false,
        }
      if (!isRepository && !this.config.initRepo) {
        throw new PushError('not-a-git-repo', 'The working directory is not a Git repository.', 'Initialize it first, or enable initRepo in the plugin configuration.')
      }
      if (repo === null && !readiness.authed) {
        throw new PushError('gh-not-authenticated', 'The GitHub CLI is not signed in for github.com, so no target repository can be resolved.', 'Run `gh auth login --hostname github.com`, then retry.')
      }
      if (repo === null) {
        throw new PushError('remote-missing', 'The project has no GitHub remote and remote creation is disabled.', 'Add an origin remote, or enable createRemote in the plugin configuration.')
      }
      if (repoView !== null && repoView.isEmpty !== true && remote === null) {
        throw new PushError('repo-exists-not-empty', `The GitHub repository ${repo.owner}/${repo.name} already exists and is not empty.`, 'Pass a different repo selector, or add an origin remote that points at it.')
      }
      if (branchInfo.detached && branch === null) {
        throw new PushError('detached-head', 'HEAD is detached; a branch is required.', 'Pass branch to name the branch, or check out a branch first.')
      }
      if (!isRepository) warnings.push('Will initialize a Git repository and make the first commit.')
      if (repoView === null && remote === null) warnings.push(`Will create the GitHub repository ${repo.owner}/${repo.name} (${this.config.visibility}) and add it as ${this.config.remoteName}.`)
      if (repoView === null && remote !== null) warnings.push(`The ${this.config.remoteName} remote exists, but ${repo.owner}/${repo.name} could not be read from GitHub; the push may fail.`)
      if (identity.name === null || identity.email === null) {
        if (this.config.configureIdentity && readiness.user !== null) {
          warnings.push('No git author identity is configured; a repository-local identity will be derived from the GitHub account.')
        } else {
          warnings.push('No git author identity is configured; set user.name and user.email before pushing.')
        }
      }
      if (featureBranchAvailable) {
        warnings.push(`The push will create ${proposedBranch} from ${defaultBranch} so a pull request can be opened.`)
      } else if (effectiveBranchPolicy === 'feature' && wantsPr) {
        if (!isRepository || remote === null || repoIsEmpty(repoView)) {
          warnings.push('branchPolicy=feature needs an existing default branch; this push bootstraps the default branch instead.')
        } else if (branch !== defaultBranch) {
          warnings.push(`branchPolicy=feature applies on the default branch only; ${branch ?? 'the current branch'} is pushed as-is.`)
        }
      }
      const tagPlan = typeof options.tag === 'string' && options.tag.length > 0
        ? {
          name: options.tag,
          message: normalizeMessage(options.tagMessage ?? '') || commitMessage,
          release: options.release !== false,
        }
        : null
      if (tagPlan !== null && isRepository) {
        const existingTag = await git.resolveTag(root, tagPlan.name)
        if (existingTag !== null) warnings.push(`Tag ${tagPlan.name} already exists locally; applying will reuse it only when it points at HEAD.`)
      }
      if (!readiness.authed) warnings.push('Sign in with `gh auth login --hostname github.com` before applying this plan.')

      return jsonSafe({
        ok: true,
        action: 'plan',
        cwd,
        root,
        isRepository,
        branch,
        baseBranch: defaultBranch,
        detached: branchInfo.detached,
        repository,
        remote: remoteUrl === null ? null : { name: this.config.remoteName, url: remoteUrl },
        changes,
        approximateChanges: approximate,
        commitMessage,
        willInitRepo: !isRepository && this.config.initRepo,
        willCreateRepo: remote === null && repoView === null,
        willCommit: changes.dirty && changes.unmerged === 0,
        willPush: true,
        branchPolicy: effectiveBranchPolicy,
        tag: tagPlan,
        release: tagPlan !== null && tagPlan.release ? { tagName: tagPlan.name, title: tagPlan.name } : null,
        featureBranchPossible,
        featureBranchAvailable,
        willCreateBranch: featureBranchAvailable,
        proposedBranch,
        pullRequest: existingPr !== null
          ? { url: existingPr.url, number: existingPr.number ?? null, create: false, base: defaultBranch }
          : featureBranchAvailable
            ? { create: true, base: defaultBranch, head: proposedBranch, title: prTitle(commitMessage), featureBranch: true }
            : createPr
              ? { create: true, base: defaultBranch, head: branch, title: prTitle(commitMessage) }
              : null,
        ready: { git: true, gh: readiness.authed, account: readiness.user?.login ?? null, identity: identity.name !== null && identity.email !== null },
        warnings,
        error: null,
      })
    } catch (error) {
      return { action: 'plan', ...failureOf(error) }
    }
  }

  /**
   * Resolve the target repository coordinates.
   * @param {{ requested: { owner: string, name: string } | null, remote: object | null, user: object | null, root: string, createRemote: boolean }} input resolution inputs.
   * @returns {{ owner: string, name: string } | null} coordinates, or null when no repository can be targeted.
   */
  _resolveRepository(input) {
    const { requested, remote, user, root, createRemote } = input
    if (requested !== null) {
      if (remote !== null && (remote.owner.toLowerCase() !== requested.owner.toLowerCase() || remote.name.toLowerCase() !== requested.name.toLowerCase())) {
        throw new PushError('repo-conflict', `The existing ${this.config.remoteName} remote points at ${remote.owner}/${remote.name}, not ${requested.owner}/${requested.name}.`, 'Remove or repoint the remote, or omit repo.')
      }
      return requested
    }
    if (remote !== null) return { owner: remote.owner, name: remote.name }
    if (!createRemote) return null
    if (user === null) return null
    return { owner: user.login, name: repositoryName(root) }
  }

  /**
   * Run the explicit commit-and-push operation.
   * @param {object} agent calling agent.
   * @param {object} options normalized options.
   * @param {AbortSignal} signal invocation cancellation.
   * @returns {Promise<object>} apply result.
   */
  async apply(agent, options, signal) {
    const { session, cwd } = this._context(agent)
    if (this.busy.has(session.id)) {
      return { action: 'apply', ...failureOf(new PushError('busy', 'Another GitHub push is already running for this Session.', 'Wait for it to finish, then retry.')) }
    }
    const operation = this._applyOperation(session, cwd, options, signal)
    this.busy.set(session.id, operation)
    try {
      return await operation
    } finally {
      this.busy.delete(session.id)
    }
  }

  /**
   * The body of one push operation, including stage reporting on failure.
   * @param {object} session calling Session.
   * @param {string} cwd effective directory.
   * @param {object} options normalized options.
   * @param {AbortSignal} signal cancellation.
   * @returns {Promise<object>} result value.
   */
  async _applyOperation(session, cwd, options, signal) {
    const warnings = [...this.configWarnings]
    const progress = { stage: 'preflight', repository: null, branch: null, commit: null, pushed: null, pullRequest: null }
    try {
      const { policy, runner } = this._execution(session, signal)
      const git = new Git({ run: runner.run.bind(runner), cwd, config: this.config })
      const github = new Github({ run: runner.run.bind(runner), cwd, config: this.config })
      const tools = { git, github, runner, cwd, quoteGit: () => quoteCommand(this.config.gitCommand), quoteGh: () => quoteCommand(this.config.ghCommand) }
      const readiness = await this._preflight(tools)
      warnings.push(...readiness.warnings)
      if (!readiness.authed) {
        throw new PushError('gh-not-authenticated', 'The GitHub CLI is not signed in for github.com.', 'Run `gh auth login --hostname github.com` in a terminal, then retry.')
      }
      const user = readiness.user
      if (user === null) {
        throw new PushError('gh-not-authenticated', 'The signed-in GitHub account could not be read.', 'Run `gh auth status` and retry.')
      }

      let isRepository = true
      const top = await git.toplevel(cwd)
      let root
      if (top.code !== 0) {
        if (!this.config.initRepo) {
          throw new PushError('not-a-git-repo', 'The working directory is not a Git repository.', 'Initialize it first, or enable initRepo in the plugin configuration.')
        }
        progress.stage = 'init'
        const init = await git.init()
        if (init.code !== 0) {
          throw new PushError('init-failed', `git init failed: ${this._detail(init)}`, 'Ensure the workspace directory is writable.')
        }
        isRepository = false
        root = safeRealpath(cwd) ?? cwd
        isRepository = true
      } else {
        root = safeRealpath(top.stdout.trim()) ?? top.stdout.trim()
      }
      this._checkWritable(policy, root)

      const identity = isRepository ? await git.identity(root) : { name: null, email: null }
      if (identity.name === null || identity.email === null) {
        if (!this.config.configureIdentity) {
          throw new PushError('git-identity-missing', 'git has no author name or email.', 'Set user.name and user.email for this repository, then retry.')
        }
        progress.stage = 'identity'
        const name = user.name ?? user.login
        const email = user.email ?? (user.id === null ? `${user.login}@users.noreply.github.com` : `${user.id}+${user.login}@users.noreply.github.com`)
        const configured = await git.configureIdentity(root, name, email)
        if (configured.code !== 0) {
          throw new PushError('git-identity-missing', `Could not configure a repository-local git identity: ${this._detail(configured)}`, 'Set user.name and user.email manually, then retry.')
        }
        warnings.push(`Configured repository-local git identity ${name} <${email}>.`)
      }

      const remoteUrlBefore = isRepository ? await git.remoteUrl(root, this.config.remoteName) : null
      const remoteBefore = remoteUrlBefore === null ? null : parseRemote(remoteUrlBefore)
      if (remoteBefore !== null && !hostAllowed(remoteBefore.host, this.config.hosts)) {
        throw new PushError('unsupported-remote', `The existing remote ${remoteUrlBefore} is not a configured GitHub host.`, `Configured hosts: ${this.config.hosts.join(', ')}.`)
      }
      const requested = parseRepoSelector(options.repo)
      let repo = this._resolveRepository({
        requested,
        remote: remoteBefore,
        user,
        root,
        createRemote: this.config.createRemote,
      })
      if (repo === null) {
        throw new PushError('remote-missing', 'The project has no GitHub remote and remote creation is disabled.', 'Add an origin remote, or enable createRemote in the plugin configuration.')
      }
      if (!ownerAllowed(repo.owner, this.config.allowedOwners, user.login)) {
        throw new PushError('owner-not-allowed', `Pushing to ${repo.owner}/${repo.name} is not allowed by this plugin's configuration.`, 'Add the owner to allowedOwners, or push to your own account.')
      }
      progress.repository = { owner: repo.owner, name: repo.name }

      let repoInfo = null
      let repoCreated = false
      if (remoteBefore !== null) {
        const view = await github.repoView(`${repo.owner}/${repo.name}`, root)
        repoInfo = view.info
      }

      let branchInfo = isRepository ? await git.branch(root) : { branch: 'main', detached: false, head: null }
      if (branchInfo.detached) {
        if (typeof options.branch !== 'string' || options.branch.length === 0) {
          throw new PushError('detached-head', 'HEAD is detached; pass branch to name the branch to push.', 'Check out a branch, or pass branch to create one at HEAD.')
        }
        progress.stage = 'branch'
        const exists = await git.branchExists(root, options.branch)
        const switched = exists
          ? await git.git(['switch', options.branch], { workdir: root })
          : await git.git(['switch', '-c', options.branch], { workdir: root })
        if (switched.code !== 0) {
          throw new PushError('branch-failed', `Could not check out branch ${options.branch}: ${this._detail(switched)}`, 'Check out a branch manually and retry.')
        }
        branchInfo = await git.branch(root)
      } else if (typeof options.branch === 'string' && options.branch.length > 0 && options.branch !== branchInfo.branch) {
        throw new PushError('branch-mismatch', `The checked-out branch is ${branchInfo.branch}, not ${options.branch}.`, 'Pass the checked-out branch name, or check out the other branch first.')
      }
      let branch = branchInfo.branch
      progress.branch = branch
      if (branch === null) {
        throw new PushError('detached-head', 'HEAD is detached and no branch could be created.', 'Check out a branch manually and retry.')
      }
      const workingStatus = await git.status(root)
      if (workingStatus.unmerged > 0) {
        throw new PushError('merge-conflict', `${workingStatus.unmerged} file(s) are in an unmerged state.`, 'Resolve the merge conflict and retry; the plugin will not commit conflict markers.')
      }

      const tagRequested = typeof options.tag === 'string' && options.tag.length > 0
      const effectiveBranchPolicy = tagRequested ? 'current' : options.branchPolicy ?? this.config.branchPolicy
      const wantsPr = (options.createPr ?? this.config.createPullRequest) === true
      let knownBaseBranch = null
      if (tagRequested) {
        knownBaseBranch = repoDefaultBranch(repoInfo)
          ?? (remoteBefore !== null ? await git.defaultBranchFromRemoteHead(root, this.config.remoteName) : null)
          ?? 'main'
        if (branch !== knownBaseBranch) {
          throw new PushError('release-requires-default-branch', `Tag and release must be created on the repository default branch (${knownBaseBranch}), not ${branch}.`, 'Merge the pull request, check out the default branch, then push again with the tag.')
        }
        warnings.push('Tag and GitHub release require the default branch; feature-branch creation is skipped for this push.')
      }
      if (!tagRequested && effectiveBranchPolicy === 'feature' && wantsPr) {
        if (remoteBefore === null) {
          warnings.push('branchPolicy=feature needs an existing GitHub repository; this first push bootstraps the default branch instead.')
        } else if (repoIsEmpty(repoInfo)) {
          warnings.push('branchPolicy=feature needs an existing default branch; this push bootstraps it instead.')
        } else {
          knownBaseBranch = repoDefaultBranch(repoInfo)
            ?? await git.defaultBranchFromRemoteHead(root, this.config.remoteName)
            ?? 'main'
          if (branch === knownBaseBranch) {
            progress.stage = 'branch'
            const proposed = await this._uniqueBranchName(git, root, featureBranchName(projectDisplayName(root, this.config.branchNaming)))
            const switched = await git.git(['switch', '-c', proposed], { workdir: root })
            if (switched.code !== 0) {
              throw new PushError('branch-failed', `Could not create branch ${proposed}: ${this._detail(switched)}`, 'Check out a branch manually and retry.')
            }
            branch = proposed
            branchInfo = await git.branch(root)
            progress.branch = branch
            warnings.push(`Created feature branch ${proposed} from ${knownBaseBranch} so a pull request can be opened.`)
          }
        }
      }

      let commit = null
      let committed = false
      let stat = emptyStat()
      let subject = ''
      if (this.config.commitMode === 'all') {
        const add = await git.addAll(root)
        if (add.code !== 0) {
          throw new PushError('stage-failed', `git add failed: ${this._detail(add)}`, 'Check file permissions and retry.')
        }
      }
      const hasStaged = await git.hasStagedChanges(root)
      if (hasStaged) {
        if (this.config.secretScan) this._scanStaged(await git.stagedFiles(root))
        stat = await git.stagedStat(root)
        subject = chooseMessage({ message: options.message, files: stat.files, branch })
        progress.stage = 'commit'
        const commitResult = await git.commit(root, subject)
        if (commitResult.code !== 0) {
          const detail = this._detail(commitResult)
          if (/please tell me who you are|unable to auto-detect email/i.test(detail)) {
            throw new PushError('git-identity-missing', 'git rejected the commit because no author identity is set.', 'Set user.name and user.email, then retry.')
          }
          throw new PushError('commit-failed', `git commit failed: ${detail}`, 'Fix the pre-commit hook or error above, then retry.')
        }
        committed = true
        commit = await git.headCommit(root)
      } else {
        commit = await git.headCommit(root)
        if (commit.sha === null) {
          throw new PushError('nothing-to-commit', 'There is nothing to commit and no commit to push.', 'Create or modify files in the project, then ask again.')
        }
        subject = commit.subject ?? chooseMessage({ message: options.message, files: 0, branch })
        warnings.push('The working tree is clean; only existing commits will be pushed.')
      }
      progress.commit = commit

      if (isRepository === false || remoteBefore === null) {
        progress.stage = 'remote'
        const target = await this.ensureRemote(tools, root, repo, { remoteBefore, repoInfo, options })
        repoInfo = target.repoInfo
        repoCreated = target.created === true
      } else if (repoInfo === null) {
        warnings.push(`Could not read ${repo.owner}/${repo.name} from GitHub; continuing with the existing remote.`)
      }
      const defaultBranch = repoDefaultBranch(repoInfo)
        ?? knownBaseBranch
        ?? (remoteBefore !== null ? await git.defaultBranchFromRemoteHead(root, this.config.remoteName) : null)
        ?? 'main'

      progress.stage = 'push'
      let aheadBefore = null
      const upstreamProbe = await git.git(['rev-parse', '--verify', '--quiet', `${this.config.remoteName}/${branch}`], { workdir: root })
      if (upstreamProbe.code === 0) {
        aheadBefore = (await git.aheadBehind(root, `${this.config.remoteName}/${branch}`)).ahead
      }
      const pushed = await git.push(root, {
        remote: this.config.remoteName,
        branch,
        force: options.force === true,
      })
      if (pushed.code !== 0) throw this._pushError(pushed, branch)
      const divergence = await git.aheadBehind(root, `${this.config.remoteName}/${branch}`)
      const webUrl = `https://${this.config.hosts[0]}/${repo.owner}/${repo.name}`
      const pushedFacts = {
        remote: this.config.remoteName,
        ref: `refs/heads/${branch}`,
        upstream: `${this.config.remoteName}/${branch}`,
        ahead: divergence.ahead,
        behind: divergence.behind,
        upToDate: committed === false && aheadBefore === 0,
        newCommit: committed,
        commitUrl: commit.sha === null ? null : `${webUrl}/commit/${commit.sha}`,
        forced: options.force === true,
      }
      progress.pushed = pushedFacts

      let tag = null
      let release = null
      if (typeof options.tag === 'string' && options.tag.length > 0) {
        if (branch !== defaultBranch) {
          throw new PushError('release-requires-default-branch', `Tag and release must be created on the default branch (${defaultBranch}).`, 'Merge the pull request, check out the default branch, then push again with the tag.')
        }
        progress.stage = 'tag'
        const tagMessage = normalizeMessage(options.tagMessage ?? '') || subject || commit.subject || options.tag
        const existingTag = await git.resolveTag(root, options.tag)
        if (existingTag !== null) {
          if (commit.sha === null || existingTag !== commit.sha) {
            throw new PushError('tag-exists', `Tag ${options.tag} already exists at ${existingTag.slice(0, 7)}, not at HEAD.`, 'Choose a new tag name, or delete the existing tag first.')
          }
          warnings.push(`Tag ${options.tag} already exists at HEAD; reusing it.`)
        } else {
          const createdTag = await git.createTag(root, options.tag, tagMessage)
          if (createdTag.code !== 0) {
            throw new PushError('tag-create-failed', `git tag failed: ${this._detail(createdTag)}`, 'Fix the tag name or repository state and retry.')
          }
        }
        const pushedTag = await git.pushTag(root, options.tag)
        if (pushedTag.code !== 0) {
          throw new PushError('tag-push-failed', `Tag ${options.tag} could not be pushed: ${this._detail(pushedTag)}`, 'Check remote permissions and retry the push.')
        }
        tag = {
          name: options.tag,
          message: tagMessage,
          pushed: true,
          url: `${webUrl}/releases/tag/${encodeURIComponent(options.tag)}`,
        }
        if (options.release !== false) {
          progress.stage = 'release'
          const existingRelease = await github.releaseView(tag.name, root)
          if (existingRelease !== null) {
            release = { url: existingRelease.url, tagName: existingRelease.tagName ?? tag.name, created: false }
          } else {
            const commitUrl = commit.sha === null ? webUrl : `${webUrl}/commit/${commit.sha}`
            const notes = `${subject || tag.name}\n\nTag: ${tag.name}\nCommit: ${commitUrl}\nBranch: ${branch}\n`
            const createdRelease = await github.releaseCreate({ tag: tag.name, title: tag.name, notes }, root)
            if (createdRelease.code !== 0 || createdRelease.url === null) {
              warnings.push(`Tag pushed, but creating the GitHub release failed: ${clip(redact(createdRelease.detail), 600).text}`)
            } else {
              release = { url: createdRelease.url, tagName: tag.name, created: true }
            }
          }
        }
      }

      let pullRequest = null
      const wantPr = wantsPr && branch !== defaultBranch
      if (wantPr) {
        progress.stage = 'pr'
        const existing = await github.prView(branch, root)
        if (existing !== null) {
          pullRequest = {
            number: existing.number ?? null,
            url: existing.url,
            state: existing.state ?? null,
            draft: existing.isDraft === true,
            created: false,
          }
        } else {
          const title = prTitle(subject)
          const body = prBody({ subject, stat, branch })
          const created = await github.prCreate({
            base: defaultBranch,
            head: branch,
            title,
            body,
            draft: options.draft ?? this.config.draftPullRequest,
          }, root)
          if (created.code !== 0 || created.pr === null) {
            warnings.push(`Push succeeded, but creating the pull request failed: ${clip(redact(created.detail), 600).text}`)
          } else {
            pullRequest = {
              number: created.pr.number ?? null,
              url: created.pr.url,
              state: created.pr.state ?? 'OPEN',
              draft: created.pr.isDraft === true,
              created: true,
            }
          }
        }
      } else if (branch === defaultBranch && (options.createPr ?? this.config.createPullRequest) === true) {
        warnings.push('Pushed the repository default branch without a pull request; configure a feature branch for pull-request tracking.')
      }
      progress.pullRequest = pullRequest

      const tracking = await this._track(session, pullRequest, webUrl, repo, warnings)
      const checks = await this._readChecks(github, `${repo.owner}/${repo.name}`, commit, root, warnings)
      const result = jsonSafe({
        ok: true,
        action: 'apply',
        cwd,
        root,
        repository: {
          host: this.config.hosts[0],
          owner: repo.owner,
          name: repo.name,
          nameWithOwner: `${repo.owner}/${repo.name}`,
          webUrl,
          visibility: repoInfo?.visibility ?? this.config.visibility,
          created: repoCreated,
          exists: true,
        },
        branch,
        baseBranch: defaultBranch,
        commit: commit === null ? null : {
          sha: commit.sha,
          shortSha: commit.shortSha,
          subject: commit.subject,
          files: stat.files,
          insertions: stat.insertions,
          deletions: stat.deletions,
        },
        pushed: pushedFacts,
        tag,
        release,
        pullRequest,
        tracking,
        checks,
        warnings,
        error: null,
      })
      return result
    } catch (error) {
      const base = failureOf(error)
      return {
        action: 'apply',
        stage: progress.stage,
        progress: jsonSafe(progress),
        warnings,
        ...base,
      }
    }
  }

  /**
   * Scan staged paths against the secret deny list.
   * @param {string[]} files staged repository-relative paths.
   * @returns {void}
   */
  _scanStaged(files) {
    for (const file of files) {
      const denied = deniedBy(file, this.config.denyPaths, this.config.allowSecretPaths)
      if (denied !== undefined) {
        throw new PushError('secret-path-blocked', `Refusing to commit ${file}: it matches the deny pattern ${denied}.`, 'Remove the file from the change set, add a narrower allowSecretPaths entry, or disable secretScan.')
      }
    }
  }

  /**
   * Read the combined checks of one commit, never failing the push for them.
   * @param {object} github GitHub adapter.
   * @param {string} repoName `owner/name`.
   * @param {{ sha: string | null } | null} commit pushed commit.
   * @param {string} root repository root.
   * @param {string[]} warnings mutable warning list.
   * @returns {Promise<object | null>} checks rollup or null.
   */
  async _readChecks(github, repoName, commit, root, warnings) {
    if (commit === null || commit.sha === null) return null
    try {
      return await github.commitChecks(repoName, commit.sha, root)
    } catch (error) {
      warnings.push(`Could not read commit checks: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /**
   * Read the checks of the checked-out commit for live card polling.
   * @param {object} agent calling agent.
   * @returns {Promise<object>} checks result.
   */
  /**
   * Read the Git graph and GitHub tracking facts for the session header view.
   * Read-only: no repository state is written.
   * @param {object} agent calling agent.
   * @returns {Promise<object>} graph facts.
   */
  async graph(agent) {
    try {
      const { session, cwd } = this._context(agent)
      const { runner } = this._execution(session, undefined)
      const git = new Git({ run: runner.run.bind(runner), cwd, config: this.config })
      const top = await git.toplevel(cwd)
      const isRepository = top.code === 0
      const root = isRepository ? safeRealpath(top.stdout.trim()) ?? top.stdout.trim() : cwd
      const branchInfo = isRepository ? await git.branch(root) : { branch: null, detached: false, head: null }
      const remoteUrl = isRepository ? await git.remoteUrl(root, this.config.remoteName) : null
      const remoteInfo = remoteUrl === null ? null : parseRemote(remoteUrl)
      const commits = isRepository ? await git.logCommits(root, 80) : []
      const warnings = [...this.configWarnings]
      let upstream = null
      let ahead = null
      let behind = null
      if (isRepository && branchInfo.branch !== null && remoteInfo !== null) {
        const candidate = `${this.config.remoteName}/${branchInfo.branch}`
        const probe = await git.git(['rev-parse', '--verify', '--quiet', candidate], { workdir: root })
        if (probe.code === 0) {
          upstream = candidate
          const divergence = await git.aheadBehind(root, candidate)
          ahead = divergence.ahead
          behind = divergence.behind
        }
      }
      const { forgeSession } = this._services()
      const bound = forgeSession === undefined || forgeSession === null ? [] : forgeSession.changeRequests(session)
      const pullRequests = bound.map(entry => {
        const snapshot = entry.update?.snapshot ?? null
        return {
          url: entry.url,
          origin: entry.origin,
          number: snapshot?.ref?.number ?? null,
          title: snapshot?.title ?? null,
          state: snapshot?.state ?? null,
          draft: snapshot?.draft ?? null,
          headBranch: snapshot?.headBranch ?? null,
          headSha: snapshot?.headSha ?? null,
          baseBranch: snapshot?.baseBranch ?? null,
          checksRollup: snapshot?.checksRollup ?? null,
          reviewDecision: snapshot?.reviewDecision ?? null,
          mergeability: snapshot?.mergeability ?? null,
        }
      })
      let checks = null
      if (remoteInfo !== null && commits.length > 0) {
        const github = new Github({ run: runner.run.bind(runner), cwd, config: this.config })
        checks = await this._readChecks(github, `${remoteInfo.owner}/${remoteInfo.name}`, { sha: commits[0].sha }, root, warnings)
      }
      return jsonSafe({
        ok: true,
        action: 'graph',
        cwd,
        isRepository,
        repository: remoteInfo === null ? null : {
          host: remoteInfo.host,
          owner: remoteInfo.owner,
          name: remoteInfo.name,
          nameWithOwner: `${remoteInfo.owner}/${remoteInfo.name}`,
          webUrl: remoteInfo.webUrl,
        },
        branch: branchInfo.branch,
        detached: branchInfo.detached,
        upstream,
        ahead,
        behind,
        commits,
        pullRequests,
        checks,
        warnings,
        error: null,
      })
    } catch (error) {
      return { action: 'graph', ...failureOf(error) }
    }
  }

  /**
   * Read the checks of the checked-out commit for the checks route.
   * @param {object} agent calling agent.
   * @returns {Promise<object>} checks result.
   */
  async checks(agent) {
    try {
      const { session, cwd } = this._context(agent)
      const { runner } = this._execution(session, undefined)
      const git = new Git({ run: runner.run.bind(runner), cwd, config: this.config })
      const top = await git.toplevel(cwd)
      const isRepository = top.code === 0
      const root = isRepository ? safeRealpath(top.stdout.trim()) ?? top.stdout.trim() : cwd
      const remoteUrl = isRepository ? await git.remoteUrl(root, this.config.remoteName) : null
      const remote = remoteUrl === null ? null : parseRemote(remoteUrl)
      const commit = isRepository ? await git.headCommit(root) : { sha: null, shortSha: null, subject: null }
      if (remote === null || commit.sha === null) {
        return jsonSafe({ ok: true, action: 'checks', commit, checks: null, warnings: [...this.configWarnings], error: null })
      }
      const github = new Github({ run: runner.run.bind(runner), cwd, config: this.config })
      const warnings = [...this.configWarnings]
      const checks = await this._readChecks(github, `${remote.owner}/${remote.name}`, commit, root, warnings)
      return jsonSafe({ ok: true, action: 'checks', commit, checks, warnings, error: null })
    } catch (error) {
      return { action: 'checks', ...failureOf(error) }
    }
  }

  /**
   * Ensure a GitHub remote exists, creating the repository when configured.
   * @param {object} tools adapters.
   * @param {string} root repository root.
   * @param {{ owner: string, name: string }} repo target coordinates.
   * @param {{ remoteBefore: string | null, repoInfo: object | null, options: object }} input existing state.
   * @returns {Promise<{ repoInfo: object | null, created: boolean }>} refreshed repository facts.
   */
  async ensureRemote(tools, root, repo, input) {
    const repoName = `${repo.owner}/${repo.name}`
    const view = await tools.github.repoView(repoName, root)
    if (view.info === null && !view.notFound) {
      throw new PushError('repo-read-failed', `Could not read ${repoName} from GitHub: ${clip(redact(view.detail), 600).text}`, 'Check network access and `gh auth status`, then retry.')
    }
    let repoInfo = view.info
    let createdRepo = false
    if (repoInfo === null) {
      const created = await tools.github.createRepo(repoName, {
        visibility: input.options.visibility ?? this.config.visibility,
        description: 'Project developed with DeepSeek Harness',
      })
      if (created.code !== 0) {
        throw new PushError('repo-create-failed', `Could not create ${repoName}: ${clip(redact(`${created.stdout}\n${created.stderr}`), 800).text}`, 'Create the repository on GitHub, then add an origin remote and retry.')
      }
      repoInfo = created.url === null ? null : {
        nameWithOwner: repoName,
        url: created.url,
        visibility: this.config.visibility,
        isEmpty: true,
        defaultBranchRef: null,
      }
      createdRepo = true
    } else if (repoInfo.isEmpty !== true) {
      throw new PushError('repo-exists-not-empty', `The GitHub repository ${repoName} already exists and is not empty.`, 'Pass a different repo selector, or add an origin remote that points at it.')
    }
    const httpsUrl = `https://${this.config.hosts[0]}/${repo.owner}/${repo.name}.git`
    const added = await tools.git.addRemote(root, this.config.remoteName, httpsUrl)
    if (added.code !== 0) {
      throw new PushError('remote-failed', `Could not add the ${this.config.remoteName} remote: ${this._detail(added)}`, 'Add the remote manually and retry.')
    }
    return { repoInfo, created: createdRepo }
  }

  /**
   * Map one rejected push to a stable failure.
   * @param {object} result runner result.
   * @param {string} branch branch name.
   * @returns {PushError} classified failure.
   */
  _pushError(result, branch) {
    const detail = this._detail(result)
    if (/non-fast-forward|fetch first|rejected/i.test(detail)) {
      return new PushError('non-fast-forward', `The remote rejected the push of ${branch} because it moved ahead.`, 'Run `git pull --ff-only` (or rebase) and retry. This plugin never forces by default.')
    }
    if (/authentication failed|could not read username|terminal prompts disabled|permission denied|invalid username or password|http 403|http 401/i.test(detail)) {
      return new PushError('push-auth-failed', `Git could not authenticate to GitHub: ${detail}`, 'Run `gh auth setup-git` once, or verify `gh auth status`; the plugin injects the gh credential helper for HTTPS pushes.')
    }
    if (/repository not found|does not appear to be a git repository|http 404/i.test(detail)) {
      return new PushError('repo-not-found', `The remote repository was not found: ${detail}`, 'Check the repository name and your access to it.')
    }
    return new PushError('push-failed', `git push failed: ${detail}`, 'Resolve the error above and retry.')
  }

  /**
   * Bind the created pull request to the Session for the change-request panel.
   * @param {object} session calling Session.
   * @param {object | null} pullRequest created or reused pull request.
   * @param {string} webUrl repository web URL.
   * @param {{ owner: string, name: string }} repo repository coordinates.
   * @param {string[]} warnings mutable warning list.
   * @returns {Promise<object | null>} tracking facts.
   */
  async _track(session, pullRequest, webUrl, repo, warnings) {
    const { forgeSession } = this._services()
    if (forgeSession === undefined || forgeSession === null) {
      warnings.push('Change-request tracking is unavailable because the forge bundle is not composed; use the returned URL.')
      return { available: false, bound: false, url: pullRequest?.url ?? null }
    }
    const target = pullRequest?.url ?? null
    if (target === null) return { available: true, bound: false, url: null }
    try {
      forgeSession.track(session, target)
      return { available: true, bound: true, url: target }
    } catch (error) {
      warnings.push(`Pushed, but the change request could not be bound for tracking: ${error instanceof Error ? error.message : String(error)}`)
      return { available: true, bound: false, url: target }
    }
  }

  /**
   * Read the Session's bound change requests and the current checkout facts.
   * @param {object} agent calling agent.
   * @returns {Promise<object>} status result.
   */
  async status(agent) {
    try {
      const { session, cwd } = this._context(agent)
      const { policy, runner } = this._execution(session, undefined)
      const git = new Git({ run: runner.run.bind(runner), cwd, config: this.config })
      const top = await git.toplevel(cwd)
      const isRepository = top.code === 0
      const root = isRepository ? safeRealpath(top.stdout.trim()) ?? top.stdout.trim() : cwd
      this._checkWritable(policy, root)
      const branchInfo = isRepository ? await git.branch(root) : { branch: null, detached: false, head: null }
      const remoteUrl = isRepository ? await git.remoteUrl(root, this.config.remoteName) : null
      const remote = remoteUrl === null ? null : parseRemote(remoteUrl)
      const commit = isRepository ? await git.headCommit(root) : { sha: null, shortSha: null, subject: null }
      const warnings = [...this.configWarnings]
      let checks = null
      if (remote !== null && commit.sha !== null) {
        const github = new Github({ run: runner.run.bind(runner), cwd, config: this.config })
        checks = await this._readChecks(github, `${remote.owner}/${remote.name}`, commit, root, warnings)
      }
      const { forgeSession } = this._services()
      const bound = forgeSession === undefined || forgeSession === null ? [] : forgeSession.changeRequests(session)
      const changeRequests = bound.map(entry => {
        const snapshot = entry.update?.snapshot ?? null
        return {
          url: entry.url,
          origin: entry.origin,
          number: snapshot?.ref?.number ?? null,
          title: snapshot?.title ?? null,
          state: snapshot?.state ?? null,
          draft: snapshot?.draft ?? null,
          checksRollup: snapshot?.checksRollup ?? null,
          reviewDecision: snapshot?.reviewDecision ?? null,
          mergeability: snapshot?.mergeability ?? null,
          headBranch: snapshot?.headBranch ?? null,
        }
      })
      return jsonSafe({
        ok: true,
        action: 'status',
        cwd,
        isRepository,
        repository: remote === null ? null : {
          host: remote.host,
          owner: remote.owner,
          name: remote.name,
          nameWithOwner: `${remote.owner}/${remote.name}`,
          webUrl: remote.webUrl,
        },
        branch: branchInfo.branch,
        commit,
        checks,
        changeRequests,
        trackingAvailable: forgeSession !== undefined && forgeSession !== null,
        warnings,
        error: null,
      })
    } catch (error) {
      return { action: 'status', ...failureOf(error) }
    }
  }
}

/**
 * Quote a command name for the shell.
 * @param {string} command command name or path.
 * @returns {string} shell word.
 */
function quoteCommand(command) {
  return `'${String(command).replaceAll("'", `'\\''`)}'`
}
