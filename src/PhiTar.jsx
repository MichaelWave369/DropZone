import React, {useRef, useState} from 'react';
import JSZip from 'jszip';
import {Archive, ArrowDownToLine, CheckCircle2, CircleAlert, FileArchive, FolderOpen, LockKeyhole, PackageOpen, UploadCloud, Fingerprint, Copy} from 'lucide-react';
import {
  ARCHIVE_INPUT_LIMIT, ARCHIVE_EXPANDED_LIMIT, ARCHIVE_FILE_LIMIT,
  collectArchiveFiles, createTar, inspectTar, gzipBytes, gunzipBytes,
  prettySize, safeArchivePath,
} from './phitar.js';
import {hasNativeArchiveDialog, pickNativeArchive, pickNativeFolderFiles, makeLargeNativeTar, saveNativeArchive, extractNativeArchive} from './phitar-native.js';
import {sha256File, compareSha256, createArchiveReceipt, receiptJson, MAX_HASH_BYTES} from './phitar-integrity.js';

async function download(blob, filename) {
  if (hasNativeArchiveDialog()) return saveNativeArchive(blob, filename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return {saved:true,filename};
}
const cleanName = name => (name.trim().replace(/\.(?:tar\.gz|tgz|tar|zip)$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-') || 'phitar-archive').slice(0, 75);

async function archiveEntries(file) {
  if (file.size > ARCHIVE_INPUT_LIMIT) throw new Error('Archive exceeds the 75 MB browser limit.');
  let items;
  if (/\.zip$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(file, {checkCRC32: true});
    const files = Object.values(zip.files).filter(f => !f.dir);
    if (files.length > ARCHIVE_FILE_LIMIT) throw new Error('ZIP exceeds 1000 files.');
    let expected = 0;
    const seen = new Set();
    for (const f of files) {
      const path = safeArchivePath(f.unsafeOriginalName || f.name);
      if (seen.has(path.toLowerCase())) throw new Error('Archive contains duplicate filenames.');
      seen.add(path.toLowerCase());
      const permissions = typeof f.unixPermissions === 'number' ? f.unixPermissions : 0;
      if ((permissions & 0o170000) === 0o120000) throw new Error('Symlink entries cannot be extracted.');
      expected += f._data?.uncompressedSize ?? 0;
      if (expected > ARCHIVE_EXPANDED_LIMIT) throw new Error('ZIP exceeds 150 MB unpacked limit.');
    }
    items = [];
    let expanded = 0;
    for (const f of files) {
      const bytes = await f.async('uint8array');
      expanded += bytes.byteLength;
      if (expanded > ARCHIVE_EXPANDED_LIMIT) throw new Error('ZIP exceeds 150 MB unpacked limit.');
      items.push({path: safeArchivePath(f.unsafeOriginalName || f.name), data: bytes});
    }
  } else if (/\.tar$/i.test(file.name)) {
    items = inspectTar(new Uint8Array(await file.arrayBuffer()));
  } else if (/\.(?:tar\.gz|tgz)$/i.test(file.name)) {
    items = inspectTar(await gunzipBytes(new Uint8Array(await file.arrayBuffer())));
  } else {
    throw new Error('PhiTar currently opens ZIP, TAR and TAR.GZ/TGZ, not RAR or 7z.');
  }
  if (!items.length) throw new Error('Archive has no supported regular files.');
  return items;
}

async function writeToChosenFolder(files) {
  if (typeof window.showDirectoryPicker !== 'function')
    throw new Error('This browser lacks folder-write access. Use Download as ZIP instead.');
  // Ask while handling the user click, not after deferred background work.
  const parent = await window.showDirectoryPicker({mode: 'readwrite'});
  const folder = await parent.getDirectoryHandle('phitar-extracted-' + Date.now(), {create: true});
  for (const entry of files) {
    const parts = safeArchivePath(entry.path).split('/');
    let dir = folder;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, {create: true});
    const handle = await dir.getFileHandle(parts.at(-1), {create: true});
    const writer = await handle.createWritable();
    try { await writer.write(entry.data); await writer.close(); }
    catch (e) { await writer.abort().catch(() => {}); throw e; }
  }
  return files.length;
}

export default function PhiTar() {
  const [files,setFiles] = useState([]);
  const [format,setFormat] = useState('zip');
  const [name,setName] = useState('my-phitar-archive');
  const [level,setLevel] = useState('6');
  const [source,setSource] = useState(null);
  const [opened,setOpened] = useState(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const openInput = useRef(null);
  const [drag,setDrag] = useState(false);
  const native = hasNativeArchiveDialog();
  const [createdReceipt,setCreatedReceipt] = useState(null);
  const [verifyFile,setVerifyFile] = useState(null);
  const [expectedHash,setExpectedHash] = useState('');
  const [verifyDigest,setVerifyDigest] = useState(null);
  const [verifyBusy,setVerifyBusy] = useState(false);
  const [streaming,setStreaming] = useState(false);
  const [streamProgress,setStreamProgress] = useState('');
  const [verifyError,setVerifyError] = useState('');
  const [verifyStatus,setVerifyStatus] = useState('');
  const verifyInput = useRef(null);

  function handleFiles(list) {
    setError('');setNotice('');setCreatedReceipt(null);
    try {
      const data = collectArchiveFiles(list);
      setFiles(data);
      setName(old => old === 'my-phitar-archive' ? cleanName(data[0]?.path.split('/')[0] || old) : old);
    } catch (e) { setError(e.message);setFiles([]); }
  }

  async function chooseNativeFolder() {
    setBusy(true);setError('');setNotice('');setCreatedReceipt(null);
    try {
      const result = await pickNativeFolderFiles();
      if (!result) {setNotice('Folder selection canceled.');return;}
      handleFiles(result.entries);
      setName(cleanName(result.filename));
      setNotice('Imported ' + result.fileCount + ' files (' + prettySize(result.totalBytes) + ') using the system folder picker.');
    } catch(e) {
      setError(e.message||'Could not load the selected directory.');
    } finally {setBusy(false);}
  }
  async function createLargeNativeTar() {
    setStreaming(true);setError('');setNotice('');setStreamProgress('Choose a source folder to scan.');
    try {
      const result=await makeLargeNativeTar({progress:({files,totalFiles})=>{
        setStreamProgress('Streaming file '+files+' of '+totalFiles+'…');
      }});
      if(!result.saved){
        setNotice('Streaming TAR canceled. No archive was created.');
        return;
      }
      setNotice('Saved '+result.filename+' • '+result.files+' files • '+prettySize(result.bytes)+'. No whole-archive memory allocation.');
      setStreamProgress('Streaming TAR completed.');
    }catch(e){
      setError(e.message||'Native TAR streaming failed.');
    }finally {setStreaming(false);}
  }
  async function create() {
    setBusy(true);setError('');setNotice('');setCreatedReceipt(null);
    try {
      if (!files.length) throw new Error('Add files before compressing.');
      const base = cleanName(name);
      let output, extension;
      if (format === 'zip') {
        const zip = new JSZip();
        for (const f of files) zip.file(f.path, f.file, {date: new Date(f.file.lastModified || Date.now())});
        output = await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:Number(level)}});
        extension = 'zip';
      } else {
        const entries = [];
        for (const f of files) entries.push({
          path:f.path, data: new Uint8Array(await f.file.arrayBuffer()),
          mtime:Math.floor((f.file.lastModified || 0)/1000),
        });
        const tar = createTar(entries);
        output = format === 'tgz' ? new Blob([await gzipBytes(tar)],{type:'application/gzip'}) :
          new Blob([tar],{type:'application/x-tar'});
        extension = format === 'tgz' ? 'tar.gz' : 'tar';
      }
      const filename = base + '.' + extension;
      const saved = await download(output, filename);
      if (!saved.saved) {setNotice('Save canceled. Archive not written.');return;}
      const savedFilename = saved.filename || filename;
      setNotice('Created ' + savedFilename + ' • ' + files.length + ' files • ' + prettySize(output.size));
      try {
        const receipt = await createArchiveReceipt(output, {filename:savedFilename, action:'created'});
        setCreatedReceipt(receipt);
        setNotice('Created ' + savedFilename + ' and computed its SHA-256 receipt locally.');
      } catch (receiptErr) {
        setNotice('Archive downloaded, but its receipt could not be generated: ' + receiptErr.message);
      }
    } catch (e) { setError(e.message || 'Archive creation failed.'); }
    finally { setBusy(false); }
  }

  async function openNativeArchive() {
    try {
      setBusy(true);setError('');setNotice('');
      const selected = await pickNativeArchive();
      if (selected) await open(selected);
      else setNotice('Open dialog canceled.');
    } catch(e) {setError(e.message||'Native archive picker failed.');}
    finally {setBusy(false);}
  }
  async function open(file) {
    if (!file) return;
    setBusy(true);setError('');setNotice('');setOpened(null);setSource(file.name);
    try {
      const entries = await archiveEntries(file);
      setOpened(entries);
      setNotice('Archive checked locally. No files executed.');
    } catch (e) { setError(e.message || 'Could not open archive.'); }
    finally { setBusy(false); }
  }
  async function unpackFolder() {
    setBusy(true);setError('');setNotice('');
    try {
      if (native) {
        const result = await extractNativeArchive(opened);
        setNotice(result.saved
          ? 'Extracted ' + result.count + ' files into ' + result.directory
          : 'Extraction canceled. No files written.');
      } else {
        const count = await writeToChosenFolder(opened);
        setNotice('Extracted ' + count + ' files into a new PhiTar folder.');
      }
    } catch (e) { setError(e.message || 'Folder extraction failed.'); }
    finally {setBusy(false);}
  }
  async function repackZip() {
    setBusy(true);setError('');setNotice('');
    try {
      const zip = new JSZip();
      for (const entry of opened) zip.file(entry.path, entry.data);
      const blob = await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
      const saved = await download(blob, cleanName(source || 'extracted') + '-contents.zip');
      setNotice(saved.saved?'Saved the checked archive contents as ZIP.':'ZIP save canceled.');
    } catch (e) {setError(e.message || 'ZIP repack failed.');}
    finally {setBusy(false);}
  }
  async function downloadReceipt() {
    if (!createdReceipt) return;
    try {
      const saved = await download(new Blob([receiptJson(createdReceipt)],{type:'application/json'}),createdReceipt.filename+'.sha256.json');
      setNotice(saved.saved?'Checksum receipt saved.':'Checksum receipt save canceled.');
    } catch(e) {setError(e.message||'Could not save checksum receipt.');}
  }
  async function copyReceiptHash() {
    if (!createdReceipt) return;
    try { await navigator.clipboard.writeText(createdReceipt.sha256); setNotice('Copied SHA-256 to clipboard.'); }
    catch { setError('Clipboard unavailable. Select and copy the checksum below.'); }
  }
  async function verifySelected() {
    setVerifyError('');setVerifyStatus('');setVerifyDigest(null);setVerifyBusy(true);
    try {
      if (!verifyFile) throw new Error('Choose an archive or file to verify.');
      if (verifyFile.size > MAX_HASH_BYTES) throw new Error('File exceeds the 150 MiB hash limit.');
      const value = await sha256File(verifyFile);
      const comparison = compareSha256(value, expectedHash);
      setVerifyDigest({sha256:value,filename:verifyFile.name,sizeBytes:verifyFile.size});
      setVerifyStatus(comparison.status === 'MATCH'
        ? 'MATCH: these file bytes equal the expected SHA-256.'
        : comparison.status === 'MISMATCH'
        ? 'MISMATCH: file bytes differ from the expected SHA-256.'
        : 'SHA-256 computed. Paste an expected SHA-256 to compare.');
    } catch (e) {setVerifyError(e.message || 'Could not calculate SHA-256.');}
    finally {setVerifyBusy(false);}
  }
  const comparisonStatus = verifyDigest && /^[a-f0-9]{64}$/i.test(expectedHash.trim())
    ? (verifyDigest.sha256 === expectedHash.trim().toLowerCase() ? 'MATCH' : 'MISMATCH')
    : null;
  const total = files.reduce((sum,f)=>sum+f.file.size,0);
  return <section className="phitar-section" id="phitar" aria-label="PhiTar archive lab">
    <div className="phitar-header">
      <div><span className="mini-label"><Archive size={15}/> PHITAR / ARCHIVE LAB • v0.6</span>
        <h2>Compress with a little <span>Phi.</span></h2>
        <p>Create and open genuine ZIP, TAR and TAR.GZ archives. No installers, backend, or code execution involved.</p>
      </div>
      <div className="phitar-status"><LockKeyhole size={16}/> BROWSER-LOCAL</div>
    </div>
    <div className="phitar-grid">
      <div className="phitar-card">
        <div className="phitar-card-title"><span className="phitar-number">01</span><h3>Make an archive</h3></div>
        <div className={'phitar-drop ' + (drag?'dragging':'')} onDragOver={e=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);handleFiles(e.dataTransfer.files);}}>
          <UploadCloud size={24}/>
          <strong>Drop files here</strong>
          <span>Or choose files / a folder below</span>
        </div>
        <div className="phitar-controls">
          <button type="button" onClick={()=>fileInput.current?.click()}><FileArchive size={16}/> Select files</button>
          <button type="button" disabled={busy||streaming} onClick={()=>native?chooseNativeFolder():folderInput.current?.click()}><FolderOpen size={16}/> {native?'Select system folder':'Select folder'}</button>
          <input hidden ref={fileInput} type="file" multiple onChange={e=>{handleFiles(e.target.files);e.target.value='';}}/>
          <input hidden ref={folderInput} type="file" multiple webkitdirectory="" onChange={e=>{handleFiles(e.target.files);e.target.value='';}}/>
        </div>
        {files.length>0&&<div className="phitar-manifest">
          <b>{files.length} files selected • {prettySize(total)}</b>
          <div>{files.slice(0,4).map(f=><span key={f.path}>{f.path}</span>)}{files.length>4&&<small>+{files.length-4} more</small>}</div>
        </div>}
        <label className="phitar-label">ARCHIVE NAME<input value={name} onChange={e=>setName(e.target.value)} spellCheck={false}/></label>
        <div className="phitar-fields">
          <label className="phitar-label">FORMAT<select value={format} onChange={e=>setFormat(e.target.value)}>
            <option value="zip">ZIP (.zip)</option><option value="tar">TAR (.tar)</option>
            <option value="tgz">GZIP TAR (.tar.gz)</option>
          </select></label>
          <label className="phitar-label">ZIP DEFLATE LEVEL<select value={level} onChange={e=>setLevel(e.target.value)} disabled={format!=='zip'}>
            <option value="0">0 · fastest</option><option value="6">6 · balanced</option><option value="9">9 · smaller</option>
          </select></label>
        </div>
        <button className="phitar-primary" type="button" disabled={busy||streaming||!files.length} onClick={create}>
          <ArrowDownToLine size={17}/> {busy?'Processing…':'CREATE ARCHIVE'}
        </button>
        {native&&<p className="phitar-fine">Desktop mode: saving opens your system file picker. Folder imports use a recursive system picker and reject symlinks, unsafe paths and excess file sizes before loading data.</p>}
        {native&&<div className="phitar-large-tar">
          <strong>Large TAR studio • Native preview</strong>
          <p>Stream a selected folder into an uncompressed TAR with 64 KiB buffers. Up to 2 GiB input and 1,000 files. Save outside the source folder. ZIP and TAR.GZ keep their existing 75 MiB limit.</p>
          <button type="button" disabled={busy||streaming} onClick={createLargeNativeTar}>
            <FolderOpen size={17}/>{streaming?'Streaming large TAR…':'STREAM LARGE FOLDER TO TAR'}
          </button>
          {streamProgress&&<small role="status">{streamProgress}</small>}
          <small>No SHA-256 receipt yet. Large TAR output cannot yet be reopened or extracted within PhiTar's 75 MiB inspection limit. Use a system TAR tool for that. No compression, encryption, signing or upload.</small>
        </div>
        <p className="phitar-fine">ZIP supports Unicode paths. TAR uses POSIX USTAR ASCII path limits. Maximum 1000 files / 75 MB input.</p>
        {createdReceipt&&<div className="phitar-receipt" aria-label="Last created archive SHA-256 receipt">
          <strong><Fingerprint size={15}/> Last created archive checksum</strong>
          <small>{createdReceipt.filename} · {prettySize(createdReceipt.sizeBytes)}</small>
          <code>{createdReceipt.sha256}</code>
          <div className="phitar-actionrow">
            <button type="button" onClick={copyReceiptHash}><Copy size={14}/> Copy SHA-256</button>
            <button type="button" onClick={downloadReceipt}><ArrowDownToLine size={14}/> Save receipt JSON</button>
          </div>
        </div>}
      </div>
      <div className="phitar-card">
        <div className="phitar-card-title"><span className="phitar-number">02</span><h3>Open / extract</h3></div>
        <div className="phitar-open">
          <PackageOpen size={30}/>
          <strong>Inspect an archive before extracting</strong>
          <span>Supports .zip, .tar, .tar.gz and .tgz</span>
          <button type="button" onClick={()=>native?openNativeArchive():openInput.current?.click()} disabled={busy}>
            {native?'Open using system file picker':'Choose archive'}
          </button>
          <input hidden ref={openInput} type="file" accept=".zip,.tar,.gz,.tgz" onChange={e=>{open(e.target.files?.[0]);e.target.value='';}}/>
        </div>
        {opened&&<div className="phitar-manifest">
          <b>{source} • {opened.length} verified regular files</b>
          <div>{opened.slice(0,8).map(e=><span key={e.path}>{e.path} ({prettySize(e.data.length)})</span>)}{opened.length>8&&<small>+{opened.length-8} more</small>}</div>
          <div className="phitar-actionrow">
            {(native||typeof window.showDirectoryPicker==='function')&&
              <button disabled={busy} onClick={unpackFolder}><FolderOpen size={15}/> Extract into new folder</button>}
            <button disabled={busy} onClick={repackZip}><ArrowDownToLine size={15}/> Download contents as ZIP</button>
          </div>
        </div>}
        {native&&<p className="phitar-fine">Native extraction uses your system folder picker and creates a new destination folder; existing files are not overwritten.</p>}
        <div className="phitar-compat"><strong>Coming later</strong><p>7z and RAR read support. RAR creation is not in v0.1; it requires separate proprietary-format tooling.</p></div>
      </div>
    </div>
    <div className="phitar-verify">
      <div className="phitar-card-title"><span className="phitar-number">03</span><h3><Fingerprint size={18}/> Verify a file's SHA-256</h3></div>
      <p>Compare a downloaded archive against a checksum you already trust. PhiTar hashes locally; no file is uploaded.</p>
      <div className="phitar-verify-fields">
        <div>
          <button type="button" className="phitar-verify-pick" onClick={()=>verifyInput.current?.click()}><FileArchive size={16}/> {verifyFile?'Change file':'Choose file'}</button>
          <input ref={verifyInput} type="file" hidden onChange={e=>{setVerifyFile(e.target.files?.[0]||null);setVerifyDigest(null);setVerifyStatus('');setVerifyError('');e.target.value='';}}/>
          {verifyFile&&<small>{verifyFile.name} · {prettySize(verifyFile.size)}</small>}
        </div>
        <label>EXPECTED SHA-256 (OPTIONAL)<input value={expectedHash} onChange={e=>{setExpectedHash(e.target.value);setVerifyStatus('');setVerifyError('');}} placeholder="Paste 64-character SHA-256 checksum" spellCheck={false}/></label>
        <button type="button" className="phitar-verify-run" disabled={!verifyFile||verifyBusy} onClick={verifySelected}>
          <Fingerprint size={15}/>{verifyBusy?'Hashing locally…':'CHECK SHA-256'}
        </button>
      </div>
      {verifyDigest&&<div className="phitar-verify-result">
        <span>Calculated SHA-256 for {verifyDigest.filename}</span>
        <code>{verifyDigest.sha256}</code>
        {comparisonStatus==='MATCH'&&<strong className="phitar-hash-match"><CheckCircle2 size={15}/> Checksum matches</strong>}
        {comparisonStatus==='MISMATCH'&&<strong className="phitar-hash-mismatch"><CircleAlert size={15}/> Checksum mismatch. Do not treat the file as identical.</strong>}
        {verifyStatus&&<small>{verifyStatus}</small>}
      </div>}
      {verifyError&&<div className="phitar-message phitar-error" role="alert">{verifyError}</div>}
      <p className="phitar-fine">SHA-256 verifies byte identity, not a sender's identity, permission to use a file, or malware safety. Max 150 MiB per hashing operation.</p>
    </div>
    {notice&&<div className="phitar-message" role="status"><CheckCircle2 size={16}/>{notice}</div>}
    {error&&<div className="phitar-message phitar-error" role="alert"><CircleAlert size={16}/>{error}</div>}
  </section>;
}
