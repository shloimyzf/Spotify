/* ============================================================
   Sessions — a private Spotify listening log
   ============================================================ */

// Replace with your own Spotify app's Client ID from
// https://developer.spotify.com/dashboard — and add this page's
// exact URL as a Redirect URI in that app's settings.
const CLIENT_ID = '997e4ee06e624c7aaf77a45f30e74394';
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = [
  'user-read-recently-played',
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-modify-public',
  'playlist-modify-private'
].join(' ');

const API = 'https://api.spotify.com/v1';

/* ---------------- DOM shortcuts ---------------- */
const $ = (id) => document.getElementById(id);

/* ---------------- State ---------------- */
let rawTracks = [];              // items from /me/player/recently-played
let artistGenres = {};           // artistId -> [genres]
let selectedGenre = '';
let aiCache = {};                // trackId -> parsed AI response | 'loading' | null
let liveTrack = null;            // currently-playing track object
let currentTrackId = '';
let previousArtistName = '';
let loopProtectionOn = false;

let playbackPollTimer = null;
let localTickTimer = null;
let progressMs = 0;
let durationMs = 0;
let isPlaying = false;
let activeBPM = 120;

let vizCtx, vizCanvas, vizAnimId, vizBlobs = [];

/* ============================================================
   Boot
   ============================================================ */
async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  loadSavedAIConfig();

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    const ok = await exchangeCodeForToken(code);
    window.history.replaceState({}, document.title, window.location.pathname);
    if (ok) window.location.reload();
    return;
  }

  const token = await getValidToken();
  if (token) {
    showDashboard();
    fetchProfile(token);
    fetchRecentlyPlayed(token);
    startPlaybackPolling();
  } else {
    showLanding();
  }
}

/* ============================================================
   Auth — PKCE
   ============================================================ */
function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(values, (x) => chars[x % chars.length]).join('');
}

async function codeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function loginWithSpotify() {
  const verifier = randomString(128);
  localStorage.setItem('sp_verifier', verifier);
  const challenge = await codeChallenge(verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function exchangeCodeForToken(code) {
  try {
    const verifier = localStorage.getItem('sp_verifier');
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error_description || 'Could not finish connecting to Spotify.');
    }
    saveTokens(await res.json());
    return true;
  } catch (e) {
    showStatus(e.message, true);
    return false;
  }
}

function saveTokens(data) {
  if (!data.access_token) return;
  localStorage.setItem('sp_access_token', data.access_token);
  if (data.refresh_token) localStorage.setItem('sp_refresh_token', data.refresh_token);
  if (data.expires_in) localStorage.setItem('sp_expires_at', Date.now() + data.expires_in * 1000);
}

async function getValidToken() {
  let token = localStorage.getItem('sp_access_token');
  const expiresAt = Number(localStorage.getItem('sp_expires_at') || 0);
  const refreshToken = localStorage.getItem('sp_refresh_token');

  if (!token) return null;
  if (expiresAt && Date.now() > expiresAt - 60000) {
    token = refreshToken ? await refreshAccessToken(refreshToken) : null;
  }
  return token;
}

async function refreshAccessToken(refreshToken) {
  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) throw new Error('refresh failed');
    const data = await res.json();
    saveTokens(data);
    return data.access_token;
  } catch {
    return null;
  }
}

function logout() {
  ['sp_access_token', 'sp_refresh_token', 'sp_expires_at', 'sp_verifier'].forEach((k) =>
    localStorage.removeItem(k)
  );
  if (playbackPollTimer) clearInterval(playbackPollTimer);
  if (localTickTimer) clearInterval(localTickTimer);
  showLanding();
}

/* ============================================================
   View switching
   ============================================================ */
function showLanding() {
  $('landing-view').classList.remove('hidden');
  $('dashboard-view').classList.add('hidden');
  $('logout-btn').classList.add('hidden');
}

function showDashboard() {
  $('landing-view').classList.add('hidden');
  $('dashboard-view').classList.remove('hidden');
  $('logout-btn').classList.remove('hidden');
}

function showStatus(message, isError = true) {
  const banner = $('status-banner');
  $('status-message').innerText = message;
  banner.classList.remove('hidden');
  banner.classList.toggle('is-error', isError);
  if (!isError) setTimeout(() => banner.classList.add('hidden'), 4000);
}

