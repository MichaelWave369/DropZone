import test from 'node:test';
import assert from 'node:assert/strict';
import {createTar,createTarHeader} from '../src/phitar.js';
import {inspectStreamingTar,extractStreamingTar} from '../src/phitar-tar-reader.js';

const encode=new TextEncoder();
const sourceFor=bytes=>({
  size:bytes.length,
  async readAt(offset,length){return bytes.slice(offset,offset+length);},
});

function fakeExtraction(){
  const dirs=[],opened=new Map(),saved=new Map(),steps=[];
  return {
    dirs,saved,steps,
    adapter:{
      readAt:null,
      async createRoot(){dirs.push('/chosen/phitar-new');return '/chosen/phitar-new';},
      join:(base,path)=>base+'/'+path,
      async mkdir(path){dirs.push(path);},
      async openNew(path){
        if(saved.has(path))throw new Error('attempted overwrite');
        const chunks=[];
        opened.set(path,chunks);
        return{
          async write(data){const n=Math.min(17,data.length);chunks.push(data.slice(0,n));return n;},
          async close(){saved.set(path,Uint8Array.from(chunks.flatMap(x=>Array.from(x))));},
        };
      },
    },
  };
}

test('large TAR scanner roundtrips USTAR headers without reading payload bytes',async()=>{
  const archive=createTar([
    {path:'folder/a.txt',data:encode.encode('hello')},
    {path:'folder/deep/b.txt',data:encode.encode('deep file')},
  ]);
  const offsets=[];
  const original=sourceFor(archive);
  const reader={
    size:original.size,
    readAt:async(offset,len)=>{offsets.push([offset,len]);return original.readAt(offset,len);},
  };
  const plan=await inspectStreamingTar(reader);
  assert.deepEqual(plan.entries.map(x=>x.path),['folder/a.txt','folder/deep/b.txt']);
  assert.deepEqual(plan.entries.map(x=>x.size),[5,9]);
  assert.ok(offsets.every(([,n])=>n===512),'only TAR headers should be read during inspection');
  const mock=fakeExtraction();
  mock.adapter.readAt=original.readAt;
  const result=await extractStreamingTar(plan,mock.adapter,{progress:p=>mock.steps.push(p)});
  assert.equal(result.files,2);
  assert.equal(result.bytes,14);
  assert.equal(new TextDecoder().decode(mock.saved.get('/chosen/phitar-new/folder/a.txt')),'hello');
  assert.equal(new TextDecoder().decode(mock.saved.get('/chosen/phitar-new/folder/deep/b.txt')),'deep file');
  assert.equal(mock.steps.at(-1).files,2);
});

test('scanner can plan 300 MiB TAR without allocating data bytes',async()=>{
  const size=300*1024*1024;
  const header=createTarHeader('project/big.dat',size);
  const archiveSize=512+size+1024;
  let bytesRequested=0;
  const plan=await inspectStreamingTar({
    size:archiveSize,
    async readAt(offset,len){
      bytesRequested+=len;
      if(offset===0)return header.slice();
      if(offset===512+size||offset===1024+size)return new Uint8Array(len);
      throw new Error('Scanner unexpectedly read archive payload');
    },
  });
  assert.equal(plan.entries[0].size,size);
  assert.ok(bytesRequested<=1536);
});

test('scanner detects corrupted checksum, unsupported links and truncated end markers',async()=>{
  const base=createTar([{path:'good.txt',data:encode.encode('contents')}]);
  const bad=base.slice();bad[20]^=1;
  await assert.rejects(inspectStreamingTar(sourceFor(bad)),/checksum/);
  const missingEnd=base.slice(0,base.length-512);
  await assert.rejects(inspectStreamingTar(sourceFor(missingEnd)),/missing end marker|truncated/i);
  const type=base.slice();type[156]=50;
  await assert.rejects(inspectStreamingTar(sourceFor(type)),/checksum|links/);
});

test('scanner rejects unsafe paths with correct TAR checksums',async()=>{
  const header=createTarHeader('valid.txt',1);
  const clone=header.slice();
  clone.fill(0,0,100);
  clone.set(encode.encode('../x.txt'),0);
  clone.fill(32,148,156);
  let sum=clone.reduce((a,b)=>a+b,0);
  const field=sum.toString(8).padStart(6,'0')+'\0 ';
  clone.set(encode.encode(field),148);
  const source=new Uint8Array(2048);
  source.set(clone,0);
  await assert.rejects(inspectStreamingTar(sourceFor(source)),/traversal|non-portable/);
});

test('scanner and extractor reject file-as-folder collisions',async()=>{
  const input=createTar([
    {path:'folder',data:encode.encode('file')},
    {path:'folder/child.txt',data:encode.encode('child')},
  ]);
  await assert.rejects(inspectStreamingTar(sourceFor(input)),/file and directory/);
});

test('extractor does not create a destination when a plan is unsafe',async()=>{
  let calls=0;
  const adapter={
    createRoot:async()=>{calls++;return '/dest/new';},
    mkdir:async()=>{},
    join:(root,path)=>root+'/'+path,
    openNew:async()=>{throw new Error('no');},
    readAt:async()=>new Uint8Array([1]),
  };
  await assert.rejects(extractStreamingTar({
    archiveBytes:4096,
    entries:[{path:'../secret',size:2,dataOffset:512}],
  },adapter),/traversal/);
  assert.equal(calls,0);
});

test('extractor fails closed when payload is truncated; no extra files opened',async()=>{
  const archive=createTar([{path:'file.txt',data:encode.encode('abcdef')}]);
  const plan=await inspectStreamingTar(sourceFor(archive));
  const fake=fakeExtraction();
  let readCount=0;
  fake.adapter.readAt=async()=>{readCount++;return new Uint8Array();};
  await assert.rejects(extractStreamingTar(plan,fake.adapter),/truncated/);
  assert.equal(readCount,1);
  assert.equal(fake.saved.size,1,'partial file handle closed; parent folder intentionally retained');
});
