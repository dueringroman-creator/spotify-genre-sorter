// ===== SPOTIFY OAUTH SETUP =====
const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';

// ===== GLOBAL STATE =====
let selectedGenres = new Set();
let genreSongMap = {}; // genre -> array of track objects
let playlistHistory = []; // Store created playlists
let cachedLibraryData = null; // Cache for library data
let genreViewMode = 'families'; // 'families', 'detailed', 'all'

// ===== GENRE FAMILY MAPPING =====

const genreFamilies = {
  // Electronic families
  "house": {
    name: "House",
    keywords: ["house"],
    exclude: ["tech house", "deep house", "progressive house", "electro house", 
              "tropical house", "future house", "bass house", "melodic house"],
    color: "#FF6B6B"
  },
  "tech-house": {
    name: "Tech House",
    keywords: ["tech house"],
    exclude: [],
    color: "#FF8787"
  },
  "deep-house": {
    name: "Deep House",
    keywords: ["deep house"],
    exclude: [],
    color: "#FFA5A5"
  },
  "techno": {
    name: "Techno",
    keywords: ["techno"],
    exclude: ["tech house"],
    color: "#4ECDC4"
  },
  "trance": {
    name: "Trance",
    keywords: ["trance"],
    exclude: [],
    color: "#95E1D3"
  },
  "drum-and-bass": {
    name: "Drum & Bass",
    keywords: ["drum and bass", "dnb", "drum n bass", "liquid funk", "neurofunk", "jump up"],
    exclude: [],
    color: "#F38181"
  },
  "dubstep": {
    name: "Dubstep",
    keywords: ["dubstep", "brostep", "riddim"],
    exclude: [],
    color: "#AA96DA"
  },
  "ambient": {
    name: "Ambient",
    keywords: ["ambient", "downtempo", "chillout"],
    exclude: [],
    color: "#FCBAD3"
  },
  "breakbeat": {
    name: "Breakbeat",
    keywords: ["breakbeat", "breaks"],
    exclude: [],
    color: "#FFFFD2"
  },
  
  // Hip-Hop families
  "hip-hop": {
    name: "Hip-Hop",
    keywords: ["hip hop", "rap"],
    exclude: ["trap", "boom bap", "conscious hip hop", "alternative hip hop"],
    color: "#A8E6CF"
  },
  "trap": {
    name: "Trap",
    keywords: ["trap"],
    exclude: [],
    color: "#FFD3B6"
  },
  
  // Rock families
  "rock": {
    name: "Rock",
    keywords: ["rock"],
    exclude: ["indie rock", "alternative rock", "punk", "metal", "hard rock", 
              "progressive rock", "psychedelic rock", "garage rock"],
    color: "#FFAAA5"
  },
  "indie-rock": {
    name: "Indie Rock",
    keywords: ["indie rock", "indie pop"],
    exclude: [],
    color: "#FF8B94"
  },
  "alternative-rock": {
    name: "Alternative Rock",
    keywords: ["alternative rock", "alt rock"],
    exclude: [],
    color: "#FFC6C7"
  },
  "punk": {
    name: "Punk",
    keywords: ["punk"],
    exclude: ["post-punk"],
    color: "#C7CEEA"
  },
  "metal": {
    name: "Metal",
    keywords: ["metal"],
    exclude: [],
    color: "#B4B4B8"
  },
  
  // Pop families
  "pop": {
    name: "Pop",
    keywords: ["pop"],
    exclude: ["indie pop", "synth pop", "dream pop", "k-pop", "j-pop"],
    color: "#FFDFD3"
  },
  
  // Jazz/Blues
  "jazz": {
    name: "Jazz",
    keywords: ["jazz"],
    exclude: [],
    color: "#FEC8D8"
  },
  "blues": {
    name: "Blues",
    keywords: ["blues"],
    exclude: [],
    color: "#957DAD"
  },
  
  // R&B/Soul
  "r-n-b": {
    name: "R&B",
    keywords: ["r&b", "rnb", "rhythm and blues"],
    exclude: [],
    color: "#D291BC"
  },
  "soul": {
    name: "Soul",
    keywords: ["soul", "neo soul"],
    exclude: [],
    color: "#E0BBE4"
  },
  
  // Reggae
  "reggae": {
    name: "Reggae",
    keywords: ["reggae", "dub", "dancehall"],
    exclude: [],
    color: "#FFDAC1"
  },
  
  // Folk/Country
  "folk": {
    name: "Folk",
    keywords: ["folk"],
    exclude: ["indie folk"],
    color: "#B5EAD7"
  },
  "country": {
    name: "Country",
    keywords: ["country"],
    exclude: [],
    color: "#C7CEEA"
  }
};

function detectGenreFamily(spotifyGenre) {
  const lowerGenre = spotifyGenre.toLowerCase().trim();
  
  for (const [familyId, family] of Object.entries(genreFamilies)) {
    // Check if it should be excluded
    const isExcluded = family.exclude.some(exc => lowerGenre.includes(exc.toLowerCase()));
    if (isExcluded) continue;
    
    // Check if it matches keywords
    const matches = family.keywords.some(kw => lowerGenre.includes(kw.toLowerCase()));
    if (matches) {
      return {
        id: familyId,
        name: family.name,
        color: family.color
      };
    }
  }
  
  return {
    id: "other",
    name: "Other",
    color: "#E8E8E8"
  };
}

