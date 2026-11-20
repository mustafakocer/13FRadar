// Last step of the client build (client/package.json → "build").
//
// Vite writes the page template to client/dist/index.html. client/dist is the
// deployment's web root, and Vercel answers a request from the file system
// before it looks at the rewrites — so `/` (and `/index.html`) were served as
// that raw file: the unrendered template, `<html lang="%LANG%">`, no title,
// no canonical, never reaching api/ssr.js. The template is not a page; it is
// an input of the renderer. It is moved next to the SSR bundle, under a name
// no route resolves to, and api/ssr.js reads it from there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
export const TEMPLATE_REL = path.join('server', 'template.html');

const from = path.join(dist, 'index.html');
const to = path.join(dist, TEMPLATE_REL);
if (!fs.existsSync(from)) {
  console.error('ssr-template: client/dist/index.html missing — the client build did not run');
  process.exit(1);
}
if (!fs.existsSync(path.dirname(to))) {
  console.error('ssr-template: client/dist/server missing — the SSR build did not run');
  process.exit(1);
}
fs.renameSync(from, to);
console.log('ssr-template: client/dist/index.html → client/dist/server/template.html');
