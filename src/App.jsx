import React, { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { ArrowDownToLine, ArrowRight, Archive, Box, Check, CheckCircle2, ChevronRight, CircleAlert, Code2, Cpu, FileCode2, FolderOpen, Github, Globe2, HardDriveDownload, Layers3, LoaderCircle, MonitorDown, Package, Rocket, ShieldCheck, Smartphone, Sparkles, UploadCloud, X, Zap, SmartphoneCharging, FileArchive, Eye, ShieldAlert } from 'lucide-react';
import { buildKit, inspectFile, TARGETS, productName, slugify, validVersion, validAppId } from './engine.js';
import {droppedToFile, folderFilesToArchive, detectChoices, safeHtmlPreview} from './grok-bridge.js';
import {SAMPLES} from './samples.js';
import PhiTar from './PhiTar.jsx';
import RelayHandoff from './RelayHandoff.jsx';

const ICONS = {windows:<MonitorDown/>, linux:<Code2/>, macos:<Box/>, android:<Smartphone/>, ios:<SmartphoneCharging/>, pwa:<Globe2/>};
const TYPES = { static:['STATIC WEB','HTML / CSS / JS'], vite:['REACT / VITE','Frontend source project'], cra:['CREATE REACT APP','Legacy React build'], generic:['NODE WEB','Static output adapter'], python:['PYTHON','Desktop executable script'], unsupported:['UNSUPPORTED','Needs an adapter'] };

export default function App() {
  const [project,setProject]=useState(null);
  const [name,setName]=useState('');
  const [targets,setTargets]=useState(['windows','linux','macos','android','ios','pwa']);
  const [appId,setAppId]=useState('com.dropzone.myapp');
  const [version,setVersion]=useState('1.0.0');
  const [color,setColor]=useState('#11172c');
  const [iconFile,setIconFile]=useState(null);
  const [error,setError]=useState('');
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const [drag,setDrag]=useState(false);
  const [repoUrl,setRepoUrl]=useState('');
  const [repoBusy,setRepoBusy]=useState(false);
  const [preview,setPreview]=useState('');
  const [previewVisible,setPreviewVisible]=useState(false);
  const [lastOutput,setLastOutput]=useState('');
  const [stagedArtifact,setStagedArtifact]=useState(null);
  const [htmlPreview,setHtmlPreview]=useState(null);
  const [htmlPreviewVisible,setHtmlPreviewVisible]=useState(false);
  const fileRef=useRef(null);
  const folderRef=useRef(null);
  const choices=detectChoices(project);
  useEffect(()=>{
    let active=true;
    safeHtmlPreview(project).then(doc=>{if(active)setHtmlPreview(doc);}).catch(()=>{if(active)setHtmlPreview(null);});
    return ()=>{active=false;};
  },[project]);

  const ingest=useCallback(async file=>{
    if(!file)return;
    setBusy(true);setError('');setStatus('Inspecting source…');setPreview('');setLastOutput('');setStagedArtifact(null);setHtmlPreviewVisible(false);
    try{
      const found=await inspectFile(file);
      setProject(found);setName(found.name);
      setAppId(`com.dropzone.${slugify(found.name).replaceAll('-','').replace(/^([0-9])/,'app$1')}`);
      setVersion('1.0.0');setIconFile(null);
      setTargets(found.kind==='python'?['windows','linux','macos']:found.kind==='generic'?['windows','linux','macos','android','ios']:['windows','linux','macos','android','ios','pwa']);
      setStatus('Source inspected locally. No application code has been executed.');
    }catch(e){setError(e.message||'Could not inspect source.');setProject(null);setStatus('');}
    finally{setBusy(false);}
  },[]);

  async function ingestFolder(files) {
    if (!files?.length)return;
    try {setError('');setBusy(true);setStatus('Reading folder files locally…');
      const archive=await folderFilesToArchive(files,files[0]?.webkitRelativePath?.split('/')[0]||'project-folder');
      await ingest(archive);
    } catch(e){setError(e.message||'Folder import failed.');setStatus('');}
    finally {setBusy(false);}
  }
  async function ingestDrop(transfer) {
    try {setBusy(true);setError('');setStatus('Reading dropped files locally…');
      await ingest(await droppedToFile(transfer));
    } catch(e){setError(e.message||'Folder drop failed.');setStatus('');}
    finally {setBusy(false);}
  }
  function chooseEntry(value) {
    if (!project || !choices.some(c=>c.value===value))return;
    setProject(old=>({...old,entry:value}));
    setPreview('');setLastOutput('');setStatus(`Entry set to ${value}.`);
  }
  function loadSample(sample) {
    ingest(new File([sample.content],sample.filename,{type:sample.filename.endsWith('.py')?'text/x-python':'text/html'}));
  }

  async function fromGithub(){
    setError('');let url;
    try{url=new URL(repoUrl.trim());}catch{setError('Enter a full public GitHub URL.');return;}
    const m=url.hostname.toLowerCase()==='github.com'&&url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)(?:\/|$)/);
    if(!m){setError('Use a public URL like https://github.com/owner/repo');return;}
    const [,owner,rawRepo]=m,repo=rawRepo.replace(/\.git$/,'');
    setRepoBusy(true);setStatus('Retrieving public repository archive…');
    try{
      const request=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,{headers:{Accept:'application/vnd.github+json'}});
      if(!request.ok)throw new Error(request.status===404?'Repository is private or missing. Download its ZIP instead.':'GitHub API could not retrieve this repository.');
      const meta=await request.json();
      const archive=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(meta.default_branch)}`);
      if(!archive.ok)throw new Error('Repository archive could not be downloaded. Download its ZIP manually.');
      if(Number(archive.headers.get('content-length')||0)>75*1024*1024)throw new Error('Repository ZIP exceeds the 75 MB limit.');
      const blob=await archive.blob();
      await ingest(new File([blob],`${repo}.zip`,{type:'application/zip'}));
    }catch(e){setError(e.message||'Public repository import failed.');setStatus('');}
    finally{setRepoBusy(false);}
  }

  function toggleTarget(id){
    if(project?.kind==='python'&&['android','ios','pwa'].includes(id))return;
    if(project?.kind==='generic'&&id==='pwa')return;
    setTargets(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
    setPreview('');setLastOutput('');
  }
  async function exportKit(){
    setBusy(true);setError('');setStatus('');
    try{
      const output=await buildKit(project,name,targets,setStatus,{appId,version,color,iconFile});
      const zip=await JSZip.loadAsync(output.blob);
      const paths=Object.keys(zip.files).filter(p=>/^\.github\/workflows\/.*\.yml$/.test(p));
      const pieces=await Promise.all(paths.map(async p=>`# ${p}\n${await zip.file(p).async('string')}`));
      setPreview(pieces.join('\n\n# ──────────────────────────────\n\n'));
      const url=URL.createObjectURL(output.blob);
      const a=document.createElement('a');a.href=url;a.download=output.filename;document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
      setLastOutput(output.filename);
      setStagedArtifact({file:new File([output.blob],output.filename,{type:'application/zip'}),project:name,version});
      setStatus('Build kit generated and downloaded. Ready for optional Parallax handoff.');
    }catch(e){setError(e.message||'Export failed.');setStatus('');}
    finally{setBusy(false);}
  }
  const ready=Boolean(project&&project.kind!=='unsupported'&&targets.length&&validVersion(version)&&validAppId(appId));
  const kindName=project?TYPES[project.kind]:null;
  const desktopCount=targets.filter(t=>['windows','linux','macos'].includes(t)).length;
  const mobileCount=targets.filter(t=>['android','ios'].includes(t)).length;
  return <div className="app-shell dropzone-theme">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Package size={23} strokeWidth={2.5}/></div><div><span className="brand-title">THE <b>DROP ZONE</b></span><span className="brand-sub">CROSS-PLATFORM PACKAGING LAB</span></div></div>
      <div className="topnav"><a href="#workspace">Drop station</a><a href="#phitar">PhiTar archives</a><a href="./phitar.html">PhiTar app ↗</a><a href="#relay-handoff">Relay handoff</a><a href="#how">Pipeline</a><a href="#limits">Reality check</a></div>
      <div className="version"><span className="green-dot"/> BROWSER FIRST <b>v0.4</b></div>
    </header>
    <main>
      <section className="hero">
        <div className="eyebrow"><Zap size={13}/> DROP CODE. PICK TARGETS. SHIP WIDER.</div>
        <h1>Welcome to<br/><span>The Drop Zone.</span></h1>
        <p>One launchpad for all those GitHub creations. Drop a ZIP, folder, HTML page, React component, or Python script; or fetch a public repository. The Drop Zone turns your source into platform-specific build kits.</p>
        <div className="hero-pills"><span><CheckCircle2 size={14}/> Six destinations</span><span><Github size={14}/> CI recipes included</span><span><ShieldCheck size={14}/> Local source inspection</span></div>
        <div className="orbit-wrap" aria-hidden="true"><div className="ring ring-a"/><div className="ring ring-b"/><div className="center-rocket"><Package size={62} strokeWidth={1.3}/></div><div className="orbit-tag orb-1"><MonitorDown/></div><div className="orbit-tag orb-2"><Smartphone/></div><div className="orbit-tag orb-3"><Code2/></div><div className="orbit-tag orb-4"><Globe2/></div></div>
      </section>
      <section id="workspace" className="work-grid">
        <div className="work-main">
          <div className="section-top"><div className="step-index">01</div><div><h2>Drop your source</h2><p>Everything is inspected in your browser. Nothing is executed.</p></div></div>
          <div className={`dropzone ${drag?'dragging':''} ${project?'has-project':''}`} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={e=>{e.preventDefault();setDrag(false);}} onDrop={e=>{e.preventDefault();setDrag(false);ingestDrop(e.dataTransfer);}} onClick={()=>fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fileRef.current?.click();}}}>
            <input ref={fileRef} type="file" hidden accept=".zip,.py,.html,.htm,.jsx,.js" onChange={e=>{ingest(e.target.files[0]);e.target.value='';}}/>
            <div className="drop-icon">{busy?<LoaderCircle className="spin" size={28}/>:<UploadCloud size={31}/>}</div>
            <strong>{project?'Drop another project to replace this one':'Drag your project into the zone'}</strong>
            <span>ZIP · FOLDER · HTML · JSX / JS · Python</span>
            <span className="select-link">Browse local files <ArrowRight size={14}/></span>
          </div>
          <div className="extra-import">
            <button type="button" className="folder-button" onClick={()=>folderRef.current?.click()}><FolderOpen size={16}/> Browse a whole project folder</button>
            <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple hidden onChange={e=>{ingestFolder(e.target.files);e.target.value='';}}/>
            <span>Folders include linked assets; dependency folders and obvious secret files are excluded.</span>
          </div>
          <div className="sample-strip"><strong>QUICK TEST</strong>{SAMPLES.map(sample=><button type="button" key={sample.id} onClick={()=>loadSample(sample)} disabled={busy}>{sample.title} <small>{sample.desc}</small></button>)}</div>
          <div className="url-box"><div className="url-label"><Github size={16}/><span>Or import a public GitHub repository</span></div><div className="url-row"><input aria-label="Public GitHub repository URL" placeholder="https://github.com/owner/repository" value={repoUrl} onChange={e=>setRepoUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&fromGithub()}/><button onClick={fromGithub} disabled={repoBusy||!repoUrl.trim()} aria-label="Import GitHub repo">{repoBusy?<LoaderCircle className="spin" size={16}/>:<ArrowRight size={17}/>}</button></div><small>Public repositories only. For private code, upload a ZIP.</small></div>
          {project&&<div className="inspect-card"><div className="inspect-top"><div className="inspect-icon"><FileCode2 size={22}/></div><div><span className="mini-label">SOURCE DETECTED</span><h3>{project.originalFile.name}</h3></div><div className={`type-chip ${project.kind==='unsupported'?'warn':''}`}>{kindName[0]}</div></div><div className="inspect-meta"><div><span>TYPE</span><b>{kindName[1]}</b></div><div><span>ENTRY</span><b>{project.entry||'Unresolved'}</b></div><div><span>FILES</span><b>{project.files.length.toLocaleString()}</b></div></div>{project.warnings.length>0&&<div className="warnings">{project.warnings.slice(0,6).map((w,i)=><p key={i}><CircleAlert size={14}/>{w}</p>)}</div>}</div>}
          {project&&choices.length>1&&<div className="entry-panel"><label htmlFor="entry-select"><Layers3 size={15}/> Choose launch entry</label><select id="entry-select" value={project.entry} onChange={e=>chooseEntry(e.target.value)}>{choices.map(c=><option value={c.value} key={c.value}>{c.label}</option>)}</select><small>Grok-inspired detection: package the script/page you actually intend to launch.</small></div>}
          {project?.kind==='static'&&htmlPreview&&<div className="html-preview-panel"><div className="preview-head"><div><Eye size={17}/><b>Safe HTML snapshot</b></div><button type="button" onClick={()=>setHtmlPreviewVisible(!htmlPreviewVisible)}>{htmlPreviewVisible?'Hide preview':'Preview page'}</button></div>{htmlPreviewVisible&&<><iframe title="Static HTML inspection preview" sandbox="" referrerPolicy="no-referrer" srcDoc={htmlPreview}/><p>Untrusted scripts and external resources are disabled in this snapshot. The actual packaged app may behave differently.</p></>}</div>}
          <div className="section-top section-second"><div className="step-index">02</div><div><h2>Select deployment targets</h2><p>Some formats require platform-specific signing or tooling.</p></div></div>
          <div className="platform-grid">{TARGETS.map(t=>{const disabled=(project?.kind==='python'&&['android','ios','pwa'].includes(t.id))||(project?.kind==='generic'&&t.id==='pwa');const active=targets.includes(t.id)&&!disabled;return <button key={t.id} className={`platform ${active?'selected':''} ${disabled?'disabled':''}`} onClick={()=>toggleTarget(t.id)} disabled={disabled} aria-pressed={active}><span className="platform-check">{active?<Check size={13}/>:null}</span><span className="platform-icon">{ICONS[t.id]}</span><span className="platform-name">{t.title}</span><small>{disabled?'Needs web adapter':t.detail}</small></button>})}</div>
          <div className="info-line"><ShieldAlert size={18}/><span>Untrusted ZIPs stay local until you choose to upload and run their workflows. Never run unknown package install scripts with secrets present.</span></div>
        </div>
        <aside className="work-aside">
          <div className="output-card"><div className="output-header"><Layers3 size={18}/><span>PACKAGE CONTROLS</span></div>
            <label className="field-label" htmlFor="app-name">APP NAME</label><input className="app-name" id="app-name" value={name} placeholder="My Amazing App" onChange={e=>setName(e.target.value)}/>
            <div className="control-pair"><label className="field-label" htmlFor="app-id">APP ID<input className="app-name" id="app-id" value={appId} onChange={e=>setAppId(e.target.value)} spellCheck={false}/></label><label className="field-label" htmlFor="app-version">VERSION<input className="app-name" id="app-version" value={version} onChange={e=>setVersion(e.target.value)}/></label></div>
            <div className="control-pair"><label className="field-label" htmlFor="icon-color">ICON COLOR<input className="app-name icon-color" id="icon-color" type="color" value={color} onChange={e=>setColor(e.target.value)}/></label><label className="field-label" htmlFor="icon-image">CUSTOM ICON<input className="icon-input" id="icon-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setIconFile(e.target.files?.[0]||null)}/></label></div>
            <div className="output-divider"/><div className="stat-row"><span><MonitorDown size={16}/> Desktop</span><b>{desktopCount}</b></div><div className="stat-row"><span><Smartphone size={16}/> Mobile</span><b>{mobileCount}</b></div><div className="stat-row"><span><Globe2 size={16}/> PWA web</span><b>{targets.includes('pwa')?'ON':'OFF'}</b></div><div className="stat-row"><span><Archive size={16}/> Source files</span><b>{project?.files.length??'—'}</b></div><div className="output-divider"/>
            <div className="deliverable"><div className="deliver-icon"><HardDriveDownload size={19}/></div><div><b>GitHub-ready build kit</b><span>Source + wrappers + workflows</span></div></div>
            <button className="build-btn" onClick={exportKit} disabled={!ready||busy}>{busy?<LoaderCircle className="spin" size={18}/>:<ArrowDownToLine size={18}/>} {busy?'Forging the kit…':'EXPORT BUILD KIT'} <ChevronRight size={17}/></button>
            <p className="fine-print">Exports a ZIP with recipes. Real installers require a trusted GitHub Actions run or local build. No cloud build happens inside this page.</p>
            {!validVersion(version)&&<p className="error">Use a version like 1.0.0.</p>}{!validAppId(appId)&&<p className="error">App ID should look like com.example.myapp.</p>}
            {status&&<div className="status" role="status"><CheckCircle2 size={15}/>{status}</div>}{error&&<div className="error" role="alert"><CircleAlert size={15}/>{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
            {lastOutput&&<p className="receipt"><FileArchive size={14}/> <b>{lastOutput}</b></p>}
          </div>
          <div className="side-note"><div><ShieldCheck size={19}/><strong>Your source stays yours</strong></div><p>ZIP analysis and export happen locally in the browser. Public GitHub imports are fetched directly. No Drop Zone backend receives your code.</p></div>
          {preview&&<div className="side-note"><div><Eye size={18}/><strong>Generated CI workflow preview</strong></div><button className="preview-toggle" onClick={()=>setPreviewVisible(!previewVisible)}>{previewVisible?'Hide workflow':'View YAML'} <ArrowRight size={14}/></button>{previewVisible&&<pre className="preview-yaml">{preview}</pre>}</div>}
        </aside>
      </section>
      <PhiTar />
      <RelayHandoff stagedArtifact={stagedArtifact}/>
      <section id="how" className="info-section"><div className="info-head"><span className="mini-label">THE PIPELINE</span><h2>Source in. Build kit out.</h2></div><div className="info-grid"><article><div className="info-num">1</div><FolderOpen size={28}/><h3>Inspect</h3><p>Recognize static websites, React/Vite, Create React App, basic Node web builds, and Python desktop scripts.</p></article><article><div className="info-num">2</div><Cpu size={28}/><h3>Wrap</h3><p>Use Tauri for desktop, Capacitor for Android/iOS, PWA for installable websites, and PyInstaller for Python.</p></article><article><div className="info-num">3</div><Rocket size={28}/><h3>Compile</h3><p>Push the generated project to GitHub, run a trusted manual workflow, and download the resulting artifacts.</p></article></div></section>
      <section id="limits" className="bottom-strip"><CircleAlert size={18}/><p><strong>Packaging is not magic:</strong> Mobile builds produce an Android debug APK and an unsigned iOS Xcode project. Desktop installers are unsigned. Signing, notarization, native plugins, and server-dependent apps need additional work.</p></section>
    </main>
    <footer><div className="brand footer-brand"><div className="brand-mark small-mark"><Package size={15}/></div><span>THE DROP ZONE</span></div><span>ONE PROJECT. MANY RUNWAYS.</span><span>GROK + CLAUDE + APPFORGE · PHITAR + RELAY v0.4</span></footer>
  </div>;
}
