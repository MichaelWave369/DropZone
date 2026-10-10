/**
 * Parallax Relay handoff contract v1.
 * Pure metadata and cryptographic receipts. Does not contact Netlify or upload bytes.
 */
export const RELAY_ORIGIN = 'https://parallax-relay-369.netlify.app';
export const RELAY_URL = RELAY_ORIGIN + '/';
export const HANDOFF_LIMIT_BYTES = 75 * 1024 * 1024;

export function normalizeHandoffLabel(value, fallback, max = 120) {
  return String(value || fallback).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || fallback;
}

export async function prepareRelayHandoff(file, options = {}) {
  if (!(file instanceof Blob)) throw new Error('Choose a file or export a build kit first.');
  if (file.size < 1 || file.size > HANDOFF_LIMIT_BYTES)
    throw new Error('Relay preparation supports files between 1 byte and 75 MiB.');
  if (!globalThis.crypto?.subtle)
    throw new Error('SHA-256 is unavailable. Open Drop Zone through HTTPS.');
  const filename = normalizeHandoffLabel(options.filename || file.name, 'dropzone-artifact.zip', 180);
  const bytes = await file.arrayBuffer();
  // Digest the actual output bytes, never a claimed checksum from uploaded metadata.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  return {
    schema: 'dropzone.parallax-handoff.v1',
    state: 'PREPARED_LOCAL_ONLY',
    filename,
    sizeBytes: file.size,
    sha256,
    project: normalizeHandoffLabel(options.project, 'DropZone'),
    version: normalizeHandoffLabel(options.version, 'unspecified', 64),
    recipient: normalizeHandoffLabel(options.recipient, 'Private / owner', 100),
    relay: RELAY_URL,
    createdAt: new Date().toISOString(),
  };
}

export function relayHandoffNote(receipt) {
  if (!receipt || receipt.schema !== 'dropzone.parallax-handoff.v1') throw new Error('Invalid handoff receipt.');
  return [
    'Drop Zone / PhiTar handoff',
    'Project: ' + receipt.project,
    'Version: ' + receipt.version,
    'Recipient: ' + receipt.recipient,
    'File: ' + receipt.filename,
    'Bytes: ' + receipt.sizeBytes,
    'SHA-256: ' + receipt.sha256,
    'Prepared locally. Upload the downloaded file manually through Parallax Relay. Verify checksum after receipt.',
  ].join('\n');
}
