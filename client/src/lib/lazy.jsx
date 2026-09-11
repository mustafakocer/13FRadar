import { createElement } from 'react';

// Code-split component that renders synchronously once its module has been
// preloaded — unlike React.lazy, which always suspends on first render.
// The server preloads every split module before renderToString, and the
// client preloads the modules for the current URL before hydrating, so
// server HTML and the first client render match.
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
  return Lazy;
}
