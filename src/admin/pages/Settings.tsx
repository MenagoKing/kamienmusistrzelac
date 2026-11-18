import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { BAND_NAME, BANDS } from '../../../shared/rules.ts';
import type { Band, Rules } from '../../../shared/types.ts';
import { Card, Confirm, ErrorBox, Field, Loading, PageHead, Segmented, Toggle, money, useAction, useFetch } from '../ui';

const P = (x: number) => Math.round(x * 10000) / 100; // 0.85 -> 85
const F = (s: string) => Number(s) / 100;

export function Settings() {
  const d = useFetch<Rules>('/api/admin/settings');
  const tok = useFetch<{ enabled: boolean; source: string; price_usd: number | null; samples: number; error: string | null }>('/api/admin/token', [d.data]);
  const [r, setR] = useState<Rules | null>(null);
  const [country, setCountry] = useState('');
  const [reset, setReset] = useState(false);
  const { busy, run } = useAction();
  useEffect(() => { if (d.data) setR(d.data); }, [d.data]);

  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!r) return <Loading />;
  const set = (patch: Partial<Rules>) => setR({ ...r, ...patch });
  const setBand = (b: Band, k: 'min' | 'max' | 'count', v: string) => setR({ ...r, bands: { ...r.bands, [b]: { ...r.bands[b], [k]: k === 'count' ? Number(v) : v === '' ? null : F(v) } } });
  const edge = r.edge_split.rocks_buyback + r.edge_split.launch_reserve + r.edge_split.ops;
  const edgeOk = Math.abs(edge - (1 - r.ev_target)) < 0.0001;
  const totalCount = BANDS.reduce((a, b) => a + r.bands[b].count, 0);
  const dirty = JSON.stringify(r) !== JSON.stringify(d.data);
  const save = async () => { const x = await run(() => api<Rules>('PUT', '/api/admin/settings', r), 'Settings saved'); if (x) { d.setData(x); tok.reload(); } };

  return (
    <>
      <PageHead kicker="System" title="Rules & settings">
        <button className="ab ghost" disabled={!dirty || busy} onClick={() => setR(d.data)}>Discard</button>
        <button className="ab primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </PageHead>
      <p className="lede">All numbers are proposals until confirmed. Changes apply to new sales immediately; sealed series keep the composition they were opened with.</p>

      <div className="grid2">
        <Card title="Market commission and buyback">
          <div className="form-grid">
            <Field label="Market commission, %" hint={`List price = dealer price × ${r.market_markup}. $100 rock → ${money(100 * r.market_markup)}. On cancel the rock price is refunded, the commission kept.`}><input type="number" step="0.5" value={P(r.market_markup) - 100} onChange={e => set({ market_markup: 1 + F(e.target.value) })} /></Field>
            <Field label="Instant buyback, % of rock value" hint="Pack pulls (own stock) only. Paid in USDC; must stay below 100%."><input type="number" step="0.5" value={P(r.buyback_share)} onChange={e => set({ buyback_share: F(e.target.value) })} /></Field>
            <Field label="Secondary royalty, %" hint="Metaplex Core royalty, goes to inventory"><input type="number" step="0.5" value={P(r.royalty)} onChange={e => set({ royalty: F(e.target.value) })} /></Field>
          </div>
        </Card>

        <Card title="Pack economics">
          <div className="form-grid">
            <Field label="EV target, %" hint="Vault value returned per pack dollar"><input type="number" step="0.5" value={P(r.ev_target)} onChange={e => set({ ev_target: F(e.target.value) })} /></Field>
            <Field label="Series size" hint="Packs in a standard series"><input type="number" value={r.series_size} onChange={e => set({ series_size: Number(e.target.value) })} /></Field>
          </div>
          <h3 className="ed-h">Edge split <span className={'fileq' + (edgeOk ? ' ok' : '')}>{P(edge)}% of {P(1 - r.ev_target)}%</span></h3>
          <div className="form-grid">
            <Field label="$ROCKS buyback & burn, %" hint="Reserved until the token launches"><input type="number" step="0.5" value={P(r.edge_split.rocks_buyback)} onChange={e => set({ edge_split: { ...r.edge_split, rocks_buyback: F(e.target.value) } })} /></Field>
            <Field label="Launch reserve, %" hint="Funds locked drop specimens"><input type="number" step="0.5" value={P(r.edge_split.launch_reserve)} onChange={e => set({ edge_split: { ...r.edge_split, launch_reserve: F(e.target.value) } })} /></Field>
            <Field label="Operations, %" hint="Vault, certificates, slicing, capsules"><input type="number" step="0.5" value={P(r.edge_split.ops)} onChange={e => set({ edge_split: { ...r.edge_split, ops: F(e.target.value) } })} /></Field>
          </div>
          {!edgeOk && <p className="warnline">The three shares must add up to 100% − EV target.</p>}
        </Card>
      </div>

      <Card title="Value bands" actions={<span className={'fileq' + (totalCount === r.series_size ? ' ok' : '')}>{totalCount} of {r.series_size} packs</span>}>
        <table className="tbl bandtbl">
          <thead><tr><th>Band</th><th>From, % of pack price</th><th>To, %</th><th>Packs per series</th></tr></thead>
          <tbody>{BANDS.map(b => (
            <tr key={b}>
              <td><span className="mono"><i className={'dotb b-' + b} />{BAND_NAME[b]}</span></td>
              <td><input type="number" step="1" value={P(r.bands[b].min)} onChange={e => setBand(b, 'min', e.target.value)} /></td>
              <td><input type="number" step="1" value={r.bands[b].max == null ? '' : P(r.bands[b].max!)} placeholder="open-ended" onChange={e => setBand(b, 'max', e.target.value)} /></td>
              <td><input type="number" value={r.bands[b].count} onChange={e => setBand(b, 'count', e.target.value)} /></td>
            </tr>
          ))}</tbody>
        </table>
        <p className="dim small">The site's band list, the FAQ figures computed from rules, and every composition check read these values.</p>
      </Card>

      <div className="grid2">
        <Card title="Redemption and shipping">
          <div className="form-grid">
            <Field label="Handling fee, USD"><input type="number" value={r.handling_fee_usd} onChange={e => set({ handling_fee_usd: Number(e.target.value) })} /></Field>
            <Field label="Insured shipping, USD" hint="Flat estimate charged at cost"><input type="number" value={r.shipping_usd} onChange={e => set({ shipping_usd: Number(e.target.value) })} /></Field>
          </div>
          <h3 className="ed-h">Ship-to countries <span className="mono dim">{r.shipping_countries.length}</span></h3>
          <div className="cchips">
            {r.shipping_countries.map(c => <span key={c} className="cchip">{c}<button onClick={() => set({ shipping_countries: r.shipping_countries.filter(x => x !== c) })} aria-label={'Remove ' + c}>×</button></span>)}
            <form onSubmit={e => { e.preventDefault(); const c = country.trim().toUpperCase(); if (/^[A-Z]{2}$/.test(c) && !r.shipping_countries.includes(c)) set({ shipping_countries: [...r.shipping_countries, c] }); setCountry(''); }}>
              <input value={country} onChange={e => setCountry(e.target.value)} placeholder="Add ISO code, e.g. MX" maxLength={2} />
            </form>
          </div>
          <p className="dim small">Customs and sanctions screening happen before a country is added.</p>
        </Card>

        <Card title="Sign in with Google">
          <div className="form-grid">
            <Field label="Google OAuth client ID" span={3} hint={<>Create it in Google Cloud Console › APIs &amp; Services › Credentials › OAuth client ID › Web application. Add your site address (and http://localhost:5173 for testing) under Authorized JavaScript origins. Only the public client ID goes here; no secret is needed.</>}>
              <input value={r.google_client_id} onChange={e => set({ google_client_id: e.target.value })} placeholder="1234567890-abc123.apps.googleusercontent.com" />
            </Field>
          </div>
          <p className="dim small">{r.google_client_id ? 'Google sign-in is on: the button appears on the sign-in screen.' : 'Off until a client ID is saved. The sign-in screen shows the button and explains it is not switched on yet.'}</p>
        </Card>

        <Card title="Chain and site">
          <div className="form-grid">
            <Field label="SOL price fallback, USD" hint="SOL quotes use a live 5-minute average from Jupiter; this is used only when it is unavailable."><input type="number" step="0.01" value={r.sol_usd} onChange={e => set({ sol_usd: Number(e.target.value) })} /></Field>
          </div>
          <div className="tgls">
            <Toggle checked={r.demo_wallet} onChange={v => set({ demo_wallet: v })} label="Demo wallet" hint="Lets visitors try the full flow without a wallet extension. Turn off at launch." />
            <Toggle checked={r.sample_notice} onChange={v => set({ sample_notice: v })} label="“Sample data on this page” in the footer" hint="Remove at launch." />
            <Toggle checked={r.market_funds_buyback} onChange={v => set({ market_funds_buyback: v })} label="Market revenue also funds the $ROCKS buyback" hint="Open decision 4. Off = pack sales only." />
          </div>
        </Card>
      </div>

      <div className="grid2">
        <Card title="Dealer sourcing">
          <div className="form-grid">
            <Field label="Max age of a dealer price, hours" hint="Checkout refuses a dealer price checked longer ago than this, until you mark it verified. 0 = off."><input type="number" min={0} value={r.source_max_age_hours} onChange={e => set({ source_max_age_hours: Number(e.target.value) })} /></Field>
          </div>
          <p className="dim small">Dealers, their shipping rates and CSV imports are under Inventory › Dealers. Redemption shipping for dealer specimens comes from the dealer’s rates, not the flat fee above.</p>
        </Card>
        <Card title={<>Pay with ${r.token_symbol || 'token'} <span className="mono dim">{r.token_enabled ? 'on' : 'dormant'}</span></>}>
          <div className="tgls"><Toggle checked={r.token_enabled} onChange={v => set({ token_enabled: v })} label="Accept the token at checkout" hint="Off until the token exists. Market reservations only." /></div>
          <div className="form-grid">
            <Field label="Symbol"><input value={r.token_symbol} onChange={e => set({ token_symbol: e.target.value.toUpperCase().slice(0, 10) })} /></Field>
            <Field label="Decimals"><input type="number" value={r.token_decimals} onChange={e => set({ token_decimals: Number(e.target.value) })} /></Field>
            <Field label="Mint address" span={3}><input value={r.token_mint} onChange={e => set({ token_mint: e.target.value.trim() })} placeholder="Set once the token is created" /></Field>
            <Field label="Discount for paying in token, %"><input type="number" step="0.5" value={P(r.token_discount)} onChange={e => set({ token_discount: F(e.target.value) })} /></Field>
            <Field label="Share of commission to burn, %" hint="Reserved per token sale"><input type="number" step="1" value={P(r.token_burn_share)} onChange={e => set({ token_burn_share: F(e.target.value) })} /></Field>
            <Field label="Price source" span={3} hint="Price = average of the last 5 minutes (sampled every 30 s)"><Segmented<'manual' | 'jupiter'> value={r.token_price_source} onChange={v => set({ token_price_source: v })} options={[['manual', 'Manual'], ['jupiter', 'Jupiter (live)']]} /></Field>
            {r.token_price_source === 'manual' && <Field label="Token price, USD"><input type="number" step="0.000001" value={r.token_manual_price_usd} onChange={e => set({ token_manual_price_usd: Number(e.target.value) })} /></Field>}
          </div>
          <p className="dim small">{tok.data ? (tok.data.price_usd != null ? `Current price ${tok.data.price_usd} USD (${tok.data.samples} samples).` : tok.data.error ? 'No price: ' + tok.data.error : 'No price yet.') : ''}</p>
        </Card>
      </div>

      <Card title="Danger zone" className="danger-card">
        <div className="dz">
          <div><b>Reset demo data</b><p className="dim">Wipes every specimen, series, drop, order and wallet and loads the sample data again. Admin sessions stay.</p></div>
          <button className="ab danger" onClick={() => setReset(true)}>Reset demo data</button>
        </div>
      </Card>
      {reset && <Confirm danger title="Reset all data?" body={<p>Everything in the database is replaced with the sample data. This cannot be undone.</p>} cta="Reset everything" onClose={() => setReset(false)} onConfirm={async () => { await run(() => api('POST', '/api/admin/reseed', {}), 'Demo data restored'); d.reload(); }} />}
    </>
  );
}
