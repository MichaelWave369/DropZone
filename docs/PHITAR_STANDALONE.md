# PhiTar standalone: packaging the packager

**PhiTar v0.3 is an independent web entrypoint sharing the same archive component and browser archive engine as The Drop Zone.**

## Use PhiTar

- Standalone web view: `https://michaelwave369.github.io/DropZone/phitar.html` (available after this PR merges and GitHub Pages deploys).
- Embedded archive station: `https://michaelwave369.github.io/DropZone/#phitar`.
- No Relay service, login, cloud upload, or backend is needed for file operations.

## Self-packaging proof

1. `npm install && npm test` in the Drop Zone repo.
2. `npm run build:phitar:kit` performs a Vite multi-page build and runs `scripts/phitar-self-package.mjs`.
3. The script assembles `dist/phitar.html` plus its Vite-generated assets into a static ZIP; it intentionally excludes unbuilt source, unrelated HTML, credentials and external repos.
4. It invokes the same `inspectFile()` and `buildKit()` functions powering the Drop Zone website, with desktop targets `windows`, `linux` and `macos`.
5. It verifies the resulting Tauri project manifest and required files and writes `phitar-build/phitar-dropzone-build-kit.zip` and `phitar-native-kit/`.
6. The workflow `.github/workflows/phitar-native.yml` compiles the generated project separately on Windows, Ubuntu and macOS runners. Only a successful native build with an uploaded artifact confirms build readiness for that OS.

From a suitable OS with Node 22, Rust and the Tauri native dependencies:

```sh
npm run build:phitar:kit
cd phitar-native-kit
npm install
npx tauri icon assets/icon.png
npx tauri build
```

The GitHub Actions workflow performs equivalent steps and uploads unsigned installer artifacts. GitHub Actions artifacts expire after seven days. An unsigned Windows installer may trigger SmartScreen; unsigned macOS applications may be blocked by Gatekeeper. The generated app must still be manually installed and exercised on each OS before any consumer release.

## Native file dialogs (PhiTar v0.4)

Desktop PhiTar is no longer limited to WebView file-picker behavior for opening, saving or extracting archives. It installs official Tauri 2 dialog and filesystem plugins into PhiTar's **generated** Tauri workspace only. The dialogs establish temporary file/directory scopes without granting the app unrestricted access to the home directory, drive or network shares. Native extraction validates paths, creates a new destination subfolder, and uses exclusive file creation. The browser version retains its original fallbacks.

Manual smoke checks: open ZIP, TAR, TAR.GZ on each OS; save an archive using the system save dialog; extract into a chosen directory, confirm nested paths and no overwrite; cancel each dialog; check corrupt archives and malicious traversal names; restart app to confirm prior permissions are not persisted. **CI proving that installers compile does not prove all native dialogs work in a GUI session.**

## PhiTar v0.3 integrity receipts

PhiTar generates a **SHA-256 integrity receipt** after creating an archive. This receipt contains the exact archive filename, byte size, hash, local timestamp, schema version, and an explicit integrity-only statement. A downloadable `.sha256.json` receipt and copyable checksum are available in the Archive Lab.

The new **Verify SHA-256** station hashes a locally selected archive or other file and optionally compares it with a SHA-256 value from a trusted source. It reports MATCH or MISMATCH for actual file bytes without contacting a server. Current hashing cap: **150 MiB** per file, computed in memory; larger files need future streaming support.

Matching hashes establish byte identity **only**. A checksum cannot prove who supplied a file, whether it contains malware, whether its provenance is trustworthy, or whether it is safe to execute. There is no signing or cryptographic authentication.

Tests exercise known SHA-256 vectors, corrupted-byte mismatches, receipt schema, and input/size validation. The self-packaged desktop program uses the same integrity code as the browser edition.
## Supported PhiTar operations

- Local ZIP creation with DEFLATE settings, ZIP inspection with CRC checks, TAR/USTAR creation/inspection, TAR.GZ generation/inspection.
- Select files and folders, view contained file paths, open into a new extraction directory where the embedded webview supports File System Access API, or download a validated ZIP of extracted contents.
- Current browser engine limits: 75 MiB input, 150 MiB expanded output, at most 1000 regular files. No RAR, 7z, ZIP encryption, PAX TAR, streaming large-file engine, native OS associations, or installer signing.
- Native WebView compatibility of directory-picker APIs is **not guaranteed**. Where unavailable, the ZIP download fallback remains. Reliable native folder selection will require a separately reviewed Tauri dialog/file-system adapter.

## Platform integrity

No arbitrary PR ZIP is compiled by this workflow. It builds only PhiTar source checked out from this repository on read-only-permission runners. The build kit is created by the real Drop Zone engine, then preserved as an artifact for audit. This is a packaging proof, not a malware scanner or security sandbox.

## Next iteration

Integrate PhiTar file selection and extraction with audited Tauri native dialog/fs capabilities, then increase the archive limits using worker-based streaming and add SHA-256 archive receipts. Broader 7z/format compatibility can follow after licensing and parser tests.