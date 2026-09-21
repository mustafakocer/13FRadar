import { Children, Suspense, useEffect, useState } from 'react';

// Fixed-height box for lazily loaded charts. The Suspense boundary is only
// mounted after hydration: server HTML and the first client render contain no
// boundary (chart modules are preloaded on both sides), so React never has a
// dehydrated boundary that a fast query update could knock into client
// rendering (error #421). After mount, a chart whose chunk is still loading
// shows the skeleton in place, at the same height.
//
// Before the boundary exists the children are rendered only when their
// module is already in memory. A chart reached by client-side navigation
// (the chunk not yet fetched) used to suspend with no boundary above it,
// which React treats as a render error (#426) and the page area went blank.
// Now it shows the skeleton, the module loads, and the chart appears.
const allLoaded = (children) =>
  Children.toArray(children).every((c) => typeof c?.type?.loaded !== 'function' || c.type.loaded());

export default function ChartBox({ height = 260, children, style = {} }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const fallback = <div className="skel" style={{ height, borderRadius: 10 }} />;
  const body = hydrated ? <Suspense fallback={fallback}>{children}</Suspense> : allLoaded(children) ? children : fallback;
  return <div style={{ minHeight: height, ...style }}>{body}</div>;
}
