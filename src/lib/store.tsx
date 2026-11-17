// App state for the site: page data, the signed-in wallet, the open dialog and toasts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getMe, getPageData, type Holding, type Me, type PackReveal, type PageData, type Series, type Specimen, type TxResult } from '../data';

export type Dialog =
  | { kind: 'wallet'; then?: Dialog }
  | { kind: 'buy'; specimen: Specimen }
  | { kind: 'pack'; series: Series }
  | { kind: 'reveal'; reveal: PackReveal; payment?: TxResult; mint?: string; via: 'pack' | 'market' | 'holding' }
  | { kind: 'redeem'; specimen: Holding | PackReveal['specimen'] }
  | { kind: 'share'; reveal: PackReveal }
  | { kind: 'register' }
  | { kind: 'proof'; seriesId: string; name: string }
  | { kind: 'account'; tab?: 'holdings' | 'pulls' | 'redemptions' };

interface Toast { id: number; text: string; tone: 'ok' | 'err' }

interface Ctx {
  data: PageData;
  me: Me | null;
  meLoaded: boolean;
  dialog: Dialog | null;
  open: (d: Dialog) => void;
  close: () => void;
  /** Opens d, asking for a wallet first if none is connected. */
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
    withWallet: d => setDialog(meRef.current ? d : { kind: 'wallet', then: d }),
  }), [data, me, meLoaded, dialog, toasts, toast, refresh]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}
