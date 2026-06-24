const CLIENT_ID = '997e4ee06e624c7aaf77a45f30e74394'; 
const REDIRECT_URI = window.location.origin + window.location.pathname; 
const SCOPE = 'user-read-recently-played playlist-modify-public user-modify-playback-state user-read-currently-playing user-read-playback-state';

const logoutBtn = document.getElementById('logout-btn');
const pwaInstallBtn = document.getElementById('pwa-install-btn');
const landingView = document.getElementById('landing-view');
const dashboardView = document.getElementById('dashboard-view');
const tracksList = document.getElementById('tracks-list');
const trackCount = document.getElementById('track-count');
const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');

// Dynamic Logs Layout Elements
const statCount = document.getElementById('stat-count');
const statRuntime = document.getElementById('stat-runtime');
const statPopularity = document.getElementById('stat-popularity');
const statTopGenre = document.getElementById('stat-topgenre');
const timelineContainer = document.getElementById('timeline-container');

// Modal Elements
const infoModal = document.getElementById('info-modal');
const modalContainer = document.getElementById('modal-container');
const modalImg = document.getElementById('modal-img');
const modalTitle = document.getElementById('modal-title');
const modalArtist = document.getElementById('modal-artist');
const modalGenres = document.getElementById('modal-genres');
const modalAlbum = document.getElementById('modal-album');
const modalRelease = document.getElementById('modal-release');
const modalPopularityElement = document.getElementById('modal-popularity');
const modalTimestamp = document.getElementById('modal-timestamp');

// Slider Queue State
let isSliding = false;
let activeHandle = null;
let startX = 0;
let sliderWidth = 0;
let activeUri = '';
let currentSlideX = 0;

// Playback Polling States
let livePlaybackInterval = null;
let localPlaybackTimeTracker = null;
let currentPlaybackProgressMs = 0;
let currentPlaybackDurationMs = 0;
let currentPlaybackIsPlaying = false;

let globalArtistGenres = {};
let loadedTrackUris = [];
let rawTracksCache = [];
let deferredPrompt;

function showUIStatus(msg, isError = true) {
    errorMessage.innerText = msg;
    if (isError) {
        errorBanner.classList.remove('border-zinc-800', 'text-zinc-300');
        errorBanner.classList.add('border-red-900/60', 'text-red-400');
    } else {
        errorBanner.classList.remove('border-red-900/60', 'text-red-400');
        errorBanner.classList.add('border-zinc-800/60', 'text-zinc-300');
    }
    errorBanner.classList.remove('hidden');
}

function toggleNightShift() {
    const body = document.body;
    const overlay = document.getElementById('night-shift-overlay');
    const btn = document.getElementById('night-shift-btn');
    
    if (body.classList.contains('night-shift')) {
        body.classList.remove('night-shift');
        overlay.classList.add('opacity-0');
        overlay.classList.remove('opacity-100');
        btn.innerText = "🌙 Night Shift: Off";
    } else {
        body.classList.add('night-shift');
        overlay.classList.remove('opacity-0');
        overlay.classList.add('opacity-100');
        btn.innerText = "🌙 Night Shift: On";
    }
}

function switchTab(tabName) {
    document.getElementById('tab-content-hub').classList.add('hidden');
    document.getElementById('tab-content-tracks').classList.add('hidden');
    document.getElementById('tab-content-ai').classList.add('hidden');

    const btnHub = document.getElementById('tab-btn-hub');
    const btnTracks = document.getElementById('tab-btn-tracks');
    const btnAi = document.getElementById('tab-btn-ai');

    btnHub.className = "flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-zinc-400 hover:text-white";
    btnTracks.className = "flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-zinc-400 hover:text-white";
    btnAi.className = "flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-zinc-400 hover:text-white";

    document.getElementById(`tab-content-${tabName}`).classList.remove('hidden');
    const activeBtn = document.getElementById(`tab-btn-${tabName === 'ai' ? 'ai' : tabName}`);
    activeBtn.className = "flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-white bg-zinc-800";
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    pwaInstallBtn.classList.remove('hidden');
    pwaInstallBtn.onclick = async () => {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            pwaInstallBtn.classList.add('hidden');
        }
        deferredPrompt = null;
    };
});

