import { createElement } from 'react';

// Code-split component that renders synchronously once its module has been
// preloaded — unlike React.lazy, which always suspends on first render.
// The server preloads every split module before renderToString, and the
// client preloads the modules for the current URL before hydrating, so
// server HTML and the first client render match.
//
// `loaded()` lets a parent ask before rendering: a chart mounted by a
// client-side navigation (home → guru → Mix) has no preloaded module and no
// Suspense boundary above it yet, and rendering it there threw the promise
// straight into React ("a component suspended while responding to
// synchronous input", error #426), which took the whole page area down.
export function lazyPreloadable(loader, pick = (m) => m.default) {
  let mod = null;
  let pending = null;
  const preload = () => {
    if (mod) return Promise.resolve(mod);
    if (!pending) pending = loader().then((m) => (mod = m));
    return pending;
  };
  function Lazy(props) {
    if (!mod) throw preload();
    return createElement(pick(mod), props);
  }
  Lazy.preload = preload;
  Lazy.loaded = () => mod !== null;
  return Lazy;
}