function buildGenreFamilyMap(genreSongMap) {
  const familyMap = {};
  
  Object.entries(genreSongMap).forEach(([genre, tracks]) => {
    const family = detectGenreFamily(genre);
    
    if (!familyMap[family.id]) {
      familyMap[family.id] = {
        name: family.name,
        color: family.color,
        genres: {},
        totalTracks: 0
      };
    }
    
    familyMap[family.id].genres[genre] = tracks;
    familyMap[family.id].totalTracks += tracks.length;
  });
  
  return familyMap;
}

// ===== CACHE MANAGEMENT =====

function getCacheKey(dataSource) {
  return `library_cache_${dataSource}`;
}

function getCacheTimestampKey(dataSource) {
  return `library_cache_timestamp_${dataSource}`;
}

function saveToCache(dataSource, data) {
  try {
    localStorage.setItem(getCacheKey(dataSource), JSON.stringify(data));
    localStorage.setItem(getCacheTimestampKey(dataSource), Date.now().toString());
  } catch (e) {
    console.warn('Cache storage failed:', e);
  }
}

function loadFromCache(dataSource) {
  try {
    const cached = localStorage.getItem(getCacheKey(dataSource));
    const timestamp = localStorage.getItem(getCacheTimestampKey(dataSource));
    
    if (cached && timestamp) {
      return {
        data: JSON.parse(cached),
        timestamp: parseInt(timestamp)
      };
    }
  } catch (e) {
    console.warn('Cache load failed:', e);
  }
  return null;
}

function clearCache(dataSource) {
  localStorage.removeItem(getCacheKey(dataSource));
  localStorage.removeItem(getCacheTimestampKey(dataSource));
}

function updateCacheInfo(timestamp) {
  const cacheInfo = document.getElementById('cache-info');
  const refreshBtn = document.getElementById('refresh-cache');
  
  if (timestamp) {
    const timeAgo = getTimeAgo(new Date(timestamp));
    cacheInfo.innerHTML = `<strong>Cached:</strong> Last updated ${timeAgo}`;
    cacheInfo.style.display = 'block';
    refreshBtn.style.display = 'inline-block';
  } else {
    cacheInfo.style.display = 'none';
    refreshBtn.style.display = 'none';
  }
}

// ===== UTILITY FUNCTIONS =====

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Create Music-Map URL from artist name
function getMusicMapUrl(artistName) {
  // Replace spaces with + and encode
  const formattedName = artistName.trim().replace(/\s+/g, '+').toLowerCase();
  return `https://www.music-map.com/${encodeURIComponent(formattedName)}`;
}

