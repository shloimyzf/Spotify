const CLIENT_ID = '997e4ee06e624c7aaf77a45f30e74394'; 
const REDIRECT_URI = window.location.origin + window.location.pathname; 
const SCOPE = 'user-read-recently-played playlist-modify-public user-modify-playback-state user-read-currently-playing user-read-playback-state';

const logoutBtn = document.getElementById('logout-btn');
const pwaInstallBtn = document.getElementById('pwa-install-btn');
const landingView = document.getElementById('landing-view');
const dashboardView = document.getElementById('dashboard-view');
const tracksList = document.getElementById('tracks-list');

// Cool Metrics Layout Elements
const statRuntime = document.getElementById('stat-runtime');
const statIndie = document.getElementById('stat-indie');
const statGenresCount = document.getElementById('stat-genres-count');
const statHaze = document.getElementById('stat-haze');
const timelineContainer = document.getElementById('timeline-container');

// Unified AI Inspector Elements
const inspectBpm = document.getElementById('inspect-bpm');
const inspectHeader = document.getElementById('inspect-header-details');
const inspectArt = document.getElementById('inspect-art');
const inspectTitle = document.getElementById('inspect-title');
const inspectArtist = document.getElementById('inspect-artist');
const inspectAiContent = document.getElementById('inspect-ai-content');
const inspectKey = document.getElementById('inspect-key');
const inspectTrivia = document.getElementById('inspect-trivia');
const inspectMix = document.getElementById('inspect-mix');
const inspectSimilarList = document.getElementById('inspect-similar-list');
const inspectPlaceholder = document.getElementById('inspect-placeholder');

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

// Active companion loop breaker configuration
let loopProtectionEnabled = false;
let previousTrackArtist = "";
let currentPlayingTrackId = "";
let currentPlayingTrackName = "";
let currentPlayingArtistName = "";

// Dynamic Taxonomy Filters State
let selectedGenreFilter = "";

// Canvas Animation context states for Midnight/ambient visualizations
let canvas, ctx;
let visualizerAnimationId = null;
let waves = [];
let particles = [];
let activeVisualizerBPM = 120;
let activeVisualizerValence = 0.5;

let globalArtistGenres = {};
let loadedTrackUris = [];
let rawTracksCache = [];
let aiInspectionCache = {}; 
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

function toggleConfigDrawer() {
    const drawer = document.getElementById('config-drawer');
    drawer.classList.toggle('translate-x-full');
}

function toggleLoopProtection() {
    const btn = document.getElementById('loop-protect-toggle');
    loopProtectionEnabled = !loopProtectionEnabled;
    if (loopProtectionEnabled) {
        btn.innerText = "Enabled 🟢";
        btn.className = "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold px-3 py-1.5 rounded-lg transition animate-pulse";
    } else {
        btn.innerText = "Disabled 🔴";
        btn.className = "bg-zinc-900 border border-zinc-850 text-red-400 hover:border-zinc-700 text-[10px] font-bold px-3 py-1.5 rounded-lg transition";
    }
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

function switchWorkspaceTab(tabName) {
    document.getElementById('tab-content-hub').classList.add('hidden');
    document.getElementById('tab-content-tracks').classList.add('hidden');

    const btnTimeline = document.getElementById('ws-tab-btn-timeline');
    const btnQueue = document.getElementById('ws-tab-btn-queue');

    btnTimeline.className = "text-xs font-bold uppercase tracking-wider pb-2 border-b-2 border-transparent text-zinc-500 hover:text-zinc-300";
    btnQueue.className = "text-xs font-bold uppercase tracking-wider pb-2 border-b-2 border-transparent text-zinc-500 hover:text-zinc-300";

    if (tabName === 'timeline') {
        document.getElementById('tab-content-hub').classList.remove('hidden');
        btnTimeline.className = "text-xs font-bold uppercase tracking-wider pb-2 border-b-2 border-emerald-500 text-white";
    } else {
        document.getElementById('tab-content-tracks').classList.remove('hidden');
        btnQueue.className = "text-xs font-bold uppercase tracking-wider pb-2 border-b-2 border-emerald-500 text-white";
    }
}

// Settings save block directly checks layout states before execution
function loadSavedAIConfig() {
    const savedProvider = localStorage.getItem('ai_provider') || 'openai';
    const savedKey = localStorage.getItem('ai_key') || '';
    const provEl = document.getElementById('ai-provider');
    const keyEl = document.getElementById('ai-key');
    if (provEl) provEl.value = savedProvider;
    if (keyEl) keyEl.value = savedKey;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSavedAIConfig);
} else {
    loadSavedAIConfig();
}

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
        startLivePlaybackPolling(); 
    } else { 
        logout();
    }
}

