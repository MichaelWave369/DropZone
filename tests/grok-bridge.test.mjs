import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

class FakeZip {
  constructor(){this.files={};}
  file(path,contents){this.files[path]=contents;return this;}
  async generateAsync(){return new Blob([JSON.stringify(Object.keys(this.files))]);}
}
const engine=readFileSync(new URL('../src/engine.js',import.meta.url),'utf8')
  .replace("import JSZip from 'jszip';",'')
  .replaceAll('export const ','const ')
  .replaceAll('export function ','function ')
  .replaceAll('export async function ','async function ');
const bridge=readFileSync(new URL('../src/grok-bridge.js',import.meta.url),'utf8')
  .replace("import JSZip from 'jszip';",'')
  .replace("import {MAX_FILES, MAX_ZIP_BYTES, MAX_EXPANDED_BYTES, normalizePath} from './engine.js';",'')
  .replaceAll('export function ','function ')
  .replaceAll('export async function ','async function ');
const {acceptableRelativePath,folderFilesToArchive,detectChoices,safeHtmlPreview}=new Function('JSZip',`${engine}\n${bridge}\nreturn {acceptableRelativePath,folderFilesToArchive,detectChoices,safeHtmlPreview}`)(FakeZip);

test('Grok bridge rejects parent traversal, absolute paths, and bogus nested paths',()=>{
  for(const path of ['../private','C:/secrets.txt','/etc/hosts','foo//bar','folder/./file'])assert.throws(()=>acceptableRelativePath(path));
  assert.equal(acceptableRelativePath('app/src/main.py'),'app/src/main.py');
});

test('Grok bridge detects choice of multiple Python entries',()=>{
  const project={kind:'python',files:[{path:'helper.py'},{path:'main.py'},{path:'src/util.py'},{path:'README.md'}]};
  assert.deepEqual(detectChoices(project).map(e=>e.value),['main.py','helper.py','src/util.py']);
});

test('Grok bridge prioritizes root HTML and honors alternate HTML pages',()=>{
  const project={kind:'static',files:[{path:'pages/about.html'},{path:'index.html'},{path:'docs.html'}]};
  assert.deepEqual(detectChoices(project).map(e=>e.value),['index.html','docs.html','pages/about.html']);
});

test('Grok bridge uses no-script, no-network CSP in static HTML preview',async()=>{
  const project={kind:'static',entry:'index.html',files:[{path:'index.html',bytes:new TextEncoder().encode('<!doctype html><html><head><title>Hello</title></head><body><script>alert(1)</script></body></html>')}]};
  const preview=await safeHtmlPreview(project);
  assert.match(preview,/default-src 'none'/);
  assert.match(preview,/form-action 'none'/);
  assert.match(preview,/<title>Hello<\/title>/);
  assert.equal(await safeHtmlPreview({...project,kind:'python'}),null);
});

test('Folder wrapper strips secrets, build outputs and common wrapper folder',async()=>{
  const fixture=(path)=>({name:path.split('/').at(-1),webkitRelativePath:path,size:16,arrayBuffer:async()=>new Uint8Array([1,2]).buffer});
  const archive=await folderFilesToArchive([
    fixture('cool-app/index.html'),fixture('cool-app/styles.css'),fixture('cool-app/.env.production'),
    fixture('cool-app/node_modules/a.js'),fixture('cool-app/.github/workflows/bad.yml'),fixture('cool-app/build/out.js'),
  ],'cool-app');
  assert.match(archive.name,/cool-app.zip/);
  const contents=JSON.parse(await archive.text());
  assert.deepEqual(contents,['index.html','styles.css']);
});

test('Folder wrapper enforces bounds before reading huge files',async()=>{
  const huge={name:'huge.html',webkitRelativePath:'app/huge.html',size:151*1024*1024,arrayBuffer:async()=>{throw new Error('should not read');}};
  await assert.rejects(folderFilesToArchive([huge],'too-big'),/150 MB/);
});
