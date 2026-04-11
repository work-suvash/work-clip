const DEFAULT_API_BASE = 'https://b718cc9a-e3b6-44a9-a713-5d1fc92d987a-00-l46vjic0vbsp.pike.replit.dev';

let currentFormat = 'video';
let cardData = [];
let apiBaseUrl = DEFAULT_API_BASE;

const goBtn = document.getElementById('goBtn');
const urlsInput = document.getElementById('urls');
const cards = document.getElementById('cards');
const serverInput = document.getElementById('serverUrl');
const serverStatus = document.getElementById('serverStatus');

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setStorage(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

function normalizeUrl(value) {
  return (value || '').trim().replace(/\/+$/, '') || DEFAULT_API_BASE;
}

function apiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

async function initBackend() {
  const saved = await getStorage(['serverUrl']);
  apiBaseUrl = normalizeUrl(saved.serverUrl);
  serverInput.value = apiBaseUrl;
}

async function saveServer() {
  apiBaseUrl = normalizeUrl(serverInput.value);
  serverInput.value = apiBaseUrl;
  await setStorage({ serverUrl: apiBaseUrl });
  serverStatus.textContent = 'Saved';
  serverStatus.className = 'server-hint ok';
  setTimeout(() => {
    serverStatus.textContent = 'Enter your WorkClip server URL';
    serverStatus.className = 'server-hint';
  }, 2000);
}

function parseUrls(text) {
  return [...new Set(text.split(/[\s,]+/).map(u => u.trim()).filter(u => u.startsWith('http')))];
}

function fmtDur(s) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function friendlyError(err) {
  if (!err) return 'Something went wrong';
  if (err.includes('Unexpected token') || err.includes('not valid JSON') || err.includes('SyntaxError')) return 'Cannot reach the WorkClip server — check the server URL above';
  if (err.includes('Failed to fetch') || err.includes('NetworkError') || err.includes('Load failed')) return 'Cannot reach the WorkClip server — check the server URL above';
  if (err.includes('Unsupported URL')) return 'This URL is not supported';
  if (err.includes('Video unavailable')) return 'Video is unavailable or private';
  if (err.includes('Private video')) return 'This video is private';
  if (err.includes('HTTP Error 403')) return 'Access denied by the platform';
  if (err.includes('HTTP Error 404')) return 'Video not found';
  if (err.includes('copyright')) return 'Video blocked due to copyright';
  if (err.includes('geo')) return 'Video not available in your region';
  if (err.includes('timed out') || err.includes('Timed out')) return 'Request timed out — try again';
  if (err.includes('network') || err.includes('Network')) return 'Network error — check your connection';
  return err.length > 90 ? err.slice(0, 90) + '...' : err;
}

async function requestJson(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Cannot reach the WorkClip server — check the server URL above');
  }
  if (!res.ok || data.error) throw new Error(data.error || `Request failed with ${res.status}`);
  return data;
}

function setFormat(btn) {
  document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFormat = btn.dataset.format;
}

async function go() {
  const urls = parseUrls(urlsInput.value);
  if (!urls.length) return;

  goBtn.disabled = true;
  goBtn.textContent = 'Loading...';
  cards.innerHTML = '';
  cardData = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const idx = cardData.length;
    cardData.push({ url, status: 'loading' });
    renderCard(idx);

    try {
      const data = await requestJson('/api/info', {
        method: 'POST',
        body: JSON.stringify({ url })
      });
      cardData[idx] = {
        ...cardData[idx],
        status: 'ready',
        title: data.title || '',
        thumbnail: data.thumbnail || '',
        duration: data.duration,
        uploader: data.uploader || '',
        formats: data.formats || [],
        selectedFormatId: data.formats?.[0]?.id || null
      };
    } catch (err) {
      cardData[idx] = { ...cardData[idx], status: 'info-error', error: err.message };
    }
    renderCard(idx);
  }

  if (cardData.filter(c => c.status === 'ready').length > 1) {
    renderDownloadAll();
  }

  goBtn.disabled = false;
  goBtn.textContent = 'Fetch';
}

function noThumbSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
}

function audioSvg() {
  return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
}

function errorSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
}

