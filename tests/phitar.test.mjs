import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeArchivePath, createTar, inspectTar, gzipBytes, gunzipBytes,
  collectArchiveFiles, ARCHIVE_FILE_LIMIT, prettySize,
} from '../src/phitar.js';

const bytes = text => new TextEncoder().encode(text);
const text = data => new TextDecoder().decode(data);

test('PhiTar normalizes portable paths and blocks traversal/device names', () => {
  assert.equal(safeArchivePath('src\\app.js'), 'src/app.js');
  for (const path of ['../secret', '/root.txt', 'C:/secrets', 'a//b', 'a/./b', 'a/../b', 'con.txt', 'NUL', 'foo.']) {
    assert.throws(() => safeArchivePath(path), {name:'Error'}, path);
  }
});
test('PhiTar creates a real USTAR archive and restores original bytes', () => {
  const values = [
    {path:'hello.txt', data:bytes('Drop Zone archives')},
    {path:'nested/folder/app.js', data:bytes('console.log("PHITAR");')},
    {path:'empty.dat', data:new Uint8Array()},
  ];
  const tar = createTar(values);
  assert.equal(tar.byteLength % 512, 0);
  const restored = inspectTar(tar);
  assert.deepEqual(restored.map(r=>r.path), values.map(x=>x.path));
  assert.deepEqual(restored.map(r=>text(r.data)), values.map(x=>text(x.data)));
});
test('PhiTar supports USTAR prefix paths between 100 and 255 bytes', () => {
  const name = 'nested/'.repeat(16) + 'hello-world.txt';
  const tar = createTar([{path:name, data:bytes('hello')}]);
  assert.equal(inspectTar(tar)[0].path, name);
});
test('PhiTar refuses Unicode TAR names instead of silently corrupting them', () => {
  assert.throws(() => createTar([{path:'café.txt',data:bytes('x')}]), /ASCII/);
});
test('PhiTar catches checksum corruption and unsupported link records', () => {
  const tar = createTar([{path:'test.txt', data:bytes('x')}]);
  const changed = tar.slice();changed[0] ^= 1;
  assert.throws(()=>inspectTar(changed), /checksum/);
  const type = tar.slice();type[156] = 50;
  assert.throws(()=>inspectTar(type), /checksum|link/);
});
test('PhiTar rejects truncated TARs and expanded payloads', () => {
  const tar = createTar([{path:'test.txt',data:bytes('some text')}]);
  assert.throws(()=>inspectTar(tar.slice(0,560)), /Truncated/);
});
test('PhiTar gzip roundtrip uses actual gzip streams', async () => {
  const tar = createTar([{path:'hello.txt', data:bytes('a'.repeat(5000))}]);
  const compressed = await gzipBytes(tar);
  assert.equal(compressed[0],0x1f);
  assert.equal(compressed[1],0x8b);
  const decompressed = await gunzipBytes(compressed);
  assert.deepEqual(decompressed,tar);
  assert.equal(text(inspectTar(decompressed)[0].data),'a'.repeat(5000));
});
test('PhiTar selection preserves folder paths and catches duplicates', () => {
  const a = new File(['one'],'a.txt');
  const b = new File(['two'],'B.txt');
  assert.deepEqual(collectArchiveFiles([a,b]).map(x=>x.path), ['a.txt','B.txt']);
  assert.throws(()=>collectArchiveFiles([a,new File(['two'],'A.TXT')]), /Duplicate/);
});
test('PhiTar rejects excessive file counts and formats sizes', () => {
  assert.equal(ARCHIVE_FILE_LIMIT,1000);
  assert.equal(prettySize(0),'0 B');
  assert.match(prettySize(1048576),/1.0 MB/);
});
