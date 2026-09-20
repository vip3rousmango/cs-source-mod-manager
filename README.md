# Counter-Strike: Source Mod Manager

An open-source desktop mod manager focused on Counter-Strike: Source first, with a long-term goal of supporting the wider Source-engine mod ecosystem.

The project is a labour of love for Counter-Strike: Source. It aims for the safety, clarity, and reliability people expect from a modern mod manager while keeping the first release deliberately focused on one game.

## Current scope

- Linux and Windows are the first release targets.
- macOS packaging is supported by the release configuration and will follow the initial Linux/Windows release path.
- Counter-Strike: Source only in the first release.
- Curated catalog entries plus local folder/ZIP imports.
- Named profiles with priorities, conflict previews, reversible deployment, and rollback recovery.
- ZIP-only archive support; RAR and 7z are intentionally unsupported in the first release.

The manager only changes its own directory under `cstrike/custom/CSMM_<profileId>`. Unmanaged game files are not part of deployment transactions.

## Community discovery

The **News** view aggregates public RSS/Atom feeds from Steam News, Steam Community announcements, GameBanana's Counter-Strike: Source feed, ModDB downloads/articles/addons, and the Valve Developer Community. Feed requests run in the main process, use HTTPS, follow only approved source hosts, cap response size and redirects, and render feed text as escaped content. The source directory remains available when a feed is temporarily offline.

GameBanana is currently the first installable community provider. Provider downloads are limited to verified ZIP files, approved HTTPS redirects, size/checksum validation, and the manager-owned library path. Additional providers should be added through a focused issue with a documented public API/feed, attribution terms, file safety model, and fixture coverage; arbitrary scraping is intentionally out of scope.

## Development

Requirements:

- Node.js 22 or newer
- npm

Install and run checks:

```sh
npm ci
npm run typecheck
npm test -- --run
npm audit --audit-level=high
npm run package
```

Start the development app with:

```sh
npm start
```

Use a disposable Counter-Strike: Source fixture directory while developing. Do not point development builds at a real game installation until you have a backup.

## Release artifacts

Electron Builder handles local packaging and production distribution from the same Vite build output:

- Windows: NSIS installer and portable executable
- Linux: AppImage and Debian package
- macOS: DMG and ZIP, enabled as a follow-up platform

Platform builds run on native GitHub Actions runners. A version tag such as `v0.1.0` triggers the Windows/Linux release workflow. macOS builds are enabled manually after the initial release gate. Signing credentials are intentionally supplied only through GitHub Actions secrets.

The release workflow expects these optional secrets:

- Windows: `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`
- macOS: `MACOS_CERTIFICATE_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

Linux artifacts are currently unsigned; add an AppImage and Debian signing step before treating a release as a trusted production distribution.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please keep changes focused on the current game scope, preserve the manager-owned deployment boundary, and add behavior coverage for safety-sensitive filesystem changes.

Issue templates, the pull request template, code ownership, dependency update automation, and the code of conduct are maintained under `.github/` and the repository root. Start with an issue for focused community work; security reports use the private advisory flow in [SECURITY.md](SECURITY.md).

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting guidance.

## License

MIT. See [LICENSE](LICENSE).
