# The Drop Zone

**Source in. Build kit out. Archive in. PhiTar out.** A browser-first React/Vite app that turns **trusted** source projects into cross-platform build recipes and project wrappers. Formerly the AppForge 369 prototype, now merged with selected ideas from Claude’s App Packager (provided separately). Now incorporates selected ideas from a user-supplied Grok Forgepack workspace, while retaining our AppForge/Claude architecture. MIT licensed.

**Status:** v0.4 tri-AI merged prototype with PhiTar and Parallax handoff staging. This is **not a cloud compilation service**. Clicking **EXPORT BUILD KIT** downloads a ZIP containing your source, a selected-platform project wrapper, and GitHub Actions workflows. Finished native installers only appear when the workflows actually compile successfully on GitHub runners or a suitable local machine. The generated workflows remain best-effort; platform build results must be verified individually. A first native Windows smoke workflow is available for testing.

## PhiTar v0.4: native desktop file dialogs

The *self-packaged PhiTar desktop application* now includes official Tauri 2 dialog and file-system plugins to open archives, select extraction directories and save archives using operating-system dialogs. The **browser** version continues to use standard file inputs, downloads, and File System Access API where available.

Native extraction only starts after the user chooses a folder and creates a fresh `phitar-extracted-*` directory. It refuses traversal, duplicate paths, unsafe Windows filenames and over-limit archives; it never knowingly overwrites existing files. Native permissions grant the specific open/read/stat/save/write/mkdir commands, with **no permanent or blanket filesystem scope**. Picker-selected paths are allowed for that app session only.

This v0.4 change patches **PhiTar's own self-generated Tauri kit**, not Drop Zone's generic exporters. See [Native file dialogs and permissions](docs/PHITAR_NATIVE_FILES.md) for security boundaries and manual testing requirements.

## PhiTar v0.3 integrity receipts

PhiTar generates a **SHA-256 integrity receipt** after creating an archive. This receipt contains the exact archive filename, byte size, hash, local timestamp, schema version, and an explicit integrity-only statement. A downloadable `.sha256.json` receipt and copyable checksum are available in the Archive Lab.

The new **Verify SHA-256** station hashes a locally selected archive or other file and optionally compares it with a SHA-256 value from a trusted source. It reports MATCH or MISMATCH for actual file bytes without contacting a server. Current hashing cap: **150 MiB** per file, computed in memory; larger files need future streaming support.

Matching hashes establish byte identity **only**. A checksum cannot prove who supplied a file, whether it contains malware, whether its provenance is trustworthy, or whether it is safe to execute. There is no signing or cryptographic authentication.

Tests exercise known SHA-256 vectors, corrupted-byte mismatches, receipt schema, and input/size validation. The self-packaged desktop program uses the same integrity code as the browser edition.
## Standalone PhiTar desktop pipeline

