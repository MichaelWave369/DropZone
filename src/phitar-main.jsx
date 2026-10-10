import React from 'react';
import {createRoot} from 'react-dom/client';
import {Archive, ArrowUpRight, CheckCircle2, FileArchive, FolderOpen, ShieldCheck} from 'lucide-react';
import PhiTar from './PhiTar.jsx';
import './styles.css';
import './phitar.css';
import './phitar-standalone.css';

function App() {
  return <div className="phitar-standalone">
    <header className="phitar-app-topbar">
      <a className="phitar-app-brand" href="./phitar.html" aria-label="PhiTar home">
        <span className="phitar-app-mark"><Archive size={23}/></span>
        <span><strong>PhiTar</strong><small>THE DROP ZONE / ARCHIVE STUDIO</small></span>
      </a>
      <nav aria-label="PhiTar navigation">
        <a href="#phitar">Archive workstation</a>
        <a href="#phitar-about">About & limits</a>
        <a href="https://michaelwave369.github.io/DropZone/" target="_blank" rel="noreferrer">
          Drop Zone builder <ArrowUpRight size={14}/>
        </a>
      </nav>
      <span className="phitar-app-version">STANDALONE PREVIEW v0.6</span>
    </header>
    <main className="phitar-app-main">
      <section className="phitar-app-hero">
        <span className="phitar-app-eyebrow"><ShieldCheck size={15}/> LOCAL FILES · NO ACCOUNT REQUIRED</span>
        <h1>Meet <span>PhiTar.</span></h1>
        <p>Pack your code, projects and everyday files into standard archives. Inspect what is inside before extracting. Your files stay on your computer unless you explicitly move them elsewhere.</p>
        <div className="phitar-app-pills">
          <span><CheckCircle2 size={15}/> ZIP / TAR / TAR.GZ</span>
          <span><FolderOpen size={15}/> Folder-aware packaging</span>
          <span><FileArchive size={15}/> Safe archive inspection</span>
        </div>
      </section>
      <PhiTar />
      <section className="phitar-app-note" id="phitar-about" aria-label="PhiTar limits">
        <ShieldCheck size={21}/>
        <div>
          <strong>Archive utility, not a file vault.</strong>
          <p>PhiTar v0.6 is local-first, with 75 MiB input and 150 MiB expanded limits and a 1,000-file cap. Standard ZIP, USTAR TAR and TAR.GZ are supported. RAR, 7z, encryption and huge archive streaming are not yet implemented. The packaged desktop edition uses the same tested browser engine; native builds must pass separately.</p>
        </div>
      </section>
    </main>
    <footer className="phitar-app-footer"><span>PHITAR / THE DROP ZONE</span><span>LOCAL FIRST · LEDGER ABOVE LABELS</span></footer>
  </div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
