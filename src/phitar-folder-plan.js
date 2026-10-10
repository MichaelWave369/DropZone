/**
 * Pure preflight for a user-selected desktop directory.
 * No bytes loaded before file count, path, symlink and size checks pass.
 */
import {safeArchivePath, ARCHIVE_FILE_LIMIT, ARCHIVE_INPUT_LIMIT} from './phitar.js';

export const NATIVE_FOLDER_MAX_DEPTH = 20;
export const NATIVE_STREAM_TAR_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const NATIVE_FOLDER_MAX_DIRECTORIES = 2000;

export function validateNativeArchivePath(path) {
  const safe = safeArchivePath(path);
  // Reject NTFS alternate data streams and Windows-invalid file characters
  // on every desktop OS so the archive remains portable on extraction.
  if (/[:*?"<>|]/.test(safe)) throw new Error('Folder contains an unsafe native filename.');
  return safe;
}

export async function planNativeFolder(root, {readDir, lstat, join, label, maxBytes = ARCHIVE_INPUT_LIMIT} = {}) {
  if (!root || typeof readDir !== 'function' || typeof lstat !== 'function' || typeof join !== 'function')
    throw new Error('Native folder scanning requires a selected directory.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > NATIVE_STREAM_TAR_MAX_BYTES) throw new Error('Invalid native folder scan byte limit.');
  const rootName = validateNativeArchivePath(label);
  if (rootName.includes('/')) throw new Error('Folder label must be a single directory name.');
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory || rootInfo.isSymlink) throw new Error('Select a regular directory, not a symbolic link.');
  const entries = [];
  const seen = new Set();
  let bytes = 0, directories = 0;

  async function walk(relative, depth) {
    if (depth > NATIVE_FOLDER_MAX_DEPTH) throw new Error('Folder nesting exceeds the 20-level limit.');
    directories++;
    if (directories > NATIVE_FOLDER_MAX_DIRECTORIES) throw new Error('Folder tree contains too many directories.');
    const base = relative ? join(root, relative) : root;
    const listing = await readDir(base);
    if (!Array.isArray(listing)) throw new Error('Native filesystem returned an invalid directory listing.');
    listing.sort((a,b)=>String(a.name).localeCompare(String(b.name),'en'));
    for(const entry of listing) {
      const name = validateNativeArchivePath(entry.name);
      if (name.includes('/')) throw new Error('Folder entry names cannot contain separators.');
      const local = relative ? relative+'/'+name : name;
      validateNativeArchivePath(local);
      const full = join(root, local);
      const meta = await lstat(full);
      if (entry.isSymlink || meta.isSymlink) throw new Error('Symbolic links are not supported in native folder imports.');
      const archivePath = validateNativeArchivePath(rootName+'/'+local);
      const key = archivePath.toLowerCase();
      if (seen.has(key)) throw new Error('Folder contains case-insensitive duplicate paths: '+archivePath);
      seen.add(key);
      if (meta.isDirectory) {
        await walk(local,depth+1);
      } else if (meta.isFile) {
        if (!Number.isSafeInteger(meta.size) || meta.size < 0) throw new Error('Invalid native file size.');
        entries.push({path:archivePath,absolutePath:full,size:meta.size});
        bytes += meta.size;
        if (entries.length > ARCHIVE_FILE_LIMIT || bytes > maxBytes)
          throw new Error('Selected folder exceeds 1,000 files or the configured size cap. Nothing was loaded.');
      } else {
        throw new Error('Native folder contains a non-regular file.');
      }
    }
  }
  await walk('',0);
  if (entries.length === 0) throw new Error('The selected folder contains no regular files.');
  return {label:rootName,entries,totalBytes:bytes,directories};
}
