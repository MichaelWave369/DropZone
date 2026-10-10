# PhiTar v0.1: archive workstation

PhiTar is a separate, client-side archive tool inside The Drop Zone. It never invokes Tauri, Capacitor or Python packagers and **does not** transform an archive into an installer.

## Formats

| Action | ZIP | USTAR TAR | GZIP TAR | 7z | RAR |
| --- | --- | --- | --- | --- | --- |
| Create | Yes (DEFLATE 0/6/9) | Yes | Yes (browser gzip stream) | No | No |
| Inspect | Yes (JSZip CRC check) | Yes | Yes | No | No |
| Extract to local folder | Chromium with File System Access API | Same | Same | No | No |
| Convert contents to ZIP | Yes | Yes | Yes | No | No |

- Creation: choose individual files or a folder, pick ZIP, TAR or TAR.GZ, then download.
- Inspection: choose an archive and review validated file list before extracting.
- Extraction: supporting Chromium browsers can write into a new phitar-extracted-* subfolder inside the chosen directory. Other browsers can repack verified archive contents into ZIP. Repacking is not an extracted folder.
- ZIP supports Unicode names. USTAR v1 rejects non-ASCII names and paths exceeding the 100-byte filename / 155-byte prefix limits. Full PAX/GNU support needs future work.
- TGZ is synonymous with TAR.GZ. Bare GZ, encrypted ZIP, 7z and RAR are unsupported.
- Maximum 1000 regular files and 75 MiB input. Cap expanded archives at 150 MiB. These checks reduce but cannot eliminate memory exhaustion from malformed archives.
- Extraction rejects TAR symlinks and special records, checks USTAR header checksums, and rejects absolute paths, path traversal, case-insensitive duplicates and Windows reserved device filenames.
- ZIP uses JSZip. TAR headers and gzip streaming live in src/phitar.js (gzip uses standard browser CompressionStream / DecompressionStream).
- No archive signing or encryption. PhiTar is not a vault.

## Testing

npm test covers USTAR roundtrips, gzip roundtrips, prefix paths, unsafe paths, corruption and truncation. PR source verification runs tests and the Vite build. Verify manual folder save in Chrome/Edge.

## Roadmap

1. Improve drag-and-drop folder traversal, progress, cancellation and worker-based memory quotas.
2. PAX headers for Unicode and longer paths; TAR.XZ adapter.
3. SHA-256 manifests and verification receipts.
4. 7z support through vetted local engine; RAR read-only via appropriately licensed parser.
5. Explicit handoff of selected projects to app packaging.

The RAR encoder is proprietary. RAR compression is not advertised or implemented here.