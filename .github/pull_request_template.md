## Scope

<!-- One focused change. Link the issue or explain why no issue is needed. -->

## User-visible change

<!-- What changes for users or contributors? -->

## Security and compatibility

- [ ] This change keeps privileged filesystem, archive, network, and Steam work in the Electron main process.
- [ ] I considered path traversal, symlink, URL, IPC, and untrusted archive inputs where relevant.
- [ ] I did not add a new provider, source, or scraper without documented public API/RSS terms and maintainer review.
- [ ] I did not commit secrets, generated release artifacts, user data, or proprietary mod files.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test -- --run`
- [ ] `npm audit --audit-level=high`
- [ ] `npm run package` or explain why packaging is not applicable
- [ ] Renderer changes include screenshots or an Electron smoke check.

## Notes for reviewers

<!-- Risks, follow-up work, migration notes, or intentionally out-of-scope items. -->
