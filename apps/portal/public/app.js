const byId = id => document.getElementById(id);
let intentToken = null;
async function readJson(url, options = {}) {
  const result = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload.reason || payload.error || 'Service unavailable');
  return payload;
}
function appendText(element, tag, text, className) {
  const child = document.createElement(tag);
  child.textContent = text;
  if (className) child.className = className;
  element.append(child);
  return child;
}
function appendLink(element, label, href, onClick) {
  const link = document.createElement('a');
  link.textContent = label;
  link.href = href;
  if (onClick) link.addEventListener('click', onClick);
  element.append(link);
  return link;
}
async function refreshStatus() {
  const [status, sites, names] = await Promise.all([
    readJson('/api/status'), readJson('/api/sites'), readJson('/api/ports'),
  ]);
  byId('run-status').textContent = 'SDPN · ' + status.scope.toUpperCase() + ' · ACTIVE';
  byId('coverage').textContent = status.indexedDocuments + ' verified local sources';
  byId('model-state').textContent = status.localAIConfigured ? 'Local model configured' : 'Local model not configured';
  const container = byId('owned-sites');
  container.replaceChildren();
  if (!sites.sites.length) appendText(container, 'p', 'No owned sites yet. Create your first port site.', 'hint');
  for (const site of sites.sites) {
    const block = document.createElement('div');
    block.className = 'site-link';
    appendLink(block, site.title, site.preview);
    appendText(block, 'small', site.preview);
    if (site.portUri) appendText(block, 'small', site.portUri + ' · signed name only');
    container.append(block);
  }
  byId('namespace-state').textContent = names.verified ?
    'Signed Port Zero namespace verified. These are registered within your local overlay only.' :
    'No currently valid signed namespace. Create one with the SDPN port-domain CLI.';
  const list = byId('names-list');
  list.replaceChildren();
  for (const entry of names.entries.slice(0, 20)) {
    appendText(list, 'span', entry.uri + ' → ' + entry.targetPort.slice(0, 34) + '…', 'names-list-item');
  }
}
async function submitSearch(event) {
  event.preventDefault();
  const q = byId('search-input').value.trim();
  const target = byId('search-results');
  target.replaceChildren();
  if (q.length < 2) return;
  appendText(target, 'p', 'Searching your local index…', 'hint');
  try {
    const data = await readJson('/api/search?q=' + encodeURIComponent(q));
    target.replaceChildren();
    if (!data.results.length) {
      appendText(target, 'p', 'No matches among the currently indexed local sources.', 'hint');
      return;
    }
    for (const result of data.results) {
      const block = document.createElement('article');
      block.className = 'result';
      appendText(block, 'div', result.kind + ' · local verified source', 'meta');
      appendText(block, 'strong', result.title);
      appendText(block, 'p', result.snippet);
      appendLink(block, result.kind === 'documentation' ? 'Read indexed document ↗' : 'Open your port site ↗',
        result.href, result.kind === 'documentation' ? async event => {
          event.preventDefault();
          try {
            const doc = await readJson(result.href);
            byId('document-title').textContent = doc.title;
            byId('document-text').textContent = doc.body;
            byId('document-view').hidden = false;
            byId('document-view').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (error) { byId('document-text').textContent = error.message; }
        } : null);
      target.append(block);
    }
  } catch (error) {
    target.replaceChildren();
    appendText(target, 'p', error.message, 'hint');
  }
}
function postWithIntent(path, data) {
  if (!intentToken) throw new Error('Local operator session not ready');
  return readJson(path, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Portal-Intent': intentToken
  }, body: JSON.stringify(data) });
}
async function submitAI(event) {
  event.preventDefault();
  const answer = byId('ai-answer');
  const button = byId('assist-form').querySelector('button[type="submit"]');
  answer.textContent = 'Checking your actual local model…';
  button.disabled = true;
  try {
    const data = await postWithIntent('/api/assist',
      { task: byId('task').value, prompt: byId('ask').value.trim() });
    answer.textContent = data.answer + '\n\n— ' + data.model + ' (local inference)';
  } catch (error) { answer.textContent = error.message; }
  finally { button.disabled = false; }
}
async function submitSite(event) {
  event.preventDefault();
  const form = byId('site-form');
  const button = form.querySelector('button[type="submit"]');
  const result = byId('site-result');
  result.replaceChildren();
  button.disabled = true;
  try {
    const fields = Object.fromEntries(new FormData(form).entries());
    const data = await postWithIntent('/api/sites', fields);
    appendText(result, 'strong', 'Site saved on this machine. ', '');
    appendLink(result, 'Open your actual site ↗', data.site.preview);
    appendText(result, 'p', 'PORT signing and internet publication require a separate owner-approved step.', 'hint');
    form.reset();
    await refreshStatus();
  } catch (error) { result.textContent = error.message; }
  finally { button.disabled = false; }
}
async function loadCommunityPlans() {
  const target = byId('community-plans');
  try {
    const catalog = await readJson('/api/plans');
    target.replaceChildren();
    for (const plan of catalog.plans) {
      const box = document.createElement('article');
      box.className = 'plan';
      appendText(box, 'strong', plan.label);
      appendText(box, 'span', plan.priceUsdMonthly === 0 ? 'FREE · OPEN SOURCE' :
        'PLANNED · NOT FOR SALE', 'plan-price');
      appendText(box, 'p', plan.description);
      const benefits = document.createElement('ul');
      for (const capability of (plan.capabilities ?? plan.services ?? []).slice(0, 6)) {
        appendText(benefits, 'li', capability.replaceAll('.', ' · '));
      }
      box.append(benefits);
      if (plan.plannedFreeCapabilities?.length) {
        appendText(box, 'small', 'Also free when implemented: ' +
          plan.plannedFreeCapabilities.join(', '), 'hint');
      }
      target.append(box);
    }
  } catch (error) {
    target.replaceChildren();
    appendText(target, 'p', 'Community plan information unavailable: ' + error.message, 'hint');
  }
}
async function initialize() {
  byId('search-form').addEventListener('submit', submitSearch);
  byId('assist-form').addEventListener('submit', submitAI);
  byId('site-form').addEventListener('submit', submitSite);
  byId('document-close').addEventListener('click', () => { byId('document-view').hidden = true; });
  try {
    const session = await readJson('/api/session');
    intentToken = session.intentToken;
    await refreshStatus();
    await loadCommunityPlans();
  } catch (error) {
    byId('run-status').textContent = 'Local workspace unavailable';
    byId('coverage').textContent = error.message;
  }
}
initialize();