// Load saved config directly on page boot
window.addEventListener('DOMContentLoaded', () => {
    const savedProvider = localStorage.getItem('ai_provider') || 'openai';
    const savedKey = localStorage.getItem('ai_key') || '';
    const provEl = document.getElementById('ai-provider');
    const keyEl = document.getElementById('ai-key');
    if (provEl) provEl.value = savedProvider;
    if (keyEl) keyEl.value = savedKey;
});

async function init() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.log("SW failed", err));
    }

    const args = new URLSearchParams(window.location.search);
    const code = args.get('code');

    if (code) {
        const success = await exchangeCodeForToken(code);
        window.history.replaceState({}, document.title, window.location.pathname);
        if (success) {
            window.location.reload();
        }
    }

    const token = await getValidToken();
    if (token) { 
        showDashboard(token); 
        startLivePlaybackPolling(); // Poll the Spotify currently-playing session automatically
    } else { 
        logout();
    }
}

function logout() {
    // DO NOT clear all localStorage, as it deletes saved API keys
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('expires_at');
    localStorage.removeItem('code_verifier');
    
    if (livePlaybackInterval) clearInterval(livePlaybackInterval);
    if (localPlaybackTimeTracker) clearInterval(localPlaybackTimeTracker);
    showLanding();
}

function showLanding() {
    landingView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
    logoutBtn.classList.add('hidden');
}

async function showDashboard(token) {
    landingView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    
    logoutBtn.onclick = () => { logout(); };
    showSkeletonLoading();
    await fetchDashboardData(token);
}

function showSkeletonLoading() {
    statCount.innerHTML = `<span class="inline-block w-8 h-4 bg-zinc-800 animate-pulse rounded"></span>`;
    statRuntime.innerHTML = `<span class="inline-block w-12 h-4 bg-zinc-800 animate-pulse rounded"></span>`;
    statPopularity.innerHTML = `<span class="inline-block w-8 h-4 bg-zinc-800 animate-pulse rounded"></span>`;
    statTopGenre.innerHTML = `<span class="inline-block w-16 h-3 bg-zinc-800 animate-pulse rounded"></span>`;
    timelineContainer.innerHTML = Array(3).fill(0).map(() => `
        <div class="relative pl-4 animate-pulse">
            <div class="absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-zinc-800"></div>
            <div class="h-4 bg-zinc-850 rounded w-1/4 mb-1"></div>
            <div class="h-3 bg-zinc-900 rounded w-1/2"></div>
        </div>
    `).join('');
}

async function fetchDashboardData(token) {
    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (response.status === 401) { 
            logout();
            return; 
        }

        if (!response.ok) {
            const errInfo = await response.json().catch(() => ({}));
            throw new Error(`Profile Processing Error (${response.status}): ${errInfo.error?.message || 'Access Denied'}`);
        }

        const data = await response.json();
        const items = data.items || [];
        rawTracksCache = items;

        if (items.length === 0) {
            renderEmptyState();
            return;
        }

        loadedTrackUris = items.map(item => item.track.uri).filter(uri => uri);

        const artistIds = [...new Set(items.map(item => item.track?.artists[0]?.id).filter(id => id))].slice(0, 50).join(',');
        if (artistIds) {
            const artistsResponse = await fetch(`https://api.spotify.com/v1/artists?ids=${artistIds}`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (artistsResponse.ok) {
                const artistsData = await artistsResponse.json();
                (artistsData.artists || []).forEach(artist => {
                    if(artist) globalArtistGenres[artist.id] = artist.genres;
                });
            }
        }

        processFactualMetrics(items);

    } catch (err) { 
        showUIStatus(err.message);
        renderEmptyState();
    }
}

// Live Polls Check Spotify Device Status under 30 seconds
function startLivePlaybackPolling() {
    if (livePlaybackInterval) clearInterval(livePlaybackInterval);
    pollLivePlayback(); 
    livePlaybackInterval = setInterval(pollLivePlayback, 5000); 
}

