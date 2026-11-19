# Security Policy

## Supported versions

Security fixes are applied to the latest `0.6.x` release. Please upgrade before
reporting an issue that may already be fixed.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected version, reproduction steps, and impact.

We will acknowledge the report, investigate, and coordinate a fix and disclosure
through the advisory.

## Credential handling

- The plugin does not collect, store, or ask for GitHub tokens. It reuses the
  `gh` CLI credential store already configured on the host.
- Git pushes inject the `gh auth git-credential` helper per command; they do not
  write credentials to `.git/config`, the command line, logs, or model context.
- Authentication failures are reported with actionable messages and redacted
  output.

## Scope and boundaries

- Only `github.com` is supported in this release.
- New repositories default to private; making one public requires an explicit
  request.
- The plugin never force-pushes, merges pull requests, or changes repository
  settings automatically. `--force-with-lease` requires an explicit flag.
- Push operations refuse read-only Sessions and block configured secret paths.

## Known limitations

- Tags and releases are only created on the repository default branch.
- GitHub Enterprise and GitLab are not supported yet.