function logout() {
    // Only clear Spotify variables so we do NOT erase user AI Keys
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
    statRuntime.innerHTML = `<span class="inline-block w-12 h-4 bg-zinc-800 animate-pulse rounded"></span>`;
    statIndie.innerHTML = `<span class="inline-block w-8 h-4 bg-zinc-800 animate-pulse rounded"></span>`;
    statGenresCount.innerHTML = `<span class="inline-block w-8 h-4 bg-zinc-800 animate-pulse rounded"></span>`;
    statHaze.innerHTML = `<span class="inline-block w-16 h-3 bg-zinc-800 animate-pulse rounded"></span>`;
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
    const currentArtist = track.artists[0]?.name || "";
    
    // Proactive Loop-breaking Protection system (Triggers natively inside polling)
    if (loopProtectionEnabled && previousTrackArtist && previousTrackArtist === currentArtist && currentPlayingTrackId !== track.id) {
        breakArtistLoop(); 
    }

    if (currentPlayingTrackId !== track.id) {
        previousTrackArtist = currentArtist; 
        currentPlayingTrackId = track.id;
        currentPlayingTrackName = track.name;
        currentPlayingArtistName = currentArtist;
        
        // Reset dynamic HUD elements on track changes
        document.getElementById('live-ai-notes-text').classList.add('hidden');
        document.getElementById('live-ai-notes-btn').classList.remove('hidden');
        document.getElementById('live-ai-notes-btn').disabled = false;
        document.getElementById('live-ai-notes-btn').innerText = "📖 AI Liner Notes";
        
        document.getElementById('live-stats-popularity').innerText = `${track.popularity || 0}%`;
        document.getElementById('live-stats-year').innerText = track.album?.release_date?.slice(0,4) || 'N/A';
        
        const mainArtistId = track.artists[0]?.id;
        const genres = globalArtistGenres[mainArtistId] || [];
        document.getElementById('live-stats-genres').innerText = genres.length > 0 ? genres.slice(0,2).join(', ') : 'Eclectic';

        // Auto inspect currently playing track inside HUD left panel
        inspectTrackDetails(track.id);
    }

    titleEl.innerText = track.name;
    artistEl.innerText = track.artists.map(a => a.name).join(', ');
    artEl.src = track.album?.images[2]?.url || track.album?.images[1]?.url || 'https://via.placeholder.com/80';
    deviceEl.innerText = `Connected: ${data.device?.name || 'Unknown Device'}`;

    currentPlaybackProgressMs = data.progress_ms || 0;
    currentPlaybackDurationMs = track.duration_ms || 0;
    currentPlaybackIsPlaying = data.is_playing;

    updateLiveProgressUI();

    if (localPlaybackTimeTracker) clearInterval(localPlaybackTimeTracker);

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

    // Dynamic sync values on the active visualizer elements if open
    updateImmersiveVisualizerProgress();

    const playPauseSVG = currentPlaybackIsPlaying 
        ? `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>` 
        : `<path d="M8 5v14l11-7z"/>`;

    playPauseIcon.innerHTML = playPauseSVG;
    document.getElementById('viz-play-pause-icon').innerHTML = playPauseSVG;
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

// AI Liner Notes Companion Pull
async function getLiveAILinerNotes() {
    const provider = localStorage.getItem('ai_provider') || 'openai';
    const key = localStorage.getItem('ai_key');
    const btn = document.getElementById('live-ai-notes-btn');
    const textEl = document.getElementById('live-ai-notes-text');

    if (!key) {
        btn.innerText = "Key missing! Set in AI tab.";
        return;
    }

    if (!currentPlayingTrackName || !currentPlayingArtistName) return;

    btn.disabled = true;
    btn.innerText = "Fetching Liner Notes...";
    textEl.innerHTML = `<span class="animate-pulse">Retrieving records context...</span>`;
    textEl.classList.remove('hidden');

    const promptText = `Provide exactly one interesting 3-sentence music trivia/history fact about the song "${currentPlayingTrackName}" by ${currentPlayingArtistName}. Respond only with the trivia paragraph.`;

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
                    messages: [{ role: "user", content: promptText }]
                })
            });
            if (response.ok) {
                const resData = await response.json();
                responseText = resData.choices[0]?.message?.content;
            }
        } else if (provider === 'gemini') {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: promptText }] }]
                })
            });
            if (response.ok) {
                const resData = await response.json();
                responseText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
            }
        }

        textEl.innerText = responseText || "No context found.";
        btn.classList.add('hidden'); 
    } catch (e) {
        textEl.innerText = `Could not fetch context: ${e.message}`;
        btn.disabled = false;
        btn.innerText = "📖 Retry AI Liner Notes";
    }
}

