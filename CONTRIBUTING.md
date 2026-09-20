# Contributing

Thanks for helping build a better Counter-Strike: Source mod experience.

## Before opening a pull request

```sh
npm ci
npm run typecheck
npm test -- --run
npm audit --audit-level=high
npm run package
```

`npm start` verifies and, when necessary, downloads the matching Electron development runtime before building the Vite bundles and launching the local Electron app. If a corporate proxy or explicit `ELECTRON_SKIP_BINARY_DOWNLOAD` setting blocks that download, unset it or provide the Electron artifact through the normal npm cache.

## Project boundaries

- Keep privileged filesystem, archive, network, and Steam operations in the main process.
- Keep the preload bridge narrow and typed; never expose generic IPC, Node, or filesystem APIs to the renderer.
- Never write outside the manager-owned `cstrike/custom/CSMM_<profileId>` deployment directory.
- Treat archive paths, symlinks, provider URLs, and catalog metadata as untrusted input.
- Prefer behavior-focused tests for discovery, import safety, conflict precedence, rollback, and unmanaged-file preservation.
- Keep the first release Counter-Strike: Source focused. General Source-engine support should be introduced through explicit game descriptors rather than scattered conditionals.
- Keep community work focused on discovery, curated releases, profiles, imports, deployment safety, and related user workflows.
- Do not add arbitrary scraping, an unverified provider adapter, telemetry, accounts, or unrelated game support without an accepted issue and maintainer direction.

## Curated catalog entries

Catalog entries are maintainer-reviewed metadata in `catalog/manifest.json`; the production manifest must not contain placeholders or synthetic test archives. Each entry requires a useful Counter-Strike: Source ZIP, a stable immutable direct HTTPS URL, exact byte size, lowercase SHA-256, author/source attribution, and verified permission to link to and download the archive. Do not commit third-party archives or expiring CDN mirror URLs. Keep browser-only fixtures under `test/fixtures`.

## Pull requests

Open an issue before a feature pull request unless the change is a small, obvious fix, documentation correction, dependency/security update, or test-only improvement. Keep one user problem per pull request. Maintainers may close or request splitting for scope creep, duplicate work, generated artifacts, drive-by refactors, or unverified third-party sources.

Use the pull request template and a conventional focused title:

- `feat(discover): ...`
- `community(provider): ...`
- `fix(import): ...`
- `security(ipc): ...`
- `docs: ...`

Every pull request must describe the user-visible change, security implications, and verification commands. Include screenshots for renderer changes and fixture coverage for filesystem or deployment changes. Do not include secrets, private paths, proprietary mod archives, or generated `release/` output.

`npm audit` covers the complete dependency graph, including the Electron packaging toolchain. Keep dependency updates compatible with the Vite build and verify a clean install before opening a pull request.

The `main` branch is protected by repository settings. Merges require the `quality` and `policy` checks, one CODEOWNERS approval, dismissal of stale approvals after new commits, resolved review conversations, and no direct or force pushes.
