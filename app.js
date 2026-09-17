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
  try {
    if (!window.isSecureContext || !window.crypto?.subtle) {
      throw new Error(
        'This page needs to be served over HTTPS (or localhost) for Spotify login to work — ' +
        'opening it as a local file, or over plain http://, will not work.'
      );
    }
    if (!CLIENT_ID || CLIENT_ID.includes('YOUR_')) {
      throw new Error('Add your Spotify app\u2019s Client ID to CLIENT_ID in app.js first.');
    }

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
  } catch (e) {
    showStatus(e.message);
    console.error('Spotify login failed:', e);
  }
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
