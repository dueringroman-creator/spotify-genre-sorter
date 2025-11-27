// ===== SPOTIFY OAUTH SETUP =====
const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';

// ===== GLOBAL STATE =====
let selectedGenres = new Set();
let genreSongMap = {}; // genre -> array of track objects
let playlistHistory = []; // Store created playlists

// ===== UTILITY FUNCTIONS =====

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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

function addToHistory(playlist) {
  playlistHistory.unshift({
    name: playlist.name,
    url: playlist.external_urls.spotify,
    trackCount: playlist.tracks?.total || 0,
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
  
  container.innerHTML = playlistHistory.map(item => {
    const date = new Date(item.createdAt);
    const timeAgo = getTimeAgo(date);
    
    return `
      <div class="history-item">
        <div class="history-item-info">
          <div class="history-item-name">${item.name}</div>
          <div class="history-item-meta">${item.trackCount} tracks • ${timeAgo}</div>
        </div>
        <a href="${item.url}" target="_blank" class="history-item-link">Open in Spotify</a>
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

document.getElementById('close-onboarding')?.addEventListener('click', () => {
  const onboarding = document.getElementById('onboarding');
  if (onboarding) {
    onboarding.style.display = 'none';
    localStorage.setItem('onboarding_seen', 'true');
  }
});

// Check if user has seen onboarding before
window.addEventListener('load', () => {
  if (localStorage.getItem('onboarding_seen') === 'true') {
    const onboarding = document.getElementById('onboarding');
    if (onboarding) onboarding.style.display = 'none';
  }
});

// ===== LIBRARY MODE - FETCH TRACKS =====

async function fetchAllLikedTracks(token) {
  let all = [];
  const limit = 50;
  let offset = 0;
  
  while (true) {
    const resp = await fetchWithRetry(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await resp.json();
    all.push(...data.items);
    updateStatus(`Fetched ${all.length} tracks...`);
    if (!data.next) break;
    offset += limit;
  }
  return all;
}

document.getElementById('fetch-tracks').addEventListener('click', async () => {
  if (!window.spotifyToken) return;
  document.getElementById('fetch-tracks').disabled = true;
  updateStatus('🎵 Fetching your liked songs...');
  
  try {
    const tracks = await fetchAllLikedTracks(window.spotifyToken);
    window.savedTracks = tracks;
    updateStatus(`✅ Fetched ${tracks.length} tracks!`);
    document.getElementById('fetch-genres').disabled = false;
  } catch (e) {
    updateStatus(`❌ Error: ${e.message}`);
    document.getElementById('fetch-tracks').disabled = false;
  }
});

// ===== LIBRARY MODE - FETCH GENRES & BUILD MAP =====

async function fetchAllGenres(token, tracks) {
  const artistIds = new Set(tracks.map(i => i.track.artists[0].id));
  const ids = Array.from(artistIds);
  const artistGenreMap = {};

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(',');
    const resp = await fetchWithRetry(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await resp.json();
    data.artists.forEach(a => {
      artistGenreMap[a.id] = a.genres;
    });
    updateStatus(`Processed ${Math.min(i + 50, ids.length)} / ${ids.length} artists...`);
  }
  return artistGenreMap;
}

// Build genre -> songs mapping
function buildGenreSongMap(tracks, artistGenreMap) {
  const map = {};
  
  tracks.forEach(item => {
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

document.getElementById('fetch-genres').addEventListener('click', async () => {
  if (!window.savedTracks) return;
  document.getElementById('fetch-genres').disabled = true;
  updateStatus('🔍 Fetching genres and organizing tracks...');
  
  try {
    const artistGenreMap = await fetchAllGenres(window.spotifyToken, window.savedTracks);
    window.artistGenreMap = artistGenreMap;
    
    // Build genre -> songs map
    genreSongMap = buildGenreSongMap(window.savedTracks, artistGenreMap);
    
    // Display genre selection UI
    displayGenreSelection();
    updateStatus('✅ Genres loaded! Select genres to create a playlist.');
  } catch (e) {
    updateStatus(`❌ Error: ${e.message}`);
    document.getElementById('fetch-genres').disabled = false;
  }
});

// ===== DISPLAY GENRE SELECTION UI =====

function displayGenreSelection() {
  // Show genre selection area
  document.getElementById('genre-selection-area').classList.remove('hidden');
  
  // Sort genres by number of tracks (descending)
  const sortedGenres = Object.entries(genreSongMap)
    .sort((a, b) => b[1].length - a[1].length);
  
  // Display stats
  displayGenreStats(sortedGenres);
  
  // Display genre grid
  const grid = document.getElementById('genre-grid');
  grid.innerHTML = sortedGenres.map(([genre, tracks]) => `
    <div class="genre-item" data-genre="${genre}">
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

function displayGenreStats(sortedGenres) {
  const totalGenres = sortedGenres.length;
  const totalTracks = window.savedTracks.length;
  
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
  const items = document.querySelectorAll('.genre-item');
  
  items.forEach(item => {
    const genre = item.getAttribute('data-genre').toLowerCase();
    if (genre.includes(filter)) {
      item.style.display = '';
    } else {
      item.style.display = 'none';
    }
  });
});

// ===== SELECT ALL / CLEAR ALL =====

document.getElementById('select-all-genres').addEventListener('click', () => {
  const items = document.querySelectorAll('.genre-item');
  items.forEach(item => {
    const genre = item.getAttribute('data-genre');
    if (item.style.display !== 'none') { // Only visible items
      selectedGenres.add(genre);
      item.classList.add('selected');
    }
  });
  updateSelectedCount();
});

document.getElementById('clear-genres').addEventListener('click', () => {
  selectedGenres.clear();
  document.querySelectorAll('.genre-item').forEach(item => {
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
    
    // Add to history
    addToHistory({
      name: playlistName,
      external_urls: { spotify: playlist.external_urls.spotify },
      tracks: { total: trackUris.length }
    });
    
    updateStatus(`✅ Created "${playlistName}" with ${trackUris.length} tracks!\n\nOpen in Spotify: ${playlist.external_urls.spotify}`);
    
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
        external_urls: { spotify: playlist.external_urls.spotify },
        tracks: { total: trackUris.length }
      });
      
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
    
    return `
      <div class="search-result-item" data-artist-id="${artist.id}">
        <img src="${imageUrl}" alt="${artist.name}">
        <div class="search-result-info">
          <h4>${artist.name}</h4>
          <p>${genres}</p>
        </div>
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
  
  document.getElementById('selected-artist').classList.remove('hidden');
  document.getElementById('artist-card').innerHTML = `
    <img src="${imageUrl}" alt="${artist.name}">
    <div class="artist-info">
      <h3>${artist.name}</h3>
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
    
    return `
      <div class="artist-item" data-artist-id="${artist.id}">
        <img src="${imageUrl}" alt="${artist.name}">
        <h4>${artist.name}</h4>
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
      external_urls: { spotify: playlist.external_urls.spotify },
      tracks: { total: allTracks.length }
    });
    
    updateStatus(`✅ Created "${playlistName}" with ${allTracks.length} tracks!\n\nOpen in Spotify: ${playlist.external_urls.spotify}`);
    document.getElementById('generate-discovery-playlist').disabled = false;
    document.getElementById('discovery-playlist-name').value = '';
  } catch (e) {
    updateStatus(`❌ Error creating playlist: ${e.message}`);
    document.getElementById('generate-discovery-playlist').disabled = false;
  }
});

// ===== PAGE LOAD: Handle OAuth Redirect =====

window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  
  if (code) {
    fetchAccessToken(code).then(() => {
      window.history.replaceState({}, document.title, REDIRECT_URI);
    });
  }
};































