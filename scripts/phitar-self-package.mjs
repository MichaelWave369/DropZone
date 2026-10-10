/**
 * PhiTar self-packaging receipt:
 * 1. Build PhiTar's standalone Vite entry (dist/phitar.html + dist/assets).
 * 2. Inspect that deployable bundle as a STATIC project using Drop Zone's own engine.
 * 3. Generate the official Drop Zone Tauri build kit.
 * 4. Extract it for native runners, retaining an auditable ZIP.
 *
 * The generated app retains the browser engine's documented archive limits.
 * Runs only on the checked-in, trusted PhiTar bundle, never third-party PR archives.
 */
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
import JSZip from 'jszip';
import {inspectFile, buildKit} from '../src/engine.js';

const OUTPUT = resolve('phitar-native-kit');
const BUNDLE = resolve('phitar-build');
const DIST = resolve('dist');
const required = resolve(DIST, 'phitar.html');
if (!existsSync(required)) {
  throw new Error('Missing dist/phitar.html; first run npm run build.');
}

function* walk(folder, prefix = '') {
  if (!existsSync(folder)) return;
  for (const dirent of readdirSync(folder, {withFileTypes: true})) {
    const file = join(folder, dirent.name);
    const path = [prefix, dirent.name].filter(Boolean).join('/');
    if (dirent.isDirectory()) yield* walk(file, path);
    else if (dirent.isFile()) yield {file, path};
    else throw new Error('Symbolic links are not allowed in the production artifact.');
  }
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}
function validIcon() {
  const pixels = 512;
  const scanline = pixels * 4 + 1;
  const rows = Buffer.alloc(scanline * pixels);
  for (let y = 0; y < pixels; y++) {
    rows[y * scanline] = 0;
    for (let x = 0; x < pixels; x++) {
      const k = y * scanline + 1 + x * 4;
      const border = x < 30 || y < 30 || x >= pixels - 30 || y >= pixels - 30;
      rows[k] = border ? 249 : 15;
      rows[k + 1] = border ? 189 : 26;
      rows[k + 2] = border ? 78 : 33;
      rows[k + 3] = 255;
    }
  }
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(pixels, 0);
  hdr.writeUInt32BE(pixels, 4);
  hdr[8] = 8; hdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', hdr),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const iconUrl = 'data:image/png;base64,' + validIcon().toString('base64');
// buildKit uses canvas to create its icons. This is a deterministic PNG fixture,
// not a browser UI shim that executes project source code.
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('Only canvas icon creation is expected.');
    return {
      width:512,height:512,
      getContext() {
        return {fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){}};
      },
      toDataURL(){return iconUrl;},
    };
  },
};

const source = new JSZip();
source.file('index.html', readFileSync(required));
// Vite's multi-page build hashes shared chunks. Ship assets alongside the HTML.
// Do not include the Drop Zone root HTML or unrelated source scripts.
let assetCount = 0;
for (const item of walk(resolve(DIST,'assets'), 'assets')) {
  const {size} = statSync(item.file);
  if (size > 75*1024*1024) throw new Error('Asset exceeds Drop Zone browser size limits.');
  source.file(item.path, readFileSync(item.file));
  assetCount++;
}
if (assetCount < 1) throw new Error('Built PhiTar page has no Vite assets.');
const staged = await source.generateAsync({type:'uint8array', compression:'DEFLATE'});
const input = new File([staged], 'phitar-dist.zip', {type:'application/zip'});
const inspected = await inspectFile(input);
if (inspected.kind !== 'static' || inspected.entry !== 'index.html') {
  throw new Error('The standalone PhiTar dist did not inspect as a static project.');
}
const kit = await buildKit(inspected, 'PhiTar', ['windows','linux','macos'], ()=>{}, {
  version:'0.4.0',
  appId:'com.phi369.phitar',
  color:'#101a21',
});
const archive = await JSZip.loadAsync(kit.blob);
const expect = ['app/index.html','src-tauri/Cargo.toml','src-tauri/tauri.conf.json','src-tauri/src/main.rs','src-tauri/src/lib.rs','assets/icon.png','.github/workflows/desktop.yml'];
for(const file of expect) if(!archive.file(file)) throw new Error('Generated kit is missing ' + file);
const conf = JSON.parse(await archive.file('src-tauri/tauri.conf.json').async('string'));
if(conf.productName !== 'PhiTar' || conf.identifier !== 'com.phi369.phitar' || !conf.bundle.active) {
  throw new Error('Drop Zone emitted the wrong PhiTar native configuration.');
}
// PhiTar-only post-processing. The generic Drop Zone exporter MUST retain
// its minimal, plugin-free privileges for arbitrary imported projects.
const NL = String.fromCharCode(10);
const cargo = await archive.file('src-tauri/Cargo.toml').async('string');
if (!cargo.includes('[dependencies]')) throw new Error('Missing Rust dependencies header.');
archive.file('src-tauri/Cargo.toml',
  cargo + NL + 'tauri-plugin-dialog = "2"' + NL + 'tauri-plugin-fs = "2"' + NL);