PhiTar now has its own standalone React page: **[Open PhiTar Archive Studio](https://michaelwave369.github.io/DropZone/phitar.html)** (published after the PR merges and Pages rebuilds). The new `npm run build:phitar:kit` command compiles the PhiTar page, imports that production bundle into the **actual Drop Zone build generator**, and produces a reviewable Tauri build kit. An independent GitHub Actions matrix then attempts real native Windows, Linux and macOS builds, uploading **unsigned installers only on successful compilation**. These OS targets are not considered verified until their individual jobs pass; installation/use still requires manual testing.

See [PhiTar standalone self-packaging and platform caveats](docs/PHITAR_STANDALONE.md). This is a browser-engine desktop wrapper, not yet a native 7-Zip replacement. Archive limits and webview file-picker compatibility remain documented.

## PhiTar archive workshop

**PhiTar v0.1** is a browser-local archive station embedded in the live Drop Zone page (navigation: **PhiTar archives**). It is separate from native app packaging. It creates and opens **.zip**, **.tar** and **.tar.gz/.tgz** archives from local files and folder selections; ZIP offers configurable DEFLATE levels. Opened archives are checked for path traversal, unsafe device names, duplicate names, TAR header corruption, unsupported TAR links and expanded-size limits. Compatible browsers can extract into a **new subfolder** selected with the File System Access API, and any browser can repack validated contents into a ZIP download.

**Boundaries:** 1000 files, 75 MB input, 150 MB expanded output; file data is handled in memory. TAR v1 creates/reads POSIX USTAR with portable ASCII names, not PAX/GNU extended headers. ZIP supports Unicode filenames. No encryption, archive splitting, 7z or RAR support yet. RAR compression is proprietary and not a claim made by this project. Treat imported archives as untrusted data; no source code is executed during archive inspection.

See [PhiTar engineering notes](docs/PHITAR.md). Tests run with `npm test`.

## Parallax Relay handoff (v0.4)

A new **Relay handoff** section stages the most recently exported Drop Zone ZIP, or a user-selected archive, for manual transfer through **Parallax Relay 369**. It computes a **real SHA-256 digest** locally, provides a downloadable JSON receipt and copyable handoff note, and opens the existing Netlify Relay in a separate tab. Nothing is uploaded by Drop Zone.

The owner can download files using Relay's authenticated interface and bring them back to Drop Zone or PhiTar. A handoff label is **not** an access-control boundary. Configure and verify the Relay site's invite/session revocation and owner-only policy before sharing private artifacts.

**This is not one-click file transfer yet.** See [Parallax Relay bridge and security design](docs/PARALLAX_RELAY_BRIDGE.md) before enabling cross-origin uploads.

## Local development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
npm test
npm run build
```

The GitHub Pages workflow in `.github/workflows/pages.yml` deploys the React interface from `main`. In the repository settings choose **Pages → GitHub Actions**. **Live React site:** https://michaelwave369.github.io/DropZone/ (the GitHub Pages build has passed).

## Native installer reality check

See [Windows installer smoke test](docs/NATIVE_SMOKE.md). This checks that a trusted example travels through the same Drop Zone generator used by the browser and reaches a real Windows/Tauri build runner. A green Pages deployment alone does not demonstrate native packaging; the native smoke workflow must compile and upload an installer artifact first.

## What can be imported

| Input | Detected as | Notes |
| --- | --- | --- |
| `.html` / `.htm` | Static website | Only self-contained HTML; use ZIP for local linked assets |
| `.zip` with `index.html` | Static website | Linked styles/scripts/assets included |
| Project folder | Static/Vite/CRA/Python | Use folder picker or drag a folder (supported browsers); dependency/build folders and obvious secrets excluded |
| Multiple HTML/Python entrypoints | Static or Python | Choose entry page/script before exporting; non-root HTML gets an entry redirect |
| `.jsx` / `.js` with `export default` | React single-file scaffold | Built into a minimal Vite project; extra third-party imports need verified dependencies |
| Vite ZIP with `package.json` | Vite | Needs a `build` script, creates `dist/index.html` |
| Create React App ZIP | CRA | Uses `build/index.html`; legacy adapter; not guaranteed for every app |
| Generic Node web ZIP | Static output adapter | Needs `npm run build` producing `dist/`, `build/`, or `out/` with `index.html` |
| `.py`, Python ZIP | Python | Platform executables only, not a mobile app |
| Public GitHub repo URL | The format inside its archive | Public only; browser API limits apply |

Next.js server-rendered applications and applications that require an external backend are **not automatically converted**. Websites that depend on cloud services retain that dependency after wrapping.

## Export targets

* **Windows / Linux / macOS:** Tauri 2 native desktop application wrapper, or PyInstaller executable for Python. All unsigned by default. Runner OS determines available artifact type.
* **Android:** Capacitor 8 debug APK, for development/testing, not Play Store release.
* **iOS:** Unsigned Capacitor Xcode project on a macOS runner. Installing on devices/TestFlight requires signing and further provisioning.
* **Installable Web / PWA:** Manifest, PNG app icons, conservative offline service worker, and web bundle workflow. Host on HTTPS to enable installation. Only supported for static, Vite, and CRA projects in this version.

Exports also contain configurable app name, version, reverse-domain app ID and icon color/image. The workspace now includes two local starter samples and a restricted HTML snapshot (scripts and network disabled), inspired by Grok’s workspace. This preview is NOT a runtime verification of the packaged app. Inspect generated `.github/workflows` before running them; the UI can preview this YAML immediately after export. Generated archives contain `dropzone-manifest.json` with conversion metadata.

## Security model

* Inputs are parsed as data locally in the browser, not run during inspection.
* ZIPs are limited by approximate compressed and expanded sizes and entry count, and suspicious secret files, dependencies, `.git`, and old workflows are excluded. These are **best-effort checks** and do not make untrusted code safe.
* Importing a public GitHub URL fetches that repository from GitHub directly in the browser. A private repository should be manually downloaded and ZIP-uploaded.
* A generated kit executes imported dependency build scripts on the runner. **Do not run unknown code in GitHub Actions** or grant a workflow secrets unless that code is reviewed. Keep the generated kit private until reviewed.
* No signing certificates are collected, transmitted, or included in ZIPs. Add them later using repository secrets if/when signing support is explicitly developed.
* Outputs and workflows are provided without guarantees; platform SDK versions, plugin compatibility, Rust/Xcode requirements, and build failures must be validated per project.

## What we selectively merged from Grok's Forgepack workspace (v0.3)

* Whole-folder upload via `webkitdirectory` and directory drag-and-drop when the browser supports it
* Multiple-entrypoint chooser for HTML and Python sources
* Read-only, isolated HTML snapshot with restrictive CSP and no script execution
* Clickable test samples (Neon Note and Hello Python)
* Stronger folder-safety tests for traversal, ignored generated folders, obvious secrets and oversized inputs

The implementation is adapted into our existing browser-first React app. We did **not** transplant Grok's heavier TanStack server/auth/database stack or its HTML Application / script-launcher packaging mode. Its Windows HTA / macOS shell / Linux `.run` outputs are different from native Tauri bundles and its phone output is an installable PWA rather than Android APK/iOS IPA. Native build generation continues through manually triggered CI workflows.

## What we selectively merged from Claude's App Packager

* PWA target, generated icons, manifest and worker
* App ID, version, color and optional image fields
* Standalone React `.jsx`/`.js` conversion to a Vite scaffold
* CRA and generic build detection (with explicit limitations)
* Manual GitHub Actions build recipes and visible YAML preview

What we retained from AppForge 369: native Tauri desktop path, Python/PyInstaller, public GitHub import, ZIP scanning and safety checks, independent React/Vite component structure, and standard browser downloads. We **did not** retain the old Claude-only download hook or assume every Node/Next.js repository is a static native-ready app.

## Validation and known limits (v0.3)

* 13 local Node tests passed; the changed React/JS source parses with TypeScript's parser.
* A production Vite build could not be executed here because npm registry DNS resolution failed (`EAI_AGAIN`).
* Generated desktop, Android, and iOS workflows remain unverified on real platform runners. They may require debugging for specific OS/tooling versions.
* Folder drag-and-drop depends on browser support for `webkitGetAsEntry`; use the folder picker when available. Browser-specific behavior still requires manual testing.
* Preview uses `sandbox=""` and CSP; CSS text and markup may display, but JavaScript and remote dependencies do not run.
* The preview must not be used as a security audit of imported source, and secret-file filtering is best-effort.

## Release flow

1. Import **trusted** source.
2. Set app name, reverse-domain ID, semver, custom icon; choose requested platforms.
3. Export kit ZIP, then unzip and review its sources, scripts and workflows.
4. Push to a new GitHub repository (private recommended), run the generated workflow manually from **Actions**.
5. Download native build artifacts after the jobs pass. Signing, notarization, mobile release distribution and one-click remote builds are future milestones.
