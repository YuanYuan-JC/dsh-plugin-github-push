# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `CHANGELOG.md` and `SECURITY.md`.

### Fixed

- Reuse only open pull requests when pushing a branch, so a branch whose
  previous pull request was merged can open a new one.

## [0.6.0] - 2026-11-19

### Added

- Explicit GitHub push operation exposed as the `github_push` tool, the
  `/github-push` slash command, and a composer button.
- Default feature-branch + pull request flow: pushes from the default branch
  create a `dsh/<package-name>` branch first, then open or reuse a pull request.
- Git conversation view tab with a commit graph, branch refs, bound pull
  requests, and checks badges.
- Optional annotated tag and GitHub release creation, restricted to the
  default branch.
- Combined commit checks (check-runs and commit statuses) in push results,
  status output, and the Git view.
- Secret-path scanning, default private repository creation, read-only Session
  refusal, and per-Session single-flight push operations.
- MIT license, README, and a GitHub Actions test workflow.

[0.6.0]: https://github.com/YuanYuan-JC/dsh-plugin-github-push/releases/tag/v0.6.0