// Retry mechanism for network requests
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      updateStatus(`⚠️ Network error, retrying... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
    }
  }
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function updateStatus(msg) {
  document.getElementById('status').innerText = msg;
  console.log(msg);
}

// ===== PLAYLIST HISTORY MANAGEMENT =====

function loadPlaylistHistory() {
  const stored = localStorage.getItem('playlist_history');
  if (stored) {
    playlistHistory = JSON.parse(stored);
    displayPlaylistHistory();
  }
}

function savePlaylistHistory() {
  localStorage.setItem('playlist_history', JSON.stringify(playlistHistory));
}

function addToHistory(playlist, tracks) {
  playlistHistory.unshift({
    name: playlist.name,
    url: playlist.external_urls.spotify,
    trackCount: tracks.length,
    tracks: tracks, // Store tracks for export
    createdAt: new Date().toISOString()
  });
  
  // Keep only last 20 playlists
  if (playlistHistory.length > 20) {
    playlistHistory = playlistHistory.slice(0, 20);
  }
  
  savePlaylistHistory();
  displayPlaylistHistory();
}

function displayPlaylistHistory() {
  const container = document.getElementById('history-list');
  
  if (playlistHistory.length === 0) {
    container.innerHTML = '<div class="history-empty">No playlists created yet. Start creating!</div>';
    return;
  }
  
  container.innerHTML = playlistHistory.map((item, index) => {
    const date = new Date(item.createdAt);
    const timeAgo = getTimeAgo(date);
    
    return `
      <div class="history-item">
        <div class="history-item-info">
          <div class="history-item-name">
            <a href="${item.url}" target="_blank">${item.name}</a>
          </div>
          <div class="history-item-meta">${item.trackCount} tracks • ${timeAgo}</div>
        </div>
        <div class="history-item-actions">
          <button class="history-item-link" onclick="exportPlaylist(${index}, 'csv')">CSV</button>
          <button class="history-item-link" onclick="exportPlaylist(${index}, 'txt')">TXT</button>
        </div>
      </div>
    `;
  }).join('');
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  return date.toLocaleDateString();
}

// ===== EXPORT FUNCTIONALITY =====

function exportPlaylist(historyIndex, format) {
  const playlist = playlistHistory[historyIndex];
  
  if (!playlist.tracks || playlist.tracks.length === 0) {
    alert('No track data available for export. This playlist was created before export feature was added.');
    return;
  }
  
  if (format === 'csv') {
    exportAsCSV(playlist);
  } else if (format === 'txt') {
    exportAsTXT(playlist);
  }
}

function exportAsCSV(playlist) {
  const headers = ['Track Name', 'Artist', 'Album', 'Genres', 'Duration (ms)', 'Spotify URL'];
  const rows = [headers];
  
  playlist.tracks.forEach(track => {
    const trackName = track.name || '';
    const artist = track.artists ? track.artists.map(a => a.name).join('; ') : '';
    const album = track.album ? track.album.name : '';
    const genres = ''; // Genres are per-artist, would need additional API calls
    const duration = track.duration_ms || '';
    const url = track.external_urls ? track.external_urls.spotify : '';
    
    rows.push([
      escapeCSV(trackName),
      escapeCSV(artist),
      escapeCSV(album),
      escapeCSV(genres),
      duration,
      url
    ]);
  });
  
  const csvContent = rows.map(row => row.join(',')).join('\n');
  downloadFile(csvContent, `${playlist.name}.csv`, 'text/csv');
}

function exportAsTXT(playlist) {
  const lines = playlist.tracks.map(track => {
    const artist = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown Artist';
    const trackName = track.name || 'Unknown Track';
    return `${artist} - ${trackName}`;
  });
  
  const txtContent = lines.join('\n');
  downloadFile(txtContent, `${playlist.name}.txt`, 'text/plain');
}

function escapeCSV(str) {
  if (!str) return '';
  str = str.toString();
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ===== LOGIN FLOW =====

document.getElementById('login').addEventListener('click', async () => {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem(CODE_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'user-library-read playlist-modify-public playlist-modify-private user-top-read',
    state: generateRandomString(16),
    code_challenge_method: 'S256',
    code_challenge: challenge
  });
  
  window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
});

async function fetchAccessToken(code) {
  const verifier = localStorage.getItem(CODE_VERIFIER_KEY);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier
  });
  
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  });
  
  const data = await resp.json();
  if (data.access_token) {
    window.spotifyToken = data.access_token;
    updateStatus('✅ Logged in successfully!');
    
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('app-section').classList.remove('hidden');
    
    // Load playlist history
    loadPlaylistHistory();
  } else {
    updateStatus('❌ Login failed');
    console.error(data);
  }
}

// ===== TAB SWITCHING =====

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    btn.classList.add('active');
    const tabName = btn.getAttribute('data-tab');
    document.getElementById(`${tabName}-tab`).classList.add('active');
  });
});

// ===== ONBOARDING =====

// Help button - reopen tour
document.getElementById('help-button')?.addEventListener('click', () => {
  // Check if user is logged in
  const appSection = document.getElementById('app-section');
  if (appSection && appSection.classList.contains('hidden')) {
    alert('👋 Please login with Spotify first to see the interactive tour!\n\nThe tour will guide you through all features once you\'re logged in.');
    return;
  }
  showTour();
});

// About section toggle
function toggleAbout() {
  const content = document.getElementById('about-content');
  const icon = document.getElementById('about-icon');
  
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    icon.classList.add('open');
  } else {
    content.classList.add('hidden');
    icon.classList.remove('open');
  }
}

// Tour functionality
function showTour() {
  document.getElementById('tour-overlay').classList.remove('hidden');
  document.getElementById('tour-step-1').classList.remove('hidden');
}

function closeTour() {
  document.getElementById('tour-overlay').classList.add('hidden');
  document.querySelectorAll('.tour-step').forEach(step => step.classList.add('hidden'));
  localStorage.setItem('tour_completed', 'true');
}

function nextTourStep(stepNum) {
  document.querySelectorAll('.tour-step').forEach(step => step.classList.add('hidden'));
  document.getElementById(`tour-step-${stepNum}`).classList.remove('hidden');
}

function prevTourStep(stepNum) {
  document.querySelectorAll('.tour-step').forEach(step => step.classList.add('hidden'));
  document.getElementById(`tour-step-${stepNum}`).classList.remove('hidden');
}

// Check if user has completed tour
window.addEventListener('load', () => {
  if (!localStorage.getItem('tour_completed')) {
    // Show tour on first visit after login
    const checkLogin = setInterval(() => {
      if (!document.getElementById('app-section').classList.contains('hidden')) {
        showTour();
        clearInterval(checkLogin);
      }
    }, 500);
  }
});

// ===== LIBRARY MODE - FETCH TRACKS =====

document.getElementById('fetch-tracks').addEventListener('click', async () => {
  if (!window.spotifyToken) return;
  
  const dataSource = document.querySelector('input[name="data-source"]:checked').value;
  document.getElementById('fetch-tracks').disabled = true;
  
  // Check cache first
  const cached = loadFromCache(dataSource);
  if (cached) {
    const useCache = confirm(`Found cached data from ${getTimeAgo(new Date(cached.timestamp))}. Use cached data? (Cancel to fetch fresh data)`);
    if (useCache) {
      cachedLibraryData = cached.data;
      await processLibraryData(dataSource);
      document.getElementById('fetch-tracks').disabled = false;
      updateCacheInfo(cached.timestamp);
      return;
    }
  }
  
  try {
    switch (dataSource) {
      case 'liked-songs':
        await fetchLikedSongs();
        break;
      case 'top-artists':
        await fetchTopArtists();
        break;
      case 'playlists':
        await fetchFromPlaylists();
        break;
    }
    
    // Save to cache
    saveToCache(dataSource, cachedLibraryData);
    updateCacheInfo(Date.now());
    
    await processLibraryData(dataSource);
  } catch (e) {
    updateStatus(`❌ Error: ${e.message}`);
  }
  
  document.getElementById('fetch-tracks').disabled = false;
});

// Refresh cache button
document.getElementById('refresh-cache').addEventListener('click', async () => {
  const dataSource = document.querySelector('input[name="data-source"]:checked').value;
  clearCache(dataSource);
  updateCacheInfo(null);
  updateStatus('Cache cleared. Click "Load Music Library" to fetch fresh data.');
});

async function fetchLikedSongs() {
  updateStatus('🎵 Fetching your liked songs...');
  let all = [];
  const limit = 50;
  let offset = 0;
  
  while (true) {
    const resp = await fetchWithRetry(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
    });
    const data = await resp.json();
    all.push(...data.items);
    updateStatus(`Fetched ${all.length} tracks...`);
    if (!data.next) break;
    offset += limit;
  }
  
  cachedLibraryData = { type: 'tracks', items: all };
  updateStatus(`✅ Fetched ${all.length} tracks!`);
}

async function fetchTopArtists() {
  updateStatus('⭐ Fetching your top artists...');
  
  const resp = await fetchWithRetry(
    'https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term',
    { headers: { 'Authorization': `Bearer ${window.spotifyToken}` } }
  );
  const data = await resp.json();
  
  // Get top tracks for each artist
  updateStatus('🎵 Fetching top tracks from your favorite artists...');
  let allTracks = [];
  
  for (let i = 0; i < data.items.length; i++) {
    const artist = data.items[i];
    const tracksResp = await fetchWithRetry(
      `https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=US`,
      { headers: { 'Authorization': `Bearer ${window.spotifyToken}` } }
    );
    const tracksData = await tracksResp.json();
    
    // Add tracks in liked songs format
    tracksData.tracks.slice(0, 5).forEach(track => {
      allTracks.push({ track: track });
    });
    
    updateStatus(`Processed ${i + 1}/${data.items.length} artists...`);
  }
  
  cachedLibraryData = { type: 'tracks', items: allTracks };
  updateStatus(`✅ Loaded ${allTracks.length} tracks from your top artists!`);
}

async function fetchFromPlaylists() {
  updateStatus('📚 Fetching your playlists...');
  
  // Get all user playlists
  let allPlaylists = [];
  let offset = 0;
  const limit = 50;
  
  while (true) {
    const resp = await fetchWithRetry(
      `https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`,
      { headers: { 'Authorization': `Bearer ${window.spotifyToken}` } }
    );
    const data = await resp.json();
    allPlaylists.push(...data.items);
    if (!data.next) break;
    offset += limit;
  }
  
  updateStatus(`Found ${allPlaylists.length} playlists. Scanning tracks...`);
  
  // Get tracks from all playlists
  let allTracks = [];
  const trackSet = new Set(); // Avoid duplicates
  
  for (let i = 0; i < allPlaylists.length; i++) {
    const playlist = allPlaylists[i];
    
    let playlistTracks = [];
    let trackOffset = 0;
    
    while (true) {
      const resp = await fetchWithRetry(
        `https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=100&offset=${trackOffset}`,
        { headers: { 'Authorization': `Bearer ${window.spotifyToken}` } }
      );
      const data = await resp.json();
      playlistTracks.push(...data.items);
      if (!data.next) break;
      trackOffset += 100;
    }
    
    // Add unique tracks
    playlistTracks.forEach(item => {
      if (item.track && item.track.id && !trackSet.has(item.track.id)) {
        trackSet.add(item.track.id);
        allTracks.push(item);
      }
    });
    
    updateStatus(`Scanned ${i + 1}/${allPlaylists.length} playlists... (${allTracks.length} unique tracks)`);
  }
  
  cachedLibraryData = { type: 'tracks', items: allTracks };
  updateStatus(`✅ Loaded ${allTracks.length} unique tracks from ${allPlaylists.length} playlists!`);
}

async function processLibraryData(dataSource) {
  updateStatus('🔍 Processing genres...');
  
  const tracks = cachedLibraryData.items;
  
  // Extract unique artist IDs
  const artistIds = new Set();
  tracks.forEach(item => {
    if (item.track && item.track.artists && item.track.artists[0]) {
      artistIds.add(item.track.artists[0].id);
    }
  });
  
  const ids = Array.from(artistIds);
  const artistGenreMap = {};
  
  // Fetch genres for all artists
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(',');
    const resp = await fetchWithRetry(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
    });
    const data = await resp.json();
    data.artists.forEach(a => {
      if (a) artistGenreMap[a.id] = a.genres;
    });
    updateStatus(`Processing artists: ${Math.min(i + 50, ids.length)} / ${ids.length}...`);
  }
  
  // Build genre -> songs map
  genreSongMap = buildGenreSongMap(tracks, artistGenreMap);
  
  // Display genre selection UI
  displayGenreSelection(tracks.length);
  updateStatus('✅ Genres loaded! Select genres to create a playlist.');
}

// ===== LIBRARY MODE - FETCH GENRES & BUILD MAP =====

// Build genre -> songs mapping
function buildGenreSongMap(tracks, artistGenreMap) {
  const map = {};
  
  tracks.forEach(item => {
    if (!item.track || !item.track.artists || !item.track.artists[0]) return;
    
    const track = item.track;
    const artistId = track.artists[0].id;
    const genres = artistGenreMap[artistId] || [];
    
    genres.forEach(genre => {
      if (!map[genre]) {
        map[genre] = [];
      }
      // Avoid duplicates
      if (!map[genre].find(t => t.id === track.id)) {
        map[genre].push(track);
      }
    });
  });
  
  return map;
}

// ===== DISPLAY GENRE SELECTION UI =====

function displayGenreSelection(totalTracks) {
  // Show genre selection area
  document.getElementById('genre-selection-area').classList.remove('hidden');
  
  // Sort genres by number of tracks (descending)
  const sortedGenres = Object.entries(genreSongMap)
    .sort((a, b) => b[1].length - a[1].length);
  
  // Display stats
  displayGenreStats(sortedGenres, totalTracks);
  
  // Initial render with current view mode
  renderGenreView();
  
  // Add view mode change listener
  document.getElementById('genre-view-mode').addEventListener('change', (e) => {
    genreViewMode = e.target.value;
    renderGenreView();
  });
}

function renderGenreView() {
  const grid = document.getElementById('genre-grid');
  
  if (genreViewMode === 'families') {
    renderFamiliesView(grid);
  } else if (genreViewMode === 'detailed') {
    renderDetailedView(grid);
  } else {
    renderAllGenresView(grid);
  }
}

// View 1: Genre Families (Grouped)
function renderFamiliesView(grid) {
  const familyMap = buildGenreFamilyMap(genreSongMap);
  
  // Sort families by total tracks
  const sortedFamilies = Object.entries(familyMap)
    .sort((a, b) => b[1].totalTracks - a[1].totalTracks);
  
  grid.innerHTML = sortedFamilies.map(([familyId, family]) => `
    <div class="genre-family-item" data-family-id="${familyId}" 
         style="border-color: ${family.color}40">
      <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: ${family.color};"></div>
      <div class="genre-family-header">
        <div class="genre-family-name">${family.name}</div>
      </div>
      <div class="genre-family-count">${family.totalTracks} tracks across ${Object.keys(family.genres).length} genres</div>
    </div>
  `).join('');
  
  // Add click handlers
  grid.querySelectorAll('.genre-family-item').forEach(item => {
    item.addEventListener('click', () => {
      const familyId = item.getAttribute('data-family-id');
      toggleFamilySelection(familyId, familyMap[familyId], item);
    });
  });
}

// View 2: Detailed (Expandable)
function renderDetailedView(grid) {
  const familyMap = buildGenreFamilyMap(genreSongMap);
  
  const sortedFamilies = Object.entries(familyMap)
    .sort((a, b) => b[1].totalTracks - a[1].totalTracks);
  
  grid.innerHTML = sortedFamilies.map(([familyId, family]) => {
    const subgenresHTML = Object.entries(family.genres)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([genre, tracks]) => `
        <div class="subgenre-item ${selectedGenres.has(genre) ? 'selected' : ''}" 
             data-genre="${genre}">
          <span class="subgenre-name">${genre}</span>
          <span class="subgenre-count">${tracks.length}</span>
        </div>
      `).join('');
    
    return `
      <div class="genre-family-item" data-family-id="${familyId}"
           style="border-color: ${family.color}40">
        <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: ${family.color};"></div>
        <div class="genre-family-header">
          <div class="genre-family-name">${family.name}</div>
          <button class="genre-family-expand" onclick="toggleFamilyExpand('${familyId}', event)">
            Expand ▼
          </button>
        </div>
        <div class="genre-family-count">${family.totalTracks} tracks</div>
        <div class="genre-family-subgenres" id="family-${familyId}-subgenres">
          ${subgenresHTML}
        </div>
      </div>
    `;
  }).join('');
  
  // Add click handlers for subgenres
  grid.querySelectorAll('.subgenre-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const genre = item.getAttribute('data-genre');
      toggleGenreSelection(genre, item);
    });
  });
  
  // Add click handlers for family items (select all in family)
  grid.querySelectorAll('.genre-family-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('genre-family-expand')) return;
      const familyId = item.getAttribute('data-family-id');
      toggleFamilySelection(familyId, familyMap[familyId], item);
    });
  });
}

// View 3: All Genres (Flat)
function renderAllGenresView(grid) {
  const sortedGenres = Object.entries(genreSongMap)
    .sort((a, b) => b[1].length - a[1].length);
  
  grid.innerHTML = sortedGenres.map(([genre, tracks]) => `
    <div class="genre-item ${selectedGenres.has(genre) ? 'selected' : ''}" data-genre="${genre}">
      <div class="genre-name">${genre}</div>
      <div class="genre-count">${tracks.length} song${tracks.length !== 1 ? 's' : ''}</div>
    </div>
  `).join('');
  
  // Add click handlers
  grid.querySelectorAll('.genre-item').forEach(item => {
    item.addEventListener('click', () => {
      const genre = item.getAttribute('data-genre');
      toggleGenreSelection(genre, item);
    });
  });
}

function toggleFamilyExpand(familyId, event) {
  event.stopPropagation();
  const subgenresDiv = document.getElementById(`family-${familyId}-subgenres`);
  const button = event.target;
  
  if (subgenresDiv.classList.contains('expanded')) {
    subgenresDiv.classList.remove('expanded');
    button.textContent = 'Expand ▼';
  } else {
    subgenresDiv.classList.add('expanded');
    button.textContent = 'Collapse ▲';
  }
}

function toggleFamilySelection(familyId, family, element) {
  const allGenresInFamily = Object.keys(family.genres);
  const allSelected = allGenresInFamily.every(g => selectedGenres.has(g));
  
  if (allSelected) {
    // Deselect all
    allGenresInFamily.forEach(g => selectedGenres.delete(g));
    element.classList.remove('selected');
  } else {
    // Select all
    allGenresInFamily.forEach(g => selectedGenres.add(g));
    element.classList.add('selected');
  }
  
  updateSelectedCount();
  
  // Update subgenre visuals if in detailed view
  if (genreViewMode === 'detailed') {
    element.querySelectorAll('.subgenre-item').forEach(subItem => {
      const genre = subItem.getAttribute('data-genre');
      if (selectedGenres.has(genre)) {
        subItem.classList.add('selected');
      } else {
        subItem.classList.remove('selected');
      }
    });
  }
}

function displayGenreStats(sortedGenres, totalTracks) {
  const totalGenres = sortedGenres.length;
  
  const statsHTML = `
    <div class="stat-item">
      <div class="stat-label">Total Genres</div>
      <div class="stat-value">${totalGenres}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Total Tracks</div>
      <div class="stat-value">${totalTracks}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Selected</div>
      <div class="stat-value" id="selected-count">0</div>
    </div>
  `;
  
  document.getElementById('genre-stats').innerHTML = statsHTML;
}

function toggleGenreSelection(genre, element) {
  if (selectedGenres.has(genre)) {
    selectedGenres.delete(genre);
    element.classList.remove('selected');
  } else {
    selectedGenres.add(genre);
    element.classList.add('selected');
  }
  
  updateSelectedCount();
}

function updateSelectedCount() {
  const countElement = document.getElementById('selected-count');
  if (countElement) {
    countElement.textContent = selectedGenres.size;
  }
  
  // Enable/disable create playlist button
  const createBtn = document.getElementById('create-library-playlist');
  createBtn.disabled = selectedGenres.size === 0;
}

// ===== GENRE FILTER =====

document.getElementById('genre-filter').addEventListener('input', (e) => {
  const filter = e.target.value.toLowerCase();
  
  if (genreViewMode === 'all') {
    const items = document.querySelectorAll('.genre-item');
    items.forEach(item => {
      const genre = item.getAttribute('data-genre').toLowerCase();
      if (genre.includes(filter)) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
  } else {
    // Filter families and subgenres
    const items = document.querySelectorAll('.genre-family-item');
    items.forEach(item => {
      const familyName = item.querySelector('.genre-family-name').textContent.toLowerCase();
      const subgenres = Array.from(item.querySelectorAll('.subgenre-name'))
        .map(el => el.textContent.toLowerCase());
      
      const matches = familyName.includes(filter) || 
                      subgenres.some(sg => sg.includes(filter));
      
      if (matches || filter === '') {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
  }
});

// ===== SELECT ALL / CLEAR ALL =====

document.getElementById('select-all-genres').addEventListener('click', () => {
  if (genreViewMode === 'all') {
    const items = document.querySelectorAll('.genre-item');
    items.forEach(item => {
      const genre = item.getAttribute('data-genre');
      if (item.style.display !== 'none') {
        selectedGenres.add(genre);
        item.classList.add('selected');
      }
    });
  } else {
    // Select all visible families
    const items = document.querySelectorAll('.genre-family-item');
    items.forEach(item => {
      if (item.style.display !== 'none') {
        const familyId = item.getAttribute('data-family-id');
        const familyMap = buildGenreFamilyMap(genreSongMap);
        const family = familyMap[familyId];
        
        Object.keys(family.genres).forEach(g => selectedGenres.add(g));
        item.classList.add('selected');
        
        // Update subgenres if in detailed view
        item.querySelectorAll('.subgenre-item').forEach(sub => {
          sub.classList.add('selected');
        });
      }
    });
  }
  updateSelectedCount();
});

document.getElementById('clear-genres').addEventListener('click', () => {
  selectedGenres.clear();
  
  document.querySelectorAll('.genre-item').forEach(item => {
    item.classList.remove('selected');
  });
  
  document.querySelectorAll('.genre-family-item').forEach(item => {
    item.classList.remove('selected');
  });
  
  document.querySelectorAll('.subgenre-item').forEach(item => {
    item.classList.remove('selected');
  });
  
  updateSelectedCount();
});

// ===== CREATE PLAYLIST FROM LIBRARY =====

document.getElementById('create-library-playlist').addEventListener('click', async () => {
  if (selectedGenres.size === 0) return;
  
  document.getElementById('create-library-playlist').disabled = true;
  
  // Get playlist mode
  const mode = document.querySelector('input[name="playlist-mode"]:checked').value;
  
  if (mode === 'merged') {
    await createMergedPlaylist();
  } else {
    await createSeparatePlaylists();
  }
  
  document.getElementById('create-library-playlist').disabled = false;
});

async function createMergedPlaylist() {
  updateStatus('🎵 Creating merged playlist...');
  
  try {
    // Collect all tracks from selected genres
    const trackSet = new Set();
    selectedGenres.forEach(genre => {
      genreSongMap[genre].forEach(track => {
        trackSet.add(track.uri);
      });
    });
    
    const trackUris = Array.from(trackSet);
    
    // Get user ID
    const userResp = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
    });
    const userData = await userResp.json();
    
    // Create playlist name
    const customName = document.getElementById('playlist-name').value.trim();
    const genreList = Array.from(selectedGenres).slice(0, 3).join(', ');
    const playlistName = customName || `${genreList}${selectedGenres.size > 3 ? ' + more' : ''}`;
    
    // Create playlist
    const createResp = await fetch(`https://api.spotify.com/v1/users/${userData.id}/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${window.spotifyToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: playlistName,
        description: `Created by Playlist Alchemist from ${selectedGenres.size} genre${selectedGenres.size !== 1 ? 's' : ''}`,
        public: false
      })
    });
    const playlist = await createResp.json();
    
    // Add tracks (Spotify limit: 100 per request)
    for (let i = 0; i < trackUris.length; i += 100) {
      const batch = trackUris.slice(i, i + 100);
      await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${window.spotifyToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uris: batch })
      });
    }
    
    // Add to history with tracks for export
    const tracksForExport = Array.from(trackSet).map(uri => {
      // Find the track object from genreSongMap
      let foundTrack = null;
      selectedGenres.forEach(genre => {
        const track = genreSongMap[genre].find(t => t.uri === uri);
        if (track && !foundTrack) foundTrack = track;
      });
      return foundTrack;
    }).filter(t => t);
    
    addToHistory({
      name: playlistName,
      external_urls: { spotify: playlist.external_urls.spotify }
    }, tracksForExport);
    
    updateStatus(`✅ Created "${playlistName}" with ${trackUris.length} tracks!\n\n[CSV Export] [TXT Export] available in Playlist History tab`);
    
    // Clear playlist name input
    document.getElementById('playlist-name').value = '';
  } catch (e) {
    updateStatus(`❌ Error creating playlist: ${e.message}`);
  }
}

