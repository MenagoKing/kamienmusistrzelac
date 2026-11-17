import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import { getPageData } from './data';
import './styles/site.css';

const root = document.getElementById('root')!;
getPageData().then(data => {
  // The build prerenders the page into #root (scripts/prerender.mjs); hydrate it. `vite dev` renders fresh.
  if (root.firstElementChild) hydrateRoot(root, <App data={data} />);
  else createRoot(root).render(<App data={data} />);
});
