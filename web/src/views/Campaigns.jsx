import React, { useEffect, useMemo, useState } from 'react';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Composer, { KebabMenu } from '../components/Composer.jsx';
import CreativeCard from '../components/CreativeCard.jsx';
import CreativeEditor from '../components/CreativeEditor.jsx';
import EvidenceDrawer from '../components/EvidenceDrawer.jsx';
import { QlooBadge, SignalChips } from '../components/Qloo.jsx';
import './studio.css';

const SEASONS = ['Spring', 'Summer', 'Autumn', 'Holiday'];
const season = () => SEASONS[Math.min(3, Math.floor(((new Date().getMonth() + 1) % 12) / 3))];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// Client-side "Suggestions based on Business Profile" cards.
function buildSuggestions(p) {
  if (!p) return [];
  const out = [];
  const prod = (p.catalog || [])[0];
  const s = season();
  const value = cap((p.values || [])[0]) || 'quality';
  const aest = (p.aesthetic || [])[0] || 'clean';
  out.push({
    id: 'seasonal',
    title: `${s} spotlight for ${p.name || 'your brand'}.`,
    body: `A timely ${s.toLowerCase()} push — "${p.tagline || p.description || 'your story'}" — aimed at ${p.audience || 'your customers'}.`,
    prompt: `Create a ${s.toLowerCase()} campaign for ${p.name || 'our brand'} (${p.tagline || ''}) targeting ${p.audience || 'our customers'}, tone: ${(p.tone || []).join(', ') || 'on-brand'}.`,
  });
  if (prod) {
    out.push({
      id: 'hero',
      title: `Hero ${prod.name}.`,
      body: `Put ${prod.name} front and center — ${prod.description || 'the product story'} for ${p.audience || 'your audience'}.`,
      prompt: `Create a product-hero campaign around ${prod.name}${prod.description ? ` — ${prod.description}` : ''}.`,
      productId: prod.id,
    });
  }
  out.push({
    id: 'value',
    title: `${value}, the ${aest} way.`,
    body: `Lead with the value your audience cares about — ${value.toLowerCase()} — expressed through a ${aest} aesthetic.`,
    prompt: `Create a brand-values campaign for ${p.name || 'our brand'} about ${value.toLowerCase()}, in a ${aest} visual style.`,
  });
  return out.slice(0, 3);
}

