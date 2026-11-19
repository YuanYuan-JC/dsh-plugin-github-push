/**
 * Browser half of the github-push bundle.
 *
 * Adds a "Push" control to the composer tool row, a confirmation dialog that
 * previews the Host plan and edits the commit message, and a compact result
 * card under the composer. The page never runs git or gh itself: every action
 * posts to the same-origin github-push routes, which call the shared Host
 * service, so the button and the model tool stay one operation.
 *
 * @module dsh-plugin-github-push/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-github-push',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    const NS = 'github-push'
    const ROUTES = {
      plan: '/api/github-push/plan',
      apply: '/api/github-push/apply',
      status: '/api/github-push/status',
      checks: '/api/github-push/checks',
      graph: '/api/github-push/graph',
    }

    const zh = {
      'button.label': '推送',
      'button.tooltip': '提交并推送到 GitHub（只在点击后提交）',
      'button.busy': '推送中…',
      'dialog.title': '推送到 GitHub',
      'dialog.planning': '正在检查项目与 GitHub 状态…',
      'dialog.review': '确认本次推送',
      'dialog.branch': '分支',
      'dialog.base': '目标分支',
      'dialog.repo': '仓库',
      'dialog.changes': '改动',
      'dialog.message': '提交信息',
      'dialog.messagePlaceholder': '留空则使用默认提交信息',
      'dialog.createPr': '创建 Pull Request',
      'dialog.updatePr': '更新已有 Pull Request',
      'dialog.noPr': '当前是默认分支，将直接推送，不创建 PR',
      'dialog.featureBranch': '新建 dsh/ 功能分支并创建 PR',
      'dialog.featureBranchHint': '默认分支上的改动会先提交到新的 dsh/ 分支，再以此分支创建 PR，避免直接改默认分支。',
      'dialog.checks': '检查',
      'dialog.tag': 'Git Tag（可选）',
      'dialog.tagPlaceholder': '例如 v1.2.0',
      'dialog.tagHint': '推送后在该提交上创建并推送 tag。',
      'dialog.release': '同时创建 GitHub Release',
      'dialog.releaseHint': '使用 tag 名作为标题，说明来自本次提交。',
      'dialog.tagBranchHint': 'Tag/Release 只在默认分支（PR 合并后）创建；本次不会新建功能分支。',
      'checks.none': '无检查',
      'checks.pending': '进行中',
      'checks.success': '通过',
      'checks.failure': '失败',
      'dialog.visibility': '新仓库可见性',
      'dialog.private': '私有',
      'dialog.public': '公开',
      'dialog.cancel': '取消',
      'dialog.confirm': '提交并推送',
      'dialog.applying': '正在提交并推送…',
      'dialog.willInit': '将初始化 Git 仓库',
      'dialog.willCreate': '将创建 GitHub 仓库',
      'dialog.newRepoNote': '仓库尚不存在，将按所选可见性创建',
      'dialog.approx': '改动数量为估算，初始化仓库后才会精确统计',
      'dialog.warnings': '提示',
      'dialog.retry': '重试',
      'dialog.close': '关闭',
      'dialog.done': '推送完成',
      'dialog.failed': '推送失败',
      'dialog.commit': '提交',
      'dialog.pr': 'Pull Request',
      'dialog.tracked': '已加入会话的变更请求跟踪',
      'dialog.untracked': '未绑定变更请求（可直接打开上面的链接）',
      'dialog.stage': '进行到',
      'dialog.explicit': '只有这次推送会提交改动；平时编辑不会自动提交。',
      'card.pushed': '已推送到 GitHub',
      'card.failed': '推送失败',
      'card.checks': '检查',
      'card.openPr': 'PR',
      'card.openCommit': '提交',
      'card.dismiss': '关闭提示',
      'card.tracking': 'GitHub 跟踪中',
      'card.noPr': '已推送提交（无 PR）',
      'view.git': 'Git',
      'view.loading': '正在读取 Git 图…',
      'view.emptyRepo': '当前目录不是 Git 仓库',
      'view.error': '无法读取 Git 图',
      'view.refresh': '刷新',
      'view.branch': '分支',
      'view.ahead': '领先',
      'view.behind': '落后',
      'view.checks': '检查',
      'view.pr': 'PR',
    }

    const en = {
      'button.label': 'Push',
      'button.tooltip': 'Commit and push to GitHub (commits only when clicked)',
      'button.busy': 'Pushing…',
      'dialog.title': 'Push to GitHub',
      'dialog.planning': 'Checking the project and GitHub state…',
      'dialog.review': 'Review this push',
      'dialog.branch': 'Branch',
      'dialog.base': 'Base branch',
      'dialog.repo': 'Repository',
      'dialog.changes': 'Changes',
      'dialog.message': 'Commit message',
      'dialog.messagePlaceholder': 'Leave empty to use the fallback message',
      'dialog.createPr': 'Create a pull request',
      'dialog.updatePr': 'Update the existing pull request',
      'dialog.noPr': 'This is the default branch; it is pushed without a pull request',
      'dialog.featureBranch': 'Create a dsh/ feature branch and a pull request',
      'dialog.featureBranchHint': 'Changes on the default branch are committed to a new dsh/ branch first, and the pull request is opened from that branch.',
      'dialog.checks': 'Checks',
      'dialog.tag': 'Git tag (optional)',
      'dialog.tagPlaceholder': 'for example v1.2.0',
      'dialog.tagHint': 'Create and push this tag on the pushed commit.',
      'dialog.release': 'Create a GitHub release too',
      'dialog.releaseHint': 'Uses the tag name as title and the pushed commit as notes.',
      'dialog.tagBranchHint': 'Tags and releases are created on the default branch (after the pull request is merged); this push does not create a feature branch.',
      'checks.none': 'none',
      'checks.pending': 'pending',
      'checks.success': 'passed',
      'checks.failure': 'failed',
      'dialog.visibility': 'New repository visibility',
      'dialog.private': 'Private',
      'dialog.public': 'Public',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Commit and push',
      'dialog.applying': 'Committing and pushing…',
      'dialog.willInit': 'Will initialize a Git repository',
      'dialog.willCreate': 'Will create the GitHub repository',
      'dialog.newRepoNote': 'The repository does not exist yet and will be created with this visibility',
      'dialog.approx': 'Change counts are approximate until the repository is initialized',
      'dialog.warnings': 'Notes',
      'dialog.retry': 'Retry',
      'dialog.close': 'Close',
      'dialog.done': 'Push complete',
      'dialog.failed': 'Push failed',
      'dialog.commit': 'Commit',
      'dialog.pr': 'Pull request',
      'dialog.tracked': 'Bound to this conversation for change-request tracking',
      'dialog.untracked': 'Not bound to a change request; open the link above',
      'dialog.stage': 'Reached',
      'dialog.explicit': 'Only this push commits changes; editing files never commits automatically.',
      'card.pushed': 'Pushed to GitHub',
      'card.failed': 'Push failed',
      'card.checks': 'Checks',
      'card.openPr': 'PR',
      'card.openCommit': 'Commit',
      'card.dismiss': 'Dismiss',
      'card.tracking': 'Tracking on GitHub',
      'card.noPr': 'Pushed commit (no pull request)',
      'view.git': 'Git',
      'view.loading': 'Loading the Git graph…',
      'view.emptyRepo': 'This directory is not a Git repository',
      'view.error': 'Could not read the Git graph',
      'view.refresh': 'Refresh',
      'view.branch': 'Branch',
      'view.ahead': 'Ahead',
      'view.behind': 'Behind',
      'view.checks': 'Checks',
      'view.pr': 'PR',
    }

    const CSS = `
.dgp-trigger{margin-left:-12px;display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer}
.dgp-trigger svg{width:14px;height:14px;flex:none}
@media (hover:hover){.dgp-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.dgp-trigger:disabled{color:var(--dsw-alias-label-dimmed);opacity:1;cursor:default}
.dgp-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
@container (max-width: 560px){.dgp-trigger{margin-left:-8px}}
.dgp-backdrop{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,18,24,.42)}
.dgp-dialog{box-sizing:border-box;display:flex;flex-direction:column;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;box-shadow:0 18px 48px rgba(0,0,0,.22)}
.dgp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.dgp-title{font-size:15px;line-height:22px;font-weight:600}
.dgp-close{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:16px;cursor:pointer}
@media (hover:hover){.dgp-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.dgp-close:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.dgp-loading{display:flex;align-items:center;gap:8px;padding:12px 0;color:var(--dsw-alias-label-secondary)}
.dgp-spinner{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:dgp-spin .8s linear infinite}
@keyframes dgp-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dgp-spinner{animation:none}}
.dgp-rows{display:grid;grid-template-columns:96px minmax(0,1fr);gap:6px 10px;margin:0 0 12px}
.dgp-key{color:var(--dsw-alias-label-secondary)}
.dgp-value{min-width:0;overflow-wrap:anywhere}
.dgp-value a{color:var(--dsw-alias-brand-primary);text-decoration:none}
.dgp-value a:hover{text-decoration:underline}
.dgp-badge{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}
.dgp-note{margin:0 0 10px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dgp-warn{margin:0 0 10px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dgp-warn ul{margin:4px 0 0;padding-left:18px}
.dgp-field{display:flex;flex-direction:column;gap:5px;margin:0 0 10px}
.dgp-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}
.dgp-textarea{box-sizing:border-box;width:100%;min-height:64px;max-height:180px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:19px;resize:vertical}
.dgp-textarea:focus{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px;border-color:transparent}
.dgp-check{display:flex;align-items:center;gap:8px;margin:0 0 10px;color:var(--dsw-alias-label-primary)}
.dgp-select{height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.dgp-input{box-sizing:border-box;width:100%;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:19px}
.dgp-input:focus{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px;border-color:transparent}
.dgp-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.dgp-button{height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;white-space:nowrap;cursor:pointer}
.dgp-button:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}
.dgp-button:disabled{cursor:default;opacity:.5}
.dgp-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.dgp-primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}
.dgp-primary:not(:disabled):hover{filter:brightness(1.05);background:var(--dsw-alias-brand-primary)}
.dgp-error{padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dgp-success{color:var(--dsw-alias-state-success-primary)}
.dgp-card{display:flex;align-items:center;gap:10px;flex-wrap:wrap;box-sizing:border-box;margin:6px 0 0;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.dgp-card-error{border-color:var(--dsw-alias-state-error-primary)}
.dgp-card-title{font-weight:600}
.dgp-card-detail{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0}
.dgp-card a{color:var(--dsw-alias-brand-primary);text-decoration:none}
.dgp-card a:hover{text-decoration:underline}
.dgp-card-spacer{flex:1 1 auto}
.dgp-card-close{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:15px;cursor:pointer}
@media (hover:hover){.dgp-card-close:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.dgp-git{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:var(--dsw-alias-label-primary)}
.dgp-git-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dgp-git-repo{display:flex;align-items:center;gap:4px;min-width:0;font-size:13px}
.dgp-git-repo a{color:var(--dsw-alias-brand-primary);text-decoration:none}
.dgp-git-facts{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1 1 auto}
.dgp-git-head .dgp-button{margin-left:auto}
.dgp-git-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 0}
.dgp-commit{display:flex;align-items:center;gap:10px;min-height:26px;padding:1px 12px 1px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
@media (hover:hover){.dgp-commit:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.dgp-commit-graph{flex:none;display:flex;align-items:center;justify-content:flex-start}
.dgp-commit-main{min-width:0;flex:1 1 auto;display:flex;flex-direction:column;gap:1px}
.dgp-commit-title{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.dgp-commit-subject{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dgp-commit-meta{display:flex;align-items:center;gap:2px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px;flex-wrap:wrap}
.dgp-commit-meta a{color:var(--dsw-alias-label-secondary);text-decoration:none;font-variant-numeric:tabular-nums}
.dgp-commit-meta a:hover{color:var(--dsw-alias-brand-primary);text-decoration:underline}
.dgp-ref{display:inline-flex;align-items:center;padding:0 5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:16px;white-space:nowrap}
.dgp-pr-badge{margin-left:6px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-brand-primary)!important;font-size:10px;line-height:16px;white-space:nowrap}
.dgp-pr-badge:hover{text-decoration:none!important;border-color:var(--dsw-alias-brand-primary)}
.dgp-check-pending{color:var(--dsw-alias-state-warn-primary)}
.dgp-check-success{color:var(--dsw-alias-state-success-primary)}
.dgp-check-failure{color:var(--dsw-alias-state-error-primary)}
.dgp-git-empty{display:flex;align-items:center;justify-content:center;height:100%;padding:24px;color:var(--dsw-alias-label-secondary);text-align:center}
`

    /** Rounded upward arrow, matching the plugin icon's intent. */
    function PushIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M8 12.5V3.5' }),
        h('path', { d: 'M4.4 7.1 8 3.5l3.6 3.6' }),
        h('path', { d: 'M3.5 13.5h9' }),
      )
    }

    /**
     * Create the per-Session UI state shared by the button, dialog, and card.
     * @returns {object} controller.
     */
    function createController() {
      const IDLE = Object.freeze({
        phase: 'idle',
        plan: null,
        message: '',
        createPr: true,
        featureBranch: false,
        tag: '',
        release: true,
        visibility: 'private',
        result: null,
        error: null,
      })
      const states = new Map()
      const listeners = new Set()
      function read(sessionId) {
        return states.get(sessionId) ?? IDLE
      }
      function publish() {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.warn('[github-push] UI listener failed:', error)
          }
        }
      }
      function update(sessionId, patch) {
        states.set(sessionId, { ...read(sessionId), ...patch })
        publish()
      }
      function subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
      function clear(sessionId) {
        states.delete(sessionId)
        publish()
      }
      /**
       * Post one operation to the Host routes.
       * @param {string} route route path.
       * @param {string} sessionId Session id.
       * @param {object} options operation options.
       * @returns {Promise<object>} canonical result.
       */
      async function request(route, sessionId, options) {
        const response = await fetch(route, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, ...options }),
        })
        let body = {}
        try {
          body = await response.json()
        } catch {
          body = {}
        }
        if (!response.ok || body?.ok !== true) {
          const detail = body?.error ?? `HTTP ${response.status}`
          const error = new Error(typeof detail === 'string' ? detail : `${detail.code}: ${detail.message}`)
          error.payload = body
          throw error
        }
        return body.result
      }
      return { read, update, subscribe, clear, request }
    }

    /** One stable controller for the whole page. */
    const controller = createController()

    /**
     * Subscribe a component to one Session's push UI state.
     * @param {string} sessionId Session id.
     * @returns {object} state.
     */
    function usePushState(sessionId) {
      return React.useSyncExternalStore(
        controller.subscribe,
        () => controller.read(sessionId),
        () => controller.read(sessionId),
      )
    }

    /**
     * Render a failure result or thrown error as one actionable paragraph.
     * @param {unknown} value result or error.
     * @returns {string} text.
     */
    function failureText(value) {
      const error = value?.error
      if (error !== undefined && error !== null) {
        const hint = typeof error.hint === 'string' && error.hint.length > 0 ? ` — ${error.hint}` : ''
        return `${error.code}: ${error.message}${hint}`
      }
      return value instanceof Error ? value.message : String(value)
    }

    /**
     * Render one label/value row.
     * @param {string} label row label.
     * @param {unknown} value React content.
     * @returns {object} React nodes.
     */
    function row(label, value) {
      return [h('span', { className: 'dgp-key', key: `k-${label}` }, label), h('span', { className: 'dgp-value', key: `v-${label}` }, value)]
    }

    /**
     * Render the project/plan summary rows.
     * @param {object} plan plan result.
     * @param {object} t translate.
     * @returns {object} React node.
     */
    function PlanSummary({ plan, t }) {
      const repository = plan.repository
      const tracked = (plan.changes?.staged ?? 0) + (plan.changes?.unstaged ?? 0)
      const untracked = plan.changes?.untracked ?? 0
      return h(React.Fragment, null,
        h('div', { className: 'dgp-rows' },
          row(t('dialog.branch'), plan.branch ?? 'HEAD'),
          row(t('dialog.base'), plan.baseBranch ?? '—'),
          row(t('dialog.repo'), repository === null
            ? '—'
            : h(React.Fragment, null, `${repository.nameWithOwner}`, plan.willCreateRepo ? h('span', { className: 'dgp-badge' }, t('dialog.willCreate')) : null)),
          row(t('dialog.changes'), plan.changes?.dirty === true
            ? `${tracked} tracked, ${untracked} untracked`
            : '—'),
        ),
        plan.willInitRepo ? h('p', { className: 'dgp-note' }, t('dialog.willInit')) : null,
        plan.willCreateBranch === true && plan.proposedBranch !== null && plan.proposedBranch !== undefined
          ? h('p', { className: 'dgp-note' }, `${t('dialog.featureBranch')}: ${plan.proposedBranch}`)
          : null,
        plan.tag === null || plan.tag === undefined
          ? null
          : h('p', { className: 'dgp-note' }, `${t('dialog.tag')}: ${plan.tag.name}${plan.tag.release === true ? ' · GitHub Release' : ''}`),
        plan.approximateChanges === true ? h('p', { className: 'dgp-note' }, t('dialog.approx')) : null,
        plan.willCreateRepo ? h('p', { className: 'dgp-note' }, t('dialog.newRepoNote')) : null,
        Array.isArray(plan.warnings) && plan.warnings.length > 0
          ? h('div', { className: 'dgp-warn' }, t('dialog.warnings'), h('ul', null, plan.warnings.map((warning, index) => h('li', { key: index }, warning))))
          : null,
      )
    }

    /**
     * Render the pull-request option area.
     * @param {object} props component props.
     * @returns {object | null} React node.
     */
    function PullRequestOption({ state, plan, t, onChange }) {
      if (plan.pullRequest === null) return h('p', { className: 'dgp-note' }, t('dialog.noPr'))
      if (plan.pullRequest?.url !== undefined) {
        return h('label', { className: 'dgp-check' }, h('input', { type: 'checkbox', checked: state.createPr, onChange: event => onChange(event.target.checked) }), t('dialog.updatePr'))
      }
      return h('label', { className: 'dgp-check' }, h('input', { type: 'checkbox', checked: state.createPr, onChange: event => onChange(event.target.checked) }), t('dialog.createPr'))
    }

    /**
     * Render the successful or failed outcome.
     * @param {object} props component props.
     * @returns {object} React node.
     */
    function ResultBody({ result, t }) {
      if (result?.ok !== true) {
        return h(React.Fragment, null,
          h('p', { className: 'dgp-error' }, failureText(result)),
          result?.stage === undefined ? null : h('p', { className: 'dgp-note' }, `${t('dialog.stage')}: ${result.stage}`),
          Array.isArray(result?.warnings) && result.warnings.length > 0
            ? h('div', { className: 'dgp-warn' }, t('dialog.warnings'), h('ul', null, result.warnings.map((warning, index) => h('li', { key: index }, warning))))
            : null,
        )
      }
      const commit = result.commit
      return h(React.Fragment, null,
        h('p', { className: 'dgp-success' }, t('dialog.done')),
        h('div', { className: 'dgp-rows' },
          row(t('dialog.repo'), result.repository?.nameWithOwner ?? '—'),
          row(t('dialog.branch'), result.branch ?? '—'),
          commit === null ? null : row(t('dialog.commit'), h(React.Fragment, null,
            `${commit.shortSha ?? ''} ${commit.subject ?? ''}`.trim(),
            result.pushed?.commitUrl === undefined ? null : h('a', { href: result.pushed.commitUrl, target: '_blank', rel: 'noreferrer' }, ' ↗'),
          )),
          result.pullRequest === null ? null : row(t('dialog.pr'), h('a', { href: result.pullRequest.url, target: '_blank', rel: 'noreferrer' }, `#${result.pullRequest.number ?? ''} ↗`)),
          result.tag === null || result.tag === undefined
            ? null
            : row(t('dialog.tag'), result.tag.name),
          result.release === null || result.release === undefined
            ? null
            : row('Release', h('a', { href: result.release.url, target: '_blank', rel: 'noreferrer' }, `↗`)),
          result.checks === null || result.checks === undefined
            ? null
            : row(t('dialog.checks'), `${t(`checks.${result.checks.state}`)}${result.checks.total > 0 ? ` (${result.checks.passed}/${result.checks.total})` : ''}`),
        ),
        result.pullRequest === null ? null : h('p', { className: 'dgp-note' }, result.tracking?.bound === true ? t('dialog.tracked') : t('dialog.untracked')),
        Array.isArray(result.warnings) && result.warnings.length > 0
          ? h('div', { className: 'dgp-warn' }, t('dialog.warnings'), h('ul', null, result.warnings.map((warning, index) => h('li', { key: index }, warning))))
          : null,
      )
    }

    /**
     * Confirmation dialog with plan preview, message editor, and outcome.
     * @param {object} props component props.
     * @returns {object} portal element.
     */
    function PushDialog({ sessionId, t, state, onClose, onConfirm, onReplan }) {
      const { phase, plan, result, error } = state
      const busy = phase === 'applying'
      React.useEffect(() => {
        const onKeyDown = event => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            onClose()
          }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [busy, onClose])
      const messageRef = React.useRef(null)
      React.useEffect(() => {
        if (phase === 'ready' && messageRef.current !== null) {
          const element = messageRef.current
          element.focus()
          element.setSelectionRange(element.value.length, element.value.length)
        }
      }, [phase])
      let body
      if (phase === 'planning') {
        body = h('div', { className: 'dgp-loading' }, h('span', { className: 'dgp-spinner', 'aria-hidden': true }), t('dialog.planning'))
      } else if (phase === 'error') {
        body = h(React.Fragment, null, h('p', { className: 'dgp-error' }, error ?? t('dialog.failed')))
      } else if (phase === 'applying') {
        body = h('div', { className: 'dgp-loading' }, h('span', { className: 'dgp-spinner', 'aria-hidden': true }), t('dialog.applying'))
      } else if (phase === 'done') {
        body = h(ResultBody, { result, t })
      } else if (plan !== null) {
        body = h(React.Fragment, null,
          h(PlanSummary, { plan, t }),
          h('label', { className: 'dgp-field' }, h('span', { className: 'dgp-label' }, t('dialog.message')),
            h('textarea', {
              ref: messageRef,
              className: 'dgp-textarea',
              value: state.message,
              placeholder: t('dialog.messagePlaceholder'),
              onChange: event => controller.update(sessionId, { message: event.target.value }),
            })),
          h('label', { className: 'dgp-field' }, h('span', { className: 'dgp-label' }, t('dialog.tag')),
            h('input', {
              className: 'dgp-input',
              type: 'text',
              value: state.tag,
              placeholder: t('dialog.tagPlaceholder'),
              onChange: event => controller.update(sessionId, { tag: event.target.value, featureBranch: event.target.value.trim().length > 0 ? false : controller.read(sessionId).featureBranch }),
            })),
          state.tag.trim().length > 0
            ? h(React.Fragment, null,
              h('p', { className: 'dgp-note' }, t('dialog.tagHint')),
              h('label', { className: 'dgp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: state.release,
                  onChange: event => controller.update(sessionId, { release: event.target.checked }),
                }),
                t('dialog.release')),
              state.release ? h('p', { className: 'dgp-note' }, t('dialog.releaseHint')) : null,
              h('p', { className: 'dgp-note' }, t('dialog.tagBranchHint')))
            : null,
          plan.featureBranchPossible === true
            ? h('label', { className: 'dgp-check' },
              h('input', {
                type: 'checkbox',
                checked: state.featureBranch,
                disabled: state.tag.trim().length > 0,
                onChange: event => controller.update(sessionId, { featureBranch: event.target.checked }),
              }),
              t('dialog.featureBranch'))
            : null,
          state.featureBranch
            ? h('p', { className: 'dgp-note' }, t('dialog.featureBranchHint'))
            : h(PullRequestOption, { state, plan, t, onChange: value => controller.update(sessionId, { createPr: value }) }),
          plan.willCreateRepo
            ? h('label', { className: 'dgp-field' }, h('span', { className: 'dgp-label' }, t('dialog.visibility')),
              h('select', { className: 'dgp-select', value: state.visibility, onChange: event => controller.update(sessionId, { visibility: event.target.value }) },
                h('option', { value: 'private' }, t('dialog.private')),
                h('option', { value: 'public' }, t('dialog.public'))))
            : null,
          h('p', { className: 'dgp-note' }, t('dialog.explicit')),
        )
      }
      const showActions = phase === 'ready' || phase === 'error' || phase === 'done'
      return createPortal(h('div', {
        className: 'dgp-backdrop',
        role: 'presentation',
        onMouseDown: event => {
          if (event.target === event.currentTarget && !busy) onClose()
        },
      }, h('div', {
        className: 'dgp-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('dialog.title'),
      },
      h('div', { className: 'dgp-head' },
        h('span', { className: 'dgp-title' }, phase === 'done' ? (result?.ok === true ? t('dialog.done') : t('dialog.failed')) : t('dialog.title')),
        h('button', { type: 'button', className: 'dgp-close', 'aria-label': t('dialog.close'), disabled: busy, onClick: onClose }, '×'),
      ),
      phase === 'ready' ? h('p', { className: 'dgp-note' }, t('dialog.review')) : null,
      body,
      showActions ? h('div', { className: 'dgp-actions' },
        phase === 'error'
          ? [h('button', { key: 'retry', type: 'button', className: 'dgp-button', onClick: onReplan }, t('dialog.retry')), h('button', { key: 'close', type: 'button', className: 'dgp-button', onClick: onClose }, t('dialog.close'))]
          : phase === 'done'
            ? h('button', { type: 'button', className: 'dgp-button dgp-primary', onClick: onClose }, t('dialog.close'))
            : [h('button', { key: 'cancel', type: 'button', className: 'dgp-button', onClick: onClose }, t('dialog.cancel')),
              h('button', { key: 'confirm', type: 'button', className: 'dgp-button dgp-primary', onClick: onConfirm }, t('dialog.confirm'))],
      ) : null,
      )), document.body)
    }

    /**
     * Composer control opening the push dialog.
     * @param {object} props component props.
     * @returns {object} React node.
     */
    function PushButton({ sessionId, t }) {
      const state = usePushState(sessionId)
      const busy = state.phase === 'applying' || state.phase === 'planning'
      const openDialog = async () => {
        controller.update(sessionId, { phase: 'planning', plan: null, message: '', result: null, error: null, createPr: true, featureBranch: false, tag: '', release: true, visibility: 'private' })
        try {
          const plan = await controller.request(ROUTES.plan, sessionId, {})
          if (plan?.ok !== true) {
            controller.update(sessionId, { phase: 'error', error: failureText(plan), plan: null })
            return
          }
          controller.update(sessionId, {
            phase: 'ready',
            plan,
            message: plan.commitMessage ?? '',
            createPr: plan.pullRequest !== null,
            featureBranch: plan.willCreateBranch === true,
            visibility: plan.repository?.visibility === 'public' ? 'public' : 'private',
          })
        } catch (error) {
          controller.update(sessionId, { phase: 'error', error: failureText(error), plan: null })
        }
      }
      const onConfirm = async () => {
        const plan = controller.read(sessionId).plan
        const current = controller.read(sessionId)
        controller.update(sessionId, { phase: 'applying', error: null })
        try {
          const options = {
            message: current.message.trim().length > 0 ? current.message : undefined,
            createPr: current.tag.trim().length > 0 ? false : current.featureBranch ? true : (plan?.pullRequest === null ? false : current.createPr),
            branchPolicy: current.tag.trim().length > 0 ? 'current' : current.featureBranch ? 'feature' : 'current',
            tag: current.tag.trim().length > 0 ? current.tag.trim() : undefined,
            release: current.tag.trim().length > 0 ? current.release : undefined,
            visibility: plan?.willCreateRepo === true ? current.visibility : undefined,
          }
          const result = await controller.request(ROUTES.apply, sessionId, options)
          controller.update(sessionId, { phase: 'done', result, plan: null })
        } catch (error) {
          controller.update(sessionId, { phase: 'error', error: failureText(error) })
        }
      }
      const onClose = () => {
        if (controller.read(sessionId).phase === 'applying') return
        controller.update(sessionId, { phase: 'idle', plan: null, error: null, message: '', featureBranch: false, tag: '', release: true })
      }
      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          className: 'dgp-trigger',
          title: t('button.tooltip'),
          'aria-label': t('button.label'),
          disabled: busy,
          onClick: openDialog,
        },
        h(PushIcon),
        h('span', null, busy ? t('button.busy') : t('button.label'))),
        state.phase === 'idle' ? null : h(PushDialog, {
          sessionId,
          t,
          state,
          onClose,
          onConfirm,
          onReplan: openDialog,
        }),
      )
    }

    /**
     * Compact result card under the composer.
     * @param {object} props component props.
     * @returns {object | null} React node.
     */
    /** Palette used for commit lanes in the Git graph. */
    const LANE_COLORS = ['#4f7cff', '#2f9e6e', '#d9822b', '#b657c4', '#d64545', '#1f9bb5']

    /** Fixed graph geometry, in CSS pixels. */
    const LANE_WIDTH = 16
    const ROW_HEIGHT = 26

    /**
     * Pick the color of one lane index.
     * @param {number} lane lane index.
     * @returns {string} CSS color.
     */
    function laneColor(lane) {
      return LANE_COLORS[lane % LANE_COLORS.length]
    }

    /**
     * Strip ref decoration prefixes down to a branch name.
     * @param {string} ref decoration such as `HEAD -> main`, `origin/main`, or `tag: v1`.
     * @returns {string} branch-ish name.
     */
    function refBranch(ref) {
      return String(ref).replace(/^HEAD -> /, '').replace(/^origin\//, '').replace(/^tag: /, '')
    }

    /**
     * Format one ISO author date for the graph row.
     * @param {string} value ISO date.
     * @returns {string} localized short date.
     */
    function formatCommitTime(value) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }

    /**
     * Assign each commit to a lane and record the vertical/merge edges needed
     * by the simple source-control graph renderer. Commits are newest first.
     * @param {{ sha: string, parents: string[] }[]} commits commits.
     * @returns {{ rows: object[], laneCount: number }} layout.
     */
    function layoutCommits(commits) {
      const lanes = []
      const rows = []
      for (const commit of commits) {
        let lane = lanes.indexOf(commit.sha)
        if (lane === -1) {
          lane = lanes.findIndex(value => value === null)
          if (lane === -1) lane = lanes.length
        }
        const before = lanes.slice()
        const after = lanes.slice()
        after[lane] = Array.isArray(commit.parents) && commit.parents.length > 0 ? commit.parents[0] : null
        const edges = []
        for (const parent of (commit.parents ?? []).slice(1)) {
          let target = after.indexOf(parent)
          if (target === -1) {
            target = after.findIndex(value => value === null)
            if (target === -1) target = after.length
            after[target] = parent
          }
          edges.push({ from: lane, to: target })
        }
        rows.push({ commit, lane, before, after, edges })
        lanes.length = 0
        for (const value of after) lanes.push(value)
        while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
      }
      const laneCount = rows.reduce((max, row) => Math.max(max, row.before.length, row.after.length, row.lane + 1), 1)
      return { rows, laneCount }
    }

    /**
     * Render one commit row: graph cell plus subject, refs, and tracking badges.
     * @param {object} props component props.
     * @returns {object} React node.
     */
    function GraphRow({ row, laneCount, t, prBySha, prByBranch, repoWebUrl }) {
      const mid = ROW_HEIGHT / 2
      const pieces = []
      for (let index = 0; index < laneCount; index += 1) {
        const incoming = row.before[index] !== undefined && row.before[index] !== null
        const outgoing = row.after[index] !== undefined && row.after[index] !== null
        if (!incoming && !outgoing) continue
        const x = index * LANE_WIDTH + LANE_WIDTH / 2
        pieces.push(h('line', {
          key: `v-${index}`,
          x1: x,
          y1: incoming ? 0 : mid,
          y2: outgoing ? ROW_HEIGHT : mid,
          x2: x,
          stroke: laneColor(index),
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }))
      }
      for (const [index, edge] of row.edges.entries()) {
        const x1 = edge.from * LANE_WIDTH + LANE_WIDTH / 2
        const x2 = edge.to * LANE_WIDTH + LANE_WIDTH / 2
        pieces.push(h('path', {
          key: `e-${index}`,
          d: `M${x1} ${mid} C${x1 + 8} ${mid}, ${x2 - 8} ${mid}, ${x2} ${mid}`,
          fill: 'none',
          stroke: laneColor(edge.to),
          strokeWidth: 1.5,
        }))
      }
      pieces.push(h('circle', {
        key: 'node',
        cx: row.lane * LANE_WIDTH + LANE_WIDTH / 2,
        cy: mid,
        r: 3.5,
        fill: laneColor(row.lane),
      }))
      const refs = (row.commit.refs ?? []).slice(0, 4)
      let pullRequest = prBySha.get(row.commit.sha) ?? null
      if (pullRequest === null) {
        for (const ref of refs) {
          const branch = refBranch(ref)
          if (prByBranch.has(branch)) {
            pullRequest = prByBranch.get(branch)
            break
          }
        }
      }
      const commitUrl = typeof repoWebUrl === 'string' ? `${repoWebUrl}/commit/${row.commit.sha}` : null
      const checks = pullRequest?.checksRollup
      return h('div', { className: 'dgp-commit' },
        h('div', { className: 'dgp-commit-graph', style: { width: `${laneCount * LANE_WIDTH}px` } }, h('svg', { width: laneCount * LANE_WIDTH, height: ROW_HEIGHT }, pieces)),
        h('div', { className: 'dgp-commit-main' },
          h('div', { className: 'dgp-commit-title' },
            h('span', { className: 'dgp-commit-subject', title: row.commit.subject }, row.commit.subject || '(no subject)'),
            ...refs.map((ref, index) => h('span', { key: `ref-${index}`, className: 'dgp-ref' }, refBranch(ref) || ref)),
          ),
          h('div', { className: 'dgp-commit-meta' },
            commitUrl === null
              ? row.commit.shortSha
              : h('a', { href: commitUrl, target: '_blank', rel: 'noreferrer' }, row.commit.shortSha),
            h('span', null, ' · '),
            h('span', null, row.commit.author),
            h('span', null, ' · '),
            h('span', null, formatCommitTime(row.commit.time)),
            pullRequest === null
              ? null
              : h('a', {
                href: pullRequest.url,
                target: '_blank',
                rel: 'noreferrer',
                className: 'dgp-pr-badge',
              }, `${t('view.pr')} #${pullRequest.number ?? ''}${typeof pullRequest.state === 'string' ? ` · ${pullRequest.state}` : ''}${typeof checks === 'string' ? ` · ${t(`checks.${checks}`)}` : ''}`),
          ),
        ),
      )
    }

    /**
     * Conversation View tab rendering a compact source-control graph with the
     * Session's GitHub pull-request and check badges. It never polls: the data
     * loads when the tab mounts, on an explicit Refresh click, and after this
     * Session pushes again.
     * @param {object} props component props.
     * @returns {object} React node.
     */
    function GitGraphView({ sessionId, t }) {
      const [data, setData] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const mounted = React.useRef(true)
      const lastResult = React.useRef(controller.read(sessionId).result)

      const load = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const result = await controller.request(ROUTES.graph, sessionId, {})
          if (!mounted.current) return
          if (result?.ok !== true) {
            setError(failureText(result))
            setData(null)
            return
          }
          setData(result)
        } catch (thrown) {
          if (mounted.current) setError(failureText(thrown))
        } finally {
          if (mounted.current) setLoading(false)
        }
      }, [sessionId])

      React.useEffect(() => {
        mounted.current = true
        void load()
        return () => {
          mounted.current = false
        }
      }, [load])

      // Refresh after a push completes in this Session, but never on a timer.
      React.useEffect(() => controller.subscribe(() => {
        const next = controller.read(sessionId).result
        if (next === lastResult.current) return
        lastResult.current = next
        if (next !== null && next !== undefined) void load()
      }), [sessionId, load])

      const layout = React.useMemo(() => layoutCommits(data?.commits ?? []), [data])
      const prBySha = new Map()
      const prByBranch = new Map()
      for (const pullRequest of data?.pullRequests ?? []) {
        if (typeof pullRequest.headSha === 'string') prBySha.set(pullRequest.headSha, pullRequest)
        if (typeof pullRequest.headBranch === 'string') prByBranch.set(pullRequest.headBranch, pullRequest)
      }

      let body
      if (loading && data === null) {
        body = h('div', { className: 'dgp-git-empty' }, t('view.loading'))
      } else if (error !== null) {
        body = h('div', { className: 'dgp-git-empty' }, h('span', { className: 'dgp-error' }, `${t('view.error')}: ${error}`))
      } else if (data?.isRepository === false) {
        body = h('div', { className: 'dgp-git-empty' }, t('view.emptyRepo'))
      } else if (layout.rows.length === 0) {
        body = h('div', { className: 'dgp-git-empty' }, 'No commits')
      } else {
        body = h('div', { className: 'dgp-git-scroll' }, layout.rows.map((row, index) => h(GraphRow, {
          key: `${row.commit.sha}-${index}`,
          row,
          laneCount: layout.laneCount,
          t,
          prBySha,
          prByBranch,
          repoWebUrl: data?.repository?.webUrl,
        })))
      }

      const repository = data?.repository ?? null
      const ahead = data?.ahead
      const behind = data?.behind
      const checks = data?.checks?.state
      return h('div', { className: 'dgp-git' },
        h('div', { className: 'dgp-git-head' },
          h('div', { className: 'dgp-git-repo' },
            h('strong', null, repository?.nameWithOwner ?? '—'),
            repository?.webUrl === undefined ? null : h('a', { href: repository.webUrl, target: '_blank', rel: 'noreferrer' }, ' ↗'),
          ),
          h('div', { className: 'dgp-git-facts' },
            data?.branch === null || data?.branch === undefined
              ? null
              : h('span', { className: 'dgp-ref' }, `${t('view.branch')}: ${data.branch}`),
            typeof ahead === 'number' && ahead > 0 ? h('span', { className: 'dgp-ref' }, `↑ ${t('view.ahead')} ${ahead}`) : null,
            typeof behind === 'number' && behind > 0 ? h('span', { className: 'dgp-ref' }, `↓ ${t('view.behind')} ${behind}`) : null,
            checks === undefined || checks === null
              ? null
              : h('span', { className: `dgp-ref dgp-check-${checks}` }, `${t('view.checks')}: ${t(`checks.${checks}`)}`),
          ),
          h('button', { type: 'button', className: 'dgp-button', disabled: loading, onClick: load }, t('view.refresh')),
        ),
        body,
      )
    }

    return {
      inject: ['locale', 'slots'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => {
          const disposeZh = ctx.locale.register(NS, 'zh', zh)
          const disposeEn = ctx.locale.register(NS, 'en', en)
          return () => {
            disposeZh()
            disposeEn()
          }
        }, 'github-push: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = 'dsh-plugin-github-push'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'github-push: styles')
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'github-push-trigger',
          order: 100,
          locale: NS,
          inject: sessionId => ({ sessionId }),
        }, PushButton))
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'git',
          order: 50,
          locale: NS,
          label: () => t('view.git'),
          inject: sessionId => ({ sessionId }),
        }, GitGraphView))
      },
    }
  },
})
