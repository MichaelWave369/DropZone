/**
 * Bounded native TAR writer, separate from the browser's in-memory archive path.
 * Consumes a validated folder plan and writes USTAR records through file handles.
 */
import {createTarHeader} from './phitar.js';
import {NATIVE_STREAM_TAR_MAX_BYTES} from './phitar-folder-plan.js';

export const TAR_STREAM_CHUNK = 64 * 1024;
const BLOCK = 512;
const END = new Uint8Array(1024);
const PAD = new Uint8Array(BLOCK);

export function streamingTarSize(plan) {
  if (!Array.isArray(plan?.entries) || !plan.entries.length || plan.entries.length > 1000)
    throw new Error('Streaming TAR requires between 1 and 1,000 files.');
  let total = END.length;
  let totalSourceBytes = 0;
  for (const item of plan.entries) {
    if (!Number.isSafeInteger(item.size) || item.size < 0)
      throw new Error('Invalid preflighted file size.');
    totalSourceBytes += item.size;
    if (totalSourceBytes > NATIVE_STREAM_TAR_MAX_BYTES)
      throw new Error('Streaming TAR source exceeds the 2 GiB limit.');
    // Checks USTAR path and file-size field before opening an output file.
    createTarHeader(item.path,item.size);
    total += BLOCK + Math.ceil(item.size/BLOCK)*BLOCK;
    if (total > NATIVE_STREAM_TAR_MAX_BYTES + 1024*1024)
      throw new Error('Streaming TAR output exceeds the 2 GiB preview limit.');
  }
  return total;
}

async function writeEntirely(handle,bytes) {
  let pos=0;
  while(pos<bytes.byteLength){
    const n=await handle.write(bytes.subarray(pos));
    if(!Number.isInteger(n)||n<=0||n>bytes.byteLength-pos)
      throw new Error('Native filesystem returned an invalid write length.');
    pos+=n;
  }
}

/**
 * @param {Object} plan – metadata-only plan from planNativeFolder()
 * @param {Object} adapter – openRead/openNew/write handles/lstat/remove; injected for testing
 * @returns {Promise<{files:number,bytes:number}>}
 */
export async function writeStreamingTar(plan,adapter,{progress}={}){
  const expectedSize=streamingTarSize(plan);
  if(!adapter||typeof adapter.openRead!=='function'||typeof adapter.openNew!=='function'||typeof adapter.lstat!=='function')
    throw new Error('Missing streaming file adapter.');
  let output;
  let ownsOutput=false;
  let ok=false;
  let written=0;
  try{
    output=await adapter.openNew();
    ownsOutput=true;
    for(let i=0;i<plan.entries.length;i++){
      const item=plan.entries[i];
      const check=await adapter.lstat(item.absolutePath);
      if(!check.isFile||check.isSymlink||check.size!==item.size)
        throw new Error('Source file changed before stream. Incomplete TAR discarded.');
      let input;
      try{
        input=await adapter.openRead(item.absolutePath);
        const descriptor=await input.stat();
        if(!descriptor.isFile||descriptor.size!==item.size)
          throw new Error('File changed while opening stream.');
        const header=createTarHeader(item.path,item.size,0);
        await writeEntirely(output,header);
        written+=header.length;
        let remaining=item.size;
        const buffer=new Uint8Array(TAR_STREAM_CHUNK);
        while(remaining>0){
          const wanted=Math.min(TAR_STREAM_CHUNK,remaining);
          const n=await input.read(buffer.subarray(0,wanted));
          if(n===null||!Number.isInteger(n)||n<=0||n>wanted)
            throw new Error('Unexpected end of source file during TAR stream.');
          await writeEntirely(output,buffer.subarray(0,n));
          written+=n;remaining-=n;
        }
        const endCheck=await adapter.lstat(item.absolutePath);
        if(endCheck.size!==item.size||endCheck.isSymlink||!endCheck.isFile)
          throw new Error('Source file changed during TAR stream.');
        const padding=(BLOCK-item.size%BLOCK)%BLOCK;
        if(padding){await writeEntirely(output,PAD.subarray(0,padding));written+=padding;}
      }finally{if(input)await input.close();}
      if(progress)progress({files:i+1,totalFiles:plan.entries.length,bytes:written});
    }
    await writeEntirely(output,END);
    written+=END.length;
    if(written!==expectedSize)throw new Error('Streaming TAR output size mismatch.');
    ok=true;
    return {files:plan.entries.length,bytes:written};
  }finally{
    if(output)await output.close();
    if(ownsOutput&&!ok && typeof adapter.removeIncomplete==='function')
      await adapter.removeIncomplete().catch(()=>{});
  }
}
