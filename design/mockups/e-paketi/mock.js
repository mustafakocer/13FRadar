// Mockup davranışı: tema anahtarı (açık/koyu) ve "Bu sayfada" aktif bölüm
// vurgusu (IntersectionObserver) — uygulamadaki ile aynı mantık.
(function () {
  const root = document.documentElement;
  const toggle = () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem('mock-theme', next); } catch {}
  };
  try { const saved = localStorage.getItem('mock-theme'); if (saved) root.dataset.theme = saved; } catch {}
  for (const id of ['theme', 'theme2']) document.getElementById(id)?.addEventListener('click', toggle);

  const links = [...document.querySelectorAll('.subnav a, .chipnav a')];
  if (!links.length) return;
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.remove('on'));
      byId.get(e.target.id)?.classList.add('on');
    }
  }, { rootMargin: '-30% 0px -60% 0px' });
  for (const id of byId.keys()) { const el = document.getElementById(id); if (el) io.observe(el); }
})();
