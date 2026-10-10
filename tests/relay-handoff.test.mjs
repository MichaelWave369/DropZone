import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELAY_ORIGIN, RELAY_URL, HANDOFF_LIMIT_BYTES,
  prepareRelayHandoff, relayHandoffNote, normalizeHandoffLabel,
} from '../src/relay-handoff.js';

test('Relay uses only the known HTTPS Netlify origin', () => {
  assert.equal(RELAY_URL, 'https://parallax-relay-369.netlify.app/');
  assert.equal(new URL(RELAY_URL).origin, RELAY_ORIGIN);
  assert.equal(new URL(RELAY_URL).search, '');
  assert.equal(new URL(RELAY_URL).hash, '');
});
test('Relay digest comes from real file bytes and matches SHA-256 known vector', async () => {
  const file = new File(['abc'], 'verify.zip');
  const receipt = await prepareRelayHandoff(file,{project:'Drop Zone',recipient:'Private / owner',version:'0.4.0'});
  assert.equal(receipt.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(receipt.filename, 'verify.zip');
  assert.equal(receipt.sizeBytes, 3);
  assert.equal(receipt.state, 'PREPARED_LOCAL_ONLY');
  assert.equal(receipt.schema, 'dropzone.parallax-handoff.v1');
  assert.equal(receipt.project, 'Drop Zone');
  assert.equal(receipt.recipient, 'Private / owner');
  assert.equal(receipt.relay, RELAY_URL);
  assert.match(receipt.createdAt, /^\d{4}-\d\d-\d\dT/);
});
test('Handoff note includes digest, recipient, explicit manual-upload boundary', async () => {
  const receipt=await prepareRelayHandoff(new File(['hello'],'demo.tar.gz'));
  const note=relayHandoffNote(receipt);
  assert.match(note,/Private \/ owner/);
  assert.match(note,/demo\.tar\.gz/);
  assert.match(note,/SHA-256: [0-9a-f]{64}/);
  assert.match(note,/manually through Parallax Relay/);
  assert.throws(()=>relayHandoffNote({}),/Invalid/);
});
test('Only safe visible metadata labels may enter a handoff receipt', () => {
  assert.equal(normalizeHandoffLabel(' foo\n bar ','fallback'),'foo bar');
  assert.equal(normalizeHandoffLabel('', 'fallback'),'fallback');
  assert.equal(normalizeHandoffLabel('x'.repeat(150), 'fallback', 100).length,100);
});
test('Handoff refuses empty and oversized files before reading payload bytes', async () => {
  await assert.rejects(prepareRelayHandoff(new Blob([])),/between 1 byte/);
  class Huge extends Blob { get size() { return HANDOFF_LIMIT_BYTES + 1; } }
  await assert.rejects(prepareRelayHandoff(new Huge(['small'])),/between 1 byte/);
  await assert.rejects(prepareRelayHandoff(null),/Choose a file/);
});