/* ============================================================
   Night shift / drawers
   ============================================================ */
function toggleNightShift() {
  const on = document.body.classList.toggle('night-shift');
  $('night-shift-btn').setAttribute('aria-pressed', String(on));
  $('night-shift-btn').innerText = on ? 'dim: on' : 'dim';
}

function toggleConfigDrawer() {
  $('config-drawer').classList.toggle('is-open');
  $('drawer-scrim').classList.toggle('is-visible');
}

function closeInspector() {
  $('inspector').classList.remove('is-open');
  $('inspector-scrim').classList.remove('is-visible');
}

function openInspectorPanel() {
  $('inspector').classList.add('is-open');
  $('inspector-scrim').classList.add('is-visible');
}

/* ============================================================
   AI config (BYOK, stored locally only)
   ============================================================ */
function loadSavedAIConfig() {
  const provider = localStorage.getItem('ai_provider') || 'openai';
  const key = localStorage.getItem('ai_key') || '';
  if ($('ai-provider')) $('ai-provider').value = provider;
  if ($('ai-key')) $('ai-key').value = key;
}

function saveAIConfig() {
  localStorage.setItem('ai_provider', $('ai-provider').value);
  localStorage.setItem('ai_key', $('ai-key').value.trim());
  showStatus('AI key saved on this device.', false);
}

function clearAIConfig() {
  localStorage.removeItem('ai_provider');
  localStorage.removeItem('ai_key');
  $('ai-key').value = '';
  showStatus('AI key cleared.', false);
}

async function callAI(promptText, expectJSON) {
  const provider = localStorage.getItem('ai_provider') || 'openai';
  const key = localStorage.getItem('ai_key');
  if (!key) return null;

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: promptText }],
        ...(expectJSON ? { response_format: { type: 'json_object' } } : {})
      })
    });
    if (!res.ok) throw new Error('AI request failed.');
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  // gemini
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        ...(expectJSON ? { generationConfig: { responseMimeType: 'application/json' } } : {})
      })
    }
  );
  if (!res.ok) throw new Error('AI request failed.');
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/* ============================================================
   Profile
   ============================================================ */
async function fetchProfile(token) {
  try {
    const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const data = await res.json();
    const badge = $('profile-badge');
    if (data.images?.length) {
      $('profile-img').src = data.images[0].url;
      $('profile-img').classList.remove('hidden');
    } else {
      $('profile-img').classList.add('hidden');
    }
    $('profile-name').innerText = data.display_name || 'connected';
    badge.classList.remove('hidden');
  } catch {
    /* non-critical */
  }
}

/* ============================================================
   Recently played + genre lookup + stats
   ============================================================ */
