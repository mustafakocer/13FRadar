// Shimmer placeholders — perceived speed while data streams in.
export function SkeletonRows({ rows = 8 }) {
  return (
    <div className="card">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel skel-row" style={{ width: `${100 - (i % 4) * 8}%` }} />
      ))}
    </div>
  );
}

export function SkeletonStats() {
  return (
    <div className="grid grid-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card">
          <div className="skel" style={{ width: '40%', height: 12 }} />
          <div className="skel" style={{ width: '65%', height: 26, marginTop: 10 }} />
          <div className="skel" style={{ width: '90%', height: 34, marginTop: 12 }} />
        </div>
      ))}
    </div>
  );
}
