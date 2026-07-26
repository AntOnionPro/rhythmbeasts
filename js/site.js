/* ========================================
   RHYTHM BEASTS — Comportamiento del sitio
   Scrollspy, revelado de secciones, nav pegado,
   y atenuación del volumen al alejarse del hero.
   ======================================== */
(() => {
  const preview = document.querySelector('.preview');
  const navbar = document.querySelector('.navbar');
  const audioEl = document.getElementById('cancion');
  const soundToggle = document.getElementById('soundToggle');
  const indicator = document.querySelector('.scroll-indicator');
  const panels = Array.from(document.querySelectorAll('.panel'));
  const links = Array.from(document.querySelectorAll('.navbar-nav .nav-link[href^="#"]'));

  const MAX_VOLUME = 0.85;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  if (audioEl) audioEl.volume = MAX_VOLUME;

  /* ---- volumen ligado a cuánto del hero se ve ---- */
  let ticking = false;
  function update() {
    ticking = false;
    if (!preview) return;
    const r = preview.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const visible = clamp((Math.min(r.bottom, vh) - Math.max(r.top, 0)) / vh, 0, 1);

    // curva perceptual: el volumen cae más rápido de lo que cae el área visible
    if (audioEl) audioEl.volume = MAX_VOLUME * Math.pow(visible, 1.6);

    if (soundToggle) {
      soundToggle.style.opacity = visible < 0.25 ? '0' : '1';
      soundToggle.style.pointerEvents = visible < 0.25 ? 'none' : 'auto';
    }
    if (indicator) indicator.style.opacity = visible < 0.9 ? '0' : '';
    if (navbar) navbar.classList.toggle('is-stuck', window.scrollY > 40);

    // el canvas deja de dibujar cuando ya no se ve
    if (window.RB) {
      if (visible < 0.02) window.RB.stop();
      else window.RB.start();
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();

  /* ---- revelado de secciones ---- */
  if ('IntersectionObserver' in window) {
    const reveal = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            reveal.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -18% 0px', threshold: 0.15 }
    );
    panels.forEach((p) => reveal.observe(p));

    /* ---- scrollspy ---- */
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === '#' + e.target.id));
        });
      },
      { rootMargin: '-45% 0px -45% 0px' }
    );
    panels.forEach((p) => spy.observe(p));
  } else {
    panels.forEach((p) => p.classList.add('is-visible'));
  }

  /* ---- cerrar el menú colapsado al navegar (móvil) ---- */
  const collapse = document.getElementById('navbarSupportedContent');
  links.forEach((l) => {
    l.addEventListener('click', () => {
      if (collapse && collapse.classList.contains('show') && window.bootstrap) {
        window.bootstrap.Collapse.getOrCreateInstance(collapse).hide();
      }
    });
  });
})();
