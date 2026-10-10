# PhiTar v0.5: native folder compression

PhiTar's desktop archive workstation now supports an OS-native **Select system folder** action for the create-archive panel. It uses the same ZIP/TAR/TAR.GZ archive engine as the web edition, and never uploads selected files.

## Trust and permission model

- On a click, the Tauri dialog plugin lets the user choose a **single directory**, with recursive session-scoped access to its descendants.
- `src/phitar-folder-plan.js` performs a metadata-only walk using filesystem `readDir` and `lstat`. No file bytes are read during the preflight.
- Every file and directory entry is validated as a portable relative path before being used to construct a native filesystem path. Absolute paths and `..`, reserved Windows names, ADS separators, invalid Windows characters and case-insensitive duplicates are rejected.
- Symbolic links, non-regular files and a selected symlink directory are rejected rather than followed. The scan is limited to **20 levels of nesting, 2,000 directories, 1,000 regular files and 75 MiB total**.
- After preflight, each regular file is lstat-checked again and read with `readFile` into a local File/Blob. Its length must match the preflight size. This reduces, but cannot eliminate, time-of-check/time-of-use races; native GUI tests on all platforms remain required.
- Selected files remain in local memory and are passed through `collectArchiveFiles()`. Their logical paths include the selected folder name, preserving nested structure.
- No persistent drive-wide scope, network upload, executable action, or extra plugin beyond the already installed Tauri dialog/fs plugins. The generated self-kit adds only `fs:allow-read-dir` and `fs:allow-lstat` to the existing minimal capabilities.
- The general Drop Zone build-kit generator is unchanged; these extra capabilities are only patched into **PhiTar's own desktop builds**.

## Manual test plan

1. Open a freshly installed PhiTar desktop application.
2. Choose **Select system folder** in the Create Archive station. Select a folder with nested subdirectories and files.
3. Confirm the file count and nested paths in the manifest. Create ZIP and save it through the native save dialog.
4. Open that ZIP through the native Open dialog. Verify all files and paths. Extract to a folder; inspect result and compare PhiTar SHA-256 receipts.
5. Repeat creation for TAR and TAR.GZ with ASCII-only path names. Unicode names are intentionally supported in ZIP but not this version of USTAR TAR.
6. Cancel folder selection and confirm no files were staged. Test a folder containing a symlink and confirm rejection.
7. Test an oversized folder and confirm it is rejected **before** file bytes are read.
8. Repeat as a browser session on GitHub Pages and confirm the existing webkitdirectory input still works without any native API.

## Not yet implemented

PhiTar v0.5 is still a bounded in-memory prototype. **Large-file streaming and files beyond 75 MiB are not yet supported.** The next iteration should move archive creation/extraction and hashing into chunked workers or a deliberately scoped native engine before raising limits. Native file associations, encrypted archives, RAR and 7z remain separate work.

Tauri official references: https://v2.tauri.app/reference/javascript/dialog/ and https://v2.tauri.app/plugin/file-system/