async function createSeparatePlaylists() {
  updateStatus('🎵 Creating separate playlists...');
  
  try {
    const userResp = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
    });
    const userData = await userResp.json();
    
    let createdCount = 0;
    const genreArray = Array.from(selectedGenres);
    
    for (const genre of genreArray) {
      const tracks = genreSongMap[genre];
      const trackUris = tracks.map(t => t.uri);
      
      // Create playlist for this genre
      const createResp = await fetch(`https://api.spotify.com/v1/users/${userData.id}/playlists`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${window.spotifyToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: genre,
          description: `${genre} playlist created by Playlist Alchemist`,
          public: false
        })
      });
      const playlist = await createResp.json();
      
      // Add tracks
      for (let i = 0; i < trackUris.length; i += 100) {
        const batch = trackUris.slice(i, i + 100);
        await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${window.spotifyToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ uris: batch })
        });
      }
      
      // Add to history
      addToHistory({
        name: genre,
        external_urls: { spotify: playlist.external_urls.spotify }
      }, tracks);
      
      createdCount++;
      updateStatus(`Created ${createdCount}/${genreArray.length} playlists...`);
    }
    
    updateStatus(`✅ Created ${createdCount} separate playlists! Check the Playlist History tab.`);
    document.getElementById('playlist-name').value = '';
  } catch (e) {
    updateStatus(`❌ Error creating playlists: ${e.message}`);
  }
}

