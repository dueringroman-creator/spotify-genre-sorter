// ============================================
// PLAYLIST ALCHEMIST v2.0 - CLEAN REBUILD
// Split View Architecture
// ============================================

// ===== SPOTIFY OAUTH CONFIGURATION =====
const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';

// ===== GLOBAL STATE =====
let spotifyToken = null;
let userTracks = [];
let artistGenreMap = {};
let genreSongMap = {};
let selectedGenres = new Set();
let allGenres = [];
let audioFeaturesCache = {};

// Smart playlist settings
const smartPlaylistSettings = {
  bpm: { min: 0, max: 200 },
  energy: { min: 0, max: 100 },
  mood: { min: 0, max: 100 },
  vocalType: 'any',
  targetDuration: 3600
};

// ===== SPOTIFY AUTHENTICATION =====

function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode.apply(null, array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode.apply(null, new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function redirectToSpotifyAuth() {
  const codeVerifier = generateCodeVerifier();
  localStorage.setItem(CODE_VERIFIER_KEY, codeVerifier);
  
  generateCodeChallenge(codeVerifier).then(codeChallenge => {
    const scopes = 'user-library-read user-top-read playlist-read-private playlist-modify-public playlist-modify-private';
    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.append('client_id', CLIENT_ID);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.append('scope', scopes);
    authUrl.searchParams.append('code_challenge_method', 'S256');
    authUrl.searchParams.append('code_challenge', codeChallenge);
    
    window.location.href = authUrl.toString();
  });
}

async function handleSpotifyCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  
  if (code) {
    const codeVerifier = localStorage.getItem(CODE_VERIFIER_KEY);
    
    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          code_verifier: codeVerifier,
        }),
      });
      
      const data = await response.json();
      spotifyToken = data.access_token;
      window.spotifyToken = spotifyToken;
      
      // Clean URL
      window.history.replaceState({}, document.title, REDIRECT_URI);
      
      // Show app
      showAppSection();
      
      // Show onboarding for first-time users
      if (!localStorage.getItem('onboarding_completed')) {
        showOnboarding();
      }
      
    } catch (error) {
      console.error('Auth error:', error);
      alert('Authentication failed. Please try again.');
    }
  }
}


// ===== CACHING FUNCTIONS =====

function saveToCache(key, data) {
  try {
    localStorage.setItem(`playlist_alchemist_${key}`, JSON.stringify(data));
    localStorage.setItem(`playlist_alchemist_${key}_timestamp`, Date.now().toString());
  } catch (e) {
    console.warn('Cache save failed:', e);
  }
}