const rust = await archive.file('src-tauri/src/lib.rs').async('string');
if (!rust.includes('tauri::Builder::default()')) throw new Error('Unexpected generated Rust builder.');
archive.file('src-tauri/src/lib.rs', rust.replace(
  'tauri::Builder::default()',
  ['tauri::Builder::default()',
    '      .plugin(tauri_plugin_dialog::init())',
    '      .plugin(tauri_plugin_fs::init())'].join(NL)
));
const caps = JSON.parse(await archive.file('src-tauri/capabilities/default.json').async('string'));
caps.permissions = [
  'core:default',
  'dialog:allow-open',
  'dialog:allow-save',
  'fs:allow-read-file',
  'fs:allow-stat',
  'fs:allow-write-file',
  'fs:allow-mkdir',
];
// Crucially no fs:scope-* permissions. The native dialog grants the selected
// file or folder to the runtime filesystem scope only for this session.
if (caps.permissions.some(x=>x.startsWith('fs:scope')||x==='fs:default')) {
  throw new Error('PhiTar must not ship a blanket filesystem scope.');
}
archive.file('src-tauri/capabilities/default.json',JSON.stringify(caps,null,2));
archive.file('PHITAR_NATIVE_SCOPE.md', [
  '# PhiTar native filesystem access',
  '',
  'Native open/save dialogs authorize explicitly chosen paths for this app session.',
  'Folder extraction uses a directory picker with recursive permission scoped to',
  'that directory only. The app creates a new phitar-extracted-* subfolder.',
  'No wildcard home-drive scope, shell commands or background transfers are enabled.',
  'Revoking permissions requires ending the app session. Test on each OS.',
].join(NL));
rmSync(OUTPUT,{recursive:true,force:true});
mkdirSync(OUTPUT,{recursive:true});
mkdirSync(BUNDLE,{recursive:true});
for(const item of Object.values(archive.files)) {
  if(item.dir)continue;
  const target = resolve(OUTPUT, item.name);
  const rel = relative(OUTPUT, target);
  if(rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new Error('Generated kit has unsafe paths.');
  }
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,Buffer.from(await item.async('uint8array')));
}
const outputFile = resolve(BUNDLE, kit.filename);
writeFileSync(outputFile, await archive.generateAsync({type:'uint8array',compression:'DEFLATE'}));
console.log(JSON.stringify({
  outcome:'SELF_PACKAGING_KIT_CREATED',
  generator:'Drop Zone inspectFile() + buildKit()',
  input:'Built PhiTar standalone web application',
  kind: inspected.kind,assets:assetCount,
  outputZip:relative(process.cwd(),outputFile),
  outputDirectory:relative(process.cwd(),OUTPUT),
  files:Object.values(archive.files).filter(x=>!x.dir).length,
  name:conf.productName,identifier:conf.identifier,
  nativeCompilation:'NOT_YET_ATTEMPTED',
  nativePermissions:caps.permissions,
},null,2));