export default function Campaigns() {
  const { profile, say, status } = useApp();
  const [campaigns, setCampaigns] = useState(null);
  const [openId, setOpenId] = useState(null);        // campaign detail view
  const [brief, setBrief] = useState(null);          // {brief, suggestions, qlooSignals}
  const [draft, setDraft] = useState(null);          // composer payload that produced the brief
  const [seed, setSeed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [dismissed, setDismissed] = useState(() => new Set());
  const [editing, setEditing] = useState(null);      // creative in the editor modal
  const [animating, setAnimating] = useState('');    // creative id currently animating
  const [evi, setEvi] = useState(false);

  const reload = async () => {
    try { setCampaigns((await api.listCampaigns()).campaigns || []); }
    catch (e) { say(e.message); setCampaigns([]); }
  };
  useEffect(() => { reload(); }, []);

  // Strategy board handoff: 'marque.strategyBrief' prefills the composer once, then is consumed.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('marque.strategyBrief');
      if (!raw) return;
      sessionStorage.removeItem('marque.strategyBrief');
      const data = JSON.parse(raw);
      const text = typeof data === 'string' ? data : data?.prompt;
      if (text) {
        setSeed({ text });
        say('Strategy loaded — review the prompt and generate the brief');
      }
    } catch { /* malformed stash — ignore */ }
  }, []);

  const suggestions = useMemo(() => buildSuggestions(profile).filter((s) => !dismissed.has(s.id)), [profile, dismissed]);
  const open = (campaigns || []).find((c) => c.id === openId) || null;

  // Generate Brief → brief review card
  const genBrief = async (payload) => {
    if (busy) return;
    setBusy(true); setNote('Drafting your campaign brief…');
    try {
      const res = await api.campaignBrief(payload);
      setBrief(res);
      setDraft(payload);
    } catch (e) { say(e.message); }
    setBusy(false); setNote('');
  };

  // Confirm brief → createCampaign → job (rotating stage copy) → refresh
  const confirmBrief = async () => {
    if (!brief?.brief) return;
    const STAGES = ['Crafting your creatives…', 'Laying out formats…', 'Finalizing assets…'];
    let si = 0;
    setBusy(true); setNote(STAGES[0]);
    const rot = setInterval(() => { si = (si + 1) % STAGES.length; setNote(STAGES[si]); }, 2800);
    try {
      const { campaign, job } = await api.createCampaign({
        brief: brief.brief,
        productId: draft?.productId,
        ingredients: draft?.ingredients,
        aspectRatio: draft?.aspectRatio,
        qlooSignals: brief.qlooSignals,   // server persists these onto the campaign
      });
      if (job?.id) {
        await pollJob(job.id).catch((e) => say(e.message));
      }
      await reload();
      setBrief(null);
      if (campaign?.id) setOpenId(campaign.id);
      say('Campaign ready');
    } catch (e) { say(e.message); }
    clearInterval(rot);
    setBusy(false); setNote('');
  };

  // Card-level animate shortcut (9:16 only — CreativeCard hides it otherwise).
  const animateOne = async (creative) => {
    setAnimating(creative.id);
    try {
      const { job } = await api.animateCreative(creative.id);
      await pollJob(job.id);
      await reload();
      say('Animation ready — open the creative to watch it');
    } catch (e) { say(e.message); }
    setAnimating('');
  };

  // ---------- detail: creative grid ----------
  if (open) {
    return (
      <div className="section" style={{ paddingBottom: 80 }}>
        <div className="page-head" style={{ textAlign: 'left', padding: '30px 0 18px' }}>
          <button className="btn ghost sm mb8" onClick={() => setOpenId(null)}>
            ← All campaigns
          </button>
          <h2 className="display" style={{ fontSize: 34 }}>{open.brief?.title || 'Campaign'}</h2>
          {open.brief?.angle && <p className="sub" style={{ margin: 0, maxWidth: 640 }}>{open.brief.angle}</p>}
          <div className="row wrap mt8">
            {(open.brief?.channels || []).map((c) => <span key={c} className="chan-chip">{c}</span>)}
            <span className="chan-chip">{open.aspectRatio || '1:1'}</span>
            <SignalChips signals={open.qlooSignals || []} />
            <button className="btn ghost sm" onClick={() => setEvi(true)}>
              <Icon name="qloo" size={14} /> Evidence
            </button>
          </div>
        </div>
        <div className="creative-grid">
          {(open.creatives || []).map((cr) => (
            <CreativeCard
              key={cr.id}
              creative={cr}
              aspect={open.aspectRatio}
              animating={animating === cr.id}
              onEdit={setEditing}
              onAnimate={animateOne}
            />
          ))}
        </div>
        {!(open.creatives || []).length && (
          <div className="empty">
            <p>No creatives yet — generation may still be running.</p>
            <button className="btn ghost sm" onClick={reload}>
              <Icon name="refresh" size={13} /> Check again
            </button>
          </div>
        )}
        {editing && (
          <CreativeEditor
            creative={editing}
            campaign={open}
            onClose={() => setEditing(null)}
            onSaved={() => reload()}
          />
        )}
        {evi && <EvidenceDrawer signals={open.qlooSignals || []} onClose={() => setEvi(false)} />}
      </div>
    );
  }

  // ---------- landing ----------
  return (
    <div className="section" style={{ paddingBottom: 80 }}>
      <div className="page-head">
        <h1 className="display">Campaigns</h1>
        <p className="sub">Start from our suggestions or prompt to create a new campaign.</p>
      </div>

      <Composer seed={seed} busy={busy} note={note} onGenerate={genBrief} />

      {brief?.brief && (
        <div className="card pad brief-card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h3>{brief.brief.title || 'Campaign brief'}</h3>
            <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'demo'} />
          </div>
          <div className="brief-field"><span className="k">Angle</span><span className="v">{brief.brief.angle}</span></div>
          <div className="brief-field"><span className="k">Audience</span><span className="v">{brief.brief.audience}</span></div>
          <div className="brief-field"><span className="k">Key message</span><span className="v">{brief.brief.keyMessage}</span></div>
          <div className="brief-field">
            <span className="k">Channels</span>
            <span className="v chip-row">{(brief.brief.channels || []).map((c) => <span key={c} className="chan-chip">{c}</span>)}</span>
          </div>
          {!!brief.qlooSignals?.length && (
            <div className="brief-field">
              <span className="k">Taste signals</span>
              <span className="v"><SignalChips signals={brief.qlooSignals} max={6} /></span>
            </div>
          )}
          {!!brief.suggestions?.length && (
            <div className="brief-field">
              <span className="k">Alternatives</span>
              <span className="v" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {brief.suggestions.map((s, i) => (
                  <button key={i} className="btn ghost sm" style={{ justifyContent: 'flex-start' }}
                    title={s.keyMessage}
                    onClick={() => setBrief((b) => ({ ...b, brief: { ...b.brief, title: s.title || b.brief.title, angle: s.angle || b.brief.angle, keyMessage: s.keyMessage || b.brief.keyMessage } }))}>
                    {s.title}{s.angle ? ` — ${s.angle}` : ''}
                  </button>
                ))}
              </span>
            </div>
          )}
          <div className="row mt16" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn ghost" onClick={() => setBrief(null)}>Discard</button>
            <button className="btn lime" disabled={busy} onClick={confirmBrief}>
              <Icon name="check" /> Confirm — generate creatives
            </button>
          </div>
        </div>
      )}

      {!!suggestions.length && (
        <>
          <div className="section-label">Suggestions based on Business Profile</div>
          <div className="grid c3">
            {suggestions.map((s) => (
              <div key={s.id} className="card suggest-card">
                <KebabMenu items={[
                  { label: 'Use', onClick: () => { setSeed({ text: s.prompt }); genBrief({ prompt: s.prompt, productId: s.productId }); } },
                  { label: 'Dismiss', onClick: () => setDismissed((d) => new Set(d).add(s.id)) },
                ]} />
                <h4>{s.title}</h4>
                <p>{s.body}</p>
                <div className="mt16">
                  <button className="btn ghost sm" disabled={busy}
                    onClick={() => { setSeed({ text: s.prompt }); genBrief({ prompt: s.prompt, productId: s.productId }); }}>
                    <Icon name="sparkle" size={14} /> Use
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-label">Your campaigns</div>
      {campaigns === null ? (
        <div className="grid c2">
          {[0, 1].map((i) => (
            <div key={i} className="card camp-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="skel skel-line w55" style={{ height: 15 }} />
                <span className="skel" style={{ width: 34, height: 20, borderRadius: 999 }} />
              </div>
              <span className="skel skel-line w85" />
              <div className="chip-row mt8">
                <span className="skel" style={{ width: 52, height: 20, borderRadius: 999 }} />
                <span className="skel" style={{ width: 64, height: 20, borderRadius: 999 }} />
              </div>
              <div className="thumbs">
                {[0, 1, 2, 3].map((j) => <span key={j} className="media-tile skel" />)}
              </div>
            </div>
          ))}
        </div>
      ) : campaigns.length ? (
        <div className="grid c2">
          {campaigns.map((c) => (
            <div key={c.id} className="card camp-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h4>{c.brief?.title || 'Untitled campaign'}</h4>
                <span className="chan-chip">{c.aspectRatio || '1:1'}</span>
              </div>
              {c.brief?.angle && <p className="muted small" style={{ margin: 0 }}>{c.brief.angle}</p>}
              <div className="chip-row mt8">
                {(c.brief?.channels || []).map((ch) => <span key={ch} className="chan-chip">{ch}</span>)}
                <SignalChips signals={c.qlooSignals || []} max={3} />
              </div>
              {!!c.creatives?.length && (
                <div className="thumbs">
                  {c.creatives.slice(0, 4).map((cr) => (
                    <span key={cr.id} className="media-tile">{cr.imagePath && <img src={cr.imagePath} alt="" loading="lazy" />}</span>
                  ))}
                  {c.creatives.length > 4 && <span className="more">+{c.creatives.length - 4}</span>}
                </div>
              )}
              <div className="foot">
                <span className="muted small">{c.creatives?.length || 0} creatives</span>
                <span className="grow" />
                <button className="btn sm" onClick={() => setOpenId(c.id)}>Open</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>No campaigns yet — generate a brief above to get started.</p>
          <button className="btn ghost sm" onClick={() => document.querySelector('.composer textarea')?.focus()}>
            <Icon name="sparkle" size={13} /> Start a brief
          </button>
        </div>
      )}
    </div>
  );
}
