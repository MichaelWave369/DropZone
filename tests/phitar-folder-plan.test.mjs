import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planNativeFolder, validateNativeArchivePath,
  NATIVE_FOLDER_MAX_DEPTH, NATIVE_FOLDER_MAX_DIRECTORIES,
} from '../src/phitar-folder-plan.js';
import {collectArchiveFiles} from '../src/phitar.js';

function fakeTree(tree) {
  const metadata = new Map();
  const listings = new Map();
  for (const [path, value] of Object.entries(tree)) {
    const parent = path.slice(0,path.lastIndexOf('/')) || '/chosen';
    const name = path.slice(path.lastIndexOf('/')+1);
    metadata.set(path, typeof value === 'object' ? value : {isFile:true,size:value});
    if (!listings.has(parent)) listings.set(parent, []);
    if(path!=='/chosen')listings.get(parent).push({name});
  }
  return {
    readDir:async path => listings.get(path) ?? [],
    lstat:async path => {
      const item=metadata.get(path);
      if (!item) throw new Error('Missing test file: '+path);
      return item;
    },
    join:(root,relative)=>root+'/'+relative,
    label:'my-project',
  };
}

test('native folder preflight preserves root and nested relative paths',async()=>{
  const fake=fakeTree({
    '/chosen':{isDirectory:true},
    '/chosen/source':{isDirectory:true},
    '/chosen/source/nested.txt':11,
    '/chosen/index.html':5,
  });
  const result=await planNativeFolder('/chosen',fake);
  assert.equal(result.label,'my-project');
  assert.deepEqual(result.entries.map(x=>x.path),[
    'my-project/index.html','my-project/source/nested.txt',
  ]);
  assert.equal(result.totalBytes,16);
  assert.equal(result.directories,2);
});

test('preflight blocks symbolic links without reading their contents',async()=>{
  const fake=fakeTree({
    '/chosen':{isDirectory:true},
    '/chosen/private-link':{isSymlink:true,isFile:false,size:0},
  });
  await assert.rejects(planNativeFolder('/chosen',fake),/Symbolic links/);
});

test('preflight rejects oversized input based on metadata alone',async()=>{
  const fake=fakeTree({
    '/chosen':{isDirectory:true},
    '/chosen/large.mov':76*1024*1024,
  });
  await assert.rejects(planNativeFolder('/chosen',fake),/75 MiB/);
});

test('preflight rejects case collisions and path traversal',async()=>{
  const fake=fakeTree({
    '/chosen':{isDirectory:true},
    '/chosen/a.txt':3,
    '/chosen/A.txt':2,
  });
  await assert.rejects(planNativeFolder('/chosen',fake),/duplicate paths/);
  for(const bad of ['../private.txt','file.txt:stream','con.txt','question?.txt']) {
    assert.throws(()=>validateNativeArchivePath(bad),{name:'Error'});
  }
});

test('preflight rejects special files and invalid folder labels',async()=>{
  const fake=fakeTree({
    '/chosen':{isDirectory:true},
    '/chosen/pipe':{isFile:false,isDirectory:false,size:0},
  });
  await assert.rejects(planNativeFolder('/chosen',fake),/non-regular/);
  await assert.rejects(planNativeFolder('/chosen',{...fake,label:'../unsafe'}),/traversal|non-portable|single directory name/);
});

test('empty folder does not generate an empty or misleading ZIP',async()=>{
  const fake=fakeTree({'/chosen':{isDirectory:true}});
  await assert.rejects(planNativeFolder('/chosen',fake),/no regular files/);
});

test('folder depth and scan directory count are bounded',async()=>{
  const deep={'/chosen':{isDirectory:true}};
  let path='/chosen';
  for(let i=0;i<NATIVE_FOLDER_MAX_DEPTH+1;i++){
    path += '/level'+i;
    deep[path]={isDirectory:true};
  }
  await assert.rejects(planNativeFolder('/chosen',fakeTree(deep)),/20-level limit/);
  assert.equal(NATIVE_FOLDER_MAX_DIRECTORIES,2000);
});

test('native folder records enter shared archive manifest without path loss',()=>{
  const descriptors=[
    {path:'my-project/index.html',file:new File(['hello'],'index.html')},
    {path:'my-project/src/app.js',file:new File(['test'],'app.js')},
  ];
  const processed=collectArchiveFiles(descriptors);
  assert.deepEqual(processed.map(x=>x.path),['my-project/index.html','my-project/src/app.js']);
  assert.equal(processed[0].file.size,5);
  assert.throws(()=>collectArchiveFiles([
    {path:'my-project/ABC.txt',file:new File(['1'],'ABC.txt')},
    {path:'my-project/abc.txt',file:new File(['2'],'abc.txt')},
  ]),/Duplicate/);
});