async function fetchRecentlyPlayed(token) {
  try {
    const res = await fetch(`${API}/me/player/recently-played?limit=50`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) throw new Error(`Spotify returned an error (${res.status}).`);

    const data = await res.json();
    rawTracks = data.items || [];

    if (rawTracks.length === 0) {
      renderEmptyLog();
      return;
    }

    const artistIds = [...new Set(rawTracks.map((i) => i.track?.artists?.[0]?.id).filter(Boolean))]
      .slice(0, 50)
      .join(',');

    if (artistIds) {
      const aRes = await fetch(`${API}/artists?ids=${artistIds}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (aRes.ok) {
        const aData = await aRes.json();
        (aData.artists || []).forEach((a) => { if (a) artistGenres[a.id] = a.genres || []; });
      }
    }

    renderStatsAndLog();
  } catch (e) {
    showStatus(e.message);
    renderEmptyLog();
  }
}

function renderEmptyLog() {
  $('stat-runtime').innerText = '0 min';
  $('stat-indie').innerText = '—';
  $('stat-genres-count').innerText = '0';
  $('stat-haze').innerText = '—';
  $('timeline-list').innerHTML = '<p class="empty-note">Nothing logged yet — play something on Spotify and refresh.</p>';
  $('tracks-list').innerHTML = '';
  $('track-count').innerText = '';
}

function moodRead(items) {
  let score = 0;
  items.forEach((item) => {
    const genres = artistGenres[item.track?.artists?.[0]?.id] || [];
    const g = genres.join(' ').toLowerCase();
    if (/ambient|lo-fi|chill|shoegaze|reggae|dream pop|psychedelic/.test(g)) score += 1;
    else if ((item.track?.popularity ?? 100) < 45) score += 0.5;
  });
  const pct = Math.round((score / (items.length || 1)) * 100);
  if (pct > 55) return `mellow (${pct}%)`;
  if (pct > 30) return `laid-back (${pct}%)`;
  if (pct > 10) return `mixed (${pct}%)`;
  return `high-energy (${pct}%)`;
}

function renderStatsAndLog() {
  const chronological = [...rawTracks].reverse();
  let totalMs = 0, totalPopularity = 0;
  const genreCounts = {};

  chronological.forEach((item) => {
    const t = item.track;
    if (!t) return;
    totalMs += t.duration_ms || 0;
    totalPopularity += t.popularity || 0;
    (artistGenres[t.artists?.[0]?.id] || []).forEach((g) => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
  });

  $('stat-runtime').innerText = `${Math.round(totalMs / 60000)} min`;
  const avgPop = rawTracks.length ? Math.round(totalPopularity / rawTracks.length) : 0;
  $('stat-indie').innerText = `${100 - avgPop}%`;
  $('stat-genres-count').innerText = String(Object.keys(genreCounts).length);
  $('stat-haze').innerText = moodRead(rawTracks);

  buildGenreFilters(genreCounts);
  renderTimeline(chronological);
  renderTrackList(rawTracks);
}

function buildGenreFilters(genreCounts) {
  const container = $('genre-filter-container');
  container.innerHTML = '';
  Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .forEach(([genre, count]) => {
      const pill = document.createElement('button');
      pill.className = `genre-pill${selectedGenre === genre ? ' is-active' : ''}`;
      pill.innerText = `${genre} (${count})`;
      pill.onclick = () => {
        selectedGenre = selectedGenre === genre ? '' : genre;
        renderStatsAndLog();
      };
      container.appendChild(pill);
    });
}

function timeAgo(iso) {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min${min > 1 ? 's' : ''} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function clockTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderTimeline(chronological) {
  const list = $('timeline-list');
  list.innerHTML = '';

  const filtered = chronological.filter((item) => {
    if (!selectedGenre) return true;
    const genres = artistGenres[item.track?.artists?.[0]?.id] || [];
    return genres.includes(selectedGenre);
  });

  if (filtered.length === 0) {
    list.innerHTML = '<p class="empty-note">No plays match this filter.</p>';
    return;
  }

  filtered.forEach((item, index) => {
    const track = item.track;
    let gapLabel = '';
    if (index > 0) {
      const prev = filtered[index - 1];
      const prevEnd = new Date(prev.played_at).getTime();
      const currentStart = new Date(item.played_at).getTime() - (track.duration_ms || 0);
      const gapMs = currentStart - prevEnd;
      if (gapMs > 5000) {
        const gapMin = Math.round(gapMs / 60000);
        gapLabel = gapMin > 0 ? `gap of ${gapMin} min${gapMin > 1 ? 's' : ''}` : `gap of ${Math.round(gapMs / 1000)}s`;
      }
    }

    const li = document.createElement('li');
    li.innerHTML = `
      <div class="timeline-row">
        <div class="timeline-row__top">
          <p class="timeline-row__title">${escapeHTML(track.name)} <span>— ${escapeHTML(track.artists.map((a) => a.name).join(', '))}</span></p>
          <span class="timeline-row__time">${timeAgo(item.played_at)} · ${clockTime(item.played_at)}</span>
        </div>
        ${gapLabel ? `<span class="timeline-row__gap">${gapLabel}</span>` : ''}
      </div>`;
    li.querySelector('.timeline-row').addEventListener('click', () => inspectTrack(track.id));
    list.appendChild(li);
  });
}

function renderTrackList(items) {
  const list = $('tracks-list');
  list.innerHTML = '';
  $('track-count').innerText = `(${items.length})`;

  items.forEach((item) => {
    const track = item.track;
    if (!track) return;
    const art = track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '';

    const li = document.createElement('li');
    li.className = 'track-row';
    li.dataset.name = track.name.toLowerCase();
    li.dataset.artist = track.artists.map((a) => a.name).join(', ').toLowerCase();
    li.innerHTML = `
      <img src="${art}" alt="">
      <div class="track-row__meta">
        <p class="track-row__title">${escapeHTML(track.name)}</p>
        <p class="track-row__artist">${escapeHTML(track.artists.map((a) => a.name).join(', '))}</p>
        <p class="track-row__time">${timeAgo(item.played_at)}</p>
      </div>
      <div class="track-row__actions">
        <button title="Play" data-action="play">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button title="Add to queue" data-action="queue">
          <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        </button>
      </div>`;

    li.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      inspectTrack(track.id);
    });
    li.querySelector('[data-action="play"]').addEventListener('click', (e) => {
      e.stopPropagation();
      playTrack(track.uri);
    });
    li.querySelector('[data-action="queue"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const ok = await addToQueue(track.uri);
      showStatus(ok ? `Queued “${track.name}.”` : 'No active Spotify player — open Spotify and press play first.', !ok);
    });

    list.appendChild(li);
  });
}

function filterTracks() {
  const q = $('search-input').value.toLowerCase().trim();
  let visible = 0;
  Array.from($('tracks-list').children).forEach((row) => {
    const match = row.dataset.name.includes(q) || row.dataset.artist.includes(q);
    row.classList.toggle('hidden', !match);
    if (match) visible++;
  });
  $('track-count').innerText = `(${visible})`;
}

function switchTab(name) {
  $('tab-timeline').classList.toggle('hidden', name !== 'timeline');
  $('tab-tracks').classList.toggle('hidden', name !== 'tracks');
  $('tab-btn-timeline').classList.toggle('is-active', name === 'timeline');
  $('tab-btn-tracks').classList.toggle('is-active', name === 'tracks');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.innerText = str ?? '';
  return div.innerHTML;
}

/* ============================================================
   Live playback polling
   ============================================================ */
function startPlaybackPolling() {
  if (playbackPollTimer) clearInterval(playbackPollTimer);
  pollPlayback();
  playbackPollTimer = setInterval(pollPlayback, 5000);
}

async function pollPlayback() {
  const token = await getValidToken();
  if (!token) return;

  try {
    const res = await fetch(`${API}/me/player`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 204) { showLiveEmpty(); return; }
    if (!res.ok) return;

    const data = await res.json();
    if (data && data.item) {
      renderLiveWidget(data);
    } else {
      showLiveEmpty();
    }
  } catch {
    /* transient network hiccup — ignore */
  }
}

function showLiveEmpty() {
  $('live-widget').classList.add('hidden');
  $('live-empty').classList.remove('hidden');
  if (localTickTimer) clearInterval(localTickTimer);
}

function renderLiveWidget(data) {
  $('live-empty').classList.add('hidden');
  $('live-widget').classList.remove('hidden');

  const track = data.item;
  const artistName = track.artists?.[0]?.name || '';

  if (loopProtectionOn && previousArtistName && previousArtistName === artistName && currentTrackId !== track.id) {
    breakArtistLoop();
  }

  if (currentTrackId !== track.id) {
    previousArtistName = artistName;
    currentTrackId = track.id;
    liveTrack = track;

    $('live-stat-pop').innerText = `${track.popularity ?? 0}%`;
    $('live-stat-year').innerText = track.album?.release_date?.slice(0, 4) || '—';
    const genres = artistGenres[track.artists?.[0]?.id] || [];
    $('live-stat-genre').innerText = genres.length ? genres.slice(0, 2).join(', ') : 'unclassified';

    fetchSimilarTracks(track.id);
  }

  $('live-title').innerText = track.name;
  $('live-artist').innerText = track.artists.map((a) => a.name).join(', ');
  $('live-art').src = track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || '';
  $('live-device').innerText = data.device?.name ? `on ${data.device.name}` : '';

  progressMs = data.progress_ms || 0;
  durationMs = track.duration_ms || 0;
  isPlaying = !!data.is_playing;

  updateProgressUI();
  $('vinyl-ring').style.opacity = isPlaying ? '1' : '0';

  if (localTickTimer) clearInterval(localTickTimer);
  if (isPlaying) {
    localTickTimer = setInterval(() => {
      progressMs = Math.min(progressMs + 1000, durationMs);
      updateProgressUI();
    }, 1000);
  }

  const icon = isPlaying
    ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  $('live-play-icon').innerHTML = icon;
  $('viz-play-icon').innerHTML = icon;

  if ($('visualizer').classList.contains('is-open')) {
    syncVisualizerMeta();
  }
}

function updateProgressUI() {
  const pct = durationMs ? Math.min(100, (progressMs / durationMs) * 100) : 0;
  $('live-progress-bar').style.width = `${pct}%`;
  $('viz-progress-bar').style.width = `${pct}%`;

  const fmt = (ms) => {
    const s = Math.floor((ms / 1000) % 60);
    const m = Math.floor(ms / 60000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };
  $('live-time').innerText = `${fmt(progressMs)} / ${fmt(durationMs)}`;
}

/* ---------------- Transport controls ---------------- */
async function togglePlayback() {
  const token = await getValidToken();
  if (!token) return;
  const endpoint = isPlaying ? 'pause' : 'play';
  await fetch(`${API}/me/player/${endpoint}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
  setTimeout(pollPlayback, 400);
}

async function skipNext() {
  const token = await getValidToken();
  if (!token) return;
  await fetch(`${API}/me/player/next`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  setTimeout(pollPlayback, 600);
}

async function skipPrevious() {
  const token = await getValidToken();
  if (!token) return;
  await fetch(`${API}/me/player/previous`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  setTimeout(pollPlayback, 600);
}

async function playTrack(uri) {
  const token = await getValidToken();
  if (!token) return;
  try {
    const res = await fetch(`${API}/me/player/play`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    if (res.status === 204) { setTimeout(pollPlayback, 400); }
    else { window.location.href = uri; }
  } catch {
    window.location.href = uri;
  }
}

async function addToQueue(uri) {
  const token = await getValidToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API}/me/player/queue?uri=${encodeURIComponent(uri)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

/* ---------------- Loop protection ---------------- */
function toggleLoopProtection() {
  loopProtectionOn = !loopProtectionOn;
  const btn = $('loop-protect-toggle');
  btn.setAttribute('aria-pressed', String(loopProtectionOn));
  btn.innerHTML = `loop guard: <strong>${loopProtectionOn ? 'on' : 'off'}</strong>`;
}

async function breakArtistLoop() {
  const token = await getValidToken();
  if (!token || !currentTrackId) return;
  try {
    const res = await fetch(`${API}/recommendations?seed_tracks=${currentTrackId}&limit=3`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    let queued = 0;
    for (const t of data.tracks || []) {
      if (await addToQueue(t.uri)) queued++;
    }
    if (queued > 0) showStatus(`Loop guard queued ${queued} different track${queued > 1 ? 's' : ''}.`, false);
  } catch {
    showStatus('Loop guard could not queue anything — is a player active?');
  }
}

/* ============================================================
   Track inspector (details + optional AI notes)
   ============================================================ */
function findTrackById(id) {
  if (liveTrack && liveTrack.id === id) return liveTrack;
  const match = rawTracks.find((i) => i.track?.id === id);
  return match ? match.track : null;
}

async function inspectTrack(trackId) {
  const track = findTrackById(trackId);
  if (!track) return;

  openInspectorPanel();

  const art = track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || '';
  $('inspect-art').src = art;
  $('inspect-title').innerText = track.name;
  $('inspect-artist').innerText = track.artists.map((a) => a.name).join(', ');
  $('inspect-bpm').classList.add('hidden');

  const genres = artistGenres[track.artists?.[0]?.id] || [];
  const genresBox = $('inspect-genres-box');
  if (genres.length) {
    $('inspect-genres-cloud').innerHTML = genres
      .map((g) => `<span class="genre-pill">${escapeHTML(g)}</span>`)
      .join('');
    genresBox.classList.remove('hidden');
  } else {
    genresBox.classList.add('hidden');
  }

  $('inspect-similar-box').classList.add('hidden');
  fetchSimilarTracks(trackId, true);

  const cached = aiCache[trackId];
  const key = localStorage.getItem('ai_key');

  $('inspect-ai-empty').classList.toggle('hidden', !!key);
  $('inspect-ai-loading').classList.add('hidden');
  $('inspect-ai-content').classList.add('hidden');

  if (!key) return;

  if (cached && cached !== 'loading') {
    renderAIInsight(cached);
    return;
  }

  $('inspect-ai-loading').classList.remove('hidden');
  aiCache[trackId] = 'loading';

  const prompt = `You are a knowledgeable, plain-spoken music writer. For the track "${track.name}" by ${track.artists.map((a) => a.name).join(', ')} (album: "${track.album?.name}", released ${track.album?.release_date}), respond with ONLY a valid JSON object, no markdown, matching:
{"bpm": <integer estimate>, "key": "<musical key, e.g. G major>", "mood": "<2-3 word mood>", "trivia": "<2-3 sentences of genuine background or context>", "mix_tip": "<1-2 sentences on what to play next after this, and why>"}
If exact facts are uncertain, give a reasonable, clearly-styled estimate rather than refusing.`;

  try {
    const text = await callAI(prompt, true);
    const parsed = JSON.parse((text || '').replace(/```json|```/g, '').trim());
    aiCache[trackId] = parsed;
    if ($('inspect-title').innerText === track.name) {
      $('inspect-ai-loading').classList.add('hidden');
      renderAIInsight(parsed);
    }
  } catch {
    aiCache[trackId] = null;
    $('inspect-ai-loading').classList.add('hidden');
    showStatus('Could not fetch AI notes for this track.');
  }
}

function renderAIInsight(parsed) {
  $('inspect-bpm').innerText = `${parsed.bpm ?? '—'} BPM`;
  $('inspect-bpm').classList.remove('hidden');
  $('inspect-key').innerText = parsed.key || '—';
  $('inspect-vibe').innerText = parsed.mood || '—';
  $('inspect-trivia').innerText = parsed.trivia || '—';
  $('inspect-mix').innerText = parsed.mix_tip || '—';
  $('inspect-ai-content').classList.remove('hidden');
  activeBPM = parsed.bpm || 120;
}

async function fetchSimilarTracks(trackId, forInspector) {
  const token = await getValidToken();
  if (!token) return;
  try {
    const res = await fetch(`${API}/recommendations?seed_tracks=${trackId}&limit=5`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const tracks = data.tracks || [];
    if (!forInspector || tracks.length === 0) return;

    const list = $('inspect-similar-list');
    list.innerHTML = '';
    tracks.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'similar-row';
      row.innerHTML = `
        <img src="${t.album?.images?.[2]?.url || ''}" alt="">
        <div class="similar-row__meta">
          <p class="similar-row__title">${escapeHTML(t.name)}</p>
          <p class="similar-row__artist">${escapeHTML(t.artists.map((a) => a.name).join(', '))}</p>
        </div>
        <button data-uri="${t.uri}">queue</button>`;
      row.querySelector('button').addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await addToQueue(t.uri);
        e.currentTarget.innerText = ok ? 'queued' : 'failed';
      });
      list.appendChild(row);
    });
    $('inspect-similar-box').classList.remove('hidden');
  } catch {
    /* non-critical */
  }
}

/* ============================================================
   Mixtape / vibe playlist generation
   ============================================================ */
const MOOD_RULES = {
  energy: (t, genres) => (t.popularity ?? 0) >= 55,
  indie: (t) => (t.popularity ?? 100) < 45,
  mellow: (t, genres) => /ambient|lo-fi|chill|dream pop|acoustic|soul|jazz/.test(genres.join(' ').toLowerCase())
};

const MOOD_LABEL = { energy: 'High Energy', indie: 'Indie & Under-the-radar', mellow: 'Mellow' };

async function generateVibePlaylist(mood) {
  const token = await getValidToken();
  if (!token) return;
  if (rawTracks.length === 0) { showStatus('Nothing logged yet to build a playlist from.'); return; }

  const rule = MOOD_RULES[mood];
  const seen = new Set();
  const uris = [];
  for (const item of rawTracks) {
    const t = item.track;
    if (!t || seen.has(t.uri)) continue;
    const genres = artistGenres[t.artists?.[0]?.id] || [];
    if (rule(t, genres)) { uris.push(t.uri); seen.add(t.uri); }
  }

  if (uris.length < 3) {
    showStatus(`Not enough recent plays match "${MOOD_LABEL[mood]}" yet — keep listening and try again.`);
    return;
  }

  showStatus(`Building "${MOOD_LABEL[mood]}"…`, false);

  try {
    const meRes = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
    const me = await meRes.json();

    const createRes = await fetch(`${API}/users/${me.id}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${MOOD_LABEL[mood]} — from Sessions`,
        description: 'Generated from your recent listening log.',
        public: false
      })
    });
    if (!createRes.ok) throw new Error('Could not create the playlist.');
    const playlist = await createRes.json();

    const addRes = await fetch(`${API}/playlists/${playlist.id}/tracks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: uris.slice(0, 50) })
    });
    if (!addRes.ok) throw new Error('Playlist created, but adding tracks failed.');

    showStatus(`"${MOOD_LABEL[mood]}" saved to your Spotify library with ${Math.min(uris.length, 50)} tracks.`, false);
  } catch (e) {
    showStatus(e.message);
  }
}

/* ============================================================
   Fullscreen visualizer
   ============================================================ */
function openVisualizer() {
  $('visualizer').classList.add('is-open');
  document.body.style.overflow = 'hidden';
  syncVisualizerMeta();
  startVisualizerRender();
}

function closeVisualizer() {
  $('visualizer').classList.remove('is-open');
  document.body.style.overflow = '';
  stopVisualizerRender();
}

function syncVisualizerMeta() {
  $('viz-art').src = $('live-art').src;
  $('viz-title').innerText = $('live-title').innerText;
  $('viz-artist').innerText = $('live-artist').innerText;
  const key = $('inspect-key') ? $('inspect-key').innerText : '—';
  $('viz-bpm-key').innerText = key !== '—' ? `${activeBPM} BPM · ${key}` : 'live metrics syncing…';
  const trivia = $('inspect-trivia') ? $('inspect-trivia').innerText : '—';
  $('viz-commentary').innerText = trivia !== '—' ? trivia : 'Add an AI key in setup to see notes here.';
}

function startVisualizerRender() {
  vizCanvas = $('viz-canvas');
  vizCtx = vizCanvas.getContext('2d');
  vizCanvas.width = vizCanvas.parentElement.clientWidth;
  vizCanvas.height = vizCanvas.parentElement.clientHeight;

  vizBlobs = [
    { x: vizCanvas.width * 0.3, y: vizCanvas.height * 0.4, r: 170, vx: 0.7, vy: 0.5, c: 'rgba(232,169,74,0.16)' },
    { x: vizCanvas.width * 0.7, y: vizCanvas.height * 0.6, r: 220, vx: -0.4, vy: 0.8, c: 'rgba(29,185,84,0.10)' },
    { x: vizCanvas.width * 0.5, y: vizCanvas.height * 0.3, r: 140, vx: 0.3, vy: -0.6, c: 'rgba(226,96,79,0.08)' }
  ];
  renderVisualizerFrame();
}

function stopVisualizerRender() {
  if (vizAnimId) cancelAnimationFrame(vizAnimId);
  vizAnimId = null;
}

function renderVisualizerFrame() {
  vizAnimId = requestAnimationFrame(renderVisualizerFrame);
  vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
  const speed = isPlaying ? activeBPM / 120 : 0.15;

  vizBlobs.forEach((b) => {
    b.x += b.vx * speed;
    b.y += b.vy * speed;
    if (b.x - b.r < 0 || b.x + b.r > vizCanvas.width) b.vx *= -1;
    if (b.y - b.r < 0 || b.y + b.r > vizCanvas.height) b.vy *= -1;

    const gradient = vizCtx.createRadialGradient(b.x, b.y, 5, b.x, b.y, b.r);
    gradient.addColorStop(0, b.c);
    gradient.addColorStop(1, 'rgba(20,17,13,0)');
    vizCtx.fillStyle = gradient;
    vizCtx.beginPath();
    vizCtx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    vizCtx.fill();
  });

  updateVisualizerProgressText();
}

function updateVisualizerProgressText() {
  const pct = durationMs ? (progressMs / durationMs) * 100 : 0;
  if (pct > 50 && $('inspect-mix').innerText !== '—') {
    $('viz-commentary').innerText = $('inspect-mix').innerText;
  }
}

init();
