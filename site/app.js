const $ = selector => document.querySelector(selector);
const labels = { overview: 'Overview', commands: 'Command library', setup: 'Server setup', privacy: 'Privacy & care' };
let catalogue, category = 'All', pendingQuery = '', toastTimer;
function route({ focus = false } = {}) {
  const view = Object.hasOwn(labels, location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  for (const section of document.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== view;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  $('#breadcrumb').textContent = labels[view];
  document.title = `Hikari · ${labels[view]}`;
  if (view === 'commands' && pendingQuery) { $('#command-search').value = pendingQuery; category = 'All'; pendingQuery = ''; renderCommands(); }
  if (focus) { $('#main').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
}
window.addEventListener('hashchange', () => route({ focus: true }));
route();
function notify(message) { const toast = $('#toast'); clearTimeout(toastTimer); toast.textContent = message; toast.hidden = false; toastTimer = setTimeout(() => { toast.hidden = true; }, 3500); }
async function copy(text) { try { await navigator.clipboard.writeText(text); notify(`Copied ${text}`); } catch { notify(`Copy unavailable. Select and copy: ${text}`); } }
document.addEventListener('click', event => {
  if (event.target.closest('.skip')) { event.preventDefault(); $('#main').focus(); return; }
  const button = event.target.closest('[data-copy]'); if (button) copy(button.dataset.copy);
  const link = event.target.closest('[data-query]'); if (link) { pendingQuery = link.dataset.query; if (location.hash === '#commands') route(); }
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && location.hash === '#commands' && !event.ctrlKey && !event.metaKey && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#command-search').focus(); }
});
function renderCommands() {
  if (!catalogue) return;
  const query = $('#command-search').value.toLowerCase().trim();
  const results = catalogue.commands.filter(c => (category === 'All' || c.category === category) && `${c.name} ${c.description}`.toLowerCase().includes(query));
  $('#results-count').textContent = `${results.length} ${results.length === 1 ? 'entry' : 'entries'} · ${catalogue.topLevelCount} top-level commands with nested actions`;
  const container = $('#command-results'); container.replaceChildren();
  if (!results.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No commands found. Try another word or choose All.'; container.append(empty); }
  for (const command of results) {
    const card = document.createElement('article'); card.className = 'command-card';
    const tag = document.createElement('span'); tag.className = 'category'; tag.textContent = command.category;
    const title = document.createElement('h2'); title.textContent = command.name;
    const description = document.createElement('p'); description.textContent = command.description;
    const copyButton = document.createElement('button'); copyButton.dataset.copy = command.name; copyButton.setAttribute('aria-label', `Copy ${command.name}`);
    copyButton.innerHTML = '<svg aria-hidden="true"><use href="#copy"/></svg>';
    card.append(tag, title, description, copyButton); container.append(card);
  }
  for (const filter of document.querySelectorAll('[data-filter]')) filter.setAttribute('aria-pressed', String(filter.dataset.filter === category));
}
$('#command-search').addEventListener('input', renderCommands);
try {
  const response = await fetch(new URL('data/catalogue.json', import.meta.url));
  if (!response.ok) throw new Error('Catalogue unavailable');
  catalogue = await response.json();
  for (const link of document.querySelectorAll('[data-link]')) { link.href = catalogue.links[link.dataset.link]; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  $('#command-count').textContent = catalogue.topLevelCount;
  for (const label of ['All', ...new Set(catalogue.commands.map(c => c.category))]) {
    const button = document.createElement('button'); button.textContent = label; button.dataset.filter = label; button.setAttribute('aria-pressed', String(label === category));
    button.addEventListener('click', () => { category = label; renderCommands(); }); $('#filters').append(button);
  }
  renderCommands();
} catch { $('#catalogue-error').hidden = false; notify('Command library unavailable. Please refresh or use /help in Discord.'); }

$('#explore-3d').addEventListener('click', async () => {
  const button = $('#explore-3d'), stage = $('#art-stage'), status = $('#model-status');
  button.disabled = true; status.textContent = 'Loading the interactive 3D scene.'; button.textContent = 'Loading 3D…';
  let viewer;
  try {
    if (!customElements.get('model-viewer')) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.type = 'module'; script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/4.4.0/model-viewer.min.js';
        const timeout = setTimeout(() => { script.remove(); reject(new Error('Viewer timed out')); }, 15000);
        script.onload = () => { clearTimeout(timeout); resolve(); }; script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('Viewer unavailable')); }; document.head.append(script);
      });
    }
    viewer = document.createElement('model-viewer');
    viewer.setAttribute('src', 'assets/hikari-palace.glb'); viewer.setAttribute('poster', 'assets/hikari-palace.webp'); viewer.setAttribute('alt', 'Interactive Hikari moon-cat diorama. Drag to rotate or use arrow keys.');
    viewer.setAttribute('camera-controls', ''); viewer.setAttribute('touch-action', 'pan-y'); viewer.setAttribute('camera-orbit', '32deg 68deg auto'); viewer.setAttribute('shadow-intensity', '0.7');
    const fail = () => { clearTimeout(modelTimeout); viewer.remove(); stage.querySelector('img').hidden = false; button.disabled = false; button.textContent = 'Retry 3D'; status.textContent = '3D could not load. The original artwork is still available.'; notify(status.textContent); };
    const modelTimeout = setTimeout(fail, 20000);
    viewer.addEventListener('error', fail, { once: true });
    viewer.addEventListener('load', () => { clearTimeout(modelTimeout); stage.querySelector('img').hidden = true; button.hidden = true; status.textContent = '3D scene ready. Drag to rotate; use arrow keys when focused.'; }, { once: true });
    stage.append(viewer);
  } catch { viewer?.remove(); button.disabled = false; button.textContent = 'Retry 3D'; status.textContent = '3D could not load. The original artwork is still available.'; notify(status.textContent); }
});
