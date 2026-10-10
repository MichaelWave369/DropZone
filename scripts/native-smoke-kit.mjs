/**
 * Trusted end-to-end fixture: inspect and export through Drop Zone's real engine.
 * The Node-only DOM stub supplies a valid PNG in place of browser canvas.
 */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import JSZip from 'jszip';
import {inspectFile, buildKit} from '../src/engine.js';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, checksum]);
}
function makeIcon() {
  const pixels = 512, stride = pixels * 4 + 1;
  const rows = Buffer.alloc(stride * pixels);
  for (let y = 0; y < pixels; y++) {
    rows[y * stride] = 0;
    for (let x = 0; x < pixels; x++) {
      const offset = y * stride + 1 + x * 4;
      const border = x < 36 || x > 475 || y < 36 || y > 475;
      rows[offset] = border ? 112 : 16;
      rows[offset + 1] = border ? 228 : 24;
      rows[offset + 2] = border ? 203 : 39;
      rows[offset + 3] = 255;
    }
  }
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(pixels, 0); hdr.writeUInt32BE(pixels, 4);
  hdr[8] = 8; hdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', hdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const iconDataURL = 'data:image/png;base64,' + makeIcon().toString('base64');
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('Only canvas is expected');
    return {
      width: 512, height: 512,
      getContext() {
        return {fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){}};
      },
      toDataURL() { return iconDataURL; },
    };
  },
};
const fixture = readFileSync(new URL('../examples/hello.html', import.meta.url));
const input = new File([fixture], 'index.html', {type:'text/html'});
const project = await inspectFile(input);
if (project.kind !== 'static') throw new Error('Fixture must be static');
const result = await buildKit(project, 'Drop Zone Smoke', ['windows'], () => {}, {
  version:'0.1.0', appId:'com.dropzone.smoke', color:'#101827',
});
const zip = await JSZip.loadAsync(result.blob);
for (const file of [
  'app/index.html',
  'scripts/build-web.mjs',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
  'src-tauri/src/main.rs',
  'src-tauri/src/lib.rs',
  'assets/icon.png',
  '.github/workflows/desktop.yml',
]) {
  if (!zip.file(file)) throw new Error('Generated kit is missing ' + file);
}
const config = JSON.parse(await zip.file('src-tauri/tauri.conf.json').async('string'));
if (config.identifier !== 'com.dropzone.smoke' || !config.bundle.active) {
  throw new Error('Invalid generated Tauri config');
}
const output = resolve('smoke-output');
mkdirSync(output, {recursive:true});
for (const entry of Object.values(zip.files)) {
  if (entry.dir) continue;
  const path = resolve(output, entry.name), rel = relative(output, path);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new Error('Unsafe output path');
  }
  mkdirSync(dirname(path), {recursive:true});
  writeFileSync(path, Buffer.from(await entry.async('uint8array')));
}
console.log('Generated Windows smoke kit using Drop Zone buildKit');
console.log('Files: ' + Object.values(zip.files).filter(x => !x.dir).length);