// ===== ARTIST DISCOVERY MODE =====

let searchTimeout;
let selectedArtist = null;
let selectedRelatedArtists = new Set();

document.getElementById('artist-search').addEventListener('input', (e) => {
  const query = e.target.value.trim();
  
  clearTimeout(searchTimeout);
  
  if (query.length < 2) {
    document.getElementById('search-results').innerHTML = '';
    return;
  }
  
  searchTimeout = setTimeout(() => searchArtist(query), 300);
});

async function searchArtist(query) {
  if (!window.spotifyToken) return;
  
  try {
    const resp = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=5`,
      { headers: { 'Authorization': `Bearer ${window.spotifyToken}` } }
    );
    const data = await resp.json();
    displaySearchResults(data.artists.items);
  } catch (e) {
    console.error('Search error:', e);
  }
}

function displaySearchResults(artists) {
  const container = document.getElementById('search-results');
  
  if (artists.length === 0) {
    container.innerHTML = '<div style="padding: 12px; color: #666;">No artists found</div>';
    return;
  }
  
  container.innerHTML = artists.map(artist => {
    const imageUrl = artist.images && artist.images[0] ? artist.images[0].url : 'https://via.placeholder.com/50';
    const genres = artist.genres && artist.genres.length > 0 ? artist.genres.slice(0, 2).join(', ') : 'No genres listed';
    const musicMapUrl = getMusicMapUrl(artist.name);
    
    return `
      <div class="search-result-item" data-artist-id="${artist.id}">
        <img src="${imageUrl}" alt="${artist.name}">
        <div class="search-result-info">
          <h4>${artist.name}</h4>
          <p>${genres}</p>
        </div>
        <a href="${musicMapUrl}" target="_blank" class="music-map-link" onclick="event.stopPropagation()" title="Find similar artists">
          similar
        </a>
      </div>
    `;
  }).join('');
  
  container.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const artistId = item.getAttribute('data-artist-id');
      const artist = artists.find(a => a.id === artistId);
      selectArtist(artist);
    });
  });
}

function selectArtist(artist) {
  selectedArtist = artist;
  
  document.getElementById('artist-search').value = '';
  document.getElementById('search-results').innerHTML = '';
  
  const imageUrl = artist.images && artist.images[0] ? artist.images[0].url : 'https://via.placeholder.com/100';
  const genreTags = artist.genres && artist.genres.length > 0 
    ? artist.genres.slice(0, 3).map(g => `<span class="genre-tag">${g}</span>`).join('')
    : '<span class="genre-tag">No genres</span>';
  const musicMapUrl = getMusicMapUrl(artist.name);
  
  document.getElementById('selected-artist').classList.remove('hidden');
  document.getElementById('artist-card').innerHTML = `
    <img src="${imageUrl}" alt="${artist.name}">
    <div class="artist-info">
      <h3>
        ${artist.name}
        <a href="${musicMapUrl}" target="_blank" class="music-map-link" title="Find similar artists">
          similar
        </a>
      </h3>
      <div class="genre-tags">
        ${genreTags}
      </div>
    </div>
  `;
  
  document.getElementById('related-artists-section').classList.add('hidden');
  updateStatus(`Selected: ${artist.name}`);
}

document.getElementById('find-related').addEventListener('click', async () => {
  if (!selectedArtist) return;
  
  updateStatus('🔍 Finding related artists...');
  document.getElementById('find-related').disabled = true;
  
  try {
    const resp = await fetch(
      `https://api.spotify.com/v1/artists/${selectedArtist.id}/related-artists`,
      { headers: { 'Authorization': `Bearer ${window.spotifyToken}` } }
    );
    const data = await resp.json();
    
    displayRelatedArtists(data.artists);
    updateStatus(`✅ Found ${data.artists.length} related artists! Click to select.`);
    document.getElementById('find-related').disabled = false;
  } catch (e) {
    updateStatus(`❌ Error: ${e.message}`);
    document.getElementById('find-related').disabled = false;
  }
});