async function pollLivePlayback() {
    const token = await getValidToken();
    if (!token) return;

    try {
        const response = await fetch('https://api.spotify.com/v1/me/player', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (response.status === 204) {
            hideLivePlaybackWidget();
            return;
        }

        if (response.ok) {
            const data = await response.json();
            if (data && data.item) {
                showLivePlaybackWidget(data);
            } else {
                hideLivePlaybackWidget();
            }
        }
    } catch (e) {
        console.error("Playback Polling Error:", e);
    }
}

function showLivePlaybackWidget(data) {
    const widget = document.getElementById('live-playback-widget');
    const titleEl = document.getElementById('live-title');
    const artistEl = document.getElementById('live-artist');
    const artEl = document.getElementById('live-art');
    const deviceEl = document.getElementById('live-device');
    const playPauseIcon = document.getElementById('live-play-pause-icon');

    widget.classList.remove('hidden');

    const track = data.item;
    titleEl.innerText = track.name;
    artistEl.innerText = track.artists.map(a => a.name).join(', ');
    artEl.src = track.album?.images[2]?.url || track.album?.images[1]?.url || 'https://via.placeholder.com/80';
    deviceEl.innerText = `Connected: ${data.device?.name || 'Unknown Device'}`;

    currentPlaybackProgressMs = data.progress_ms || 0;
    currentPlaybackDurationMs = track.duration_ms || 0;
    currentPlaybackIsPlaying = data.is_playing;

    updateLiveProgressUI();

    if (localPlaybackTimeTracker) clearInterval(localPlaybackTimeTracker);

    // Continuously update timer second-by-second to track active status
    if (currentPlaybackIsPlaying) {
        localPlaybackTimeTracker = setInterval(() => {
            currentPlaybackProgressMs += 1000;
            if (currentPlaybackProgressMs > currentPlaybackDurationMs) {
                currentPlaybackProgressMs = currentPlaybackDurationMs;
                clearInterval(localPlaybackTimeTracker);
            }
            updateLiveProgressUI();
        }, 1000);
    }

    if (currentPlaybackIsPlaying) {
        playPauseIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
    } else {
        playPauseIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
    }
}

function updateLiveProgressUI() {
    const progressEl = document.getElementById('live-progress-bar');
    const timeEl = document.getElementById('live-time');
    
    const pct = (currentPlaybackProgressMs / currentPlaybackDurationMs) * 100;
    progressEl.style.width = `${Math.min(100, pct)}%`;

    const format = (ms) => {
        const s = Math.floor((ms / 1000) % 60);
        const m = Math.floor(ms / 60000);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    timeEl.innerText = `${format(currentPlaybackProgressMs)} / ${format(currentPlaybackDurationMs)}`;
}

function hideLivePlaybackWidget() {
    document.getElementById('live-playback-widget').classList.add('hidden');
    if (localPlaybackTimeTracker) clearInterval(localPlaybackTimeTracker);
}

async function toggleLivePlayback() {
    const token = await getValidToken();
    if (!token) return;

    const endpoint = currentPlaybackIsPlaying ? 'pause' : 'play';
    try {
        const response = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (response.status === 403) {
            showUIStatus("Spotify Premium session required to modify playback states from other apps.");
        } else {
            pollLivePlayback();
        }
    } catch (e) {
        console.error(e);
    }
}

async function skipLiveNext() {
    const token = await getValidToken();
    if (!token) return;
    try {
        await fetch('https://api.spotify.com/v1/me/player/next', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        pollLivePlayback();
    } catch (e) {
        console.error(e);
    }
}

async function skipLivePrevious() {
    const token = await getValidToken();
    if (!token) return;
    try {
        await fetch('https://api.spotify.com/v1/me/player/previous', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        pollLivePlayback();
    } catch (e) {
        console.error(e);
    }
}

function getRelativeTime(playedAtString) {
    const playedAt = new Date(playedAtString);
    const now = new Date();
    const diffMs = now - playedAt;
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHr = Math.round(diffMin / 60);
    
    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin} min${diffMin > 1 ? 's' : ''} ago`;
    if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
    
    return playedAt.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getAbsoluteTime(playedAtString) {
    const playedAt = new Date(playedAtString);
    return playedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function processFactualMetrics(items) {
    tracksList.innerHTML = '';
    timelineContainer.innerHTML = '';
    
    statCount.innerText = `${items.length}`;
    
    let totalDurationMs = 0;
    let totalPopularity = 0;
    let genreCounts = {};

    const chronologically = [...items].reverse();

    chronologically.forEach((item) => {
        const track = item.track;
        if (!track) return;
        
        totalDurationMs += track.duration_ms;
        totalPopularity += (track.popularity || 0);

        const artistId = track.artists[0]?.id;
        const genres = globalArtistGenres[artistId] || [];
        genres.forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
    });

    const totalMinutes = Math.round(totalDurationMs / 60000);
    statRuntime.innerText = `${totalMinutes} min`;

    const avgPopularity = items.length > 0 ? Math.round(totalPopularity / items.length) : 0;
    statPopularity.innerText = `${avgPopularity}%`;

    const sortedGenres = Object.keys(genreCounts).sort((a,b) => genreCounts[b] - genreCounts[a]);
    statTopGenre.innerText = sortedGenres.length > 0 ? sortedGenres[0] : 'None';

    chronologically.forEach((item, index) => {
        const track = item.track;
        const playedAtStr = item.played_at;
        const relativeTime = getRelativeTime(playedAtStr);
        const absoluteTime = getAbsoluteTime(playedAtStr);

        let gapText = "";
        if (index > 0) {
            const prevItem = chronologically[index - 1];
            const prevEnd = new Date(prevItem.played_at).getTime();
            const trackDuration = track.duration_ms;
                    
            const currentEnd = new Date(item.played_at).getTime();
            const currentStart = currentEnd - trackDuration;
                    
            const gapMs = currentStart - prevEnd;
            if (gapMs > 5000) {
                const gapSec = Math.round(gapMs / 1000);
                const gapMin = Math.round(gapSec / 60);
                if (gapMin > 0) {
                    gapText = `Break of ${gapMin} min${gapMin > 1 ? 's' : ''}`;
                } else {
                    gapText = `Break of ${gapSec} sec`;
                }
            } else {
                gapText = "Continuous stream";
            }
        }

        const logNode = document.createElement('div');
        logNode.className = 'relative pl-4 group';
        logNode.innerHTML = `
            <div class="absolute -left-[31px] top-1.5 w-2.5 h-2.5 rounded-full border border-zinc-900 bg-emerald-500 shadow-[0_0_8px_rgba(29,185,84,0.4)] group-hover:bg-emerald-400 transition-colors"></div>
            <div class="flex flex-col sm:flex-row sm:justify-between sm:items-baseline text-xs">
                <p class="font-bold text-white text-sm truncate">${track.name} <span class="text-zinc-500 font-normal text-xs">by ${track.artists.map(a => a.name).join(', ')}</span></p>
                <span class="text-[10px] text-zinc-500 whitespace-nowrap">${relativeTime} (${absoluteTime})</span>
            </div>
            ${gapText ? `<p class="text-[10px] text-zinc-500 font-medium tracking-wider mt-0.5 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800/40 inline-block uppercase">${gapText}</p>` : ''}
        `;
        timelineContainer.prepend(logNode);
    });

    // standard Event delegation prevents inline escaping failures
    items.forEach((item, index) => {
        const track = item.track;
        const relativeTime = getRelativeTime(item.played_at);
        const albumArt = track.album?.images[1]?.url || 'https://via.placeholder.com/150';
        const trackName = track.name;
        const artistName = track.artists.map(a => a.name).join(', ');
        const mainArtistId = track.artists[0]?.id;

        const card = document.createElement('div');
        card.className = 'card-bg rounded-xl p-3.5 flex flex-col justify-between cursor-pointer transition duration-150 transform active:scale-[0.99] relative overflow-hidden';
                
        card.innerHTML = `
            <div class="flex items-start justify-between space-x-3 min-w-0">
                <div class="flex items-center space-x-3 min-w-0">
                    <img src="${albumArt}" class="w-11 h-11 rounded shadow-md object-cover flex-shrink-0">
                    <div class="min-w-0">
                        <p class="font-bold text-white truncate text-xs">${trackName}</p>
                        <p class="text-[10px] text-zinc-400 truncate">${artistName}</p>
                        <p class="text-[9px] text-zinc-500 font-semibold uppercase tracking-wider mt-1 block">${relativeTime}</p>
                    </div>
                </div>
                <button class="play-btn w-7 h-7 rounded-full bg-zinc-900 hover:bg-zinc-700 active:scale-90 text-white flex items-center justify-center transition" title="Play directly on Spotify Device">
                    <svg class="w-2.5 h-2.5 fill-current spotify-green" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
            </div>

            <div class="slider-container relative w-full h-8 bg-zinc-950 rounded-full border border-zinc-800/80 overflow-hidden mt-3.5 select-none flex items-center justify-center pointer-events-auto">
                <span class="text-[9px] text-zinc-500 font-extrabold uppercase tracking-widest slider-text">Slide to Queue</span>
                <div class="absolute left-0 top-0 bottom-0 w-8 bg-emerald-500 rounded-full flex items-center justify-center cursor-pointer transition-colors active:scale-95 slider-handle">
                    <span class="text-black font-extrabold text-xs pointer-events-none">➔</span>
                </div>
            </div>
        `;

        // Safe click targeting separation
        card.addEventListener('click', (e) => {
            if (e.target.closest('.slider-container') || e.target.closest('.play-btn')) {
                return; 
            }
            openModal(track.id, mainArtistId, trackName, artistName, albumArt, track.album?.name, track.album?.release_date, track.popularity, item.played_at);
        });

        const playBtn = card.querySelector('.play-btn');
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            playTrackOnSpotify(track.uri);
        });

        const sliderHandle = card.querySelector('.slider-handle');
        sliderHandle.addEventListener('mousedown', (e) => initSlider(e, track.uri));
        sliderHandle.addEventListener('touchstart', (e) => initSlider(e, track.uri));

        tracksList.appendChild(card);
    });

    trackCount.innerText = `${items.length} tracks`;
}

// Slide drag implementation
function initSlider(e, uri) {
    e.preventDefault();
    isSliding = true;
    activeHandle = e.currentTarget;
    activeUri = uri;
    currentSlideX = 0;
            
    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    startX = clientX;
            
    sliderWidth = activeHandle.parentElement.clientWidth - activeHandle.clientWidth;
            
    document.addEventListener('mousemove', handleSlide);
    document.addEventListener('touchmove', handleSlide, { passive: false });
    document.addEventListener('mouseup', endSlide);
    document.addEventListener('touchend', endSlide);
}

function handleSlide(e) {
    if (!isSliding || !activeHandle) return;
    if (e.cancelable) e.preventDefault();
            
    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    let deltaX = clientX - startX;
            
    deltaX = Math.max(0, Math.min(deltaX, sliderWidth));
    currentSlideX = deltaX; // save real coordinate state directly
            
    activeHandle.style.transform = `translateX(${deltaX}px)`;
            
    const pct = (deltaX / sliderWidth) * 100;
    activeHandle.parentElement.style.background = `linear-gradient(to right, rgba(16, 185, 129, ${pct/300}) ${pct}%, rgb(9, 9, 11) ${pct}%)`;
}

async function endSlide(e) {
    if (!isSliding || !activeHandle) return;
    isSliding = false;
            
    document.removeEventListener('mousemove', handleSlide);
    document.removeEventListener('touchmove', handleSlide);
    document.removeEventListener('mouseup', endSlide);
    document.removeEventListener('touchend', endSlide);

    // Access local tracking coordinate
    if (currentSlideX >= sliderWidth * 0.85) {
        activeHandle.style.transition = 'transform 0.15s ease-out';
        activeHandle.style.transform = `translateX(${sliderWidth}px)`;
                
        const textEl = activeHandle.parentElement.querySelector('.slider-text');
        textEl.innerText = "QUEUING...";
        textEl.classList.add('text-emerald-400');
                
        const success = await addToSpotifyQueue(activeUri);
        if (success) {
            textEl.innerText = "QUEUED!";
            activeHandle.style.backgroundColor = '#10B981';
            setTimeout(() => resetSlider(activeHandle), 1500);
        } else {
            textEl.innerText = "NO ACTIVE PLAYER";
            textEl.classList.remove('text-emerald-400');
            textEl.classList.add('text-red-400');
            activeHandle.style.backgroundColor = '#EF4444';
            setTimeout(() => resetSlider(activeHandle), 3500);
        }
    } else {
        resetSlider(activeHandle);
    }
            
    activeHandle = null;
}

function resetSlider(handle) {
    if (!handle) return;
    handle.style.transition = 'transform 0.2s ease-out, background-color 0.2s';
    handle.style.transform = 'translateX(0px)';
    handle.style.backgroundColor = '#10b981';
            
    const parent = handle.parentElement;
    parent.style.background = 'rgb(9, 9, 11)';
            
    const textEl = parent.querySelector('.slider-text');
    textEl.innerText = "Slide to Queue";
    textEl.className = "text-[9px] text-zinc-500 font-extrabold uppercase tracking-widest slider-text";
            
    setTimeout(() => {
        handle.style.transition = '';
    }, 200);
}

// Active Player Track playback triggers
async function playTrackOnSpotify(trackUri) {
    const token = await getValidToken();
    if (!token) return;

    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/play', {
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: [trackUri] })
        });

        if (response.status === 204) {
            pollLivePlayback(); // refresh the live card immediately
        } else if (response.status === 404) {
            // Fallback to launching deep links directly if player connection is missing
            window.location.href = trackUri;
        } else {
            window.location.href = trackUri;
        }
    } catch (err) {
        window.location.href = trackUri;
    }
}

async function addToSpotifyQueue(trackUri) {
    const token = await getValidToken();
    if (!token) return false;

    try {
        const response = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(trackUri)}`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
        });
                
        if (response.status === 204) {
            return true;
        }
        return false;
    } catch (err) {
        console.error("Queue API Error:", err);
        return false;
    }
}

