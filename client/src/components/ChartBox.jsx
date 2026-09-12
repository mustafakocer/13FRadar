import { Suspense, useEffect, useState } from 'react';

// Fixed-height box for lazily loaded charts. The Suspense boundary is only
// mounted after hydration: server HTML and the first client render contain no
// boundary (chart modules are preloaded on both sides), so React never has a
// dehydrated boundary that a fast query update could knock into client
// rendering (error #421). After mount, a chart whose chunk is still loading
// shows the skeleton in place, at the same height.
export default function ChartBox({ height = 260, children, style = {} }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const fallback = <div className="skel" style={{ height, borderRadius: 10 }} />;
  return (
    <div style={{ minHeight: height, ...style }}>
      {hydrated ? <Suspense fallback={fallback}>{children}</Suspense> : children}
    </div>
  );
}
