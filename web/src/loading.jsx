import React from 'react';
import { useLocation } from 'react-router-dom';

/* Route-level Suspense fallback — the deck's "module boot" readout. Sits inside
   .main while a lazily-fetched view chunk is in flight, so the rail and shell
   chrome stay live underneath. Built only from global styles.css tokens and
   classes (.loading-wrap, .spinner, mono micro-labels, lime signal accents) —
   it imports no view css, so it reads identically no matter which module is
   booting and never drags a view's stylesheet into the eager bundle. */

// pathname → instrument label for the boot readout; first match wins
const MODULES = [
  [/^\/onboarding/, 'ONBOARDING'],
  [/^\/strategy/, 'STRATEGY.BOARD'],
  [/^\/campaigns/, 'OUTPUT.PIPELINE'],
  [/^\/(shoots|photoshoot)/, 'PHOTOSHOOT'],
  [/^\/websites/, 'SITES'],
  [/^\/brand-?book/, 'BRAND.BOOK'],
  [/^\/profile/, 'BRAND.PROFILE'],
  [/^\/(dashboard)?$/, 'DECK'],
];
const moduleName = (path) => (MODULES.find(([re]) => re.test(path)) || [null, 'MODULE'])[1];

const frame = {
  position: 'relative',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
  padding: '30px 44px',
  background: 'var(--card)',
  border: '1px solid var(--line-soft)',
};
// corner bracket — two sides of a 9px square, drawn in the lime signal accent
const corner = (top, right, bottom, left) => ({
  position: 'absolute', width: 9, height: 9,
  top: top ? -1 : 'auto', right: right ? -1 : 'auto', bottom: bottom ? -1 : 'auto', left: left ? -1 : 'auto',
  borderStyle: 'solid', borderColor: 'var(--lime)', borderWidth: 0,
  borderTopWidth: top ? 1 : 0, borderRightWidth: right ? 1 : 0,
  borderBottomWidth: bottom ? 1 : 0, borderLeftWidth: left ? 1 : 0,
});
const kicker = {
  fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
  letterSpacing: '.14em', color: 'var(--ink-4)', textTransform: 'uppercase',
};
const readout = {
  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
  letterSpacing: '.08em', color: 'var(--lime)', textTransform: 'uppercase',
  display: 'flex', alignItems: 'baseline', gap: 2,
};

export default function ModuleLoader() {
  const { pathname } = useLocation();
  const name = moduleName(pathname);
  return (
    <div className="loading-wrap" role="status" aria-live="polite" aria-label={`Loading ${name.toLowerCase()}`}
      style={{ animation: 'fade-in .15s ease-out both' }}>
      <div style={frame}>
        <i aria-hidden="true" style={corner(true, false, false, true)} />
        <i aria-hidden="true" style={corner(true, true, false, false)} />
        <i aria-hidden="true" style={corner(false, false, true, true)} />
        <i aria-hidden="true" style={corner(false, true, true, false)} />
        <span style={kicker}><span style={{ color: 'var(--lime)' }}>{'// '}</span>LOADING MODULE</span>
        <div className="spinner" style={{ width: 30, height: 30, borderWidth: 2 }} />
        <span style={readout}>
          {name}
          <span aria-hidden="true" style={{ animation: 'caret-blink 1s steps(1) infinite' }}>▮</span>
        </span>
      </div>
    </div>
  );
}
