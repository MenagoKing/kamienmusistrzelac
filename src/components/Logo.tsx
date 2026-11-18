import logoOnDark from '../../space-rocks-site/assets/logo/space-rocks-logo-on-dark.svg';

/** The primary lockup (assets/logo/space-rocks-logo-on-dark.svg), sized by height like the design. */
export function Logo({ height }: { height: number }) {
  return <img className="lgA" style={{ height, width: 'auto' }} src={logoOnDark} width={238} height={64} alt="Space Rocks" />;
}

export const NAV = [
  ['#market', 'Market'],
  ['#packs', 'Packs'],
  ['#drops', 'Launch drops'],
  ['#vault', 'Register'],
  ['#rocks', '$ROCKS'],
  ['#faq', 'FAQ'],
  ['#play', 'Play'],
] as const;

export function NavList({ base = '' }: { base?: string }) {
  return (
    <ul className="navl">
      {NAV.map(([href, label]) => (
        <li key={href}><a href={base + href}>{label}</a></li>
      ))}
    </ul>
  );
}
