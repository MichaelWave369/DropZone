import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_HASH_BYTES, RECEIPT_SCHEMA,
  sha256File, normalizeExpectedSha256, compareSha256,
  createArchiveReceipt, receiptJson,
} from '../src/phitar-integrity.js';

test('PhiTar SHA-256 is computed from actual file bytes',async()=>{
  const file = new File(['abc'], 'test.zip');
  const digest = await sha256File(file);
  assert.equal(digest,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const copy = new Blob(['abcd']);
  assert.notEqual(await sha256File(copy), digest);
});
test('PhiTar SHA-256 supports optional SHA256 prefix and rejects invalid hashes',()=>{
  const known='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(normalizeExpectedSha256(' SHA256: '+known.toUpperCase()),known);
  assert.equal(normalizeExpectedSha256(''),null);
  assert.equal(compareSha256(known,'' ).status,'NOT_COMPARED');
  assert.deepEqual(compareSha256(known,known),{status:'MATCH',match:true});
  assert.deepEqual(compareSha256(known,'0'.repeat(64)),{status:'MISMATCH',match:false});
  assert.throws(()=>normalizeExpectedSha256('not-a-hash'),/64 hexadecimal/);
});
test('PhiTar archive integrity receipt is explicit about its authority',async()=>{
  const receipt=await createArchiveReceipt(new Blob(['abc']),{filename:'example.tar.gz',action:'created'});
  assert.equal(receipt.schema,RECEIPT_SCHEMA);
  assert.equal(receipt.state,'COMPUTED_LOCAL');
  assert.equal(receipt.algorithm,'SHA-256');
  assert.equal(receipt.action,'created');
  assert.equal(receipt.sizeBytes,3);
  assert.equal(receipt.sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.match(receipt.note,/Not a signature/);
  assert.deepEqual(JSON.parse(receiptJson(receipt)),receipt);
  assert.throws(()=>receiptJson({sha256:'abc'}),/Invalid/);
});
test('PhiTar rejects unsafe receipt names, actions and invalid hash input',async()=>{
  await assert.rejects(createArchiveReceipt(new Blob(['a']),{filename:'../secret'}),/plain filename/);
  await assert.rejects(createArchiveReceipt(new Blob(['a']),{filename:'x.zip',action:'uploaded'}),/Unsupported receipt/);
  await assert.rejects(sha256File(null),/Select a file/);
  class Huge extends Blob {get size(){return MAX_HASH_BYTES+1;}}
  await assert.rejects(sha256File(new Huge(['x'])),/150 MiB/);
});