function displayRelatedArtists(artists) {
  const container = document.getElementById('related-artists-grid');
  selectedRelatedArtists.clear();
  
  container.innerHTML = artists.slice(0, 12).map(artist => {
    const imageUrl = artist.images && artist.images[0] ? artist.images[0].url : 'https://via.placeholder.com/200';
    const musicMapUrl = getMusicMapUrl(artist.name);
    
    return `
      <div class="artist-item" data-artist-id="${artist.id}">
        <img src="${imageUrl}" alt="${artist.name}">
        <h4>${artist.name}</h4>
        <div class="artist-item-footer">
          <a href="${musicMapUrl}" target="_blank" class="music-map-link" 
             onclick="event.stopPropagation()" title="Find similar artists">
            similar
          </a>
        </div>
      </div>
    `;
  }).join('');
  
  container.querySelectorAll('.artist-item').forEach(item => {
    item.addEventListener('click', () => {
      const artistId = item.getAttribute('data-artist-id');
      
      if (selectedRelatedArtists.has(artistId)) {
        selectedRelatedArtists.delete(artistId);
        item.classList.remove('selected');
      } else {
        selectedRelatedArtists.add(artistId);
        item.classList.add('selected');
      }
      
      updateStatus(`Selected ${selectedRelatedArtists.size} related artist${selectedRelatedArtists.size !== 1 ? 's' : ''}`);
    });
  });
  
  document.getElementById('related-artists-section').classList.remove('hidden');
}

