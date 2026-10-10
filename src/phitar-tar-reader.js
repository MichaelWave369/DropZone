/**
 * PhiTar native-only, bounded USTAR reader and chunked extractor.
 *
 * Scan reads 512-byte headers and jumps over payloads without loading them.
 * Extraction requires a separate user-selected output folder, with no overwrite.
 * This validates TAR structure, NOT payload hashes, signatures or malware safety.
 */
import {safeArchivePath,ARCHIVE_FILE_LIMIT} from './phitar.js';
import {NATIVE_STREAM_TAR_MAX_BYTES,validateNativeArchivePath} from './phitar-folder-plan.js';
import {TAR_STREAM_CHUNK} from './phitar-tar-stream.js';

const BLOCK=512;
const MAX_TAR_BYTES=NATIVE_STREAM_TAR_MAX_BYTES+1024*1024;
const asciiDecoder=new TextDecoder('utf-8',{fatal:true});

function allZero(a){return a.every(x=>x===0);}
function field(a,start,width){
  const bytes=a.subarray(start,start+width);
  const index=bytes.indexOf(0);
  return asciiDecoder.decode(index<0?bytes:bytes.subarray(0,index));
}
function octal(a,start,width){
  const value=field(a,start,width).trim();
  if(!/^[0-7]+$/.test(value))throw new Error('Malformed TAR octal field.');
  const n=Number.parseInt(value,8);
  if(!Number.isSafeInteger(n))throw new Error('TAR size exceeds safe integer limits.');
  return n;
}
function verifyHeader(h){
  const expected=octal(h,148,8);
  let actual=0;
  for(let i=0;i<BLOCK;i++)actual+=i>=148&&i<156?32:h[i];
  if(actual!==expected)throw new Error('TAR header checksum mismatch.');
  if(asciiDecoder.decode(h.subarray(257,262))!=='ustar')
    throw new Error('Only POSIX USTAR TAR is supported; PAX/GNU extended headers are not supported.');
  const name=field(h,0,100),prefix=field(h,345,155);
  const type=h[156];
  if(type!==0&&type!==48&&type!==53)
    throw new Error('TAR links, executable special entries and extended headers are rejected.');
  const size=octal(h,124,12);
  if(type===53&&size!==0)throw new Error('Malformed TAR directory record.');
  const raw=(prefix?prefix+'/':'')+name;
  const path=validateNativeArchivePath(safeArchivePath(raw.replace(/\/$/,'')));
  if(!/^[\x20-\x7e]+$/.test(path))throw new Error('Native USTAR only supports ASCII paths.');
  if(type===53&&!raw.endsWith('/'))throw new Error('Malformed TAR directory path.');
  return {path,size,isDirectory:type===53};
}

/**
 * @param {Object} source {size:number,readAt(offset,length):Promise<Uint8Array>}
 * @returns {Promise<{entries:Array, archiveBytes:number, dataBytes:number}>}
 */
export async function inspectStreamingTar(source){
  if(!source||typeof source.readAt!=='function'||!Number.isSafeInteger(source.size)||
    source.size<1024||source.size>MAX_TAR_BYTES||source.size%BLOCK)
    throw new Error('TAR file is truncated, malformed, or above the native 2 GiB preview limit.');
  let pos=0,dataBytes=0;
  const entries=[],files=new Set(),directories=new Set();
  while(pos+1024<=source.size){
    const h=await source.readAt(pos,BLOCK);
    if(!(h instanceof Uint8Array)||h.byteLength!==BLOCK)
      throw new Error('TAR header truncated while reading.');
    if(allZero(h)){
      const second=await source.readAt(pos+BLOCK,BLOCK);
      if(!(second instanceof Uint8Array)||second.byteLength!==BLOCK||!allZero(second))
        throw new Error('Missing complete TAR end marker.');
      if(!entries.length)throw new Error('TAR contains no regular files.');
      // Do not load the trailing padding. POSIX readers allow blocks of zeros.
      return {entries,archiveBytes:source.size,dataBytes};
    }
    const {path,size,isDirectory}=verifyHeader(h);
    const key=path.toLowerCase();
    if(isDirectory){
      if(files.has(key))throw new Error('TAR file/directory name collision.');
      directories.add(key);
    }else{
      if(files.has(key)||directories.has(key))throw new Error('Duplicate or conflicting TAR path.');
      files.add(key);
      dataBytes+=size;
      if(entries.length>=ARCHIVE_FILE_LIMIT||dataBytes>NATIVE_STREAM_TAR_MAX_BYTES)
        throw new Error('TAR exceeds 1,000 files or 2 GiB of unpacked data.');
      const offset=pos+BLOCK;
      const padded=Math.ceil(size/BLOCK)*BLOCK;
      if(padded>source.size-offset-1024)
        throw new Error('Truncated TAR payload or end marker.');
      entries.push({path,size,dataOffset:offset});
    }
    const padded=Math.ceil(size/BLOCK)*BLOCK;
    if(padded>source.size-(pos+BLOCK)-1024)
      throw new Error('Truncated TAR payload or end marker.');
    pos+=BLOCK+padded;
  }
  throw new Error('TAR is missing its end marker.');
}

