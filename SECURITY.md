# Security Policy

## Reporting a vulnerability

Please do not open a public issue, pull request, or discussion for a security vulnerability. Use GitHub's private security advisory flow for `vip3rousmango/cs-source-mod-manager`. If that channel is unavailable, contact the repository owner privately through the address listed on the GitHub profile.

Include:

- affected release, commit, or dependency;
- operating system and installation channel;
- reproduction steps or a minimal fixture;
- impact, exploit prerequisites, and any known workaround; and
- whether the issue is already public elsewhere.

Redact usernames, absolute paths, private mod archives, access tokens, and other personal data. Do not test destructive behavior against another user's machine or game installation.

The project is especially interested in archive traversal, symlink handling, unsafe Electron IPC exposure, untrusted provider URLs, unintended writes outside the manager-owned directory, dependency vulnerabilities, and release artifact tampering.

## Response expectations

Maintainers will acknowledge a private report when practicable, reproduce it in an isolated fixture, coordinate a fix or mitigation, and credit the reporter only with permission. Do not disclose exploit details until a patched release or mitigation is available.

## Supported versions

Only the latest published release and the default branch receive security fixes while the project is pre-1.0. CI runs `npm audit --audit-level=high` across the complete dependency graph. A clean dependency audit does not replace review of Electron, archive, IPC, and filesystem changes.
