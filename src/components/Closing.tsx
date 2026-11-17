import { useState, type FormEvent } from 'react';
import { joinWaitlist } from '../data';
import { Logo } from './Logo';

/** §06 $ROCKS */
export function Token() {
  return (
    <section className="s wrap" id="rocks" aria-labelledby="h-rocks">
      <div className="intro rv">
        <div><div className="sec mono"><span>§06</span><span>$ROCKS</span></div><h2 id="h-rocks">The token buys the rocks.</h2></div>
        <p>$ROCKS funds the first inventory and rewards the people who show up early. It does one more thing: every pack sale buys some of it back.</p>
      </div>
      <div className="tok">
        <ul className="pts rv">
          <li><b className="mono">01</b><span>Launched on pump.fun to fund the first inventory, shown with invoices and photos before or at launch.</span></li>
          <li><b className="mono">02</b><span>Holders above a set balance open every launch drop 30 minutes early.</span></li>
          <li><b className="mono">03</b><span>A share of every pack sale buys $ROCKS on the market and burns it, on a public dashboard.</span></li>
          <li className="no"><b className="mono">04</b><span>It is not a share of the vault: no yield, no revenue share, no claim on any rock.</span></li>
        </ul>
        <div className="ledger rv">
          <div className="mono" style={{ color: 'var(--mute)' }}>Token</div><div className="tk">$ROCKS</div>
          <div className="row" style={{ marginTop: 22 }}><span>Launch</span><span>pump.fun</span></div>
          <div className="row"><span>First inventory</span><span>shown before launch</span></div>
          <div className="row"><span>Buyback and burn</span><span>live at launch</span></div>
          <div className="row"><span>Early access</span><span>30 min per drop</span></div>
        </div>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ['Is every specimen a real meteorite?', 'Yes. Each one has an official name and classification listed in the Meteoritical Bulletin, a weigh-in on video, a certificate, and provenance and export papers. No file, no listing.'],
  ['Is the market random?', 'No. Every listed specimen has one fixed price, set from its documented purchase price. You see the exact rock you buy before you pay.'],
  ['What can a pack be worth?', 'Every pack lands in a band. Floor: 70 to 85% of the pack price in vault value, never below 70%. Par: 90 to 120%. Hit: 150% or more. Each sealed series of 100 holds exactly 78, 19 and 3, published before sale opens, with live counts of what’s left.'],
  ['What happens to a rock I sell back?', 'You get 85% of its vault value in USDC, instantly. The rock goes into the next unopened series, never the one on sale, so every published count stays exact.'],
  ['Can I get the actual rock?', 'Yes. Burn the NFT and we ship the sealed capsule to you, insured, to the countries we can ship to. Shipping is charged at cost plus a handling fee.'],
  ['What happens if a launch is scrubbed?', 'The locked specimens roll over to the next drop, so it grows. Packs you opened stay yours.'],
  ['What is $ROCKS for?', 'Early access to launch drops, and a buyback and burn funded by pack sales. It is not a claim on the vault or on any rock.'],
];

/** §07 Questions (native details/summary; the first one open). */
export function Faq() {
  return (
    <section className="s wrap" id="faq" aria-labelledby="h-faq">
      <div className="sec mono rv"><span>§07</span><span>Questions</span></div><h2 id="h-faq" className="rv">Before you buy.</h2>
      <div className="faq rv">
        {FAQ.map(([q, a], i) => (
          <details key={i} open={i === 0}><summary>{q}<i aria-hidden="true" /></summary><p>{a}</p></details>
        ))}
      </div>
    </section>
  );
}

/** Waitlist form. */
export function Join() {
  const [ok, setOk] = useState('');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = (e.currentTarget.elements.namedItem('em') as HTMLInputElement).value;
    joinWaitlist(email).then(() => setOk('You’re on the list. We’ll write when the vault opens.'));
  };
  return (
    <section className="final wrap" id="join" aria-labelledby="h-join">
      <div className="sec mono" style={{ justifyContent: 'center' }}>Waitlist</div>
      <h2 id="h-join">The next one is already falling.</h2><p>We’ll write when the vault opens and when the next launch drop is set. Nothing else.</p>
      <form className="form" id="wl" onSubmit={submit}>
        <label htmlFor="em" className="sr">Email address</label>
        <input id="em" type="email" placeholder="you@email.com" autoComplete="email" required />
        <button className="btn" type="submit">Join the waitlist</button>
      </form>
      <p className="mono" id="wlok" role="status" style={{ marginTop: 16, fontSize: 12, color: 'var(--dust2)' }}>{ok}</p>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="wrap">
      <div className="foot">
        <div><Logo height={36} /><p>Real meteorites, vaulted and minted on Solana.</p></div>
        <div><h5>Product</h5><ul><li><a href="#market">Market</a></li><li><a href="#packs">Packs</a></li><li><a href="#drops">Launch drops</a></li><li><a href="#vault">The vault</a></li><li><a href="#rocks">$ROCKS</a></li></ul></div>
        <div><h5>Help</h5><ul><li><a href="#faq">FAQ</a></li><li><a href="#packs">Pack bands and series</a></li><li><a href="#after">Shipping and redemption</a></li></ul></div>
        {/* TODO: Terms and Privacy pages. They point to the top for now. */}
        <div><h5>Legal</h5><ul><li><a href="#top">Terms</a></li><li><a href="#top">Privacy</a></li></ul></div>
      </div>
      {/* Remove "Sample data on this page" at launch (HANDOFF). */}
      <div className="base mono"><span>© 2026 Space Rocks</span><span>Sample data on this page</span></div>
    </footer>
  );
}
