# Contributing

Thanks for helping build a better Counter-Strike: Source mod experience.

## Before opening a pull request

```sh
npm ci
npm run typecheck
npm test -- --run
npm run package
```

The Electron Playwright smoke test requires a complete local Electron runtime. If your package manager blocks Electron's postinstall download, repair the install before running `npm run test:e2e`.

## Project boundaries

- Keep privileged filesystem, archive, network, and Steam operations in the main process.
- Keep the preload bridge narrow and typed; never expose generic IPC, Node, or filesystem APIs to the renderer.
- Never write outside the manager-owned `cstrike/custom/CSMM_<profileId>` deployment directory.
- Treat archive paths and symlinks as untrusted input.
- Prefer behavior-focused tests for discovery, import safety, conflict precedence, rollback, and unmanaged-file preservation.
- Keep the first release Counter-Strike: Source focused. General Source-engine support should be introduced through explicit game descriptors rather than scattered conditionals.

## Pull requests

Describe the user-visible behavior, safety implications, and verification commands. Include screenshots for renderer changes and fixture coverage for filesystem or deployment changes.