function filterTracks() {
    const query = document.getElementById('search-input').value.toLowerCase().trim();
    const cards = tracksList.children;
    let visibleCount = 0;

    rawTracksCache.forEach((item, index) => {
        const card = cards[index];
        if (!card) return;
                
        const trackName = item.track.name.toLowerCase();
        const artistName = item.track.artists.map(a => a.name).join(', ').toLowerCase();
                
        if (trackName.includes(query) || artistName.includes(query)) {
            card.classList.remove('hidden');
            visibleCount++;
        } else {
            card.classList.add('hidden');
        }
    });
    trackCount.innerText = `${visibleCount} match${visibleCount !== 1 ? 'es' : ''}`;
}

function openModal(trackId, artistId, title, artist, artUrl, albumName, releaseDate, popularity, playedAt) {
    const genres = globalArtistGenres[artistId] || [];

    modalImg.src = artUrl;
    modalTitle.innerText = title;
    modalArtist.innerText = artist;
    modalGenres.innerText = genres.length > 0 ? genres.slice(0, 3).join(', ') : 'Not returned by Spotify';
    modalAlbum.innerText = albumName || 'Unknown Album';
    modalRelease.innerText = releaseDate || 'Unavailable';
    modalPopularityElement.innerText = `${popularity}%`;
    modalTimestamp.innerText = `${new Date(playedAt).toLocaleString()}`;

    infoModal.classList.remove('hidden');
    setTimeout(() => {
        infoModal.classList.remove('opacity-0');
        modalContainer.classList.remove('scale-95');
    }, 50);
}

