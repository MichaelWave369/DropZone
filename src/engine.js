import JSZip from 'jszip';

export const TARGETS = [
  { id: 'windows', title: 'Windows', detail: 'EXE / MSI', kind: 'desktop' },
  { id: 'linux', title: 'Linux', detail: 'AppImage / DEB', kind: 'desktop' },
  { id: 'macos', title: 'macOS', detail: 'APP / DMG', kind: 'desktop' },
  { id: 'android', title: 'Android', detail: 'Debug APK', kind: 'mobile' },
  { id: 'ios', title: 'iPhone / iPad', detail: 'Xcode project', kind: 'mobile' },
  { id: 'pwa', title: 'Installable Web', detail: 'PWA / Browser', kind: 'web' },
];

export const MAX_ZIP_BYTES = 75 * 1024 * 1024;
export const MAX_FILES = 1500;
export const MAX_EXPANDED_BYTES = 150 * 1024 * 1024;

export function slugify(input) {
  return (input || 'my-app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'my-app';
}
export function productName(input) {
  const raw = (input || 'My App').replace(/[\r\n<>"\\]/g, '').trim().slice(0, 48);
  return raw || 'My App';
}
export function validVersion(v) { return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v); }
export function validAppId(id) { return /^(?:[A-Za-z][A-Za-z0-9_]*\.)+[A-Za-z][A-Za-z0-9_]*$/.test(id) && id.length <= 155; }
export function validColor(c) { return /^#[a-fA-F0-9]{6}$/.test(c); }
export function safeIdentifier(input) {
  return slugify(input).replace(/-/g, '') || 'app';
}
export function normalizePath(path) {
  const p = String(path).replace(/\\/g, '/').replace(/^\.\//, '');
  if (p.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(p) || /[\x00-\x1f]/.test(p) || /^[a-z]:/i.test(p)) throw new Error('ZIP contains an unsafe path.');
  return p;
}
const EXCLUDE = /(^|\/)(\.git|node_modules|\.next|\.turbo|__pycache__)(\/|$)/i;
const PRIVATE = /(^|\/)(?:\.env(?:\.[^/]*)?|id_rsa|id_ed25519|\.npmrc|\.pypirc|[^/]+\.(?:pem|p12|pfx|key))$/i;
const IGNORE_FILE = /(^|\/)(\.DS_Store|Thumbs\.db)$/i;

function withinRoot(path, root) { return root ? path.startsWith(root) : true; }
function trimRoot(path, root) { return path.slice(root.length); }
function chooseRoot(names) {
  const candidates = names.filter(x => /(^|\/)package\.json$/.test(x));
  if (candidates.length) return candidates.sort((a, b) => a.split('/').length - b.split('/').length)[0].slice(0, -'package.json'.length);
  const indexes = names.filter(x => /(^|\/)index\.html$/.test(x));
  if (indexes.length) return indexes.sort((a, b) => a.split('/').length - b.split('/').length)[0].slice(0, -'index.html'.length);
  const paths = names.map(n => n.split('/'));
  if (paths.length && paths.every(parts => parts.length > 1 && parts[0] === paths[0][0])) return paths[0][0] + '/';
  return '';
}
export async function inspectFile(file) {
  if (!file) throw new Error('Choose a ZIP, HTML, JSX/JS, or Python file.');
  if (file.size > MAX_ZIP_BYTES) throw new Error('File exceeds the 75 MB browser prototype limit.');
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  let files = [], kind, entry = '', warnings = [], root = '';
  if (/\.zip$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(file, { checkCRC32: false });
    const entries = Object.values(zip.files).filter(f => !f.dir);
    if (entries.length > MAX_FILES) throw new Error('ZIP has too many files (limit: 1500).');
    let estimated = 0;
    for (const f of entries) {
      const path = normalizePath(f.name);
      estimated += f._data?.uncompressedSize || 0;
      if (estimated > MAX_EXPANDED_BYTES) throw new Error('ZIP expanded size exceeds the 150 MB safety limit.');
      if (PRIVATE.test(path)) warnings.push(`Excluded sensitive-looking file: ${path}`);
      if (EXCLUDE.test(path)) warnings.push(`Excluded dependency/build directory: ${path}`);
    }
    const allowed = entries.filter(f => !EXCLUDE.test(f.name) && !PRIVATE.test(f.name) && !f.name.startsWith('__MACOSX/'));
    const names = allowed.map(f => normalizePath(f.name));
    root = chooseRoot(names);
    files = allowed.filter(f => withinRoot(normalizePath(f.name), root)).map(f => ({ path: trimRoot(normalizePath(f.name), root), item: f }));
    const byName = new Set(files.map(f => f.path));
    if (byName.has('package.json')) {
      const pkg = JSON.parse(await files.find(f => f.path === 'package.json').item.async('string'));
      const scripts = pkg.scripts || {};
      const dep = { ...pkg.dependencies, ...pkg.devDependencies };
      if (dep.next || /\bnext\b/.test(scripts.build || '')) {
        kind = 'unsupported'; warnings.push('Next.js requires a verified static-export adapter; server-rendered apps cannot be wrapped as static files.');
      } else if (dep['react-scripts'] && scripts.build) {
        kind = 'cra'; entry = 'package.json'; warnings.push('Create React App is legacy; this adapter requires its build to emit build/index.html.');
      } else if (dep.vite && scripts.build) {
        kind = 'vite'; entry = 'package.json';
      } else if (scripts.build) {
        kind = 'generic'; entry = 'package.json'; warnings.push('Generic Node adapter expects a static site at dist/, build/, or out/ with index.html; server-side apps are not supported.');
      } else if (byName.has('index.html')) {
        kind = 'static'; entry = 'index.html'; warnings.push('package.json has no build script. Treating as static HTML.');
      } else {
        kind = 'unsupported'; warnings.push('No supported web build script, static index.html, or Python entry point.');
      }
      if (dep['react-router-dom']) warnings.push('History-based routing may need HashRouter or a fallback when packaged.');
    } else if (byName.has('index.html') || files.some(f=>/\.html?$/i.test(f.path))) {
      kind = 'static'; entry = byName.has('index.html') ? 'index.html' : files.filter(f=>/\.html?$/i.test(f.path)).sort((a,b)=>a.path.length-b.path.length)[0].path;
      if (entry !== 'index.html') warnings.push('This source has no root index.html; an entry redirect will be created.');
    } else {
      const py = files.filter(f => f.path.endsWith('.py')).map(f => f.path).sort((a,b) => a.length-b.length);
      if (py.length) { kind = 'python'; entry = py.includes('main.py') ? 'main.py' : py[0]; }
      else { kind = 'unsupported'; warnings.push('No index.html, supported Vite package.json, or Python entry point found.'); }
    }
  } else if (/\.py$/i.test(file.name)) {
    kind = 'python'; entry = file.name; files = [{ path: file.name, file }];
  } else if (/\.(jsx|js)$/i.test(file.name)) {
    const input = await file.text();
    if (!/\bexport\s+default\b/.test(input)) throw new Error('Single React scripts must include `export default` for the component.');
    const external = [...input.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^.'"/][^'"]*)['"]/g)].map(m => m[1]);
    const imports = [...new Set(external.filter(m => !['react','react-dom','react-dom/client'].includes(m)))];
    if (/(?:from\s*|import\s*\(\s*)['\"]\.{1,2}\//.test(input)) warnings.push('Single-file component imports relative files. Supply a ZIP with those dependencies instead.');
    if (imports.length) warnings.push('Single-file React imports extra dependencies (' + imports.join(', ') + '). Add their verified versions to app/package.json before building.');
    kind='vite'; entry='package.json';
    const packageJson={name:slugify(base),version:'0.1.0',private:true,type:'module',scripts:{build:'vite build'},dependencies:{react:'^19.0.0','react-dom':'^19.0.0'},devDependencies:{vite:'^6.0.0','@vitejs/plugin-react':'^4.4.1'}};
    const virtual={
      'package.json':JSON.stringify(packageJson,null,2),
      'vite.config.js':"import {defineConfig} from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({plugins:[react()],base:'./'});\n",
      'index.html':'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>React App</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
      'src/main.jsx':"import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App/>);\n",
      'src/App.jsx':input,
    };
    files=Object.entries(virtual).map(([path,source])=>({path,bytes:new TextEncoder().encode(source)}));
  } else if (/\.html?$/i.test(file.name)) {
    kind = 'static'; entry = 'index.html'; files = [{ path: 'index.html', file }];
    warnings.push('Standalone HTML must be self-contained. Any referenced local files need to be included in a ZIP.');
  } else {
    throw new Error('Unsupported input: use .zip, .html, .jsx, .js (React default export), or .py.');
  }
  if (!files.length) throw new Error('No supported source files detected.');
  const usable = files.filter(f => !PRIVATE.test(f.path) && !EXCLUDE.test(f.path) && !f.path.startsWith('.github/'));
  if (usable.length !== files.length) warnings.push('Existing GitHub workflows and sensitive or generated directories are not imported.');
  if (kind === 'python') warnings.push('Python binaries are desktop only. Android/iOS/PWA require a separate application architecture.');
  return { name: productName(base), files: usable, kind, entry, warnings: [...new Set(warnings)], originalFile: file };
}

function yamlDesktop(selected) { const platforms = selected.filter(id => ['windows','linux','macos'].includes(id)).map(id => ({windows:'windows-latest',linux:'ubuntu-22.04',macos:'macos-latest'})[id]).join(', '); return `name: Desktop installers\non:\n  workflow_dispatch:\njobs:\n  desktop:\n    strategy:\n      fail-fast: false\n      matrix:\n        os: [${platforms}]\n    runs-on: \${{ matrix.os }}\n    permissions:\n      contents: read\n    steps:\n      - uses: actions/checkout@v4\n      - name: Linux dependencies\n        if: runner.os == 'Linux'\n        run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22'\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: swatinem/rust-cache@v2\n        with:\n          workspaces: './src-tauri -> target'\n      - name: Install packager dependencies\n        run: npm install --no-audit --no-fund\n      - name: Generate platform icons\n        run: npx tauri icon assets/icon.png\n      - uses: tauri-apps/tauri-action@v1\n        with:\n          uploadWorkflowArtifacts: true\n`; }
function yamlAndroid() { return `name: Android debug APK\non:\n  workflow_dispatch:\njobs:\n  apk:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22'\n      - uses: actions/setup-java@v4\n        with:\n          distribution: temurin\n          java-version: '21'\n      - uses: android-actions/setup-android@v3\n      - name: Install dependencies\n        run: npm install --no-audit --no-fund\n      - name: Build web assets\n        run: npm run build:web\n      - name: Initialize and sync Android\n        run: npx cap add android && npx cap sync android\n      - name: Build debug APK\n        working-directory: android\n        run: chmod +x gradlew && ./gradlew assembleDebug\n      - uses: actions/upload-artifact@v4\n        with:\n          name: android-debug-apk\n          path: android/app/build/outputs/apk/debug/*.apk\n          if-no-files-found: error\n`; }
function yamlIos() { return `name: iOS Xcode project (unsigned)\non:\n  workflow_dispatch:\njobs:\n  project:\n    runs-on: macos-latest\n    permissions:\n      contents: read\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22'\n      - name: Install dependencies\n        run: npm install --no-audit --no-fund\n      - name: Build web assets\n        run: npm run build:web\n      - name: Create Xcode project\n        run: npx cap add ios && npx cap sync ios\n      - name: Archive Xcode project\n        run: zip -qr ios-xcode-project.zip ios\n      - uses: actions/upload-artifact@v4\n        with:\n          name: ios-unsigned-xcode-project\n          path: ios-xcode-project.zip\n          if-no-files-found: error\n`; }
function yamlPwa() { return `name: PWA web bundle
on:
  workflow_dispatch:
jobs:
  web:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install --no-audit --no-fund
      - run: npm run build:web
      - uses: actions/upload-artifact@v4
        with:
          name: installable-web-pwa
          path: web-output/
          if-no-files-found: error
`; }
function yamlPython(name, entry, selected) {
  const safe = slugify(name);
  if (!/^[a-zA-Z0-9_.\/ -]+$/.test(entry)) throw new Error('Python entry point contains unsafe shell characters. Please rename the file.');
  const platforms = selected.filter(id => ['windows','linux','macos'].includes(id)).map(id => ({windows:'windows-latest',linux:'ubuntu-22.04',macos:'macos-latest'})[id]).join(', ');
  return `name: Python desktop executables\non:\n  workflow_dispatch:\njobs:\n  python:\n    strategy:\n      fail-fast: false\n      matrix:\n        os: [${platforms}]\n    runs-on: \${{ matrix.os }}\n    permissions:\n      contents: read\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n      - name: Install project requirements\n        shell: bash\n        run: |\n          python -m pip install --upgrade pip pyinstaller\n          if [ -f app/requirements.txt ]; then python -m pip install -r app/requirements.txt; fi\n      - name: Package executable\n        shell: bash\n        run: python -m PyInstaller --noconfirm --clean --onefile --name '${safe}' "app/${entry.replaceAll('"','')}"\n      - uses: actions/upload-artifact@v4\n        with:\n          name: ${safe}-\${{ runner.os }}\n          path: dist/*\n          if-no-files-found: error\n`;
}
function readme(name, kind, selected, warnings) {
  const platforms = selected.map(t => TARGETS.find(p=>p.id ===t)?.title).join(', ');
  return `# ${name} — The Drop Zone build kit\n\nThis package was generated locally in your browser. Your source was not uploaded to a Drop Zone server.\n\n**Project type:** ${kind}\n\n**Requested platforms:** ${platforms}\n\n## Build on GitHub Actions\n\n1. Create a **private** GitHub repository for this generated kit (recommended until source is reviewed).\n2. Upload the entire contents of this ZIP to that repository.\n3. Open the repository's **Actions** tab, enable workflows if prompted, select the target workflow and choose **Run workflow**.\n4. After completion, download the resulting file from the workflow run's **Artifacts** section.\n\n### Supported builds\n\n- Tauri 2 web apps: desktop native installers on Windows/macOS/Linux.\n- Capacitor 8 web apps: Android **debug** APKs; iOS **unsigned Xcode source project** only. An installable iPhone IPA requires code signing and a separate distribution pipeline.\n- Python scripts: platform-specific desktop executables through PyInstaller. A command-line Python script remains a command-line program.
- PWA: hosted HTTPS web bundle with an install manifest and basic offline cache. It is not a native binary.\n\n### Important restrictions\n\n- **Never enable Actions for unknown/untrusted source**. Uploading to CI runs install/build scripts with network access.
- Only **trusted** input code should be compiled. The workflows intentionally use manual \`workflow_dispatch\` triggers and do not run on pull requests.\n- Build jobs run npm scripts/pip packages from source, so inspect dependencies before pressing **Run workflow**. Never store signing keys or tokens in build input files.\n- Codesigning/notarization is not configured. Windows may warn about unsigned downloads; macOS Gatekeeper may block distribution.\n- This ZIP **is not a compiled app**. It is a generated source/build project. GitHub Actions or a local development machine produces the binaries.\n- Builds are best-effort: platform SDK and app-specific plugins/dependencies can require modifications.\n\n${warnings.length ? `## Warnings from inspection\n\n${warnings.map(w=>`- ${w}`).join('\n')}\n\n` : ''}## Local commands (web packages)\n\n\`npm install\` followed by \`npm run build:web\`, then \`npx tauri build\` on a compatible desktop system.\n\nFor mobile: \`npm run build:web && npx cap add android && npx cap sync android\` or replace android with ios on macOS.\n\nBuilt with The Drop Zone.\n` .replaceAll('\`','`');
}
async function pngIcon(options = {}, size = 512) {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable for app icon generation.');
  ctx.fillStyle = options.color || '#11172c'; ctx.fillRect(0,0,size,size);
  if (options.iconFile) {
    if (!/^image\/(png|jpeg|webp)$/.test(options.iconFile.type) || options.iconFile.size > 5 * 1024 * 1024) throw new Error('Use a PNG, JPEG, or WebP icon under 5 MB.');
    const bitmap = await createImageBitmap(options.iconFile);
    const edge=Math.min(bitmap.width,bitmap.height);
    ctx.drawImage(bitmap,(bitmap.width-edge)/2,(bitmap.height-edge)/2,edge,edge,0,0,size,size);
    bitmap.close?.();
  } else {
    ctx.strokeStyle = '#8cebd9'; ctx.lineWidth=size*.051; ctx.lineJoin='round';
    ctx.beginPath(); ctx.moveTo(size*.5,size*.102); ctx.lineTo(size*.846,size*.297); ctx.lineTo(size*.846,size*.695); ctx.lineTo(size*.5,size*.895); ctx.lineTo(size*.154,size*.695); ctx.lineTo(size*.154,size*.297); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle='#d2b8ff'; ctx.lineWidth=size*.068;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(size*.309,size*.502);ctx.lineTo(size*.449,size*.631);ctx.lineTo(size*.701,size*.381);ctx.stroke();
  }
  return canvas.toDataURL('image/png').split(',')[1];
}
function serviceWorker() { return `const CACHE = 'drop-zone-pwa-v1';
self.addEventListener('install', e => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      e.waitUntil(caches.open(CACHE).then(cache => cache.put(e.request, copy)));
    }
    return response;
  }).catch(() => caches.match(e.request)));
});
`; }
function injectPwa(html, color) {
  const registration = '<script>if ("serviceWorker" in navigator && window.isSecureContext) window.addEventListener("load",()=>navigator.serviceWorker.register(new URL("./sw.js",document.baseURI)).catch(console.warn));</script>';
  let result = html;
  if (!/rel=["']manifest["']/i.test(result)) {
    const tags=`<link rel="manifest" href="./manifest.webmanifest"><meta name="theme-color" content="${color}"><link rel="apple-touch-icon" href="./icon-192.png">`;
    result=/<\/head>/i.test(result)?result.replace(/<\/head>/i, tags+'</head>'):result.replace(/<body/i, '<head>'+tags+'</head><body');
  }
  if (!/serviceWorker\.register/.test(result)) result=result.replace(/<\/body>/i, `${registration}</body>`);
  return result;
}
function rustCargo(name, version) {
  const crate = slugify(name).replaceAll('-','_');
  return `[package]\nname = "${crate}"\nversion = "${version}"\ndescription = "Drop Zone packaged desktop app"\nauthors = ["Drop Zone"]\nedition = "2021"\n\n[lib]\nname = "${crate}_lib"\ncrate-type = ["staticlib", "cdylib", "rlib"]\n\n[build-dependencies]\ntauri-build = { version = "2", features = [] }\n\n[dependencies]\ntauri = { version = "2", features = [] }\n`;
}
function webBuildScript(kind) { return `import { spawnSync } from 'node:child_process';
import { existsSync, cpSync, statSync, rmSync } from 'node:fs';
const kind = ${JSON.stringify(kind)};
const out = 'web-output';
rmSync(out, {recursive:true, force:true});
if (kind === 'static') {
  if (!existsSync('app/index.html')) throw new Error('Missing app/index.html');
  cpSync('app',out,{recursive:true});
} else {
  const install=spawnSync('npm',['install','--no-audit','--no-fund'],{cwd:'app',stdio:'inherit',shell:process.platform==='win32'});
  if (install.status !== 0) process.exit(install.status || 1);
  const cmd=kind==='vite' ? ['run','build','--','--base=./'] : ['run','build'];
  const build=spawnSync('npm',cmd,{cwd:'app',stdio:'inherit',shell:process.platform==='win32'});
  if (build.status !== 0) process.exit(build.status || 1);
  const candidates=['app/dist','app/build','app/out'];
  const found=candidates.find(p=>existsSync(p+'/index.html'));
  if (!found) throw new Error('No static index.html found in dist/, build/, or out/. Server-side applications are not supported.');
  cpSync(found,out,{recursive:true});
  if (found!=='app/dist') { rmSync('app/dist',{recursive:true,force:true}); cpSync(found,'app/dist',{recursive:true}); }
}
if (!existsSync(out+'/index.html') || !statSync(out+'/index.html').isFile()) throw new Error('Web output missing index.html');
console.log('Static web bundle is available in '+out);
`; }

export async function buildKit(project, name, selected, onProgress = () => {}, options = {}) {
  if (project.kind === 'unsupported') throw new Error('This project type is not supported by the first prototype.');
  const targets = selected.filter(t => TARGETS.some(x=>x.id===t));
  if (!targets.length) throw new Error('Pick at least one target.');
  if (project.kind === 'python' && targets.some(t => t === 'android' || t === 'ios' || t === 'pwa')) throw new Error('Python only supports desktop executables.');
  if (targets.includes('pwa') && project.kind === 'generic') throw new Error('PWA requires static HTML, Vite, or CRA. Generic builds need a verified web-output adapter.');
  const version=options.version || '1.0.0', appId=options.appId || `com.dropzone.${safeIdentifier(name)}`, color=options.color || '#11172c';
  if (!validVersion(version)) throw new Error('Enter a semantic version such as 1.0.0.');
  if (!validAppId(appId)) throw new Error('App ID must be reverse-domain form, like com.example.myapp.');
  if (!validColor(color)) throw new Error('Icon color must be a six-digit hex color.');
  const label=productName(name), slug=slugify(label), zip = new JSZip();
  onProgress('Copying project files…');
  for (const f of project.files) {
    const path = normalizePath(f.path);
    if (!path || EXCLUDE.test(path) || PRIVATE.test(path) || path.startsWith('.github/') || IGNORE_FILE.test(path)) continue;
    const data = f.item ? await f.item.async('uint8array') : f.bytes || await f.file.arrayBuffer();
    zip.file(`app/${path}`, data);
  }
  if (project.kind === 'static' && project.entry !== 'index.html') {
    if (!project.files.some(f=>f.path===project.entry && /\.html?$/i.test(f.path))) throw new Error('Selected HTML entry point was not found.');
    const url = project.entry.split('/').map(encodeURIComponent).join('/');
    zip.file('app/index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./${url}"><title>Opening app</title></head><body><a href="./${url}">Open app</a></body></html>`);
  }
  zip.file('README.md', readme(label, project.kind, targets, project.warnings));
  zip.file('dropzone-manifest.json', JSON.stringify({ schema:1, generator:'The Drop Zone v0.3.0', name:label, slug, version, appId, kind:project.kind, entry:project.entry, platforms:targets, warnings:project.warnings },null,2));
  if (project.kind === 'python') {
    zip.file('.github/workflows/python-desktop.yml', yamlPython(label,project.entry,targets));
  } else {
    const staticSite = project.kind === 'static';
    const isPwa=targets.includes('pwa');
    if (project.kind === 'cra') {
      const pkgEntry=project.files.find(f=>f.path==='package.json');
      if (pkgEntry) {
        const raw=pkgEntry.item ? await pkgEntry.item.async('string') : new TextDecoder().decode(pkgEntry.bytes);
        const pkg=JSON.parse(raw); pkg.homepage='.'; zip.file('app/package.json',JSON.stringify(pkg,null,2));
      }
    }
    zip.file('package.json', JSON.stringify({name:`${slug}-build-kit`,version,private:true,type:'module',scripts:{'build:web':'node scripts/build-web.mjs','build:desktop':'npm run build:web && tauri build',tauri:'tauri'},devDependencies:{'@tauri-apps/cli':'^2.0.0','@capacitor/cli':'^8.0.0'},dependencies:{'@capacitor/core':'^8.0.0','@capacitor/android':'^8.0.0','@capacitor/ios':'^8.0.0'}},null,2));
    zip.file('scripts/build-web.mjs',webBuildScript(project.kind));
    zip.file('src-tauri/Cargo.toml',rustCargo(label,version));
    zip.file('src-tauri/build.rs','fn main() { tauri_build::build() }\n');
    const crate=slug.replaceAll('-','_');
    zip.file('src-tauri/src/main.rs',`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\nfn main() { ${crate}_lib::run(); }\n`);
    zip.file('src-tauri/src/lib.rs',`#[cfg_attr(mobile, tauri::mobile_entry_point)]\npub fn run() {\n    tauri::Builder::default()\n      .run(tauri::generate_context!())\n      .expect("error running application");\n}\n`);
    zip.file('src-tauri/capabilities/default.json',JSON.stringify({identifier:'default',description:'Default window; no privileged host plugins.',windows:['main'],permissions:['core:default']},null,2));
    zip.file('src-tauri/tauri.conf.json',JSON.stringify({$schema:'https://schema.tauri.app/config/2',productName:label,version,identifier:appId,build:{frontendDist:staticSite?'../app':'../app/dist',beforeBuildCommand:'npm run build:web'},app:{windows:[{title:label,label:'main',width:1160,height:780,resizable:true}],security:{csp:null}},bundle:{active:true,targets:'all',icon:['icons/32x32.png','icons/128x128.png','icons/128x128@2x.png','icons/icon.icns','icons/icon.ico']}},null,2));
    zip.file('capacitor.config.json',JSON.stringify({appId,appName:label,webDir:staticSite?'app':'app/dist',server:{androidScheme:'https'}},null,2));
    zip.file('assets/icon.png',await pngIcon({color, iconFile:options.iconFile},512),{base64:true});
    if (isPwa) {
      const publicDir=staticSite?'app/':'app/public/';
      for (const size of [192,512]) zip.file(`${publicDir}icon-${size}.png`,await pngIcon({color,iconFile:options.iconFile},size),{base64:true});
      zip.file(`${publicDir}manifest.webmanifest`,JSON.stringify({name:label,short_name:label.slice(0,12),id:'./',start_url:'./',scope:'./',display:'standalone',theme_color:color,background_color:color,icons:[{src:'./icon-192.png',sizes:'192x192',type:'image/png'},{src:'./icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]},null,2));
      zip.file(`${publicDir}sw.js`,serviceWorker());
      const htmlPath=project.kind==='cra'?'app/public/index.html':'app/index.html';
      const original=zip.file(htmlPath);
      if (!original) throw new Error('PWA needs an index.html file in your project.');
      zip.file(htmlPath,injectPwa(await original.async('string'),color));
      zip.file('.github/workflows/web-pwa.yml',yamlPwa());
    }
    if (targets.some(t=>['windows','linux','macos'].includes(t))) zip.file('.github/workflows/desktop.yml',yamlDesktop(targets));
    if (targets.includes('android')) zip.file('.github/workflows/android.yml',yamlAndroid());
    if (targets.includes('ios')) zip.file('.github/workflows/ios-project.yml',yamlIos());
  }
  onProgress('Compressing build kit…');
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  onProgress('Ready');
  return { blob, filename:`${slug}-dropzone-build-kit.zip` };
}
