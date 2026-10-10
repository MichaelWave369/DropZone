import React, {useEffect, useState} from 'react';
import {ArrowDownToLine, ArrowUpRight, CheckCircle2, ClipboardCopy, FileArchive, Fingerprint, FolderInput, LoaderCircle, ShieldCheck} from 'lucide-react';
import {HANDOFF_LIMIT_BYTES, RELAY_URL, prepareRelayHandoff, relayHandoffNote} from './relay-handoff.js';

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function RelayHandoff({stagedArtifact}) {
  const [manualFile, setManualFile] = useState(null);
  const [project, setProject] = useState('DropZone');
  const [recipient, setRecipient] = useState('Resh');
  const [version, setVersion] = useState('1.0.0');
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const file = manualFile || stagedArtifact?.file || null;

  useEffect(() => {
    setManualFile(null);
    setReceipt(null);
    setProject(stagedArtifact?.project || 'DropZone');
    setVersion(stagedArtifact?.version || '1.0.0');
    setFeedback('');
    setError('');
  }, [stagedArtifact]);

  function clearReceipt() {setReceipt(null);setFeedback('');setError('');}
  async function prepare() {
    setBusy(true);setError('');setFeedback('');setReceipt(null);
    try {
      setReceipt(await prepareRelayHandoff(file, {project, recipient, version}));
      setFeedback('SHA-256 prepared locally. Nothing has been uploaded.');
    } catch (e) {setError(e.message || 'Could not prepare relay handoff.');}
    finally {setBusy(false);}
  }
  async function copyNote() {
    try {
      await navigator.clipboard.writeText(relayHandoffNote(receipt));
      setFeedback('Copied the handoff note. Paste it into the Relay notes field.');
    } catch {setError('Clipboard access was blocked. Use the receipt JSON instead.');}
  }
  function saveReceipt() {
    const json = new Blob([JSON.stringify({...receipt, note:relayHandoffNote(receipt)}, null, 2)+'\n'],{type:'application/json'});
    saveBlob(json, receipt.filename + '.relay-receipt.json');
  }

  return <section className="relay-section" id="relay-handoff" aria-label="Parallax Relay file handoff">
    <div className="relay-heading">
      <div className="relay-kicker"><Fingerprint size={16}/> PARALLAX RELAY 369 / ARTIFACT HANDOFF</div>
      <h2>Pack here. <span>Relay there.</span></h2>
      <p>Stage an exported build kit, PhiTar archive, or other file. Generate a verifiable handoff receipt before sending it to your collaborator through Parallax Relay.</p>
    </div>
    <div className="relay-grid">
      <div className="relay-panel">
        <h3><FileArchive size={18}/> 01 / Prepare the file</h3>
        {file ? <p className="relay-selected"><CheckCircle2 size={16}/><span>{file.name} <small>({(file.size / 1024).toFixed(1)} KiB)</small></span></p>
          : <p className="relay-muted">Export a Drop Zone build kit first, or select any file on your machine.</p>}
        <label className="relay-pick"><FolderInput size={15}/> Choose file for Relay
          <input type="file" onChange={e=>{setManualFile(e.target.files?.[0]||null);clearReceipt();e.target.value='';}}/>
        </label>
        {stagedArtifact?.file && !manualFile && <p className="relay-muted">Latest generated build kit is staged in memory. Its ZIP was already downloaded to your device.</p>}
        <div className="relay-fields">
          <label>PROJECT<input value={project} onChange={e=>{setProject(e.target.value);clearReceipt();}} maxLength={120}/></label>
          <label>VERSION<input value={version} onChange={e=>{setVersion(e.target.value);clearReceipt();}} maxLength={64}/></label>
          <label>RECIPIENT LABEL<input value={recipient} onChange={e=>{setRecipient(e.target.value);clearReceipt();}} maxLength={100}/></label>
        </div>
        <button className="relay-primary" disabled={!file||busy||file.size>HANDOFF_LIMIT_BYTES} onClick={prepare}>
          {busy?<LoaderCircle size={16} className="spin"/>:<Fingerprint size={16}/>}
          {busy?'Hashing file…':'PREPARE SHA-256 RECEIPT'}
        </button>
        <p className="relay-muted">Maximum 75 MiB per file for local hashing. Recipient is a handoff label, not an access-control setting.</p>
      </div>
      <div className="relay-panel">
        <h3><ShieldCheck size={18}/> 02 / Transfer through Relay</h3>
        {receipt ? <>
          <p className="relay-ready"><CheckCircle2 size={16}/> Local receipt prepared</p>
          <div className="relay-digest"><span>SHA-256</span><code>{receipt.sha256}</code><small>{receipt.filename} • {receipt.sizeBytes.toLocaleString()} bytes</small></div>
          <div className="relay-actions">
            <button onClick={copyNote}><ClipboardCopy size={16}/> Copy handoff note</button>
            <button onClick={saveReceipt}><ArrowDownToLine size={16}/> Save receipt JSON</button>
          </div>
          <a className="relay-open" href={RELAY_URL} target="_blank" rel="noopener noreferrer">OPEN PARALLAX RELAY <ArrowUpRight size={16}/></a>
          <p className="relay-muted">In Relay, sign in, select the ZIP you downloaded, and fill Project, Version, Recipient and Note. Paste the handoff note. Your file is sent only from Relay after you choose to upload it.</p>
        </> : <>
          <div className="relay-await"><Fingerprint size={30}/><strong>Awaiting verified artifact</strong><span>The recipient can compare this digest with the file received in Relay.</span></div>
          <a className="relay-open relay-open-muted" href={RELAY_URL} target="_blank" rel="noopener noreferrer">OPEN RELAY MANUALLY <ArrowUpRight size={16}/></a>
        </>}
        <p className="relay-warning"><ShieldCheck size={15}/> Separate authenticated systems. No credentials, cookies or file bytes are passed across sites by Drop Zone. Current Relay collaborator access is not recipient-scoped; only use it with trusted people.</p>
      </div>
    </div>
    {feedback&&<div role="status" className="relay-feedback"><CheckCircle2 size={16}/>{feedback}</div>}
    {error&&<div role="alert" className="relay-feedback relay-error">{error}</div>}
  </section>;
}