function closeModal() {
    infoModal.classList.add('opacity-0');
    modalContainer.classList.add('scale-95');
    setTimeout(() => { infoModal.classList.add('hidden'); }, 200);
}

function handleOutsideModalClick(event) {
    if (event.target === infoModal) {
        closeModal();
    }
}

function saveAIConfig() {
    const provider = document.getElementById('ai-provider').value;
    const key = document.getElementById('ai-key').value.trim();
    localStorage.setItem('ai_provider', provider);
    localStorage.setItem('ai_key', key);
    showUIStatus("AI configuration updated successfully.", false);
}

function generateAIPrivacyClear() {
    localStorage.removeItem('ai_provider');
    localStorage.removeItem('ai_key');
    document.getElementById('ai-key').value = '';
    showUIStatus("AI credentials cleared from local environment.", false);
}

async function runAIAuditor() {
    const provider = localStorage.getItem('ai_provider') || 'openai';
    const key = localStorage.getItem('ai_key');
    const outputTerminal = document.getElementById('ai-output');
    const runBtn = document.getElementById('ai-run-btn');

    if (!key) {
        outputTerminal.innerText = "Error: No API key found. Please enter your API key in the configuration block above and save it.";
        return;
    }

    if (rawTracksCache.length === 0) {
        outputTerminal.innerText = "Error: No Spotify history loaded to analyze yet.";
        return;
    }

    runBtn.disabled = true;
    runBtn.innerText = "Processing...";
    outputTerminal.innerText = "Connecting to model endpoint...\nFormulating prompt based on your last 50 actual stream logs...";

    const tracksSummary = rawTracksCache.map((item, idx) => {
        const track = item.track;
        const genres = globalArtistGenres[track?.artists[0]?.id] || [];
        return `${idx + 1}. "${track.name}" by ${track.artists.map(a=>a.name).join(', ')} [Popularity: ${track.popularity}%, Year: ${track.album.release_date?.slice(0,4)}, Genres: ${genres.join('/')}]`;
    }).join('\n');

    const promptText = `Analyze my last 50 recently played tracks on Spotify. Audit this actual data:\n\n${tracksSummary}\n\nTasks:\n1. Formulate a 2-paragraph musical evaluation profiling my style, tempo trends, and artist overlaps.\n2. Suggest 5 accurate songs for my current profile, explaining why they align with this sequence.\n3. Make note of any sudden style transitions between consecutive entries. Speak as a highly professional music critic. Keep response concise, readable, and authentic.`;

    try {
        let responseText = "";

        if (provider === 'openai') {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: "You are StreamPulse AI, an expert music analyst and DJ auditing scrobble logs." },
                        { role: "user", content: promptText }
                    ]
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API error (${response.status})`);
            }

            const resData = await response.json();
            responseText = resData.choices[0]?.message?.content || "No text generated.";
        } else if (provider === 'gemini') {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: promptText }]
                    }]
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API error (${response.status})`);
            }

            const resData = await response.json();
            responseText = resData.candidates?.[0]?.content?.parts?.[0]?.text || "No text generated.";
        }

        outputTerminal.innerText = responseText;
    } catch (err) {
        outputTerminal.innerText = `API Fetch Error: ${err.message}\n\nPlease check your key and billing limits on your developer panel.`;
    } finally {
        runBtn.disabled = false;
        runBtn.innerText = "Run Analysis";
    }
}

