import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import { embeddedPageData, getPageData } from './data';
import './styles/site.css';
import './styles/app.css';

const root = document.getElementById('root')!;
// Production renders the page on the server with the data embedded (#sr-data): hydrate it.
// `vite dev` renders fresh from the API.
const embedded = embeddedPageData();
if (embedded && root.firstElementChild) hydrateRoot(root, <App data={embedded} />);
else getPageData().then(data => createRoot(root).render(<App data={data} />)).catch(() => {
  root.innerHTML = '<p style="padding:40px;font-family:system-ui;color:#EFE6DA">The vault is not reachable right now. Refresh in a moment.</p>';
});
