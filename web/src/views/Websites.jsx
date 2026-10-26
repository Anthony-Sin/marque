import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import VersionTabs from '../components/VersionTabs.jsx';
import PublishBar from '../components/PublishBar.jsx';
import { QlooBadge } from '../components/Qloo.jsx';
import { useStages, fmtDate } from '../components/Composer.jsx';
import './studio.css';

const CREATE_STAGES = ['Reading your Business Profile…', 'Drafting copy & layout…', 'Styling with your palette…', 'Putting the pages together…'];
const EDIT_STAGES = ['Reworking the layout…', 'Rewriting the copy…', 'Polishing the details…'];
const IMPROVE_STAGES = ['Scraping your site…', 'Checking linked socials…', 'Reading audience-adjacent brands…', 'Ranking fixes by impact…'];

const absUrl = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`);
// bare host for run-copy titles ('huel.com'), '' when the input isn't a url yet
const host = (u) => { try { return new URL(absUrl(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const SOC_ICON = { instagram: 'image', tiktok: 'film', youtube: 'play', x: 'share', twitter: 'share', facebook: 'share', linkedin: 'book', pinterest: 'image' };
const socIcon = (p) => SOC_ICON[String(p || '').toLowerCase()] || 'link';
const IMPACT_ORD = { high: 0, med: 1, medium: 1, low: 2 };
const impOrd = (v) => IMPACT_ORD[String(v || '').toLowerCase()] ?? 3;

// recommendation cards clamp their copy to fit the fixed deck — a tap expands
// the card inside the panel's own scroller. The 'more' toggle only appears
// when the clamp actually cut text (measured, never guessed).
function useClampToggle(probeSel, deps = []) {
  const ref = useRef(null);
  const [clipped, setClipped] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const probe = () => {
      let hit = false;
      el.querySelectorAll(probeSel).forEach((n) => {
        if (n.scrollHeight > n.clientHeight + 1) hit = true;
      });
      setClipped(hit);
    };
    probe();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(probe) : null;
    ro?.observe(el);
    window.addEventListener('resize', probe);
    return () => { ro?.disconnect(); window.removeEventListener('resize', probe); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const expandable = clipped || open;
  const onKey = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); }
  };
  return {
    ref, open, expandable,
    expandProps: expandable
      ? { role: 'button', tabIndex: 0, 'aria-expanded': open, onClick: () => setOpen((o) => !o), onKeyDown: onKey }
      : {},
  };
}

// fix-list card — 'why' copy is the audit's core output; it un-clamps on tap
function ImpSug({ s }) {
  const { ref, open, expandable, expandProps } = useClampToggle('.imp-fix, .imp-why', [s.fix, s.why]);
  return (
    <div ref={ref} className={`card imp-sug${open ? ' open' : ''}${expandable ? ' can' : ''}`}
      title={expandable ? (open ? 'Collapse' : 'Read the full recommendation') : undefined}
      {...expandProps}>
      <div className="imp-sug-top">
        <span className="imp-area">{s.area || 'site'}</span>
        <span className="imp-badges">
          {!!s.impact && <span className={`imp-badge impact-${String(s.impact).toLowerCase()}`}>impact {s.impact}</span>}
          {!!s.effort && <span className="imp-badge">effort {s.effort}</span>}
        </span>
      </div>
      {!!s.fix && <div className="imp-fix">{s.fix}</div>}
      {!!s.why && <div className="imp-why">{s.why}</div>}
      {expandable && <span className="imp-more">{open ? 'less' : 'more'}</span>}
    </div>
  );
}

// audit progress card — shared by the rail veil (re-run over the dimmed audit),
// the first-run inline panel and the fix-bay veil. /api/websites/improve is one
// synchronous call — there's no job object — so stage copy rotates client-side
// over an honest duration note instead of pretending to know live progress.
function AuditRun({ title, stage }) {
  return (
    <div className="imp-veil-card">
      <span className="spinner" />
      <span className="imp-veil-txt">
        <b>{title}</b>
        <span className="imp-veil-stage">{stage}</span>
        <span className="imp-veil-note">About a minute — pulls from your live site + the taste graph.</span>
      </span>
    </div>
  );
}

// "what to steal" row — same clamp→tap-to-expand contract as the fix cards
function ImpSteal({ n, i }) {
  const { ref, open, expandable, expandProps } = useClampToggle('.imp-steal-txt', [n.steal]);
  return (
    <div ref={ref} className={`imp-steal${open ? ' open' : ''}`}
      title={expandable ? (open ? 'Collapse' : 'Read the full note') : undefined}
      {...expandProps}>
      <b><i className="imp-steal-n">{String(i + 1).padStart(2, '0')}</i>{n.brand}</b>
      <span className="imp-steal-txt">{n.steal}</span>
      {expandable && <span className="imp-more">{open ? 'less' : 'more'}</span>}
    </div>
  );
}

export default function Websites() {
  const { say, status, profile } = useApp();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(() => (sp.get('tab') === 'site' || (!sp.get('tab') && sp.get('site')) ? 'site' : 'improve')); // 'improve' | 'site'
  const tabBtn = { improve: useRef(null), site: useRef(null) };
  // APG tablist: arrows/Home/End move the selection like the click does (each
  // switch is URL-backed), then focus lands on the newly-selected tab
  const onTabsKey = (e) => {
    const order = ['improve', 'site'];
    const i = order.indexOf(tab);
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % order.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + order.length) % order.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = order.length - 1;
    if (j < 0 || j === i) return;
    e.preventDefault();
    goTab(order[j]);
    tabBtn[order[j]].current?.focus();
  };
  const [sites, setSites] = useState(null);
  const [vid, setVid] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState('');            // 'create' | 'edit' | 'del' | 'pub'
  const [impUrl, setImpUrl] = useState('');
  const [imp, setImp] = useState(null);            // improveWebsite result
  const [impErr, setImpErr] = useState('');
  const [impBusy, setImpBusy] = useState(false);
  const [unpubId, setUnpubId] = useState(null);    // site row mid-unpublish
  const stageNote = useStages(busy === 'edit' ? EDIT_STAGES : CREATE_STAGES, busy === 'create' || busy === 'edit');
  const impStage = useStages(IMPROVE_STAGES, impBusy, 2000);
  const [siteId, setSiteId] = useState(() => sp.get('site') || null); // which generated site is shown (default: newest)
  const site = sites?.find((s) => s.id === siteId) || sites?.[sites.length - 1] || null;

  // tab + site selection live in the URL: changes PUSH a history entry (Back
  // undoes the last switch), and ?site implies the site tab when ?tab is absent
  const goTab = (t) => {
    setSp((p) => {
      const n = new URLSearchParams(p);
      n.set('tab', t); // explicit for both — a bare ?site would else snap improve back
      return n;
    });
  };
  const pickSite = (id) => {
    setSp((p) => {
      const n = new URLSearchParams(p);
      if (id) { n.set('site', id); n.set('tab', 'site'); }
      else n.delete('site');
      return n;
    });
    setVid(null);
  };

  // URL → state: Back/Forward and shared links drive the same state as clicks
  useEffect(() => {
    const t = sp.get('tab');
    setTab(t === 'site' || (!t && sp.get('site')) ? 'site' : 'improve');
    setSiteId(sp.get('site'));
  }, [sp]);

  // stale or bogus params get cleaned (replace — the lie never stays in history):
  // a ?site the list can't resolve, or a ?tab we don't have
  useEffect(() => {
    const wantSite = sp.get('site');
    const wantTab = sp.get('tab');
    const siteBad = wantSite && Array.isArray(sites) && !sites.some((s) => s.id === wantSite);
    const tabBad = wantTab && !['site', 'improve'].includes(wantTab);
    if (!siteBad && !tabBad) return;
    setSp((p) => {
      const n = new URLSearchParams(p);
      if (siteBad) n.delete('site');
      if (tabBad) n.delete('tab');
      return n;
    }, { replace: true });
  }, [sp, sites]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = async () => {
    try {
      const d = await api.listWebsites();
      setSites(d.websites || []);
      if (d.lastAudit) { setImp((cur) => cur || d.lastAudit); if (d.lastAudit.url && !impUrl) setImpUrl(d.lastAudit.url); }
    } catch (e) { say(e.message); setSites([]); }
  };
  useEffect(() => { reload(); }, []);

  // prefill the audit input with the profile's source site once it loads
  useEffect(() => {
    if (!impUrl && profile?.source?.url) setImpUrl(profile.source.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const versions = site?.versions || [];
  const active = versions.find((v) => v.id === vid)
    || versions.find((v) => v.id === site?.activeVersion)
    || versions[versions.length - 1];

  const mergeVersion = (version) => {
    setSites((ss) => ss.map((s) => s.id === site.id
      ? { ...s, versions: [...s.versions.filter((v) => v.id !== version.id), version], activeVersion: version.id }
      : s));
    setVid(version.id);
  };

  const create = async () => {
    setBusy('create');
    try {
      const { website } = await api.createWebsite(prompt.trim() || undefined);
      await reload();
      setVid(website?.activeVersion || website?.versions?.at(-1)?.id);
      if (website?.id) pickSite(website.id); // land on the fresh site — url says which
      say('Your website is ready');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const edit = async (p) => {
    setBusy('edit');
    try {
      const { version } = await api.editWebsite(site.id, p || prompt.trim() || 'Refresh the design with a new variation');
      mergeVersion(version);
      setEditOpen(false); setPrompt('');
      say('New version ready');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const previewNewTab = () => {
    // open the generated doc inside a sandboxed iframe wrapper — its scripts
    // run in an opaque origin and can't reach app storage
    const inner = URL.createObjectURL(new Blob([active?.html || ''], { type: 'text/html' }));
    const shell = `<!doctype html><title>Preview</title><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style><iframe sandbox="allow-scripts" src="${inner}"></iframe>`;
    const u = URL.createObjectURL(new Blob([shell], { type: 'text/html' }));
    window.open(u, '_blank', 'noopener');
    setTimeout(() => { URL.revokeObjectURL(u); URL.revokeObjectURL(inner); }, 60_000);
  };

  const delVersion = async () => {
    if (!active || versions.length <= 1) { say('Keep at least one version'); return; }
    setBusy('del');
    try {
      await api.deleteWebsiteVersion(site.id, active.id);
      setVid(null);
      await reload();
      say('Version deleted');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const publish = async (slug) => {
    setBusy('pub');
    try {
      const { publishedSlug } = await api.publishWebsite(site.id, slug);
      setSites((ss) => ss.map((s) => s.id === site.id ? { ...s, publishedSlug } : s));
      say(`Live at /s/${publishedSlug}`);
    } catch (e) { say(e.message); }
    setBusy('');
  };
  const unpublish = async () => {
    setBusy('pub');
    try {
      await api.unpublishWebsite(site.id);
      setSites((ss) => ss.map((s) => s.id === site.id ? { ...s, publishedSlug: undefined } : s));
      say('Unpublished');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  // per-row unpublish on the audit rail — same helper the PublishBar uses
  const unpubSite = async (id) => {
    if (unpubId) return;
    setUnpubId(id);
    try {
      await api.unpublishWebsite(id);
      setSites((ss) => ss.map((s) => (s.id === id ? { ...s, publishedSlug: null } : s)));
      say('Unpublished');
    } catch (e) { say(e.message); }
    setUnpubId(null);
  };

  // ---------- improve my site ----------
  const analyze = async () => {
    // empty input has no fallback — the server 422s when profile.source is
    // unset, so guard here and mirror it on the button's disabled state
    if (impBusy || !impUrl.trim()) return;
    setImpBusy(true); setImpErr('');
    try {
      setImp(await api.improveWebsite(impUrl.trim() || undefined));
    } catch (e) {
      setImpErr(e.message || 'analysis failed');
      say(e.message);
    }
    setImpBusy(false);
  };

  const impSugs = (Array.isArray(imp?.suggestions) ? imp.suggestions : [])
    .slice().sort((a, b) => impOrd(a.impact) - impOrd(b.impact) || impOrd(a.effort) - impOrd(b.effort));
  const impSocials = Object.entries(imp?.socials || {}).filter(([, u]) => u);
  const impMissing = Array.isArray(imp?.missingSocials) ? imp.missingSocials : [];
  const impSteals = Array.isArray(imp?.competitorNotes) ? imp.competitorNotes : [];
  const impComps = Array.isArray(imp?.competitors) ? imp.competitors : [];

  const renderImprove = () => (
    <div className="cp-split ws-split">
      <section className="card hud cp-panel ws-rail">
        <div className="zone-head"><span className="z-id">AUD</span>Site audit</div>
        <div className="cp-panel-body">
          <div className="imp-ask">
            <p className="muted small">
              We scrape your live site, check which socials it links, then rank concrete fixes —
              benchmarked against the brands your audience already loves.
            </p>
            <div className="imp-ask-row">
              <span className="imp-urlwrap">
                <Icon name="globe" size={14} />
                <input
                  value={impUrl}
                  placeholder="https://yoursite.com"
                  onChange={(e) => setImpUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') analyze(); }}
                />
              </span>
              <button className="btn lime" disabled={impBusy || !impUrl.trim()} onClick={analyze}>
                {impBusy ? <span className="spinner" /> : <Icon name="sparkle" />}
                {impBusy ? 'Analyzing…' : 'Analyze vs competitors'}
              </button>
            </div>
            {!imp && !impBusy && (
              <div className="imp-checks">
                <div className="imp-check"><Icon name="globe" size={14} /><b>Scrape</b><span>Page copy, structure & social links</span></div>
                <div className="imp-check"><Icon name="qloo" size={14} /><b>Benchmark</b><span>Against brands your audience loves</span></div>
                <div className="imp-check"><Icon name="check" size={14} /><b>Fix list</b><span>Ranked by impact × effort</span></div>
              </div>
            )}
          </div>

          {/* first run — no audit on record to keep on screen, so the progress
              card takes the rail in-flow instead of veiling empty space */}
          {impBusy && !imp && (
            <div className="imp-running">
              <AuditRun title={`Auditing ${host(impUrl) || 'your site'}`} stage={impStage} />
            </div>
          )}

          {impErr && !impBusy && (
            <div className="imp-err">
              <Icon name="x" size={14} /> Couldn't analyze that site — {impErr}
              <button className="btn ghost sm" onClick={analyze}><Icon name="refresh" size={13} /> Retry</button>
            </div>
          )}

          {/* re-run — the last audit stays mounted under a grayscale veil; the
              new result swaps straight into it, so nothing collapses or jumps */}
          {imp && (
            <div className={`imp-result${impBusy ? ' busy' : ''}`} aria-busy={impBusy || undefined}>
              <div className="imp-dim">
                <div className="muted small">
                  Audit of {imp.url || 'your site'}{imp.at ? ` · from ${fmtDate(imp.at)}` : ''}
                </div>
                {(!!impSocials.length || !!impMissing.length) && (
                  <div className="card pad imp-soc-card">
                    <div className="section-label" style={{ margin: '0 0 12px' }}>Socials</div>
                    <div className="chip-row">
                      {impSocials.map(([plat, href]) => (
                        <a key={plat} className="imp-soc" href={absUrl(href)} target="_blank" rel="noopener noreferrer">
                          <Icon name={socIcon(plat)} size={13} /> {plat}
                        </a>
                      ))}
                      {impMissing.map((p) => (
                        <span key={p} className="imp-miss" title={`Link ${cap(p)} on your site so we can plan for it`}>
                          <Icon name="x" size={11} /> No {cap(p)} linked on your site
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {!!impSteals.length && (
                  <div className="card pad imp-steal-card">
                    <div className="section-label" style={{ margin: '0 0 6px' }}>What to steal</div>
                    {impSteals.map((n, i) => <ImpSteal key={i} n={n} i={i} />)}
                    {!!impComps.length && (
                      <div className="imp-note" style={{ textAlign: 'left' }}>Benchmarked against: {impComps.join(', ')}</div>
                    )}
                  </div>
                )}

                {!impSteals.length && !!impComps.length && (
                  <div className="imp-note">Benchmarked against: {impComps.join(', ')}</div>
                )}
              </div>
              {impBusy && (
                <div className="imp-veil">
                  <AuditRun title={`Re-auditing ${host(impUrl) || 'your site'} — last audit stays put`} stage={impStage} />
                </div>
              )}
            </div>
          )}

          {/* what's already on record — real sites, real publish state */}
          {Array.isArray(sites) && !!sites.length && (
            <div className="ws-sites">
              <div className="imp-lab">Sites on record</div>
              {[...sites].reverse().slice(0, 4).map((s, i) => (
                <div key={s.id} className="ws-site-row">
                  <button type="button" className="ws-site-main"
                    title="Open this site in the generator"
                    onClick={() => pickSite(s.id)}>
                    <span className="ws-site-name">
                      Site {sites.length - i}{s.producedFrom?.campaignTitle ? ` — ${s.producedFrom.campaignTitle}` : ''}
                    </span>
                    <span className="ws-site-meta">
                      <i className={`ws-dot${s.publishedSlug ? ' live' : ''}`} aria-hidden="true" />
                      {fmtDate(s.createdAt)} · {s.publishedSlug ? 'live' : 'draft'}
                    </span>
                  </button>
                  {!!s.publishedSlug && (
                    <span className="ws-site-acts">
                      <a className="ws-live" href={`/s/${s.publishedSlug}`} target="_blank" rel="noopener noreferrer"
                        title={`Open the live page — /s/${s.publishedSlug}`}>
                        <Icon name="link" size={11} /><span className="ws-live-slug">/s/{s.publishedSlug}</span>
                      </a>
                      <button type="button" className="ws-unpub" title="Unpublish this site"
                        disabled={unpubId === s.id} onClick={() => unpubSite(s.id)}>
                        {unpubId === s.id ? <span className="spinner" /> : <Icon name="x" size={11} />}
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="card hud cp-panel ws-fix" aria-busy={impBusy || undefined}>
        <div className="zone-head"><span className="z-id">FIX</span>Fix list — ranked by impact{!!impSugs.length && <span className="z-tag">{impSugs.length}</span>}</div>
        <div className="cp-panel-body">
          {!!impSugs.length ? (
            <div className={`grid c2 imp-dim${impBusy ? ' off' : ''}`}>
              {impSugs.map((s, i) => <ImpSug key={i} s={s} />)}
            </div>
          ) : (
            <div className="imp-empty">
              {impBusy ? <span className="spinner" /> : <span className="imp-empty-ic"><Icon name="site" size={22} /></span>}
              <b>{impBusy ? 'Audit running' : 'No audit yet'}</b>
              {impBusy && <span className="imp-veil-stage">{impStage}</span>}
              <p>{impBusy
                ? 'The fix list lands here ranked by impact × effort.'
                : 'Run the analysis and your fixes land here — each card ranked by impact × effort, benchmarked against the brands your audience already loves.'}</p>
            </div>
          )}
        </div>
        {/* fix cards stay mounted mid re-run — the veil sits on the panel, not
            the scroller, so it covers exactly what's on screen at any scroll */}
        {impBusy && !!impSugs.length && (
          <div className="imp-veil">
            <AuditRun title="Re-ranking fixes against the new audit" stage={impStage} />
          </div>
        )}
      </section>
    </div>
  );

  // ---------- generate / manage site ----------
  const renderSite = () => {
    if (busy === 'create') {
      return (
        <div className="gen-hero">
          <div className="icon-hero"><Icon name="site" size={28} /></div>
          <div className="big">Generating your Website …</div>
          <div className="muted">{stageNote}</div>
          <div className="mt16"><div className="spinner" style={{ margin: '0 auto' }} /></div>
        </div>
      );
    }

    if (sites === null) {
      return (
        <div className="site-view">
          <div className="ver-tabs">
            {[0, 1, 2].map((i) => (
              <span key={i} className="ver-tab" style={{ cursor: 'default' }}>
                <span className="thumb skel" />
                <span className="skel skel-line w55" style={{ margin: '7px auto 0' }} />
              </span>
            ))}
          </div>
          <span className="skel" style={{ flex: 1, minHeight: 0, borderRadius: 16, display: 'block' }} />
        </div>
      );
    }

    if (!site) {
      return (
        <div className="gen-hero">
          <div className="icon-hero"><Icon name="site" size={28} /></div>
          <div className="big">Your site is built from your Business Profile</div>
          <div className="muted">Copy and imagery grounded in your taste signature — one click to a live page.</div>
          <div className="mt24">
            <input
              className="slug-in"
              style={{ width: 320, maxWidth: '80%', marginRight: 10 }}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder="Optional direction (e.g. bold landing for the summer drop)"
            />
            <button className="btn lime" onClick={create}>
              {busy === 'create' ? <span className="spinner" /> : <Icon name="sparkle" />} Create Website
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="site-view">
        <div className="row wrap" style={{ justifyContent: 'flex-end', marginBottom: 4, alignItems: 'center' }}>
          {sites.length > 1 && (
            <select
              className="slug-in"
              style={{ marginRight: 'auto', maxWidth: 320 }}
              value={site.id}
              aria-label="Switch generated site"
              onChange={(e) => pickSite(e.target.value)}
            >
              {[...sites].reverse().map((s, i) => (
                <option key={s.id} value={s.id}>
                  {`Site ${sites.length - i} — ${fmtDate(s.createdAt)}${s.producedFrom?.campaignTitle ? ` · from “${s.producedFrom.campaignTitle}”` : ''}`}
                </option>
              ))}
            </select>
          )}
          <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'off'} label="Taste graph" />
        </div>

        <VersionTabs
          versions={versions}
          activeId={active?.id}
          onPick={setVid}
          busy={busy === 'edit'}
          onRegenerate={() => edit('Regenerate the site with a fresh variation of layout and copy')}
        />

        <div className="toolbar mb16">
          {editOpen ? (
            <>
              <input
                className="site-prompt"
                autoFocus
                value={prompt}
                placeholder="Describe the change (e.g. darker hero, add testimonials section)…"
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && edit()}
              />
              <button className="btn lime sm" disabled={busy === 'edit'} onClick={() => edit()}>
                {busy === 'edit' ? <span className="spinner" /> : <Icon name="send" />} {busy === 'edit' ? 'Editing…' : 'Apply'}
              </button>
              <button className="btn ghost sm" onClick={() => setEditOpen(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn ghost sm" disabled={busy === 'edit'} onClick={() => setEditOpen(true)}>
                <Icon name="edit" /> Edit
              </button>
              <button className="btn ghost sm" disabled={busy === 'edit'}
                onClick={() => edit('Regenerate the site with a fresh variation of layout and copy')}>
                {busy === 'edit' ? <span className="spinner" /> : <Icon name="refresh" />} Regenerate
              </button>
              <button className="btn ghost sm" onClick={previewNewTab}>
                <Icon name="eye" /> Preview in New Tab
              </button>
              <span className="grow" />
              <button className="btn ghost sm" disabled={busy === 'del'} onClick={delVersion}>
                {busy === 'del' ? <span className="spinner" /> : <Icon name="trash" />} Delete version
              </button>
            </>
          )}
        </div>

        <div className="preview-frame">
          {busy === 'edit' ? (
            <div className="loading-wrap" style={{ height: '100%', background: 'var(--card)' }}>
              <div className="spinner" />
              <div className="muted">{stageNote}</div>
            </div>
          ) : active ? (
            <iframe title="site preview" srcDoc={active.html} sandbox="" />
          ) : (
            <div className="empty" style={{ height: '100%', background: 'var(--card)' }}>No version selected — pick one above.</div>
          )}
        </div>

        <div className="mt8">
          <PublishBar
            publishedSlug={site.publishedSlug}
            base="/s/"
            label="this site"
            busy={busy === 'pub'}
            onPublish={publish}
            onUnpublish={unpublish}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="section view ws-view">
      <div className="view-head">
        <div className="vh-main">
          <span className="vh-kicker">MARQUE / SITES</span>
          <h1 className="display">Websites</h1>
          <p className="sub">Audit your live site against competitors — or generate a new one from your Business Profile.</p>
        </div>
        <div className="vh-side">
          <div className="seg-tabs" role="tablist" aria-label="Websites sections" onKeyDown={onTabsKey}>
            <button role="tab" id="ws-tab-improve" aria-selected={tab === 'improve'} aria-controls="ws-panel"
              tabIndex={tab === 'improve' ? 0 : -1} ref={tabBtn.improve}
              className={tab === 'improve' ? 'on' : ''}
              onClick={() => goTab('improve')}>Improve my site</button>
            <button role="tab" id="ws-tab-site" aria-selected={tab === 'site'} aria-controls="ws-panel"
              tabIndex={tab === 'site' ? 0 : -1} ref={tabBtn.site}
              className={tab === 'site' ? 'on' : ''}
              onClick={() => goTab('site')}>Your website</button>
          </div>
        </div>
      </div>

      <div id="ws-panel" role="tabpanel" className="ws-panel" aria-labelledby={`ws-tab-${tab}`}>
        {tab === 'improve' ? renderImprove() : renderSite()}
      </div>
    </div>
  );
}