async function generateVibePlaylist(moodProfile) {
    const token = await getValidToken();
    if (!token || rawTracksCache.length === 0) return;

    let filteredUris = [];
    let playlistTitle = "StreamPulse Compilation";
    let playlistDesc = "History session compiled by StreamPulse.";

    if (moodProfile === 'energy') {
        filteredUris = rawTracksCache
            .filter(item => item.track?.popularity > 70)
            .map(item => item.track?.uri)
            .filter(uri => uri);
        playlistTitle = "StreamPulse: Peak Energy 🔥";
        playlistDesc = `Upbeat sessions over 70% popularity compiled on ${new Date().toLocaleDateString()}.`;
    } else if (moodProfile === 'indie') {
        filteredUris = rawTracksCache
            .filter(item => item.track?.popularity <= 60)
            .map(item => item.track?.uri)
            .filter(uri => uri);
        playlistTitle = "StreamPulse: Indie & Deep Cuts ☕";
        playlistDesc = `Deep scrobble cuts under 60% popularity compiled on ${new Date().toLocaleDateString()}.`;
    } else if (moodProfile === 'retro') {
        filteredUris = rawTracksCache
            .filter(item => {
                const year = new Date(item.track?.album?.release_date).getFullYear();
                return year && year < 2020;
            })
            .map(item => item.track?.uri)
            .filter(uri => uri);
        playlistTitle = "StreamPulse: Classic Golden Eras ⏳";
        playlistDesc = `Timeless releases pre-2020 compiled on ${new Date().toLocaleDateString()}.`;
    } else {
        filteredUris = loadedTrackUris;
    }

    if (filteredUris.length === 0) {
        showUIStatus("Filter warning: No tracks match the requirements of this compilation mood.", true);
        return;
    }

    try {
        const meResponse = await fetch('https://api.spotify.com/v1/me', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const meData = await meResponse.json();
        const userId = meData.id;

        const createPlaylistResponse = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: playlistTitle,
                description: playlistDesc,
                public: true
            })
        });
        const playlistData = await createPlaylistResponse.json();
        const playlistId = playlistData.id;

        await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: filteredUris })
        });

        showUIStatus(`Created compilation playlist "${playlistTitle}" with ${filteredUris.length} tracks.`, false);
    } catch (err) {
        showUIStatus("Playlist Engine Error: " + err.message);
    }
}

