# PhiTar v0.7: large USTAR inspection and extraction

PhiTar's standalone Tauri desktop app can now inspect and extract **uncompressed POSIX USTAR** archives beyond the normal 75 MiB browser limit, without loading the archive into JavaScript memory.

## Two-phase native workflow

1. Choose **Inspect large TAR**. The native file picker scopes read access to the selected TAR. A bounded scanner reads 512-byte metadata headers, validates POSIX USTAR structure and jumps over file payloads with Tauri file-handle seek. The app retains only the regular file manifest.
2. Review the manifest. Select **Extract into new folder**. A separate system dialog asks you to choose an output parent. PhiTar opens the source TAR again and rescans its headers, refusing extraction if the archive layout changed since inspection.
3. A fresh `phitar-large-extracted-*` folder is created inside the chosen parent. Regular file bytes are read and written in 64 KiB chunks through Tauri native file handles. Existing file paths are not overwritten. Directories are created only below the new output root.

## Accepted format and bounds

- Input: **uncompressed** `.tar` only. ZIP, TGZ, TAR.GZ, PAX/GNU extensions, symlinks, hard links and special files are NOT supported in the large reader.
- A maximum of **1,000 regular files**, **2 GiB unpacked data** and **2 GiB plus 1 MiB input TAR structure**.
- Valid USTAR header checksums; two 512-byte zero-block TAR end markers; validated portable relative filenames, no `..` segments, absolute paths, Windows devices, NTFS stream separators, unsafe filename characters or case-insensitive path collisions.
- The scanner reads TAR headers only. Header checksums are **not** cryptographic payload checksums: file bytes remain unverified against an independent source.
- Only on the desktop Tauri app. The GitHub Pages/browser archive reader intentionally retains its memory limits.

## Failure and trust boundaries

- Inspection and extraction are two separate user actions. No uploaded source, no cloud connection or automatic code execution.
- Existing files are not intentionally overwritten: the extraction creates a fresh root and `open(...,{createNew:true})` for every file.
- A partially extracted folder may remain when source I/O fails midway, and its path is reported. PhiTar does not automatically recursively delete a directory after failure.
- TOCTOU hazards remain for filesystems modified concurrently; revalidation checks TAR metadata, but not cryptographic payload identity. An attacker who can change the on-disk TAR between reads can change payload bytes.
- No code signing, malware scanning, payload hash verification, pause/resume, or cancellation yet.

## Tests and manual acceptance

Automated Node tests cover header-only inspection of sparse synthetic 300 MiB TARs without allocating the payload, standards-compatible TAR roundtrips, partial writes, truncated payloads, header corruption, path traversal and file/directory collisions.

After CI produces installers, manually verify on Windows, Linux and macOS: open a TAR larger than 75 MiB, inspect it, extract into an empty chosen folder, and compare file bytes using an independent TAR tool and SHA-256. Try canceling both native dialogs, malformed TARs, symlinks/hardlinks, a duplicate filename, and a source TAR modified between scan and extraction. Successful compilation does not prove OS GUI functionality.

Next work: streamed SHA-256 checking and cancellation, plus ZIP64 or TAR.GZ streaming implemented and tested separately.