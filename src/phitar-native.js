/**
 * PhiTar native bridge (Tauri 2).
 *
 * An intentionally small browser/desktop boundary. The only directory
 * capabilities come from user-operated dialogs at runtime. No blanket
 * HOME/DOCUMENT/DOWNLOAD filesystem scope, shell plugin, or web requests.
 */
import { isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { mkdir, readFile, stat, writeFile } from '@tauri-apps/plugin-fs';
import { safeArchivePath, ARCHIVE_FILE_LIMIT, ARCHIVE_INPUT_LIMIT, ARCHIVE_EXPANDED_LIMIT } from './phitar.js';

export function hasNativeArchiveDialog() {
  return isTauri();
}

export function nativeJoin(root, ...segments) {
  if (typeof root !== 'string' || !root.trim() || !/^(?:[a-z]:[\\/]|[\\/]|\\\\)/i.test(root))
    throw new Error('Native output root must come from a selected absolute directory.');
  // Native dialog paths may contain either separator depending on platform.
  const separator = root.includes('\\') ? '\\' : '/';
  const normalized = segments.flatMap(segment => {
    const path = safeArchivePath(segment);
    // Windows disallows these characters, and ':' can introduce alternate
    // data streams that should never be created during archive extraction.
    if (/[:*?"<>|]/.test(path)) throw new Error('Unsafe filename for native extraction.');
    return path.split('/');
  });
  return root.replace(/[\\/]+$/, '') + separator + normalized.join(separator);
}

function nativeBaseName(path) {
  return String(path).split(/[\\/]/).at(-1);
}

export async function pickNativeArchive() {
  if (!hasNativeArchiveDialog()) throw new Error('Native file picker requires the desktop PhiTar app.');
  const selected = await open({
    title: 'Open archive in PhiTar',
    multiple: false,
    filters: [{ name: 'Supported archives', extensions: ['zip', 'tar', 'gz', 'tgz'] }],
  });
  if (!selected) return null;
  if (typeof selected !== 'string') throw new Error('Select a single archive.');
  const meta = await stat(selected);
  if (!meta.isFile || meta.size > ARCHIVE_INPUT_LIMIT) throw new Error('Selected archive is not a regular file under 75 MiB.');
  const name = nativeBaseName(selected);
  if (!/\.(?:zip|tar|tar\.gz|tgz)$/i.test(name)) throw new Error('PhiTar only opens ZIP, TAR, TAR.GZ or TGZ.');
  const data = await readFile(selected);
  if (data.length > ARCHIVE_INPUT_LIMIT) throw new Error('Selected archive exceeds PhiTar input limit.');
  return new File([data], name, { type: 'application/octet-stream' });
}

export async function saveNativeArchive(blob, suggestedName) {
  if (!hasNativeArchiveDialog()) throw new Error('Native save picker requires the desktop PhiTar app.');
  if (!(blob instanceof Blob) || blob.size > ARCHIVE_EXPANDED_LIMIT)
    throw new Error('Archive output exceeds the 150 MiB desktop preview limit.');
  const filename = safeArchivePath(suggestedName);
  if (filename.includes('/')) throw new Error('Only a filename may be suggested for saving.');
  const selected = await save({title:'Save PhiTar archive',defaultPath:filename});
  if (!selected) return {saved:false};
  const data = new Uint8Array(await blob.arrayBuffer());
  await writeFile(selected, data);
  return {saved:true, filename:nativeBaseName(selected)};
}

export async function extractNativeArchive(entries) {
  if (!hasNativeArchiveDialog()) throw new Error('Native folder picker requires the desktop PhiTar app.');
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > ARCHIVE_FILE_LIMIT)
    throw new Error('Choose a validated archive of at most 1,000 regular files.');
  let total=0;
  const paths=new Set();
  const files = entries.map(entry => {
    const path=safeArchivePath(entry.path);
    // Validate all native names before showing a dialog or writing any file.
    nativeJoin('/phitar-validation',path);
    if (!(entry.data instanceof Uint8Array)) throw new Error('Extraction requires validated Uint8Array content.');
    if (paths.has(path.toLowerCase())) throw new Error('Duplicate archive path: ' + path);
    paths.add(path.toLowerCase());
    total += entry.data.length;
    if (total > ARCHIVE_EXPANDED_LIMIT) throw new Error('Archive exceeds the 150 MiB extraction limit.');
    return { path, data: entry.data };
  });
  // A user click chooses precisely the parent folder. The dialog adds it
  // (recursively) to the session-scoped Tauri fs ACL, not a blanket drive scope.
  const parent = await open({title:'Choose destination folder for PhiTar extraction',directory:true,recursive:true,multiple:false});
  if (!parent) return {saved:false,count:0};
  if (typeof parent !== 'string') throw new Error('Choose one destination directory.');
  // New child directory keeps user files untouched. No overwrite.
  const folder = nativeJoin(parent,'phitar-extracted-'+Date.now());
  await mkdir(folder, {recursive:false});
  for (const {path,data} of files) {
    const parts=path.split('/');
    if (parts.length>1) await mkdir(nativeJoin(folder,...parts.slice(0,-1)),{recursive:true});
    await writeFile(nativeJoin(folder,path),data,{createNew:true});
  }
  return {saved:true,count:files.length,directory:folder};
}