document.getElementById('generate-discovery-playlist').addEventListener('click', async () => {
  if (!selectedArtist && selectedRelatedArtists.size === 0) {
    updateStatus('⚠️ Please select at least the main artist or some related artists');
    return;
  }
  
  updateStatus('🎵 Generating playlist...');
  document.getElementById('generate-discovery-playlist').disabled = true;
  
  try {
    const artistIds = [selectedArtist.id, ...Array.from(selectedRelatedArtists)];
    
    let allTracks = [];
    for (const artistId of artistIds) {
      const resp = await fetch(
        `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`,
        { headers: { 'Authorization': `Bearer ${window.spotifyToken}` } }
      );
      const data = await resp.json();
      allTracks.push(...data.tracks.slice(0, 5));
    }
    
    const userResp = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
    });
    const userData = await userResp.json();
    
    const customName = document.getElementById('discovery-playlist-name').value.trim();
    const playlistName = customName || `${selectedArtist.name} + Related Artists`;
    
    const createResp = await fetch(`https://api.spotify.com/v1/users/${userData.id}/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${window.spotifyToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: playlistName,
        description: `Created by Playlist Alchemist featuring ${selectedArtist.name} and similar artists`,
        public: false
      })
    });
    const playlist = await createResp.json();
    
    const trackUris = allTracks.map(t => t.uri);
    await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${window.spotifyToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: trackUris })
    });
    
    // Add to history
    addToHistory({
      name: playlistName,
      external_urls: { spotify: playlist.external_urls.spotify }
    }, allTracks);
    
    updateStatus(`✅ Created "${playlistName}" with ${allTracks.length} tracks!\n\n[CSV Export] [TXT Export] available in Playlist History tab`);
    document.getElementById('generate-discovery-playlist').disabled = false;
    document.getElementById('discovery-playlist-name').value = '';
  } catch (e) {
    updateStatus(`❌ Error creating playlist: ${e.message}`);
    document.getElementById('generate-discovery-playlist').disabled = false;
  }
});

// ===== PAGE LOAD: Handle OAuth Redirect =====

// Make functions globally accessible for onclick handlers
window.toggleAbout = toggleAbout;
window.closeTour = closeTour;
window.nextTourStep = nextTourStep;
window.prevTourStep = prevTourStep;
window.exportPlaylist = exportPlaylist;
window.toggleFamilyExpand = toggleFamilyExpand;

window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  
  if (code) {
    fetchAccessToken(code).then(() => {
      window.history.replaceState({}, document.title, REDIRECT_URI);
    });
  }
};































