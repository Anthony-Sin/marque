import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// <Kebab items={[{label, icon?, danger?, onClick}]} up? corner? align? />
// more-vert dropdown; closes on outside click / Escape.
//   corner  — absolutely pins the trigger to a card's top-right (parent must be position:relative)
//   up      — opens the menu above the trigger (bottom-of-page CTAs)
//   align   — 'right' (default) or 'left': which trigger edge the menu hugs
export default function Kebab({ items = [], up = false, corner = false, align = 'right', title = 'More options' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const list = items.filter(Boolean);
  if (!list.length) return null;

  return (
    <span ref={ref} className={`pf-kebab${corner ? ' corner' : ''}${up ? ' up' : ''}${align === 'left' ? ' left' : ''}`}>
      <button
        type="button"
        className="pf-kbtn"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="kebab" size={17} sw={3.4} />
      </button>
      {open && (
        <span className="menu" role="menu">
          {list.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={it.danger ? 'pf-danger' : ''}
              onClick={() => { setOpen(false); it.onClick?.(); }}
            >
              {it.icon && <Icon name={it.icon} size={14} />}
              <span>{it.label}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