// Spotify artist-loop breaker using algorithmically generated recommendation vectors
async function breakArtistLoop() {
    const token = await getValidToken();
    if (!token || !currentPlayingTrackId) return;

    showUIStatus("Breaking loop... Fetching native Spotify recommendation seeds.", false);

    try {
        const response = await fetch(`https://api.spotify.com/v1/recommendations?seed_tracks=${currentPlayingTrackId}&limit=3`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (response.ok) {
            const data = await response.json();
            const recTracks = data.tracks || [];
            let queuedCount = 0;

            for (let track of recTracks) {
                const success = await addToSpotifyQueue(track.uri);
                if (success) queuedCount++;
            }

            if (queuedCount > 0) {
                showUIStatus(`Playback Guard active: Successfully loaded and queued ${queuedCount} similar songs directly from Spotify's Recommendations API.`, false);
                return;
            }
        }
        throw new Error("Target player unavailable or recommendation endpoint blocked.");
    } catch (err) {
        showUIStatus("Autoplay Injection failure. Is your Spotify player session active?", true);
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

function calculateBakedIndicator(items, genreCounts) {
    let chillPoints = 0;
    
    items.forEach(item => {
        const artistId = item.track?.artists[0]?.id;
        const genres = globalArtistGenres[artistId] || [];
        const genreStr = genres.join(' ').toLowerCase();

        if (
            genreStr.includes('ambient') || 
            genreStr.includes('lo-fi') || 
            genreStr.includes('chill') || 
            genreStr.includes('shoegaze') || 
            genreStr.includes('reggae') || 
            genreStr.includes('dream pop') || 
            genreStr.includes('psychedelic')
        ) {
            chillPoints++;
        } else if (item.track?.popularity < 45) {
            chillPoints += 0.5;
        }
    });

    const total = items.length || 1;
    const score = Math.round((chillPoints / total) * 100);

    let status = "Clear Headed ☕";
    if (score > 60) status = `In Orbit 🪐 (${score}%)`;
    else if (score > 40) status = `Baked 🌲 (${score}%)`;
    else if (score > 20) status = `Zoned Out 😶‍🌫️ (${score}%)`;
    else if (score > 5) status = `Chilled 🌊 (${score}%)`;

    return status;
}

function processFactualMetrics(items) {
    tracksList.innerHTML = '';
    timelineContainer.innerHTML = '';
    
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
    const undergroundScore = 100 - avgPopularity;
    statIndie.innerText = `${undergroundScore}%`;

    const uniqueGenres = Object.keys(genreCounts).length;
    statGenresCount.innerText = `${uniqueGenres}`;

    statHaze.innerText = calculateBakedIndicator(items, genreCounts);

    buildGenreFilters(genreCounts);

    chronologically.forEach((item, index) => {
        const track = item.track;
        
        if (selectedGenreFilter) {
            const mainArtistId = track.artists[0]?.id;
            const genres = globalArtistGenres[mainArtistId] || [];
            if (!genres.includes(selectedGenreFilter)) return;
        }

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
        logNode.className = 'relative pl-4 group cursor-pointer';
        logNode.innerHTML = `
            <div class="absolute -left-[31px] top-1.5 w-2.5 h-2.5 rounded-full border border-zinc-900 bg-emerald-500 shadow-[0_0_8px_rgba(29,185,84,0.4)] group-hover:bg-emerald-400 transition-colors"></div>
            <div class="flex flex-col sm:flex-row sm:justify-between sm:items-baseline text-xs">
                <p class="font-bold text-white text-sm truncate">${track.name} <span class="text-zinc-500 font-normal text-xs">by ${track.artists.map(a => a.name).join(', ')}</span></p>
                <span class="text-[10px] text-zinc-500 whitespace-nowrap">${relativeTime} (${absoluteTime})</span>
            </div>
            ${gapText ? `<p class="text-[10px] text-zinc-500 font-medium tracking-wider mt-0.5 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800/40 inline-block uppercase">${gapText}</p>` : ''}
        `;
        
        logNode.addEventListener('click', () => {
            inspectTrackDetails(track.id);
        });

        timelineContainer.prepend(logNode);
    });

    items.forEach((item, index) => {
        const track = item.track;
        const relativeTime = getRelativeTime(item.played_at);
        const albumArt = track.album?.images[1]?.url || 'https://via.placeholder.com/150';
        const trackName = track.name;
        const artistName = track.artists.map(a => a.name).join(', ');

        const card = document.createElement('div');
        card.className = 'card-bg rounded-xl p-3.5 flex flex-col justify-between cursor-pointer transition duration-150 transform active:scale-[0.99] relative overflow-hidden';
                
        card.innerHTML = `
            <div class="flex items-start justify-between space-x-3 min-w-0">
                <div class="flex items-center space-x-3 min-w-0 flex-1">
                    <img src="${albumArt}" class="w-11 h-11 rounded shadow-md object-cover flex-shrink-0 bg-zinc-900">
                    <div class="min-w-0 flex-1">
                        <p class="font-bold text-white truncate text-xs">${trackName}</p>
                        <p class="text-[10px] text-zinc-400 truncate">${artistName}</p>
                        <span class="text-[9px] text-zinc-500 font-semibold uppercase tracking-wider block mt-1">${relativeTime}</span>
                    </div>
                </div>
                
                <div class="flex items-center space-x-1.5 flex-shrink-0" onclick="event.stopPropagation()">
                    <button class="card-play-btn w-7 h-7 rounded-full bg-zinc-900 hover:bg-zinc-700 text-white flex items-center justify-center transition" title="Play on active Spotify Device">
                        <svg class="w-2.5 h-2.5 fill-current spotify-green" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
            </div>

            <div class="slider-container relative w-full h-8 bg-zinc-950 rounded-full border border-zinc-800/80 overflow-hidden mt-3.5 select-none flex items-center justify-center pointer-events-auto">
                <span class="text-[9px] text-zinc-500 font-extrabold uppercase tracking-widest slider-text">Slide to Queue</span>
                <div class="absolute left-0 top-0 bottom-0 w-8 bg-emerald-500 rounded-full flex items-center justify-center cursor-pointer transition-colors active:scale-95 slider-handle">
                    <span class="text-black font-extrabold text-xs pointer-events-none">➔</span>
                </div>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (e.target.closest('.slider-container') || e.target.closest('.play-btn') || e.target.closest('button')) {
                return; 
            }
            inspectTrackDetails(track.id);
        });

        const cardPlayBtn = card.querySelector('.card-play-btn');
        cardPlayBtn.addEventListener('click', (e) => {
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

function buildGenreFilters(genreCounts) {
    const filterContainer = document.getElementById('genre-filter-container');
    filterContainer.innerHTML = '';

    const sortedGenres = Object.entries(genreCounts)
        .sort((a,b) => b[1] - a[1])
        .slice(0, 8); 

    sortedGenres.forEach(([genre, count]) => {
        const pill = document.createElement('button');
        const isActive = selectedGenreFilter === genre;
        
        pill.className = `text-[10px] font-bold px-2.5 py-1 rounded-full border transition active:scale-95 whitespace-nowrap uppercase tracking-wider ${
            isActive ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-zinc-900 border-zinc-850 text-zinc-400 hover:border-zinc-700'
        }`;
        pill.innerText = `${genre} (${count})`;
        
        pill.addEventListener('click', () => {
            if (selectedGenreFilter === genre) {
                selectedGenreFilter = ""; 
            } else {
                selectedGenreFilter = genre;
            }
            processFactualMetrics(rawTracksCache); 
        });

        filterContainer.appendChild(pill);
    });
}

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
    currentSlideX = deltaX;
            
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
            showUIStatus("To add to queue, first open your Spotify app and play a song to establish an active player session.", true);
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
            pollLivePlayback();
        } else if (response.status === 404) {
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

// On-demand single track analysis & similar track generation (Fills left column HUD)
async function inspectTrackDetails(trackId) {
    const matchedItem = rawTracksCache.find(item => item.track?.id === trackId);
    if (!matchedItem) return;

    const track = matchedItem.track;
    const mainArtistId = track.artists[0]?.id;

    // Transition details immediately
    inspectPlaceholder.classList.add('hidden');
    inspectHeader.classList.remove('hidden');
    inspectAiContent.classList.add('hidden');
    inspectBpm.classList.add('hidden');
    
    // Clear and hide Spotify recommended seeds layout while loading
    document.getElementById('inspect-similar-box').classList.add('hidden');

    inspectArt.src = track.album?.images[2]?.url || 'https://via.placeholder.com/80';
    inspectTitle.innerText = track.name;
    inspectArtist.innerText = track.artists.map(a => a.name).join(', ');

    // Repaint Genre Taxonomy index list in selected track inspector HUD
    const genresBox = document.getElementById('inspect-genres-box');
    const genresCloud = document.getElementById('inspect-genres-cloud');
    const genres = globalArtistGenres[mainArtistId] || [];
    if (genres.length > 0) {
        genresCloud.innerHTML = genres.map(g => `<span class="bg-zinc-950 border border-zinc-850 text-zinc-400 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">${g}</span>`).join('');
        genresBox.classList.remove('hidden');
    } else {
        genresBox.classList.add('hidden');
    }

    // Load Spotify native recommendations seeds alongside AI data
    getFactualSpotifyRecommendations(trackId);

    // Read AI cache to prevent spending tokens twice
    const cachedData = aiInspectionCache[trackId];
    if (cachedData) {
        renderInspectorAIUI(cachedData);
        return;
    }

    const key = localStorage.getItem('ai_key');
    if (!key) {
        return;
    }

    // Begin background hydration securely using stored AI keys
    aiInspectionCache[trackId] = "loading";
    const provider = localStorage.getItem('ai_provider') || 'openai';

    const promptText = `Analyze this specific track: "${track.name}" by ${track.artists.map(a => a.name).join(', ')} (released in ${track.album.release_date}, album: "${track.album.name}").

Please use your structural neural knowledge of musicology and music history to provide interesting, accurate song facts. 

Respond ONLY with a valid, parseable JSON object matching this schema. Do not write markdown wraps or code blocks:
{
  "bpm": 122,
  "key": "G Major (Camelot 9B)",
  "valence_mood": "Warm Euphoric",
  "trivia": "Provide a 3-sentence interesting factual context/trivia history about the production, writing, or reception of this song.",
  "mix_tip": "Provide a 2-sentence practical transition tip on how a DJ can cleanly mix this style or what tempo/vibe track to transition into next."
}`;

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
                    messages: [{ role: "user", content: promptText }],
                    response_format: { type: "json_object" }
                })
            });
            if (response.ok) {
                const resData = await response.json();
                responseText = resData.choices[0]?.message?.content;
            }
        } else if (provider === 'gemini') {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: promptText }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });
            if (response.ok) {
                const resData = await response.json();
                responseText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
            }
        }

        const parsed = JSON.parse(responseText);
        aiInspectionCache[trackId] = parsed; 
        renderInspectorAIUI(parsed);

    } catch (e) {
        console.error("AI Insight failed:", e);
        aiInspectionCache[trackId] = null;
    }
}

// Fetch factual similar tracks natively via Spotify Web Recommendations
async function getFactualSpotifyRecommendations(trackId) {
    const token = await getValidToken();
    if (!token) return;

    try {
        const response = await fetch(`https://api.spotify.com/v1/recommendations?seed_tracks=${trackId}&limit=5`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (response.ok) {
            const data = await response.json();
            const recTracks = data.tracks || [];
            
            inspectSimilarList.innerHTML = '';
            
            if (recTracks.length > 0) {
                recTracks.forEach(trackItem => {
                    const row = document.createElement('div');
                    row.className = "bg-zinc-950 p-2.5 border border-zinc-850/80 rounded-xl flex justify-between items-center text-xs font-mono";
                    row.innerHTML = `
                        <div class="min-w-0 pr-2 flex items-center space-x-2 flex-1">
                            <img src="${trackItem.album?.images[2]?.url || 'https://via.placeholder.com/40'}" class="w-7 h-7 rounded object-cover flex-shrink-0">
                            <div class="min-w-0">
                                <p class="text-zinc-200 font-bold truncate text-[11px]">${trackItem.name}</p>
                                <p class="text-zinc-500 text-[9px] truncate">${trackItem.artists.map(a => a.name).join(', ')}</p>
                            </div>
                        </div>
                        <button onclick="handleProgrammaticQueue(event, '${trackItem.uri}')" class="bg-zinc-900 border border-zinc-800 text-[9px] hover:bg-zinc-850 text-emerald-400 font-extrabold px-2.5 py-1.5 rounded uppercase tracking-wider whitespace-nowrap">
                            🔌 Queue Similar
                        </button>
                    `;
                    inspectSimilarList.appendChild(row);
                });
                document.getElementById('inspect-similar-box').classList.remove('hidden');
            }
        }
    } catch (err) {
        console.error("Recommendations failed:", err);
    }
}

// Immediate similar track injector click helper
async function handleProgrammaticQueue(event, trackUri) {
    event.stopPropagation();
    const btn = event.currentTarget;
    btn.innerText = "QUEUEING...";

    const success = await addToSpotifyQueue(trackUri);
    if (success) {
        btn.innerText = "QUEUED ⚡";
        btn.className = "bg-emerald-500/10 border border-emerald-500/20 text-[9px] text-emerald-400 font-extrabold px-2.5 py-1.5 rounded uppercase tracking-wider whitespace-nowrap";
    } else {
        btn.innerText = "FAILED";
        btn.className = "bg-red-950/20 border border-red-900/40 text-[9px] text-red-400 font-extrabold px-2.5 py-1.5 rounded uppercase tracking-wider whitespace-nowrap";
        showUIStatus("Could not search or inject queue. Ensure Spotify has an active player running on your account.", true);
    }
}

function renderInspectorAIUI(parsed) {
    inspectBpm.innerText = `${parsed.bpm || '--'} BPM`;
    inspectBpm.classList.remove('hidden');

    inspectKey.innerText = parsed.key || '--';
    document.getElementById('inspect-vibe-tag').innerText = parsed.valence_mood || '--';
    inspectTrivia.innerText = parsed.trivia || '--';
    inspectMix.innerText = parsed.mix_tip || '--';

    inspectAiContent.classList.remove('hidden');
    
    // Also feed stats context update dynamically to Full-screen canvas visualizer state
    activeVisualizerBPM = parsed.bpm || 120;
    
    document.getElementById('hydration-badge').innerText = "AI MUSICOLOGY ACTIVE";
    document.getElementById('hydration-badge').className = "text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse";
}

function inspectActiveTrack() {
    if (currentPlayingTrackId) {
        inspectTrackDetails(currentPlayingTrackId);
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

// FULL-SCREEN IMMERSIVE VISUALIZER ANIMATION CODE
function openImmersiveVisualizer() {
    const overlay = document.getElementById('fullscreen-viz');
    overlay.classList.remove('translate-y-full', 'pointer-events-none', 'opacity-0');
    overlay.classList.add('translate-y-0', 'opacity-100');

    // Populate metadata indicators instantly
    document.getElementById('viz-art').src = document.getElementById('live-art').src;
    document.getElementById('viz-title').innerText = document.getElementById('live-title').innerText;
    document.getElementById('viz-artist').innerText = document.getElementById('live-artist').innerText;
    
    const keyText = inspectKey.innerText !== '--' ? `${activeVisualizerBPM} BPM | ${inspectKey.innerText}` : 'SYNCING LIVE METRICS...';
    document.getElementById('viz-bpm-key').innerText = keyText;

    // Load lyrics/musicology commentary deck
    const lyricsBox = document.getElementById('viz-floating-commentary');
    if (inspectTrivia.innerText !== '--') {
        lyricsBox.innerText = inspectTrivia.innerText;
    } else {
        lyricsBox.innerText = "Liner Notes Standby. Connect AI config to unlock musicology commentary...";
    }

    startImmersiveVisualizerRender();
}

function closeImmersiveVisualizer() {
    const overlay = document.getElementById('fullscreen-viz');
    overlay.classList.remove('translate-y-0', 'opacity-100');
    overlay.classList.add('translate-y-full', 'pointer-events-none', 'opacity-0');

    stopImmersiveVisualizerRender();
}

function updateImmersiveVisualizerProgress() {
    const progressText = document.getElementById('viz-time-progress');
    const durationText = document.getElementById('viz-time-duration');
    const progressBar = document.getElementById('viz-progress-bar');

    const format = (ms) => {
        const s = Math.floor((ms / 1000) % 60);
        const m = Math.floor(ms / 60000);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    if (currentPlayingTrackId) {
        progressText.innerText = format(currentPlaybackProgressMs);
        durationText.innerText = format(currentPlaybackDurationMs);
        const pct = (currentPlaybackProgressMs / currentPlaybackDurationMs) * 100;
        progressBar.style.width = `${Math.min(100, pct)}%`;

        // Switch commentary stories halfway through playback
        const lyricsBox = document.getElementById('viz-floating-commentary');
        if (inspectTrivia.innerText !== '--' && inspectMix.innerText !== '--') {
            if (pct > 50) {
                lyricsBox.innerText = inspectMix.innerText;
            } else {
                lyricsBox.innerText = inspectTrivia.innerText;
            }
        }
    }
}

function startImmersiveVisualizerRender() {
    canvas = document.getElementById('viz-canvas');
    ctx = canvas.getContext('2d');
    
    // Scale canvas resolution safely
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;

    // Define sine wave structures
    waves = [
        { y: canvas.height * 0.5, length: 0.005, amplitude: 40, frequency: 0.02, color: 'rgba(29, 185, 84, 0.15)' },
        { y: canvas.height * 0.5, length: 0.01, amplitude: 20, frequency: 0.04, color: 'rgba(16, 185, 129, 0.1)' },
        { y: canvas.height * 0.5, length: 0.002, amplitude: 60, frequency: 0.01, color: 'rgba(52, 211, 153, 0.05)' }
    ];

    // Define particle array structures
    particles = Array(40).fill(0).map(() => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2 + 1,
        vX: Math.random() * 0.5 - 0.25,
        vY: Math.random() * -0.5 - 0.1
    }));

    animateVisualizer();
}

function stopImmersiveVisualizerRender() {
    if (visualizerAnimationId) {
        cancelAnimationFrame(visualizerAnimationId);
        visualizerAnimationId = null;
    }
}

function animateVisualizer() {
    visualizerAnimationId = requestAnimationFrame(animateVisualizer);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Speed modifiers synced directly to active track BPM
    const bpmSpeedMultiplier = currentPlaybackIsPlaying ? (activeVisualizerBPM / 120) : 0.15;

    // Draw multi-layered ambient color morphing sine waves
    waves.forEach(wave => {
        ctx.beginPath();
        ctx.moveTo(0, wave.y);

        for (let i = 0; i < canvas.width; i++) {
            const waveY = wave.y + Math.sin(i * wave.length + wave.frequency) * wave.amplitude;
            ctx.lineTo(i, waveY);
        }

        ctx.strokeStyle = wave.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Increment wave phase frequency synced to BPM speed
        wave.frequency += 0.01 * bpmSpeedMultiplier;
    });

    // Draw and update ambient particles
    particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fill();

        // Apply physical updates mapped to current tempo playback state
        p.x += p.vX * bpmSpeedMultiplier;
        p.y += p.vY * bpmSpeedMultiplier;

        // Recycle boundaries
        if (p.y < 0) {
            p.y = canvas.height;
            p.x = Math.random() * canvas.width;
        }
        if (p.x < 0 || p.x > canvas.width) {
            p.vX *= -1;
        }
    });
}

// Redesigned AI Auditor is now disabled as features are fully parsed directly into HUD Left Panel
function runAIAuditor() {
    switchTab('ai');
}

function renderEmptyState() {
    statRuntime.innerText = "0 min";
    statIndie.innerText = "0%";
    statGenresCount.innerText = "0";
    statHaze.innerText = "Unknown";
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
