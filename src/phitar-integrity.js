/**
 * PhiTar archive integrity receipts.
 * SHA-256 checks byte-for-byte identity only; it does NOT authenticate
 * a sender, validate archive safety, or replace code signing.
 */
export const MAX_HASH_BYTES = 150 * 1024 * 1024;
export const RECEIPT_SCHEMA = 'phitar.archive-integrity.v1';

export function normalizeExpectedSha256(input) {
  if (input == null || String(input).trim() === '') return null;
  const value = String(input).trim().replace(/^sha(?:-?256)?\s*[:=]\s*/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Expected SHA-256 must be exactly 64 hexadecimal characters.');
  return value;
}

export async function sha256File(blob) {
  if (!(blob instanceof Blob)) throw new Error('Select a file to hash.');
  if (blob.size > MAX_HASH_BYTES) throw new Error('SHA-256 input exceeds the 150 MiB memory limit.');
  if (!globalThis.crypto?.subtle?.digest) throw new Error('SHA-256 requires a secure browser context (HTTPS or a trusted desktop origin).');
  const bytes = await blob.arrayBuffer();
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
}

export function compareSha256(observed, expectedInput) {
  const expected = normalizeExpectedSha256(expectedInput);
  if (!expected) return {status:'NOT_COMPARED', match:null};
  const actual = normalizeExpectedSha256(observed);
  return {status:actual === expected?'MATCH':'MISMATCH', match:actual === expected};
}

export async function createArchiveReceipt(blob, {filename, action='created'} = {}) {
  const name = String(filename || blob?.name || 'archive').replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!name || name.includes('/') || name.includes('\\')) throw new Error('Receipt requires a plain filename.');
  if (!['created', 'inspected', 'received'].includes(action)) throw new Error('Unsupported receipt action.');
  const sha256 = await sha256File(blob);
  return {
    schema: RECEIPT_SCHEMA,
    filename:name,
    sizeBytes:blob.size,
    algorithm:'SHA-256',
    sha256,
    action,
    state:'COMPUTED_LOCAL',
    generatedAt:new Date().toISOString(),
    note:'Integrity checksum only. Not a signature, malware scan or proof of trusted provenance.',
  };
}

export function receiptJson(receipt) {
  if (!receipt || receipt.schema !== RECEIPT_SCHEMA || !/^[a-f0-9]{64}$/.test(receipt.sha256||''))
    throw new Error('Invalid PhiTar archive receipt.');
  return JSON.stringify(receipt,null,2) + '\n';
}
