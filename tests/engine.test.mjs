import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

class MockZip {
  constructor() { this.files = {}; }
  file(path, data) {if(arguments.length===1) {const v=this.files[path];if(v===undefined)return null;return {async:async(type)=>type==='string' ? (typeof v==='string'?v:new TextDecoder().decode(v)) : v};} this.files[path] = data; return this; }
  async generateAsync() {return this.files; }
  static async loadAsync() {throw new Error('loadAsync mock not initialized');}
}
const source=readFileSync(new URL('../src/engine.js', import.meta.url),'utf8')
  .replace("import JSZip from 'jszip';",'')
  .replaceAll('export const ','const ')
  .replaceAll('export function ','function ')
  .replaceAll('export async function ','async function ');
const doc={createElement:()=>({getContext:()=>({fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){}}),toDataURL:()=>`data:image/png;base64,${Buffer.from('mock').toString('base64')}`,set width(n){},set height(n){}})};
const {normalizePath,slugify,inspectFile,buildKit,validVersion,validAppId} = new Function('JSZip','document',`${source}\nreturn {normalizePath,slugify,inspectFile,buildKit,validVersion,validAppId};`)(MockZip,doc);

test('unsafe paths and slugs',()=>{
  assert.equal(slugify('EVIE 24!'),'evie-24');
  assert.throws(()=>normalizePath('../oops.js'));
  assert.throws(()=>normalizePath('/private.txt'));
  assert.throws(()=>normalizePath('C:\\secrets.txt'));
});

test('HTML project exports desktop and Android recipes only when selected', async()=>{
  const p=await inspectFile({name:'sample.html',size:5,arrayBuffer:async()=>Buffer.from('<html></html>')});
  const kit=await buildKit(p,'My Thing',['windows','android']);
  assert.ok(kit.filename.includes('my-thing'));
  assert.ok(kit.blob['src-tauri/Cargo.toml'].includes('name = "my_thing"'));
  assert.match(kit.blob['.github/workflows/desktop.yml'],/os: \[windows-latest\]/);
  assert.ok(kit.blob['.github/workflows/android.yml']);
  assert.ok(!kit.blob['.github/workflows/ios-project.yml']);
  assert.match(kit.blob['README.md'],/not a compiled app/i);
});

test('Python export has no mobile and protects workflow command from unsafe names',async()=>{
  const project=await inspectFile({name:'main.py',size:4,arrayBuffer:async()=>Buffer.from('print(1)')});
  await assert.rejects(buildKit(project,'my app',['ios']),/Python only supports desktop/);
  const kit=await buildKit(project,'my app',['linux','macos']);
  assert.match(kit.blob['.github/workflows/python-desktop.yml'],/os: \[ubuntu-22.04, macos-latest\]/);
  assert.ok(!kit.blob['.github/workflows/desktop.yml']);
  project.entry='$(touch hacked).py';
  await assert.rejects(buildKit(project,'my app',['windows']),/unsafe shell characters/);
});

test('ZIP inspect supports nested source and excludes secrets',async()=>{
  const zip = new MockZip();
  const wrap = x=>({name:x,dir:false,_data:{uncompressedSize:100},async:async(t)=> t==='string' ? '{"dependencies":{"vite":"^6"},"scripts":{"build":"vite build"}}' : new Uint8Array([1,2,3])});
  zip.files={'repo/package.json':wrap('repo/package.json'),'repo/src/App.jsx':wrap('repo/src/App.jsx'),'repo/.env.production':wrap('repo/.env.production'),'repo/node_modules/abc/index.js':wrap('repo/node_modules/abc/index.js')};
  MockZip.loadAsync=async()=>zip;
  const p=await inspectFile({name:'repo.zip',size:2000});
  assert.equal(p.kind,'vite');
  assert.equal(p.files.length,2);
  assert.equal(p.entry,'package.json');
  assert.ok(p.warnings.some(x=>x.includes('sensitive-looking')));
});


test('The Drop Zone validates version and application identifiers',()=>{
  assert.equal(validVersion('1.2.3'),true);
  assert.equal(validVersion('1'),false);
  assert.equal(validAppId('com.example.myapp'),true);
  assert.equal(validAppId('com.example.2bad'),false);
});

test('Standalone JSX creates a Vite scaffold rather than guessing libraries',async()=>{
  const file={name:'My Widget.jsx',size:88,text:async()=>"import React from 'react'; export default function App(){return <div>Hi</div>;}"};
  const project=await inspectFile(file);
  assert.equal(project.kind,'vite');
  assert.equal(project.entry,'package.json');
  assert.ok(project.files.some(f=>f.path==='src/App.jsx'));
  const kit=await buildKit(project,'Test Widget',['windows']);
  assert.match(kit.blob['app/package.json'] instanceof Uint8Array ? new TextDecoder().decode(kit.blob['app/package.json']) : kit.blob['app/package.json'],/vite build/);
});

test('Static HTML selected as PWA emits installable manifest and workflow',async()=>{
  const f={name:'index.html',size:80,arrayBuffer:async()=>Buffer.from('<!doctype html><html><head></head><body>Hello</body></html>')};
  const project=await inspectFile(f);
  const kit=await buildKit(project,'My Web App',['pwa'],()=>{},{appId:'com.example.myweb',version:'1.2.3',color:'#ffcc00'});
  assert.ok(kit.blob['.github/workflows/web-pwa.yml']);
  assert.equal(JSON.parse(kit.blob['app/manifest.webmanifest']).theme_color,'#ffcc00');
  assert.ok(kit.blob['app/sw.js']);
  assert.match(kit.blob['app/index.html'],/manifest.webmanifest/);
  assert.match(kit.blob['dropzone-manifest.json'],/com.example.myweb/);
});

test('Alternate HTML entry produces a local index redirect without losing its source',async()=>{
  const file={name:'site.html',size:60,arrayBuffer:async()=>Buffer.from('<html><head></head><body>Landing</body></html>')};
  const project=await inspectFile(file);
  project.files.push({path:'pages/detail.html',bytes:new TextEncoder().encode('<html>detail</html>')});
  project.entry='pages/detail.html';
  const kit=await buildKit(project,'My Pages',['windows']);
  assert.match(kit.blob['app/index.html'],/pages\/detail.html/);
  assert.ok(kit.blob['app/pages/detail.html']);
});