function checkedPlan(plan){
  if(!plan||!Array.isArray(plan.entries)||plan.entries.length<1||plan.entries.length>ARCHIVE_FILE_LIMIT||
    !Number.isSafeInteger(plan.archiveBytes)||plan.archiveBytes>MAX_TAR_BYTES)
    throw new Error('Invalid streaming TAR inspection plan.');
  let total=0;
  const files=new Set();
  const directories=new Set();
  for(const entry of plan.entries){
    const path=validateNativeArchivePath(entry.path);
    if(path!==entry.path||!Number.isSafeInteger(entry.size)||entry.size<0||
      !Number.isSafeInteger(entry.dataOffset)||entry.dataOffset<BLOCK||
      entry.dataOffset+entry.size>plan.archiveBytes-1024)
      throw new Error('Unsafe or invalid streaming TAR entry.');
    total+=entry.size;
    const key=path.toLowerCase();
    if(files.has(key))throw new Error('Duplicate TAR filename.');
    files.add(key);
    const parts=key.split('/');
    for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/'));
  }
  if(total>NATIVE_STREAM_TAR_MAX_BYTES)throw new Error('TAR exceeds the 2 GiB unpacked limit.');
  for(const path of files)if(directories.has(path))throw new Error('A TAR path cannot be both a file and directory.');
  return plan.entries;
}

async function writeAll(handle,bytes){
  let written=0;
  while(written<bytes.length){
    const count=await handle.write(bytes.subarray(written));
    if(!Number.isInteger(count)||count<=0||count>bytes.length-written)
      throw new Error('Invalid native file write length.');
    written+=count;
  }
}

/** Extract only validated regular files into a newly created root.
 *  If interrupted, the partial root is LEFT IN PLACE and reported by the caller.
 *  We do not recursively delete paths after a failure.
 */
export async function extractStreamingTar(plan,adapter,{progress}={}){
  const entries=checkedPlan(plan);
  if(!adapter||typeof adapter.readAt!=='function'||typeof adapter.createRoot!=='function'||
    typeof adapter.mkdir!=='function'||typeof adapter.openNew!=='function'||typeof adapter.join!=='function')
    throw new Error('Missing native streaming extraction adapter.');
  const root=await adapter.createRoot();
  if(typeof root!=='string'||!root)throw new Error('No extraction destination created.');
  let copied=0;
  const madeDirs=new Set();
  for(let i=0;i<entries.length;i++){
    const entry=entries[i];
    const parts=entry.path.split('/');
    for(let d=1;d<parts.length;d++){
      const sub=parts.slice(0,d).join('/');
      const key=sub.toLowerCase();
      if(!madeDirs.has(key)){
        await adapter.mkdir(adapter.join(root,sub));
        madeDirs.add(key);
      }
    }
    const filename=adapter.join(root,entry.path);
    let handle;
    try{
      handle=await adapter.openNew(filename);
      let n=0;
      while(n<entry.size){
        const take=Math.min(TAR_STREAM_CHUNK,entry.size-n);
        const data=await adapter.readAt(entry.dataOffset+n,take);
        if(!(data instanceof Uint8Array)||data.length<1||data.length>take)
          throw new Error('Source TAR payload truncated during extraction.');
        await writeAll(handle,data);
        n+=data.length;
        copied+=data.length;
      }
    }finally{if(handle)await handle.close();}
    if(progress)progress({files:i+1,totalFiles:entries.length,bytes:copied});
  }
  return {saved:true,directory:root,files:entries.length,bytes:copied};
}
