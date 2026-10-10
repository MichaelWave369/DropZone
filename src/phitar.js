/**
 * PhiTar's browser-local POSIX USTAR / gzip engine.
 * Never executes source files. RAR and 7z are intentionally not advertised.
 */
export const ARCHIVE_FILE_LIMIT = 1000;
export const ARCHIVE_INPUT_LIMIT = 75 * 1024 * 1024;
export const ARCHIVE_EXPANDED_LIMIT = 150 * 1024 * 1024;
const te = new TextEncoder();
const td = new TextDecoder('utf-8', { fatal: true });
const BLOCK = 512;

export function safeArchivePath(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Archive path cannot be empty.');
  const path = input.replaceAll('\\', '/').replace(/^\.\//, '');
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || /[\x00-\x1f\x7f]/.test(path))
    throw new Error('Archive contains an absolute or unsafe path.');
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.endsWith(' ') || p.endsWith('.')))
    throw new Error('Archive contains a traversal or non-portable path.');
  if (parts.some(p => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(p)))
    throw new Error('Archive contains a Windows reserved filename.');
  return parts.join('/');
}

export function collectArchiveFiles(files) {
  const input = Array.from(files ?? []);
  if (!input.length) throw new Error('Choose at least one file.');
  if (input.length > ARCHIVE_FILE_LIMIT) throw new Error('Too many files (maximum 1000).');
  let total = 0;
  const seen = new Set();
  return input.map(file => {
    if (!(file instanceof Blob)) throw new Error('Expected browser file objects.');
    const path = safeArchivePath(file.webkitRelativePath || file.name);
    if (seen.has(path.toLowerCase())) throw new Error('Duplicate filename: ' + path);
    seen.add(path.toLowerCase());
    total += file.size;
    if (file.size > ARCHIVE_INPUT_LIMIT || total > ARCHIVE_INPUT_LIMIT)
      throw new Error('Archive input exceeds the 75 MB browser limit.');
    return { path, file };
  });
}

function writeAscii(bytes, offset, length, value) {
  if (!/^[\x20-\x7e]*$/.test(value) || value.length > length) throw new Error('TAR v1 requires ASCII filenames within USTAR limits.');
  for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
}
function octal(bytes, offset, length, number) {
  const s = Math.floor(number).toString(8);
  if (s.length > length - 1 || !Number.isSafeInteger(number) || number < 0)
    throw new Error('Value exceeds TAR header limits.');
  writeAscii(bytes, offset, length, s.padStart(length - 1, '0') + '\0');
}
function ustarName(path) {
  if (!/^[\x20-\x7e]+$/.test(path)) throw new Error('TAR v1 only accepts ASCII paths; use ZIP for Unicode names.');
  if (te.encode(path).length <= 100) return { name: path, prefix: '' };
  const slash = path.lastIndexOf('/');
  for (let i = slash; i > 0; i = path.lastIndexOf('/', i - 1)) {
    const prefix = path.slice(0, i), name = path.slice(i + 1);
    if (prefix.length <= 155 && name.length <= 100) return { name, prefix };
  }
  throw new Error('TAR path exceeds USTAR limits; use ZIP for long filenames.');
}
function header(path, byteLength, mtime) {
  const { name, prefix } = ustarName(path);
  const h = new Uint8Array(BLOCK);
  writeAscii(h, 0, 100, name);
  octal(h, 100, 8, 0o644);
  octal(h, 108, 8, 0);
  octal(h, 116, 8, 0);
  octal(h, 124, 12, byteLength);
  octal(h, 136, 12, mtime);
  h.fill(32, 148, 156);
  h[156] = '0'.charCodeAt(0);
  writeAscii(h, 257, 6, 'ustar\0');
  writeAscii(h, 263, 2, '00');
  writeAscii(h, 345, 155, prefix);
  let check = 0;
  for (const n of h) check += n;
  // POSIX checksum: six octal digits followed by NUL and space.
  const field = check.toString(8).padStart(6, '0');
  writeAscii(h, 148, 8, field + '\0 ');
  return h;
}

