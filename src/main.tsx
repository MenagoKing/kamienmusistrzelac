import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import { AccountPage } from './account/AccountPage';
import { embeddedPageData, getPageData } from './data';
import './styles/site.css';
import './styles/app.css';
import './styles/account.css';
import './styles/v3.css';

const root = document.getElementById('root')!;
const fail = () => {
  root.innerHTML = '<p style="padding:40px;font-family:system-ui;color:#EFE6DA">The vault is not reachable right now. Refresh in a moment.</p>';
};

if (location.pathname.startsWith('/account')) {
  // The account page renders in the browser only (it is personal).
  getPageData().then(data => createRoot(root).render(<AccountPage data={data} />)).catch(fail);
} else {
  // Production renders the landing page on the server with the data embedded (#sr-data): hydrate it.
  // `vite dev` renders fresh from the API.
  const embedded = embeddedPageData();
  if (embedded && root.firstElementChild) hydrateRoot(root, <App data={embedded} />);
  else getPageData().then(data => createRoot(root).render(<App data={data} />)).catch(fail);
}
