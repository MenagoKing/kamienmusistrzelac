// Build-time prerender of the page with the data layer's first snapshot (see scripts/prerender.mjs).
import { renderToString } from 'react-dom/server';
import { App } from './App';
import { getPageData } from './data';

export async function render() {
  return renderToString(<App data={await getPageData()} />);
}
