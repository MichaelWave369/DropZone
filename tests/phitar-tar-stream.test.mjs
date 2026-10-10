import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTar} from '../src/phitar.js';
import {planNativeFolder,NATIVE_STREAM_TAR_MAX_BYTES} from '../src/phitar-folder-plan.js';
import {streamingTarSize,writeStreamingTar,TAR_STREAM_CHUNK} from '../src/phitar-tar-stream.js';

const enc=new TextEncoder();
const filePath='/selected/src/demo.txt';

function adapterFor(bytes,{truncate=false}={}){
  const output=[];
  let removed=false,closedOutput=false,closedInput=false;
  const read=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const adapter={
    lstat:async()=>({size:read.length,isFile:true,isSymlink:false}),
    openRead:async()=>{
      let pos=0;
      return {
        stat:async()=>({size:read.length,isFile:true}),
        read:async buffer=>{
          if(truncate||pos>=read.length) return null;
          const n=Math.min(buffer.byteLength, Math.min(13000, read.length-pos));
          buffer.set(read.subarray(pos,pos+n));pos+=n;return n;
        },
        close:async()=>{closedInput=true;},
      };
    },
    openNew:async()=>({
      write:async chunk=>{
        const n=Math.min(8192,chunk.length);
        output.push(chunk.slice(0,n));
        return n;
      },
      close:async()=>{closedOutput=true;},
    }),
    removeIncomplete:async()=>{removed=true;},
  };
  return {adapter,get bytes(){return Uint8Array.from(output.flatMap(x=>Array.from(x)));},get removed(){return removed;},get closedInput(){return closedInput;},get closedOutput(){return closedOutput;}};
}
function plan(bytes,path='folder/src/demo.txt'){
  return {entries:[{absolutePath:filePath,path,size:bytes.length}]};
}

test('streaming TAR writer produces standards-compatible USTAR without whole-archive buffers',async()=>{
  const data=enc.encode('Philip TAR!'.repeat(17000));
  assert.ok(data.length>TAR_STREAM_CHUNK);
  const mock=adapterFor(data);
  const progress=[];
  const result=await writeStreamingTar(plan(data),mock.adapter,{progress:step=>progress.push(step)});
  assert.equal(result.files,1);
  assert.equal(result.bytes,streamingTarSize(plan(data)));
  const unpacked=inspectTar(mock.bytes);
  assert.equal(unpacked[0].path,'folder/src/demo.txt');
  assert.deepEqual(unpacked[0].data,data);
  assert.equal(progress[0].files,1);
  assert.equal(mock.removed,false);
  assert.equal(mock.closedInput,true);
  assert.equal(mock.closedOutput,true);
});

test('streaming TAR preflights multi-hundred MiB output sizes without allocating it',()=>{
  const huge={entries:[{path:'project/large.dat',size:700*1024*1024,absolutePath:'/selected/large.dat'}]};
  assert.equal(streamingTarSize(huge),700*1024*1024+512+1024);
  assert.throws(()=>streamingTarSize({entries:[{path:'bad/../escape',size:1,absolutePath:'x'}]}),/traversal/);
  assert.throws(()=>streamingTarSize({entries:[{path:'x',size:NATIVE_STREAM_TAR_MAX_BYTES+1,absolutePath:'x'}]}),/2 GiB/);
});

test('truncated input fails closed and removes newly created incomplete output',async()=>{
  const data=enc.encode('a-file');
  const mock=adapterFor(data,{truncate:true});
  await assert.rejects(writeStreamingTar(plan(data),mock.adapter),/Unexpected end/);
  assert.equal(mock.removed,true);
  assert.equal(mock.closedInput,true);
  assert.equal(mock.closedOutput,true);
});

test('preflight preserves normal 75 MiB limit and allows metadata-only large TAR mode',async()=>{
  const adapter={
    lstat:async path=>path==='/selected'?{isDirectory:true,isSymlink:false}:{isFile:true,isSymlink:false,size:250*1024*1024},
    readDir:async()=>[{name:'big.bin',isFile:true}],
    join:(root,seg)=>root+'/'+seg,
    label:'project',
  };
  await assert.rejects(planNativeFolder('/selected',adapter),/75 MiB/);
  const planned=await planNativeFolder('/selected',{...adapter,maxBytes:NATIVE_STREAM_TAR_MAX_BYTES});
  assert.equal(planned.entries[0].size,250*1024*1024);
  assert.equal(planned.totalBytes,250*1024*1024);
});

test('no native destination is opened if TAR preflight path fails',async()=>{
  let called=false;
  const adapter={
    openNew:async()=>{called=true;throw new Error('should not open');},
    openRead:async()=>{throw new Error('should not read');},
    lstat:async()=>({isFile:true,size:1}),
  };
  await assert.rejects(writeStreamingTar({entries:[{path:'../bad',size:1,absolutePath:'/tmp/bad'}]},adapter),/traversal/);
  assert.equal(called,false);
});
