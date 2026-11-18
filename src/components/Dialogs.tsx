import type { Dialog } from '../lib/store';
import { AuthDialog } from './WalletDialog';
import { BuyDialog, BuyListingDialog, PackDialog, PackOpening, RevealDialog } from './Checkout';
import { ItemDialog, ListDialog, RedeemDialog, ShareDialog } from './Account';
import { ProofDialog, RegisterDialog } from './Explore';

/** Renders whichever dialog is open (site and account page share them). */
export function DialogHost({ d }: { d: Dialog | null }) {
  if (!d) return null;
  switch (d.kind) {
    case 'auth': return <AuthDialog mode={d.mode} then={d.then} />;
    case 'buy': return <BuyDialog specimen={d.specimen} />;
    case 'buy-listing': return <BuyListingDialog listing={d.listing} />;
    case 'pack': return <PackDialog series={d.series} />;
    case 'opening': return <PackOpening key={d.seed} series={d.series} currency={d.currency} seed={d.seed} />;
    case 'reveal': return <RevealDialog key={d.reveal.specimen.id} reveal={d.reveal} payment={d.payment} mint={d.mint} via={d.via} reservation={d.reservation} confirm={d.confirm} />;
    case 'item': return <ItemDialog holding={d.holding} />;
    case 'list': return <ListDialog holding={d.holding} />;
    case 'redeem': return <RedeemDialog specimen={d.specimen} reservation={d.reservation ?? ('reservation' in d.specimen ? d.specimen.reservation : null)} />;
    case 'share': return <ShareDialog reveal={d.reveal} />;
    case 'register': return <RegisterDialog />;
    case 'proof': return <ProofDialog seriesId={d.seriesId} name={d.name} />;
  }
}
