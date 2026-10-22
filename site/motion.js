const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
const targets = [...document.querySelectorAll('[data-reveal]')];
let observer, viewAnimation, resultsAnimation, initialView = true, scrollFrame;

function configureReveals() {
  observer?.disconnect();
  if (reduce.matches || !('IntersectionObserver' in window)) {
    root.classList.remove('motion-ready');
    return;
  }
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: .08, rootMargin: '0px 0px -28px 0px' });
  for (const element of targets) if (!element.classList.contains('is-visible')) observer.observe(element);
  root.classList.add('motion-ready');
}
configureReveals();
reduce.addEventListener('change', () => {
  viewAnimation?.cancel(); resultsAnimation?.cancel(); configureReveals(); updateProgress();
});
// Keyboard focus must never land inside an invisible reveal.
document.addEventListener('focusin', event => {
  const section = event.target.closest('[data-reveal]');
  if (section) { section.style.transition = 'none'; section.classList.add('is-visible'); }
});
document.addEventListener('hikari:viewchange', () => {
  viewAnimation?.cancel();
  const active = document.querySelector('[data-view]:not([hidden])');
  if (!initialView && !reduce.matches) viewAnimation = active.animate([
    { opacity: .2, transform: 'translateY(9px)' }, { opacity: 1, transform: 'none' },
  ], { duration: 360, easing: 'cubic-bezier(.22,1,.36,1)' });
  initialView = false;
  updateProgress();
});
document.addEventListener('hikari:results', () => {
  resultsAnimation?.cancel();
  if (!reduce.matches) resultsAnimation = document.querySelector('#command-results').animate([
    { opacity: .25, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' },
  ], { duration: 230, easing: 'ease-out' });
});
function updateProgress() {
  const total = root.scrollHeight - innerHeight;
  const progress = reduce.matches || total <= 0 ? 0 : Math.min(1, Math.max(0, scrollY / total));
  document.querySelector('#scroll-progress').style.transform = `scaleX(${progress})`;
  scrollFrame = undefined;
}
window.addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateProgress); }, { passive: true });
window.addEventListener('resize', updateProgress);

for (const image of document.querySelectorAll('img')) {
  const loaded = () => image.classList.remove('media-loading');
  if (!image.complete) image.classList.add('media-loading');
  image.addEventListener('load', loaded);
  image.addEventListener('error', loaded);
}