export function createTar(entries) {
  if (!entries.length || entries.length > ARCHIVE_FILE_LIMIT) throw new Error('Invalid TAR file count.');
  let size = 1024;
  const paths = new Set();
  for (const entry of entries) {
    entry.path = safeArchivePath(entry.path);
    if (!(entry.data instanceof Uint8Array)) throw new Error('TAR entries require Uint8Array content.');
    if (paths.has(entry.path.toLowerCase())) throw new Error('Duplicate filename: ' + entry.path);
    paths.add(entry.path.toLowerCase());
    ustarName(entry.path);
    size += BLOCK + Math.ceil(entry.data.length / BLOCK) * BLOCK;
    if (size > ARCHIVE_EXPANDED_LIMIT) throw new Error('TAR exceeds the 150 MB browser output limit.');
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const entry of entries) {
    out.set(header(entry.path, entry.data.length, entry.mtime ?? 0), offset);
    offset += BLOCK;
    out.set(entry.data, offset);
    offset += Math.ceil(entry.data.length / BLOCK) * BLOCK;
  }
  return out;
}
function parseOctal(bytes, start, width) {
  const s = td.decode(bytes.subarray(start, start + width)).replace(/\0.*$/, '').trim();
  if (!s || !/^[0-7]+$/.test(s)) throw new Error('TAR contains an invalid octal header field.');
  const n = Number.parseInt(s, 8);
  if (!Number.isSafeInteger(n)) throw new Error('TAR has an oversized header field.');
  return n;
}
function isZero(bytes) { return bytes.every(n => n === 0); }
function readName(bytes) {
  return td.decode(bytes.subarray(0, bytes.indexOf(0) === -1 ? bytes.length : bytes.indexOf(0)));
}

export function inspectTar(source) {
  const data = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (data.byteLength > ARCHIVE_EXPANDED_LIMIT) throw new Error('Archive exceeds 150 MB.');
  const records = [];
  let pos = 0, expanded = 0;
  const seen = new Set();
  while (pos + BLOCK <= data.byteLength) {
    const h = data.subarray(pos, pos + BLOCK);
    if (isZero(h)) {
      if (pos + 1024 > data.byteLength || !isZero(data.subarray(pos + BLOCK, pos + 1024)))
        throw new Error('TAR has a truncated end marker.');
      return records;
    }
    if (td.decode(h.subarray(257, 262)) !== 'ustar')
      throw new Error('PhiTar v1 supports POSIX USTAR archives. Extended PAX/GNU TAR is not supported yet.');
    const expected = parseOctal(h, 148, 8);
    let actual = 0;
    for (let i = 0; i < BLOCK; i++) actual += i >= 148 && i < 156 ? 32 : h[i];
    if (actual !== expected) throw new Error('TAR header checksum mismatch.');
    const type = h[156];
    if (type !== 0 && type !== 48 && type !== 53)
      throw new Error('TAR links, special entries and extended headers are not supported.');
    const name = readName(h.subarray(0, 100));
    const prefix = readName(h.subarray(345, 500));
    const rawPath = prefix ? prefix + '/' + name : name;
    const path = safeArchivePath(rawPath.replace(/\/$/, ''));
    const length = parseOctal(h, 124, 12);
    if (type === 53 && length !== 0) throw new Error('Malformed TAR directory record.');
    const start = pos + BLOCK;
    const padded = Math.ceil(length / BLOCK) * BLOCK;
    if (padded > data.byteLength - start) throw new Error('Truncated TAR archive.');
    if (type !== 53) {
      if (seen.has(path.toLowerCase())) throw new Error('Duplicate filename: ' + path);
      seen.add(path.toLowerCase());
      expanded += length;
      if (records.length >= ARCHIVE_FILE_LIMIT || expanded > ARCHIVE_EXPANDED_LIMIT)
        throw new Error('Archive exceeds file-count or unpacked-size limits.');
      records.push({ path, size: length, data: data.slice(start, start + length) });
    }
    pos = start + padded;
  }
  throw new Error('Truncated TAR archive (missing end marker).');
}

export async function gzipBytes(bytes) {
  if (typeof CompressionStream === 'undefined') throw new Error('This browser does not support gzip compression.');
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const result = new Uint8Array(await new Response(stream).arrayBuffer());
  if (result.byteLength > ARCHIVE_INPUT_LIMIT) throw new Error('Compressed file exceeds the 75 MB browser limit.');
  return result;
}

export async function gunzipBytes(bytes) {
  if (bytes.byteLength > ARCHIVE_INPUT_LIMIT) throw new Error('Archive exceeds the 75 MB browser limit.');
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser does not support gzip decompression.');
  // The uncompressed payload must be capped while streaming to block decompression bombs.
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ARCHIVE_EXPANDED_LIMIT) throw new Error('Decompressed TAR exceeds the 150 MB limit.');
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

export function prettySize(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' :
    bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
}
