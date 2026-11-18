// App state for the site and the account page: page data, the signed-in collector, the open dialog, toasts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getMe, getPageData, type Currency, type Holding, type Listing, type Me, type PackReveal, type PageData, type Reservation, type Series, type Specimen, type TxResult } from '../data';

export type Dialog =
  | { kind: 'auth'; mode?: 'login' | 'register'; then?: Dialog }
  | { kind: 'buy'; specimen: Specimen }
  | { kind: 'buy-listing'; listing: Listing }
  | { kind: 'pack'; series: Series }
  | { kind: 'opening'; series: Series; currency: Currency; seed: string }
  | { kind: 'reveal'; reveal: PackReveal; payment?: TxResult; mint?: string; via: 'pack' | 'market' | 'holding'; reservation?: Reservation | null; confirm?: boolean }
  | { kind: 'item'; holding: Holding }
  | { kind: 'list'; holding: Holding }
  | { kind: 'redeem'; specimen: Holding | PackReveal['specimen']; reservation?: Reservation | null }
  | { kind: 'share'; reveal: PackReveal }
  | { kind: 'register' }
  | { kind: 'game' }
  | { kind: 'proof'; seriesId: string; name: string };

interface Toast { id: number; text: string; tone: 'ok' | 'err' }

interface Ctx {
  data: PageData;
  me: Me | null;
  meLoaded: boolean;
  dialog: Dialog | null;
  open: (d: Dialog) => void;
  close: () => void;
  /** Opens d, asking the visitor to sign in first if needed. */
  withWallet: (d: Dialog) => void;
  refresh: () => Promise<void>;
  toast: (text: string, tone?: Toast['tone']) => void;
  toasts: Toast[];
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ initial, children }: { initial: PageData; children: ReactNode }) {
  const [data, setData] = useState(initial);
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++seq.current;
    setToasts(t => [...t, { id, text, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    const [d, m] = await Promise.all([getPageData().catch(() => null), getMe().catch(() => null)]);
    if (d) setData(d);
    setMe(m);
    setMeLoaded(true);
  }, []);

  useEffect(() => {
    getMe().then(setMe).catch(() => setMe(null)).finally(() => setMeLoaded(true));
  }, []);

  const meRef = useRef(me);
  meRef.current = me;

  const value = useMemo<Ctx>(() => ({
    data, me, meLoaded, dialog, toasts, toast, refresh,
    open: d => setDialog(d),
    close: () => setDialog(null),
    withWallet: d => setDialog(meRef.current ? d : { kind: 'auth', then: d }),
  }), [data, me, meLoaded, dialog, toasts, toast, refresh]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

/** Display name for the signed-in collector. */
export const callsign = (me: Me | null) => {
  if (!me) return '';
  const a = me.profile.wallet ?? me.address;
  return me.profile.username ?? a.slice(0, 4) + '…' + a.slice(-4);
};
