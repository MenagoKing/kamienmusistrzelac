// Server render of the page with live data (server/index.ts injects it and the data as #sr-data).
import { renderToString } from 'react-dom/server';
import { App } from './App';
import type { PageData } from './data';

export function render(data: PageData) {
  return renderToString(<App data={data} />);
}