function renderEmptyState() {
    statCount.innerText = "0";
    statRuntime.innerText = "0 min";
    statPopularity.innerText = "0%";
    statTopGenre.innerText = "None";
    timelineContainer.innerHTML = `<div class="py-4 text-center text-zinc-500 text-xs">No scrobbles audited. Stream music on your account and return.</div>`;
}

async function loginWithSpotifyClick() {
    const verifier = generateRandomString(128);
    localStorage.setItem('code_verifier', verifier);
    const challenge = await generateCodeChallenge(verifier);
            
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: SCOPE,
        redirect_uri: REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: challenge
    });
    window.location.href = 'https://accounts.spotify.com/authorize?' + params.toString();
}

async function exchangeCodeForToken(code) {
    try {
        const codeVerifier = localStorage.getItem('code_verifier');
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier
        });

        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(`Token Exchange Failed: ${errData.error_description || response.statusText}`);
        }

        const data = await response.json();
        saveTokens(data);
        return true;
    } catch (e) {
        showUIStatus(e.message);
        return false;
    }
}

async function getValidToken() {
    let token = localStorage.getItem('access_token');
    const expiresAt = localStorage.getItem('expires_at');
    const refreshToken = localStorage.getItem('refresh_token');

    if (!token) return null;

    if (expiresAt && Date.now() > (Number(expiresAt) - 60000)) {
        if (refreshToken) {
            token = await refreshAccessToken(refreshToken);
        } else {
            token = null;
        }
    }
    return token;
}

async function refreshAccessToken(refreshToken) {
    try {
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        });

        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        if (!response.ok) {
            throw new Error("Failed to refresh access token");
        }

        const data = await response.json();
        saveTokens(data);
        return data.access_token;
    } catch (e) {
        console.error("Session refresh error:", e);
        return null;
    }
}

function saveTokens(data) {
    if (data.access_token) {
        localStorage.setItem('access_token', data.access_token);
        if (data.refresh_token) {
            localStorage.setItem('refresh_token', data.refresh_token);
        }
        if (data.expires_in) {
            const expiresAt = Date.now() + (data.expires_in * 1000);
            localStorage.setItem('expires_at', expiresAt);
        }
    }
}

function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values, x => possible[x % possible.length]).join('');
}

async function generateCodeChallenge(codeVerifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

init();