function renderCard(idx) {
  const c = cardData[idx];
  let el = document.getElementById(`card-${idx}`);
  if (!el) {
    el = document.createElement('div');
    el.id = `card-${idx}`;
    el.className = 'card';
    cards.appendChild(el);
  }

  if (c.status === 'loading') {
    el.className = 'card';
    el.innerHTML = '<div class="card-thumb loading"></div><div class="card-body"><div class="skeleton-line medium"></div><div class="skeleton-line short"></div></div>';
    return;
  }

  if (c.status === 'info-error') {
    el.className = 'card card-error';
    el.innerHTML = `<div class="card-thumb"><div class="card-error-icon">${errorSvg()}</div></div><div class="card-body"><div class="card-title" style="color:var(--error)">Could not fetch video</div><div class="card-error-msg">${esc(friendlyError(c.error || ''))}</div><div class="card-error-url">${esc(c.url)}</div></div>`;
    return;
  }

  el.className = 'card';
  const isAudio = currentFormat === 'audio';

  let thumbHtml;
  if (isAudio) {
    thumbHtml = `<div class="no-thumb" style="color:var(--accent)">${audioSvg()}</div>`;
  } else if (c.thumbnail) {
    thumbHtml = `<img src="${esc(c.thumbnail)}" alt="">`;
  } else {
    thumbHtml = `<div class="no-thumb">${noThumbSvg()}</div>`;
  }

  let qualityChips = '';
  if (!isAudio && c.formats && c.formats.length > 1) {
    qualityChips = c.formats.map(f =>
      `<button class="q-chip${f.id === c.selectedFormatId ? ' active' : ''}" data-action="quality" data-idx="${idx}" data-format-id="${esc(f.id)}" type="button">${esc(f.label)}</button>`
    ).join('');
  }

  let actionHtml = '';
  if (c.status === 'ready') {
    actionHtml = `<button class="card-dl-btn" data-action="download" data-idx="${idx}" type="button">Download</button>${qualityChips}`;
  } else if (c.status === 'downloading') {
    actionHtml = '<span class="card-status downloading"><span class="spin"></span> Downloading...</span>';
  } else if (c.status === 'done') {
    actionHtml = `<button class="card-dl-btn done" data-action="save" data-idx="${idx}" type="button">Save</button><span class="card-status done">${esc(c.filename || '')}</span>`;
  } else if (c.status === 'error') {
    actionHtml = `<button class="card-dl-btn" data-action="download" data-idx="${idx}" type="button">Retry</button><span class="card-status error">${esc(friendlyError(c.error || 'Download failed'))}</span>`;
  }

  el.innerHTML = `<div class="card-thumb">${thumbHtml}</div><div class="card-body"><div class="card-title">${esc(c.title || 'Untitled')}</div><div class="card-meta">${esc(c.uploader)}${c.duration ? ' · ' + fmtDur(c.duration) : ''}</div><div class="card-actions">${actionHtml}</div></div>`;
}

function renderDownloadAll() {
  const existing = document.getElementById('dl-all-bar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'dl-all-bar';
  bar.className = 'dl-all-bar';
  bar.innerHTML = '<button class="dl-all-btn" data-action="download-all" type="button">Download All</button>';
  cards.appendChild(bar);
}

function pickFormat(idx, formatId) {
  cardData[idx].selectedFormatId = formatId;
  renderCard(idx);
}

async function dlCard(idx) {
  const c = cardData[idx];
  c.status = 'downloading';
  c.error = null;
  renderCard(idx);

  try {
    const data = await requestJson('/api/download', {
      method: 'POST',
      body: JSON.stringify({
        url: c.url,
        format: currentFormat,
        format_id: c.selectedFormatId,
        title: c.title || ''
      })
    });
    c.jobId = data.job_id;
    pollCard(idx);
  } catch (err) {
    c.status = 'error';
    c.error = err.message;
    renderCard(idx);
  }
}

function pollCard(idx) {
  const c = cardData[idx];
  const iv = setInterval(async () => {
    try {
      const data = await requestJson(`/api/status/${c.jobId}`, { method: 'GET' });
      if (data.status === 'done') {
        clearInterval(iv);
        c.status = 'done';
        c.filename = data.filename;
        renderCard(idx);
        saveCard(idx);
      } else if (data.status === 'error') {
        clearInterval(iv);
        c.status = 'error';
        c.error = data.error;
        renderCard(idx);
      }
    } catch {
      clearInterval(iv);
      c.status = 'error';
      c.error = 'Lost connection to server';
      renderCard(idx);
    }
  }, 1000);
}

function safeFilename(filename) {
  return (filename || 'workclip-download').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 180);
}

function saveCard(idx) {
  const c = cardData[idx];
  if (!c.jobId) return;
  const url = apiUrl(`/api/file/${c.jobId}`);
  chrome.downloads.download({ url, filename: safeFilename(c.filename), saveAs: false });
}

async function dlAll() {
  const btn = document.querySelector('.dl-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Downloading...'; }
  for (let i = 0; i < cardData.length; i++) {
    if (cardData[i].status === 'ready') await dlCard(i);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Download All'; }
}

document.querySelectorAll('.pill').forEach(btn => btn.addEventListener('click', () => setFormat(btn)));

urlsInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
});

goBtn.addEventListener('click', go);
document.getElementById('saveServerBtn').addEventListener('click', saveServer);
serverInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveServer(); });

cards.addEventListener('click', e => {
  const target = e.target.closest('button[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const idx = Number(target.dataset.idx);

  if (action === 'quality') pickFormat(idx, target.dataset.formatId);
  if (action === 'download') dlCard(idx);
  if (action === 'save') saveCard(idx);
  if (action === 'download-all') dlAll();
});

initBackend();
