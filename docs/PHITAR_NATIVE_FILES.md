# PhiTar native desktop file handling (v0.5)

PhiTar v0.4 adds OS-native archive opening, saving and extraction in the self-packaged Windows, Linux and macOS Tauri application. The web app keeps existing browser file controls and downloads.

## Native capability boundaries

- Runtime interface: `src/phitar-native.js` using the official Tauri dialog and filesystem plugins.
- Installed only for PhiTar in `scripts/phitar-self-package.mjs`; generic projects exported through Drop Zone **do not** gain these plugins.
- Permitted commands: dialog open/save, filesystem stat/read-file/write-file/mkdir; **no blanket `fs:scope-*`, no shell plugin and no persistent filesystem scope**.
- Selecting a file or directory in the native dialog adds that chosen path to Tauri's temporary session scope. Folder extraction asks for recursive scope to the selected folder because it must write nested paths.
- The native picker rejects files larger than 75 MiB before loading and the archive engine still caps expanded files at 150 MiB and 1,000 entries. In-memory design is unchanged.
- Extraction rechecks every relative filename, rejects traversal and unsafe Windows characters including alternate-data-stream syntax, creates a fresh `phitar-extracted-*` folder, and fails on attempted overwrite.
- Archive creation and checksum receipt save use the OS save dialog. Cancel leaves the destination untouched and is displayed as canceled.
- Scope changes are **not persisted across restarts**. Native dialog/folder behavior may differ by OS; manual end-to-end tests remain necessary.

## Manual verification after the native workflow passes

1. Install PhiTar on a clean Windows, Linux and macOS test machine.
2. Open a known ZIP and a TAR.GZ via **Open using system file picker**; confirm the manifest content matches.
3. Extract to a selected folder, inspect nested files and confirm the new `phitar-extracted-*` folder was created.
4. Build a ZIP and save via system dialog. Reopen the saved result and compare SHA-256 using PhiTar.
5. Test cancel on archive open, save and extraction. Canceled actions should not report success.
6. Test ZIP path traversal and case-insensitive collisions; ensure no paths escape the selected output folder.
7. Check the same flows in the GitHub Pages web version, which must not request native plugins.

## What's still missing

- Native recursive folder compression is available in v0.5 through the dialog-scoped reader, with preflight checks and the existing 75 MiB total size limit.
- Huge archive streaming, 7z/RAR support, encrypted archives, drag/drop from native file manager integration and native installer signing.
- Automated GUI dialog tests on real operating systems. CI proves compilation and kit capability shape, not human interaction.

Reference: https://v2.tauri.app/plugin/dialog/ and https://v2.tauri.app/plugin/file-system/