function loadFromCache(key) {
  try {
    const cached = localStorage.getItem(`playlist_alchemist_${key}`);
    const timestamp = localStorage.getItem(`playlist_alchemist_${key}_timestamp`);
    
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

function clearCache(key) {
  localStorage.removeItem(`playlist_alchemist_${key}`);
  localStorage.removeItem(`playlist_alchemist_${key}_timestamp`);
}

// ===== SPOTIFY API FUNCTIONS =====

async function fetchSpotifyAPI(endpoint, options = {}) {
  const response = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${spotifyToken}`,
      ...options.headers
    },
    ...options
  });
  
  if (!response.ok) {
    throw new Error(`Spotify API error: ${response.status}`);
  }
  
  return response.json();
}

async function fetchAllLikedSongs(progressCallback) {
  const tracks = [];
  let offset = 0;
  const limit = 50;
  let total = 0;
  
  // First request to get total
  const firstBatch = await fetchSpotifyAPI(`me/tracks?limit=${limit}&offset=0`);
  total = firstBatch.total;
  tracks.push(...firstBatch.items.map(item => item.track));
  
  if (progressCallback) {
    progressCallback(tracks.length, total);
  }
  
  // Fetch remaining
  while (tracks.length < total) {
    offset += limit;
    const batch = await fetchSpotifyAPI(`me/tracks?limit=${limit}&offset=${offset}`);
    tracks.push(...batch.items.map(item => item.track));
    
    if (progressCallback) {
      progressCallback(tracks.length, total);
    }
  }
  
  return tracks;
}

async function fetchTopArtists() {
  const response = await fetchSpotifyAPI('me/top/artists?limit=50&time_range=medium_term');
  const artistIds = response.items.map(a => a.id);
  
  // Fetch tracks from these artists
  const tracks = [];
  for (const artistId of artistIds) {
    const artistTracks = await fetchSpotifyAPI(`artists/${artistId}/top-tracks?market=US`);
    tracks.push(...artistTracks.tracks);
  }
  
  return tracks;
}

async function fetchUserPlaylists() {
  const playlists = [];
  let offset = 0;
  const limit = 50;
  
  while (true) {
    const batch = await fetchSpotifyAPI(`me/playlists?limit=${limit}&offset=${offset}`);
    playlists.push(...batch.items);
    
    if (batch.items.length < limit) break;
    offset += limit;
  }
  
  return playlists;
}

async function fetchPlaylistTracks(playlistId) {
  const tracks = [];
  let offset = 0;
  const limit = 100;
  
  while (true) {
    const batch = await fetchSpotifyAPI(`playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`);
    tracks.push(...batch.items.map(item => item.track).filter(t => t));
    
    if (batch.items.length < limit) break;
    offset += limit;
  }
  
  return tracks;
}

async function fetchAudioFeatures(trackIds) {
  if (trackIds.length === 0) return {};
  
  const features = {};
  
  // Process in batches of 100 (Spotify API limit)
  for (let i = 0; i < trackIds.length; i += 100) {
    const batch = trackIds.slice(i, i + 100);
    const response = await fetchSpotifyAPI(`audio-features?ids=${batch.join(',')}`);
    
    response.audio_features.forEach((feature, idx) => {
      if (feature) {
        features[batch[idx]] = feature;
      }
    });
  }
  
  return features;
}

async function createSpotifyPlaylist(name, tracks) {
  // Get user ID
  const user = await fetchSpotifyAPI('me');
  
  // Create playlist
  const playlist = await fetchSpotifyAPI(`users/${user.id}/playlists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,
      description: 'Created with Playlist Alchemist',
      public: false
    })
  });
  
  // Add tracks (max 100 per request)
  const trackUris = tracks.map(t => t.uri);
  for (let i = 0; i < trackUris.length; i += 100) {
    const batch = trackUris.slice(i, i + 100);
    await fetchSpotifyAPI(`playlists/${playlist.id}/tracks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        uris: batch
      })
    });
  }
  
  return playlist;
}


// ===== GENRE DETECTION SYSTEM =====

// Simplified genre detection - maps Spotify genres to common categories
function detectGenreFamily(spotifyGenre) {
  const genre = spotifyGenre.toLowerCase().trim();
  
  // Electronic genres
  if (genre.includes('techno') || genre.includes('tekno')) return 'Techno';
  if (genre.includes('house')) return 'House';
  if (genre.includes('trance')) return 'Trance';
  if (genre.includes('drum and bass') || genre.includes('dnb') || genre.includes('d&b') || genre.includes('jungle')) return 'Drum & Bass';
  if (genre.includes('dubstep') || genre.includes('brostep')) return 'Dubstep';
  if (genre.includes('edm') || genre.includes('big room') || genre.includes('festival')) return 'EDM';
  if (genre.includes('ambient') || genre.includes('downtempo') || genre.includes('chillout')) return 'Ambient';
  if (genre.includes('breakbeat') || genre.includes('breaks')) return 'Breakbeat';
  if (genre.includes('electro')) return 'Electro';
  if (genre.includes('idm') || genre.includes('glitch')) return 'IDM';
  
  // Rock genres
  if (genre.includes('rock') && !genre.includes('electro')) return 'Rock';
  if (genre.includes('metal')) return 'Metal';
  if (genre.includes('punk')) return 'Punk';
  if (genre.includes('indie') && !genre.includes('dance')) return 'Indie';
  if (genre.includes('alternative')) return 'Alternative';
  if (genre.includes('grunge')) return 'Grunge';
  
  // Urban genres
  if (genre.includes('hip hop') || genre.includes('hip-hop') || genre.includes('rap')) return 'Hip Hop';
  if (genre.includes('r&b') || genre.includes('rnb') || genre.includes('rnb')) return 'R&B';
  if (genre.includes('trap') && !genre.includes('edm')) return 'Trap';
  if (genre.includes('drill')) return 'Drill';
  if (genre.includes('grime')) return 'Grime';
  
  // Pop & mainstream
  if (genre.includes('pop') && !genre.includes('k-pop')) return 'Pop';
  if (genre.includes('k-pop') || genre.includes('kpop')) return 'K-Pop';
  if (genre.includes('dance')) return 'Dance';
  if (genre.includes('disco')) return 'Disco';
  if (genre.includes('funk')) return 'Funk';
  
  // Jazz & blues
  if (genre.includes('jazz')) return 'Jazz';
  if (genre.includes('blues')) return 'Blues';
  if (genre.includes('soul')) return 'Soul';
  
  // Classical & orchestral
  if (genre.includes('classical') || genre.includes('orchestra')) return 'Classical';
  if (genre.includes('soundtrack') || genre.includes('score')) return 'Soundtrack';
  
  // World & regional
  if (genre.includes('reggae') || genre.includes('dancehall')) return 'Reggae';
  if (genre.includes('latin') || genre.includes('salsa') || genre.includes('bachata')) return 'Latin';
  if (genre.includes('country')) return 'Country';
  if (genre.includes('folk')) return 'Folk';
  
  // Default
  return 'Other';
}


// ===== BUILD GENRE MAPS =====

async function buildGenreMaps(tracks) {
  // Get unique artist IDs
  const artistIds = [...new Set(tracks.flatMap(t => t.artists.map(a => a.id)))];
  
  // Fetch artist info in batches of 50 (Spotify limit)
  artistGenreMap = {};
  for (let i = 0; i < artistIds.length; i += 50) {
    const batch = artistIds.slice(i, i + 50);
    const response = await fetchSpotifyAPI(`artists?ids=${batch.join(',')}`);
    
    response.artists.forEach(artist => {
      if (artist) {
        artistGenreMap[artist.id] = artist.genres || [];
      }
    });
  }
  
  // Build genre → tracks map
  genreSongMap = {};
  
  tracks.forEach(track => {
    const trackGenres = new Set();
    
    track.artists.forEach(artist => {
      const spotifyGenres = artistGenreMap[artist.id] || [];
      spotifyGenres.forEach(spotifyGenre => {
        const normalizedGenre = detectGenreFamily(spotifyGenre);
        trackGenres.add(normalizedGenre);
      });
    });
    
    // Add track to each genre it belongs to
    trackGenres.forEach(genre => {
      if (!genreSongMap[genre]) {
        genreSongMap[genre] = [];
      }
      genreSongMap[genre].push(track);
    });
  });
  
  // Remove duplicates
  Object.keys(genreSongMap).forEach(genre => {
    const seen = new Set();
    genreSongMap[genre] = genreSongMap[genre].filter(track => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
  });
}

// ===== FILTER FUNCTIONS =====

async function getAudioFeaturesForTracks(tracks) {
  const trackIds = tracks.map(t => t.id);
  const uncachedIds = trackIds.filter(id => !audioFeaturesCache[id]);
  
  if (uncachedIds.length > 0) {
    const features = await fetchAudioFeatures(uncachedIds);
    Object.assign(audioFeaturesCache, features);
  }
  
  return trackIds.map(id => audioFeaturesCache[id]).filter(f => f);
}

function applyFilters(tracks, settings) {
  return tracks.filter(track => {
    const features = audioFeaturesCache[track.id];
    if (!features) return true; // Include if no features available
    
    // BPM filter
    if (settings.bpm.min > 0 || settings.bpm.max < 200) {
      const bpm = features.tempo;
      if (bpm < settings.bpm.min || bpm > settings.bpm.max) return false;
    }
    
    // Energy filter (0-100 scale)
    if (settings.energy.min > 0 || settings.energy.max < 100) {
      const energy = features.energy * 100;
      if (energy < settings.energy.min || energy > settings.energy.max) return false;
    }
    
    // Mood filter (valence - 0-100 scale)
    if (settings.mood.min > 0 || settings.mood.max < 100) {
      const mood = features.valence * 100;
      if (mood < settings.mood.min || mood > settings.mood.max) return false;
    }
    
    // Vocal filter
    if (settings.vocalType !== 'any') {
      const instrumentalness = features.instrumentalness;
      if (settings.vocalType === 'instrumental' && instrumentalness < 0.5) return false;
      if (settings.vocalType === 'vocal' && instrumentalness > 0.5) return false;
    }
    
    return true;
  });
}

// ===== PLAYLIST GENERATION =====

function generatePlaylistTracks() {
  let allTracks = [];
  
  // Collect tracks from selected genres
  selectedGenres.forEach(genre => {
    const tracks = genreSongMap[genre] || [];
    allTracks.push(...tracks);
  });
  
  // Remove duplicates
  const seen = new Set();
  allTracks = allTracks.filter(track => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
  
  // Apply filters
  allTracks = applyFilters(allTracks, smartPlaylistSettings);
  
  // Target duration in seconds
  const targetDuration = smartPlaylistSettings.targetDuration;
  const targetDurationMs = targetDuration * 1000;
  
  // Smart selection to meet duration
  let totalDuration = 0;
  const selectedTracks = [];
  
  // Shuffle for variety
  const shuffled = [...allTracks].sort(() => Math.random() - 0.5);
  
  for (const track of shuffled) {
    if (totalDuration >= targetDurationMs) break;
    
    selectedTracks.push(track);
    totalDuration += track.duration_ms;
  }
  
  return selectedTracks;
}


// ===== UI CONNECTION LAYER =====

// Show/hide app sections
function showAppSection() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('app-section').style.display = 'block';
}

function showOnboarding() {
  document.getElementById('onboarding-modal').style.display = 'flex';
}

function closeOnboarding() {
  document.getElementById('onboarding-modal').style.display = 'none';
  localStorage.setItem('onboarding_completed', 'true');
}

// Load library with progress
async function handleLoadLibrary() {
  const sourceInput = document.querySelector('input[name="data-source"]:checked');
  const timeframeInput = document.querySelector('input[name="timeframe"]:checked');
  
  if (!sourceInput) {
    alert('Please select a music source');
    return;
  }
  
  const source = sourceInput.value;
  const timeframe = timeframeInput ? timeframeInput.value : 'all';
  
  // Show progress
  const progressContainer = document.getElementById('load-progress-container');
  const progressFill = document.getElementById('load-progress-fill');
  const progressText = document.getElementById('load-progress-text');
  const loadBtn = document.getElementById('load-library-btn');
  
  progressContainer.style.display = 'block';
  loadBtn.disabled = true;
  
  try {
    let tracks = [];
    
    // Check cache first
    const cached = loadFromCache(source);
    if (cached && (Date.now() - cached.timestamp) < 86400000) { // 24 hours
      tracks = cached.data;
      progressFill.style.width = '100%';
      progressText.textContent = `Loaded ${tracks.length} tracks from cache`;
    } else {
      // Fetch fresh data
      if (source === 'liked-songs') {
        tracks = await fetchAllLikedSongs((current, total) => {
          const percent = (current / total) * 100;
          progressFill.style.width = `${percent}%`;
          progressText.textContent = `Loading ${current}/${total} tracks...`;
        });
      } else if (source === 'top-artists') {
        progressText.textContent = 'Fetching your top artists...';
        tracks = await fetchTopArtists();
        progressFill.style.width = '100%';
      } else if (source === 'playlists') {
        progressText.textContent = 'Loading your playlists...';
        const playlists = await fetchUserPlaylists();
        // For now, get tracks from first 5 playlists
        tracks = [];
        for (let i = 0; i < Math.min(5, playlists.length); i++) {
          const playlistTracks = await fetchPlaylistTracks(playlists[i].id);
          tracks.push(...playlistTracks);
        }
        progressFill.style.width = '100%';
      }
      
      // Save to cache
      saveToCache(source, tracks);
    }
    
    // Store tracks
    userTracks = tracks;
    
    // Build genre maps
    progressText.textContent = 'Analyzing genres...';
    await buildGenreMaps(tracks);
    
    // Fetch audio features for filtering
    progressText.textContent = 'Loading audio features...';
    await getAudioFeaturesForTracks(tracks);
    
    // Show genre section
    document.getElementById('genre-section').style.display = 'block';
    renderGenreGrid();
    
    progressText.textContent = `Complete! ${tracks.length} tracks loaded`;
    
    setTimeout(() => {
      progressContainer.style.display = 'none';
      loadBtn.disabled = false;
    }, 2000);
    
  } catch (error) {
    console.error('Load error:', error);
    progressText.textContent = 'Error loading library';
    progressText.style.color = '#ff4444';
    loadBtn.disabled = false;
  }
}

// Render genre grid
function renderGenreGrid() {
  const grid = document.getElementById('genre-grid');
  allGenres = Object.keys(genreSongMap).sort((a, b) => {
    // Sort by track count descending
    return genreSongMap[b].length - genreSongMap[a].length;
  });
  
  grid.innerHTML = allGenres.map(genre => {
    const count = genreSongMap[genre].length;
    const selected = selectedGenres.has(genre) ? 'selected' : '';
    
    return `
      <div class="genre-card ${selected}" data-genre="${genre}">
        <div class="genre-name">${genre}</div>
        <div class="genre-count">${count} tracks</div>
      </div>
    `;
  }).join('');
  
  // Add click listeners
  grid.querySelectorAll('.genre-card').forEach(card => {
    card.addEventListener('click', () => {
      const genre = card.dataset.genre;
      toggleGenre(genre, card);
    });
  });
}

// Genre search
function handleGenreSearch(e) {
  const query = e.target.value.toLowerCase();
  const cards = document.querySelectorAll('.genre-card');
  
  cards.forEach(card => {
    const genre = card.dataset.genre.toLowerCase();
    if (genre.includes(query)) {
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  });
}

// Toggle genre selection
function toggleGenre(genre, element) {
  if (selectedGenres.has(genre)) {
    selectedGenres.delete(genre);
    element.classList.remove('selected');
  } else {
    selectedGenres.add(genre);
    element.classList.add('selected');
  }
  
  updateRightPanel();
}

// Update right panel display
function updateRightPanel() {
  const list = document.getElementById('selected-genres-list');
  const totalTracksEl = document.getElementById('total-tracks');
  const totalDurationEl = document.getElementById('total-duration');
  const clearBtn = document.getElementById('clear-selection-btn');
  const previewBtn = document.getElementById('preview-btn');
  const createBtn = document.getElementById('create-btn');
  
  if (selectedGenres.size === 0) {
    list.innerHTML = '<div class="empty-state">No genres selected yet</div>';
    totalTracksEl.textContent = '0';
    totalDurationEl.textContent = '0m';
    
    clearBtn.disabled = true;
    previewBtn.disabled = true;
    createBtn.disabled = true;
    return;
  }
  
  // Render selected genres
  list.innerHTML = Array.from(selectedGenres).map(genre => {
    const tracks = genreSongMap[genre] || [];
    const filtered = applyFilters(tracks, smartPlaylistSettings);
    const count = filtered.length;
    
    return `
      <div class="selected-genre-item">
        <span class="selected-genre-name">${genre}</span>
        <span class="selected-genre-count">${count}</span>
      </div>
    `;
  }).join('');
  
  // Calculate totals
  const playlistTracks = generatePlaylistTracks();
  const totalTracks = playlistTracks.length;
  const totalDuration = playlistTracks.reduce((sum, t) => sum + t.duration_ms, 0);
  
  totalTracksEl.textContent = totalTracks;
  totalDurationEl.textContent = formatDuration(totalDuration);
  
  // Enable buttons
  clearBtn.disabled = false;
  previewBtn.disabled = false;
  createBtn.disabled = false;
}

// Clear selection
function clearSelection() {
  selectedGenres.clear();
  
  document.querySelectorAll('.genre-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  updateRightPanel();
}

// Show preview modal
function showPreviewModal() {
  const tracks = generatePlaylistTracks();
  const list = document.getElementById('preview-tracks-list');
  
  list.innerHTML = tracks.map(track => `
    <div class="preview-track">
      <div class="preview-track-info">
        <div class="preview-track-name">${escapeHtml(track.name)}</div>
        <div class="preview-track-artist">${escapeHtml(track.artists[0].name)}</div>
      </div>
    </div>
  `).join('');
  
  document.getElementById('preview-modal').style.display = 'flex';
}

function closePreviewModal() {
  document.getElementById('preview-modal').style.display = 'none';
}

// Create playlist
async function createPlaylist() {
  const name = document.getElementById('playlist-name').value || 'My Playlist';
  const tracks = generatePlaylistTracks();
  
  if (tracks.length === 0) {
    alert('No tracks to add to playlist');
    return;
  }
  
  const createBtn = document.getElementById('create-btn');
  const originalText = createBtn.textContent;
  createBtn.disabled = true;
  createBtn.textContent = 'Creating...';
  
  try {
    await createSpotifyPlaylist(name, tracks);
    showNotification(`Playlist "${name}" created with ${tracks.length} tracks!`);
    
    // Reset
    clearSelection();
    document.getElementById('playlist-name').value = 'My Playlist';
    
  } catch (error) {
    console.error('Create error:', error);
    showNotification('Error creating playlist. Please try again.');
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = originalText;
  }
}

// Show notification
function showNotification(message) {
  const notification = document.getElementById('success-notification');
  const textEl = document.getElementById('notification-text');
  
  textEl.textContent = message;
  notification.style.display = 'block';
  
  setTimeout(() => {
    notification.style.display = 'none';
  }, 3000);
}

// Helper: Format duration
function formatDuration(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


// ===== FILTER UPDATES =====

function updateBPMFilter() {
  const min = parseInt(document.getElementById('bpm-min').value);
  const max = parseInt(document.getElementById('bpm-max').value);
  
  smartPlaylistSettings.bpm.min = min;
  smartPlaylistSettings.bpm.max = max;
  
  document.getElementById('bpm-display').textContent = `${min} - ${max} BPM`;
  
  updateRightPanel();
}

function updateEnergyFilter() {
  const min = parseInt(document.getElementById('energy-min').value);
  const max = parseInt(document.getElementById('energy-max').value);
  
  smartPlaylistSettings.energy.min = min;
  smartPlaylistSettings.energy.max = max;
  
  let display = 'All levels';
  if (min > 0 || max < 100) {
    display = `${min} - ${max}`;
  }
  document.getElementById('energy-display').textContent = display;
  
  updateRightPanel();
}

function updateMoodFilter() {
  const min = parseInt(document.getElementById('mood-min').value);
  const max = parseInt(document.getElementById('mood-max').value);
  
  smartPlaylistSettings.mood.min = min;
  smartPlaylistSettings.mood.max = max;
  
  let display = 'All moods';
  if (min > 0 || max < 100) {
    display = `${min} - ${max}`;
  }
  document.getElementById('mood-display').textContent = display;
  
  updateRightPanel();
}

function updateVocalFilter() {
  const select = document.getElementById('vocal-type');
  smartPlaylistSettings.vocalType = select.value;
  
  updateRightPanel();
}

function updateDurationFilter() {
  const select = document.getElementById('duration-target');
  smartPlaylistSettings.targetDuration = parseInt(select.value);
  
  updateRightPanel();
}

// ===== INITIALIZATION =====

function initializeApp() {
  console.log('🎵 Playlist Alchemist initializing...');
  
  // Login button
  const loginBtn = document.getElementById('login');
  if (loginBtn) {
    loginBtn.addEventListener('click', redirectToSpotifyAuth);
  }
  
  // Load library button
  const loadBtn = document.getElementById('load-library-btn');
  if (loadBtn) {
    loadBtn.addEventListener('click', handleLoadLibrary);
  }
  
  // Genre search
  const searchInput = document.getElementById('genre-search');
  if (searchInput) {
    searchInput.addEventListener('input', handleGenreSearch);
  }
  
  // Clear selection
  const clearBtn = document.getElementById('clear-selection-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearSelection);
  }
  
  // Preview button
  const previewBtn = document.getElementById('preview-btn');
  if (previewBtn) {
    previewBtn.addEventListener('click', showPreviewModal);
  }
  
  // Create button
  const createBtn = document.getElementById('create-btn');
  if (createBtn) {
    createBtn.addEventListener('click', createPlaylist);
  }
  
  // Create from preview
  const createFromPreviewBtn = document.getElementById('create-from-preview');
  if (createFromPreviewBtn) {
    createFromPreviewBtn.addEventListener('click', () => {
      closePreviewModal();
      createPlaylist();
    });
  }
  
  // Filter listeners
  const bpmMin = document.getElementById('bpm-min');
  const bpmMax = document.getElementById('bpm-max');
  if (bpmMin && bpmMax) {
    bpmMin.addEventListener('input', updateBPMFilter);
    bpmMax.addEventListener('input', updateBPMFilter);
  }
  
  const energyMin = document.getElementById('energy-min');
  const energyMax = document.getElementById('energy-max');
  if (energyMin && energyMax) {
    energyMin.addEventListener('input', updateEnergyFilter);
    energyMax.addEventListener('input', updateEnergyFilter);
  }
  
  const moodMin = document.getElementById('mood-min');
  const moodMax = document.getElementById('mood-max');
  if (moodMin && moodMax) {
    moodMin.addEventListener('input', updateMoodFilter);
    moodMax.addEventListener('input', updateMoodFilter);
  }
  
  const vocalType = document.getElementById('vocal-type');
  if (vocalType) {
    vocalType.addEventListener('change', updateVocalFilter);
  }
  
  const durationTarget = document.getElementById('duration-target');
  if (durationTarget) {
    durationTarget.addEventListener('change', updateDurationFilter);
  }
  
  // Help button
  const helpBtn = document.getElementById('help-button');
  if (helpBtn) {
    helpBtn.addEventListener('click', showOnboarding);
  }
  
  // Logout button
  const logoutBtn = document.getElementById('logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.clear();
      window.location.reload();
    });
  }
  
  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function() {
      this.parentElement.style.display = 'none';
    });
  });
  
  // Check for Spotify callback
  handleSpotifyCallback();
  
  console.log('✅ App initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
