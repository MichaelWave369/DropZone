/** Grok-inspired browser ingestion and entry selection. No source is executed. */
import JSZip from 'jszip';
import {MAX_FILES, MAX_ZIP_BYTES, MAX_EXPANDED_BYTES, normalizePath} from './engine.js';

const OMIT = /(^|\/)(?:\.git|node_modules|\.next|\.turbo|__pycache__|\.venv|venv|dist|build|coverage)(\/|$)/i;
const SECRET = /(^|\/)(?:\.env(?:\.[^/]*)?|id_rsa|id_ed25519|\.npmrc|\.pypirc|[^/]+\.(?:pem|p12|pfx|key))$/i;
const JUNK = /(^|\/)(?:\.DS_Store|Thumbs\.db)$/i;
export function acceptableRelativePath(input) {
  const path=normalizePath(input);
  if (!path || path.includes('//') || /(^|\/)\.(?:\/|$)/.test(path)) throw new Error('Folder contains an unsafe file path.');
  return path;
}

export async function folderFilesToArchive(files, displayName='project') {
  const chosen=[...files];
  if (!chosen.length) throw new Error('That folder has no files.');
  if (chosen.length>MAX_FILES) throw new Error(`Project has more than ${MAX_FILES} files.`);
  const paths=chosen.map(f=>acceptableRelativePath(f.webkitRelativePath||f.name));
  const tops=new Set(paths.map(p=>p.split('/')[0]));
  const wrapped=tops.size===1 && paths.every(p=>p.includes('/'));
  const prefix=wrapped?[...tops][0]+'/':'';
  const zip=new JSZip();
  let total=0;let kept=0;
  for (let i=0;i<chosen.length;i++) {
    const f=chosen[i];const relative=paths[i].slice(prefix.length);
    if (!relative || OMIT.test(relative) || SECRET.test(relative) || JUNK.test(relative) || relative.startsWith('.github/')) continue;
    total+=f.size;
    if (total>MAX_EXPANDED_BYTES) throw new Error('Folder exceeds the 150 MB expanded source limit.');
    zip.file(relative,await f.arrayBuffer());kept++;
  }
  if (!kept) throw new Error('Nothing packable remained after excluding dependencies and secrets.');
  const bytes=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
  if (bytes.size>MAX_ZIP_BYTES) throw new Error('Folder archive exceeds the 75 MB limit.');
  // Only the generated local File enters existing inspection; never upload a folder to our server.
  return new File([bytes],`${displayName.replace(/[^A-Za-z0-9_-]/g,'-') || 'folder'}.zip`,{type:'application/zip'});
}

async function readTree(entry, prefix, output) {
  if (output.length>MAX_FILES) throw new Error('Folder has too many files.');
  if (entry.isFile) {
    const f=await new Promise((resolve,reject)=>entry.file(resolve,reject));
    Object.defineProperty(f,'webkitRelativePath',{configurable:true,value:`${prefix}${f.name}`});
    output.push(f);
    return;
  }
  if (!entry.isDirectory) return;
  const reader=entry.createReader();
  for (;;) {
    const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));
    if (!batch.length) break;
    for (const child of batch) await readTree(child,`${prefix}${entry.name}/`,output);
  }
}

export async function droppedToFile(transfer) {
  // For normal file drops, do not rezip an existing single script or ZIP.
  const items=[...(transfer.items||[])];
  const entries=items.filter(i=>i.kind==='file').map(i=>i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.some(e=>e.isDirectory)) {
    const files=[];
    for (const entry of entries) await readTree(entry,'',files);
    return folderFilesToArchive(files,entries.length===1?entries[0].name:'project-folder');
  }
  const files=[...transfer.files];
  if (files.length===1) return files[0];
  return folderFilesToArchive(files,'project-files');
}

export function detectChoices(project) {
  if (!project) return [];
  const files=project.files||[];
  if (project.kind==='python') {
    return files.filter(f=>/\.py$/i.test(f.path)).sort((a,b)=>{
      const score=p=>/^(main|app|run|cli|__main__)\.py$/i.test(p)?0:p.split('/').length;
      return score(a.path)-score(b.path)||a.path.localeCompare(b.path);
    }).slice(0,40).map(f=>({value:f.path,label:`Python · ${f.path}`}));
  }
  if (project.kind==='static') {
    return files.filter(f=>/\.html?$/i.test(f.path)).sort((a,b)=>Number(b.path==='index.html')-Number(a.path==='index.html') ||a.path.localeCompare(b.path)).slice(0,40).map(f=>({value:f.path,label:`Web page · ${f.path}`}));
  }
  return [];
}

export async function safeHtmlPreview(project) {
  if (!project || project.kind!=='static') return null;
  const selected=project.files.find(f=>f.path===project.entry);
  if(!selected) return null;
  const source=selected.item?await selected.item.async('string'):
    selected.bytes?new TextDecoder().decode(selected.bytes):
    selected.file?await selected.file.text():'';
  if (!source || source.length>250_000) return null;
  // A static, no-script preview. CSP blocks network, forms, framing, and plugins.
  const policy=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none';">`;
  return /<head[^>]*>/i.test(source)?source.replace(/<head[^>]*>/i,x=>x+policy):policy+source;
}
