# The Drop Zone

**Source in. Build kit out.**

The Drop Zone combines the AppForge 369 prototype with selected ideas from Claude's App Packager and Grok's Forgepack.

## Current hosted version

The initial GitHub Pages preview is an adapted single-file React packager from Claude. It accepts ZIP, HTML, and JSX projects and exports GitHub Actions packaging kits. **It does not compile native binaries in the browser.** The old Claude-specific download API has been replaced with a standard browser ZIP download.

The **v0.3 tri-AI React/Vite starter** adds folder imports, entrypoint selection, restricted HTML previews, samples, a Tauri desktop pipeline, Capacitor mobile output, Python executables, and source safety checks. That full project has **not yet been committed** here; it is available as `The-Drop-Zone-v0.3-tri-ai-starter.zip` in the project conversation.

## Publish

1. Merge the Pages bootstrap PR.
2. In **Settings → Pages**, select **Build and deployment → Source: GitHub Actions**.
3. Watch **Actions → Drop Zone GitHub Pages** or run the workflow manually.
4. Expected URL: https://michaelwave369.github.io/DropZone/

## Upgrade to v0.3

Preferred: extract `The-Drop-Zone-v0.3-tri-ai-starter.zip` and commit the extracted files to the repository root. The existing Pages workflow detects `package.json`, runs tests and builds the Vite app before deploying `dist/`.

Alternate: upload the *unmodified* ZIP named `The-Drop-Zone-v0.3-tri-ai-starter.zip` at repository root. The Pages workflow can extract and compile it without committing individual source files, but committing source is better for review and maintenance.

## Platform and security notes

Windows/macOS/Linux apps require suitable native build workers; Android builds are debug APKs; iPhone apps require Apple signing/provisioning. A PWA is not an IPA/APK. All build kits are best-effort and native runner builds remain to be validated. Review imported code and CI scripts before running; do not upload secrets or use untrusted build inputs.

MIT licensed.
