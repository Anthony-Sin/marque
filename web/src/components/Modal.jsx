import React, { useEffect } from 'react';
import Icon from './Icon.jsx';

// <Modal title onClose footer narrow width>children</Modal>
// veil + centered card; closes on veil click and Escape.
export default function Modal({ title, onClose, children, footer, narrow = false, width }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal${narrow ? ' pf-modal-narrow' : ''}`} style={width ? { maxWidth: width } : undefined}
        role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'}>
        {(title || onClose) && (
          <div className="pf-modal-head">
            <h3 className="pf-modal-title">{title}</h3>
            <span className="grow" />
            {onClose && (
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        )}
        <div className="pf-modal-body">{children}</div>
        {footer && <div className="pf-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
