import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeJoin} from '../src/phitar-native.js';

test('nativeJoin accepts a user-selected absolute destination and nested paths', () => {
  assert.equal(nativeJoin('/tmp/selected','folder/deep/hello.txt'),'/tmp/selected/folder/deep/hello.txt');
  assert.equal(nativeJoin('C:\\Users\\Test','folder/deep/hello.txt'),'C:\\Users\\Test\\folder\\deep\\hello.txt');
});
test('nativeJoin forbids traversal, Windows device paths and ADS file names', () => {
  for (const name of ['../outside.txt','/absolute.txt','folder/../outside','NUL.txt','file.txt:extra', 'a/b?.txt','a/b*']) {
    assert.throws(()=>nativeJoin('/tmp/selected',name),{name:'Error'},name);
  }
});
test('nativeJoin only accepts absolute paths supplied by folder picker', () => {
  for (const root of ['','relative','../private']) {
    assert.throws(()=>nativeJoin(root,'good.txt'),/selected absolute directory/);
  }
});
