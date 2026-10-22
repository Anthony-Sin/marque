import React, { useRef, useState } from 'react';
import api from '../api.js';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';

// <UploadBtn onUploaded={({path}, file)=>…} label accept multiple className icon onError />
// Hidden file input → POST /api/upload → onUploaded per file (sequential when multiple).
export default function UploadBtn({
  label = 'Upload',
  icon = 'upload',
  accept = 'image/*',
  multiple = false,
  className = 'btn ghost',
  onUploaded,
  onError,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const app = useApp();

  const onChange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      for (const f of files) {
        const res = await api.upload(f); // → { path: '/assets/x.png' }
        await onUploaded?.(res, f);
      }
    } catch (err) {
      if (onError) onError(err);
      else app?.say?.(`Upload failed — ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} hidden onChange={onChange} />
      <button type="button" className={className} onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <span className="spinner pf-spin-sm" /> : <Icon name={icon} size={15} />}
        {busy ? 'Uploading…' : label}
      </button>
    </>
  );
}
