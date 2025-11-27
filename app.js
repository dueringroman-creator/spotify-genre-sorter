// Playlist Alchemist - Main Application
// Version: v1 (internal tracking)
// Spotify Playlist Creator with Genre Sorting and Music Stats

// ===== SPOTIFY OAUTH SETUP =====
const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';

// ===== GLOBAL STATE =====
let selectedGenres = new Set();
let genreSongMap = {};
let playlistHistory = [];
let cachedLibraryData = null;
let genreViewMode = 'families';
let excludedArtists = new Map(); // Map of genre -> Set of excluded artist IDs
let excludedTracks = new Map(); // Map of "genre:artistId" -> Set of excluded track IDs
let manualGenreMappings = {}; // User-defined genre mappings: { "tekno": "techno" }

// ===== GENRE FAMILY MAPPING =====

const genreFamilies = {
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
    keywords: ["techno", "tekno", "industrial techno", "dub techno", "minimal techno", "detroit techno", "berlin techno", "hard techno", "acid techno"],
    exclude: ["tech house"],
    color: "#4ECDC4"
  },
  "industrial": {
    name: "Industrial",
    keywords: ["industrial", "ebm", "electro-industrial", "power electronics", "noise"],
    exclude: ["industrial techno"],
    color: "#666666"
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
  "pop": {
    name: "Pop",
    keywords: ["pop"],
    exclude: ["indie pop", "synth pop", "dream pop", "k-pop", "j-pop"],
    color: "#FFDFD3"
  },
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
  "reggae": {
    name: "Reggae",
    keywords: ["reggae", "dub", "dancehall"],
    exclude: [],
    color: "#FFDAC1"
  },
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
  
  // Check manual mappings first
  if (manualGenreMappings[lowerGenre]) {
    const mappedGenre = manualGenreMappings[lowerGenre];
    // Recursively detect family for the mapped genre
    for (const [familyId, family] of Object.entries(genreFamilies)) {
      const matches = family.keywords.some(kw => mappedGenre.toLowerCase().includes(kw.toLowerCase()));
      if (matches) {
        return {
          id: familyId,
          name: family.name,
          color: family.color
        };
      }
    }
  }
  
  // First pass: exact keyword matching
  for (const [familyId, family] of Object.entries(genreFamilies)) {
    const isExcluded = family.exclude.some(exc => lowerGenre.includes(exc.toLowerCase()));
    if (isExcluded) continue;
    
    const matches = family.keywords.some(kw => lowerGenre.includes(kw.toLowerCase()));
    if (matches) {
      return {
        id: familyId,
        name: family.name,
        color: family.color
      };
    }
  }
  
  // Second pass: fuzzy matching for common misspellings/variations
  const fuzzyMappings = {
    // Techno variations
    'tekno': 'techno',
    'technо': 'techno', // Cyrillic 'o'
    'tecno': 'techno',
    'tekk': 'techno',
    'schranz': 'techno',
    'hardtechno': 'techno',
    'hard techno': 'techno',
    
    // House variations
    'houze': 'house',
    'housе': 'house', // Cyrillic 'e'
    
    // Hip hop variations
    'hiphop': 'hip hop',
    'hip-hop': 'hip hop',
    'rap': 'hip hop',
    'trap': 'hip hop',
    
    // Electronic variations
    'electronica': 'electronic',
    'electro': 'electronic',
    'idm': 'electronic',
    'glitch': 'electronic',
    
    // Industrial/experimental
    'industrial': 'techno', // Often classified under techno family
    'ebm': 'techno',
    'noise': 'experimental',
    
    // Drum & bass
    'dnb': 'drum and bass',
    'd&b': 'drum and bass',
    'jungle': 'drum and bass',
    
    // Dubstep/bass
    'brostep': 'dubstep',
    'riddim': 'dubstep'
  };
  
  // Try fuzzy mappings
  for (const [variant, canonical] of Object.entries(fuzzyMappings)) {
    if (lowerGenre.includes(variant)) {
      // Try to match the canonical version
      for (const [familyId, family] of Object.entries(genreFamilies)) {
        const matches = family.keywords.some(kw => canonical.includes(kw.toLowerCase()));
        if (matches) {
          return {
            id: familyId,
            name: family.name,
            color: family.color
          };
        }
      }
    }
  }
  
  // Third pass: word-based matching (catch compound genres)
  const words = lowerGenre.split(/[\s\-]+/);
  for (const word of words) {
    for (const [familyId, family] of Object.entries(genreFamilies)) {
      const isExcluded = family.exclude.some(exc => word.includes(exc.toLowerCase()));
      if (isExcluded) continue;
      
      const matches = family.keywords.some(kw => word === kw.toLowerCase());
      if (matches) {
        return {
          id: familyId,
          name: family.name,
          color: family.color
        };
      }
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

// ===== MUSIC STATS GENERATION ===== v1 UPDATE #1

function generateMusicStats() {
  if (!cachedLibraryData || !genreSongMap || Object.keys(genreSongMap).length === 0) {
    return;
  }
  
  const tracks = cachedLibraryData.items;
  const statsContainer = document.getElementById('stats-content');
  
  const totalTracks = tracks.length;
  const totalGenres = Object.keys(genreSongMap).length;
  const familyMap = buildGenreFamilyMap(genreSongMap);
  
  // Exclude "other" category from stats
  delete familyMap.other;
  
  const sortedGenres = Object.entries(genreSongMap)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);
  
  const diversityScore = Math.min(10, (totalGenres / 20) * 10).toFixed(1);
  
  const rareGenres = Object.entries(genreSongMap)
    .filter(([_, tracks]) => tracks.length <= 5)
    .sort((a, b) => a[1].length - b[1].length)
    .slice(0, 3);
  
  const sortedFamilies = Object.entries(familyMap)
    .sort((a, b) => b[1].totalTracks - a[1].totalTracks);
  
  const topFamily = sortedFamilies[0];
  
  // Calculate total tracks excluding "other" for accurate percentages
  const totalTracksWithGenres = Object.values(familyMap).reduce((sum, fam) => sum + fam.totalTracks, 0);
  const topFamilyPercentage = topFamily ? ((topFamily[1].totalTracks / totalTracksWithGenres) * 100).toFixed(0) : 0;
  
  const mostDiverseFamily = Object.entries(familyMap)
    .map(([id, data]) => ({
      id,
      name: data.name,
      subgenreCount: Object.keys(data.genres).length
    }))
    .sort((a, b) => b.subgenreCount - a.subgenreCount)[0];
  
  const durations = tracks
    .filter(item => item.track && item.track.duration_ms)
    .map(item => item.track.duration_ms);
  const avgDuration = durations.length > 0 
    ? Math.floor(durations.reduce((a, b) => a + b, 0) / durations.length / 1000)
    : 0;
  const avgMinutes = Math.floor(avgDuration / 60);
  const avgSeconds = avgDuration % 60;
  
  const artistTrackCount = {};
  tracks.forEach(item => {
    if (item.track && item.track.artists && item.track.artists[0]) {
      const artistName = item.track.artists[0].name;
      artistTrackCount[artistName] = (artistTrackCount[artistName] || 0) + 1;
    }
  });
  
  const topArtist = Object.entries(artistTrackCount)
    .sort((a, b) => b[1] - a[1])[0];
  
  const html = `
    <div class="stats-grid">
      <div class="stats-card">
        <h3>Overview</h3>
        <div class="stats-card-content">
          <div class="stat-row">
            <span class="stat-row-label">Total Tracks</span>
            <span class="stat-row-value">${totalTracks.toLocaleString()}</span>
          </div>
          <div class="stat-row">
            <span class="stat-row-label">Total Genres</span>
            <span class="stat-row-value">${totalGenres}</span>
          </div>
          <div class="stat-row">
            <span class="stat-row-label">Genre Families</span>
            <span class="stat-row-value">${Object.keys(familyMap).length}</span>
          </div>
          <div class="stat-row">
            <span class="stat-row-label">Avg Track Length</span>
            <span class="stat-row-value">${avgMinutes}:${avgSeconds.toString().padStart(2, '0')}</span>
          </div>
        </div>
      </div>
      
      <div class="stats-card">
        <h3>Top Genre Families</h3>
        <div class="stats-card-content">
          ${sortedFamilies.slice(0, 5).map(([id, data]) => {
            const percentage = ((data.totalTracks / totalTracksWithGenres) * 100).toFixed(1);
            return `
              <div class="genre-breakdown-item">
                <div class="genre-breakdown-color" style="background: ${data.color}"></div>
                <div class="genre-breakdown-info">
                  <div class="genre-breakdown-name">${data.name}</div>
                  <div class="genre-breakdown-tracks">${data.totalTracks} tracks (${percentage}%)</div>
                </div>
              </div>
              <div class="stat-bar">
                <div class="stat-bar-fill" style="width: ${percentage}%; background: ${data.color}"></div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      
      <div class="stats-card">
        <h3>Top Specific Genres</h3>
        <div class="stats-card-content">
          ${sortedGenres.map(([genre, tracks]) => {
            const percentage = ((tracks.length / totalTracksWithGenres) * 100).toFixed(1);
            const family = detectGenreFamily(genre);
            return `
              <div class="stat-row">
                <span class="stat-row-label">${genre}</span>
                <span class="stat-row-value">${tracks.length} (${percentage}%)</span>
              </div>
              <div class="stat-bar">
                <div class="stat-bar-fill" style="width: ${percentage}%; background: ${family.color}"></div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      
      <div class="stats-card">
        <h3>Insights</h3>
        <div class="stats-card-content">
          ${topFamily ? `<div class="fun-fact">
            <strong>${topFamily[1].name}</strong> dominates your library at ${topFamilyPercentage}% of your tracks${topFamilyPercentage > 40 ? ". That's your dominant sound." : "."}
          </div>` : ''}
          
          ${mostDiverseFamily && mostDiverseFamily.subgenreCount > 5 ? `
          <div class="fun-fact">
            Most diverse family: <strong>${mostDiverseFamily.name}</strong> with ${mostDiverseFamily.subgenreCount} sub-genres${mostDiverseFamily.subgenreCount > 10 ? ". Impressive variety." : "."}
          </div>
          ` : ''}
          
          ${rareGenres.length > 0 ? `
          <div class="fun-fact">
            Rarest finds: <strong>${rareGenres.map(([g, _]) => g).join(', ')}</strong>${rareGenres[0][1].length === 1 ? " (deep cuts)" : ""}
          </div>
          ` : ''}
          
          ${topArtist ? `
          <div class="fun-fact">
            Most featured artist: <strong>${topArtist[0]}</strong> with ${topArtist[1]} tracks
          </div>
          ` : ''}
          
          <div class="fun-fact">
            Genre diversity score: <strong>${diversityScore}/10</strong>${diversityScore > 7 ? " — Eclectic taste" : diversityScore > 4 ? " — Balanced collection" : " — Focused tastes"}
          </div>
          
          ${totalTracks > 1000 ? `
          <div class="fun-fact">
            Total listening time: <strong>${Math.floor(totalTracks * avgDuration / 3600)} hours</strong> of music${totalTracks > 5000 ? ". Extensive collection." : ""}
          </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
  
  statsContainer.innerHTML = html;
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
    // Silently ignore cache quota errors - non-critical
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

function getMusicMapUrl(artistName) {
  const formattedName = artistName.trim().replace(/\s+/g, '+').toLowerCase();
  return `https://www.music-map.com/${encodeURIComponent(formattedName)}`;
}

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
      updateStatus(`Network error, retrying... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
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
    trackData: tracks.map(t => ({
      name: t.name,
      artists: t.artists ? t.artists.map(a => a.name) : [],
      album: t.album ? t.album.name : '',
      uri: t.uri,
      duration_ms: t.duration_ms || 0,
      external_urls: t.external_urls
    })),
    createdAt: new Date().toISOString()
  });
  
  if (playlistHistory.length > 20) {
    playlistHistory = playlistHistory.slice(0, 20);
  }
  
  try {
    savePlaylistHistory();
  } catch (e) {
    console.warn('Storage quota exceeded, reducing history size');
    playlistHistory = playlistHistory.slice(0, 10);
    try {
      savePlaylistHistory();
    } catch (e2) {
      console.error('Could not save playlist history:', e2);
    }
  }
  
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
  
  if (!playlist.trackData || playlist.trackData.length === 0) {
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
  const headers = ['Track Name', 'Artist', 'Album', 'Duration (ms)', 'Spotify URL'];
  const rows = [headers];
  
  playlist.trackData.forEach(track => {
    const trackName = track.name || '';
    const artist = track.artists ? track.artists.join('; ') : '';
    const album = track.album || '';
    const duration = track.duration_ms || '';
    const url = track.external_urls ? track.external_urls.spotify : '';
    
    rows.push([
      escapeCSV(trackName),
      escapeCSV(artist),
      escapeCSV(album),
      duration,
      url
    ]);
  });
  
  const csvContent = rows.map(row => row.join(',')).join('\n');
  downloadFile(csvContent, `${playlist.name}.csv`, 'text/csv');
}

function exportAsTXT(playlist) {
  const lines = playlist.trackData.map(track => {
    const artist = track.artists && track.artists.length > 0 ? track.artists.join(', ') : 'Unknown Artist';
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
    scope: 'user-library-read playlist-read-private playlist-modify-public playlist-modify-private user-top-read',
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
    updateStatus('Logged in successfully');
    
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('app-section').classList.remove('hidden');
    
    loadPlaylistHistory();
  } else {
    updateStatus('Login failed');
    console.error(data);
  }
}

// ===== TAB SWITCHING ===== v1 UPDATE #3

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    btn.classList.add('active');
    const tabName = btn.getAttribute('data-tab');
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    if (tabName === 'stats' && cachedLibraryData) {
      generateMusicStats();
    }
  });
});

// ===== ONBOARDING =====

document.getElementById('help-button')?.addEventListener('click', () => {
  const appSection = document.getElementById('app-section');
  if (appSection && appSection.classList.contains('hidden')) {
    alert('Please login with Spotify first to see the interactive tour!\n\nThe tour will guide you through all features once you\'re logged in.');
    return;
  }
  showTour();
});

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

window.addEventListener('load', () => {
  // Load manual genre mappings from localStorage
  const savedMappings = localStorage.getItem('manual_genre_mappings');
  if (savedMappings) {
    try {
      manualGenreMappings = JSON.parse(savedMappings);
    } catch (e) {
      console.warn('Failed to load manual genre mappings:', e);
    }
  }
  
  // Show tour on first login (mandatory until completed or skipped)
  if (!localStorage.getItem('tour_completed')) {
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
    
    saveToCache(dataSource, cachedLibraryData);
    updateCacheInfo(Date.now());
    
    await processLibraryData(dataSource);
  } catch (e) {
    updateStatus(`Error: ${e.message}`);
  }
  
  document.getElementById('fetch-tracks').disabled = false;
});

document.getElementById('refresh-cache').addEventListener('click', async () => {
  const dataSource = document.querySelector('input[name="data-source"]:checked').value;
  clearCache(dataSource);
  updateCacheInfo(null);
  updateStatus('Cache cleared. Click "Load Music Library" to fetch fresh data.');
});

async function fetchLikedSongs() {
  updateStatus('Loading your Spotify library...');
  let all = [];
  const limit = 50;
  let offset = 0;
  
  while (true) {
    const resp = await fetchWithRetry(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
    });
    const data = await resp.json();
    all.push(...data.items);
    
    if (all.length > 5000) {
      updateStatus(`${all.length} songs found. This may take a moment...`);
    } else if (all.length > 1000) {
      updateStatus(`${all.length} tracks and counting...`);
    } else {
      updateStatus(`Fetched ${all.length} tracks...`);
    }
    
    if (!data.next) break;
    offset += limit;
  }
  
  cachedLibraryData = { type: 'tracks', items: all };
  updateStatus(`Loaded ${all.length} tracks successfully`);
}

async function fetchTopArtists() {
  updateStatus('Loading your favorite artists...');
  
  const resp = await fetchWithRetry(
    'https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term',
    { headers: { 'Authorization': `Bearer ${window.spotifyToken}` } }
  );
  const data = await resp.json();
  
  updateStatus('Fetching their best tracks...');
  let allTracks = [];
  
  for (let i = 0; i < data.items.length; i++) {
    const artist = data.items[i];
    const tracksResp = await fetchWithRetry(
      `https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=US`,
      { headers: { 'Authorization': `Bearer ${window.spotifyToken}` } }
    );
    const tracksData = await tracksResp.json();
    
    tracksData.tracks.slice(0, 5).forEach(track => {
      allTracks.push({ track: track });
    });
    
    updateStatus(`Processing artists... ${i + 1}/${data.items.length}`);
  }
  
  cachedLibraryData = { type: 'tracks', items: allTracks };
  updateStatus(`Loaded ${allTracks.length} tracks from your top artists`);
}

async function fetchFromPlaylists() {
  updateStatus('Fetching your playlists...');
  
  let allPlaylists = [];
  let offset = 0;
  const limit = 50;
  
  // First, fetch all playlists
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
  
  // Show playlist selection UI
  const shouldContinue = await showPlaylistSelectionUI(allPlaylists);
  if (!shouldContinue) {
    updateStatus('Playlist selection cancelled');
    return;
  }
  
  // Get selected playlists
  const selectedPlaylists = allPlaylists.filter((_, index) => {
    const checkbox = document.querySelector(`input[data-playlist-index="${index}"]`);
    return checkbox && checkbox.checked;
  });
  
  if (selectedPlaylists.length === 0) {
    updateStatus('No playlists selected');
    return;
  }
  
  updateStatus(`Loading tracks from ${selectedPlaylists.length} selected playlists...`);
  
  let allTracks = [];
  const trackSet = new Set();
  
  for (let i = 0; i < selectedPlaylists.length; i++) {
    const playlist = selectedPlaylists[i];
    
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
    
    playlistTracks.forEach(item => {
      if (item.track && item.track.id && !trackSet.has(item.track.id)) {
        trackSet.add(item.track.id);
        allTracks.push(item);
      }
    });
    
    updateStatus(`Scanned ${i + 1}/${selectedPlaylists.length} playlists... (${allTracks.length} unique tracks)`);
  }
  
  cachedLibraryData = { type: 'tracks', items: allTracks };
  updateStatus(`Loaded ${allTracks.length} unique tracks from ${selectedPlaylists.length} playlists`);
}

function showPlaylistSelectionUI(playlists) {
  return new Promise((resolve) => {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'playlist-selection-modal';
    modal.innerHTML = `
      <div class="playlist-selection-content">
        <h3>Select Playlists to Scan</h3>
        <p style="color: #b3b3b3; font-size: 14px; margin-bottom: 16px;">
          Choose which playlists to include in your library analysis
        </p>
        <div class="playlist-selection-actions" style="margin-bottom: 16px;">
          <button class="btn-small" onclick="document.querySelectorAll('.playlist-selection-checkbox').forEach(cb => cb.checked = true)">Select All</button>
          <button class="btn-small" onclick="document.querySelectorAll('.playlist-selection-checkbox').forEach(cb => cb.checked = false)">Deselect All</button>
        </div>
        <div class="playlist-selection-list">
          ${playlists.map((playlist, index) => `
            <label class="playlist-selection-item">
              <input type="checkbox" 
                     class="playlist-selection-checkbox" 
                     data-playlist-index="${index}"
                     checked>
              <img src="${playlist.images && playlist.images[0] ? playlist.images[0].url : 'https://via.placeholder.com/50'}" 
                   alt="${playlist.name}"
                   class="playlist-thumb">
              <div class="playlist-info">
                <div class="playlist-name">${playlist.name}</div>
                <div class="playlist-tracks-count">${playlist.tracks.total} tracks</div>
              </div>
            </label>
          `).join('')}
        </div>
        <div class="playlist-selection-buttons">
          <button class="btn-small" id="cancel-playlist-selection">Cancel</button>
          <button class="btn-primary" id="confirm-playlist-selection">Continue</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById('cancel-playlist-selection').addEventListener('click', () => {
      document.body.removeChild(modal);
      resolve(false);
    });
    
    document.getElementById('confirm-playlist-selection').addEventListener('click', () => {
      document.body.removeChild(modal);
      resolve(true);
    });
  });
}

async function processLibraryData(dataSource) {
  updateStatus('Organizing your music...');
  
  const tracks = cachedLibraryData.items;
  
  const artistIds = new Set();
  tracks.forEach(item => {
    if (item.track && item.track.artists && item.track.artists[0]) {
      artistIds.add(item.track.artists[0].id);
    }
  });
  
  const ids = Array.from(artistIds);
  const artistGenreMap = {};
  
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(',');
    const resp = await fetchWithRetry(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
    });
    const data = await resp.json();
    data.artists.forEach(a => {
      if (a) artistGenreMap[a.id] = a.genres;
    });
    updateStatus(`Analyzing genres... ${Math.min(i + 50, ids.length)} / ${ids.length} artists`);
  }
  
  genreSongMap = buildGenreSongMap(tracks, artistGenreMap);
  
  displayGenreSelection(tracks.length);
  generateMusicStats(); // v1 UPDATE #2
  updateStatus('Analysis complete. Select your genres below');
}

function buildGenreSongMap(tracks, artistGenreMap) {
  const map = {};
  
  tracks.forEach(item => {
    if (!item.track || !item.track.artists || !item.track.artists[0]) return;
    
    const track = item.track;
    const artistId = track.artists[0].id;
    const genres = artistGenreMap[artistId] || [];
    
    // Skip tracks with no genres
    if (genres.length === 0) return;
    
    genres.forEach(genre => {
      if (!map[genre]) {
        map[genre] = [];
      }
      if (!map[genre].find(t => t.id === track.id)) {
        map[genre].push(track);
      }
    });
  });
  
  return map;
}

// Helper function to count unique artists per genre
function getArtistCountForGenre(genre) {
  const tracks = genreSongMap[genre];
  if (!tracks) return 0;
  
  const artistIds = new Set();
  tracks.forEach(track => {
    if (track.artists && track.artists[0]) {
      artistIds.add(track.artists[0].id);
    }
  });
  
  return artistIds.size;
}

// Helper function to get artists grouped by genre
function getArtistsForGenre(genre) {
  const tracks = genreSongMap[genre];
  if (!tracks) return [];
  
  const artistMap = new Map();
  
  tracks.forEach(track => {
    if (track.artists && track.artists[0]) {
      const artist = track.artists[0];
      if (!artistMap.has(artist.id)) {
        artistMap.set(artist.id, {
          id: artist.id,
          name: artist.name,
          tracks: []
        });
      }
      artistMap.get(artist.id).tracks.push(track);
    }
  });
  
  // Sort by track count descending
  return Array.from(artistMap.values())
    .sort((a, b) => b.tracks.length - a.tracks.length);
}

// ===== DISPLAY GENRE SELECTION UI =====

function displayGenreSelection(totalTracks) {
  document.getElementById('genre-selection-area').classList.remove('hidden');
  
  const sortedGenres = Object.entries(genreSongMap)
    .sort((a, b) => b[1].length - a[1].length);
  
  displayGenreStats(sortedGenres, totalTracks);
  
  renderGenreView();
  
  // Remove old event listener and add new one (prevent duplicates)
  const viewModeSelect = document.getElementById('genre-view-mode');
  const newViewModeSelect = viewModeSelect.cloneNode(true);
  viewModeSelect.parentNode.replaceChild(newViewModeSelect, viewModeSelect);
  
  newViewModeSelect.addEventListener('change', (e) => {
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

function renderFamiliesView(grid) {
  const familyMap = buildGenreFamilyMap(genreSongMap);
  
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
  
  grid.querySelectorAll('.genre-family-item').forEach(item => {
    item.addEventListener('click', () => {
      const familyId = item.getAttribute('data-family-id');
      toggleFamilySelection(familyId, familyMap[familyId], item);
    });
  });
}

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
  
  grid.querySelectorAll('.subgenre-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const genre = item.getAttribute('data-genre');
      toggleGenreSelection(genre, item);
    });
  });
  
  grid.querySelectorAll('.genre-family-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('genre-family-expand')) return;
      const familyId = item.getAttribute('data-family-id');
      toggleFamilySelection(familyId, familyMap[familyId], item);
    });
  });
}

function renderAllGenresView(grid) {
  const sortedGenres = Object.entries(genreSongMap)
    .sort((a, b) => b[1].length - a[1].length);
  
  grid.innerHTML = sortedGenres.map(([genre, tracks]) => {
    const artistCount = getArtistCountForGenre(genre);
    const safeGenreId = genre.replace(/[^a-z0-9]/gi, '_');
    const family = detectGenreFamily(genre);
    const isOther = family.id === 'other';
    
    return `
      <div class="genre-item ${selectedGenres.has(genre) ? 'selected' : ''}" data-genre="${genre}">
        <div class="genre-name">${genre}</div>
        <div class="genre-count">${tracks.length} song${tracks.length !== 1 ? 's' : ''} • ${artistCount} artist${artistCount !== 1 ? 's' : ''}</div>
        ${isOther ? `<button class="genre-map-btn" onclick="showGenreMappingDialog('${genre}', event)" title="Map to genre family">Map to Family</button>` : ''}
        <button class="genre-expand-btn" onclick="toggleGenreArtists('${genre}', event)">Show Artists ▼</button>
        <div class="genre-artists-list" id="genre-artists-${safeGenreId}"></div>
      </div>
    `;
  }).join('');
  
  grid.querySelectorAll('.genre-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't toggle selection if clicking the expand button or map button
      if (e.target.classList.contains('genre-expand-btn') || e.target.classList.contains('genre-map-btn')) return;
      
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

function toggleGenreArtists(genre, event) {
  event.stopPropagation();
  
  const safeGenreId = genre.replace(/[^a-z0-9]/gi, '_');
  const artistsList = document.getElementById(`genre-artists-${safeGenreId}`);
  const button = event.target;
  
  if (artistsList.classList.contains('expanded')) {
    artistsList.classList.remove('expanded');
    artistsList.innerHTML = '';
    button.textContent = 'Show Artists ▼';
  } else {
    // Load and display artists
    const artists = getArtistsForGenre(genre);
    
    // Initialize excludedArtists set for this genre if it doesn't exist
    if (!excludedArtists.has(genre)) {
      excludedArtists.set(genre, new Set());
    }
    const excluded = excludedArtists.get(genre);
    
    artistsList.innerHTML = artists.map(artist => {
      const isExcluded = excluded.has(artist.id);
      const safeArtistId = artist.id.replace(/[^a-z0-9]/gi, '_');
      const safeGenreId = genre.replace(/[^a-z0-9]/gi, '_');
      return `
        <div class="artist-in-genre">
          <label class="artist-checkbox-label">
            <input type="checkbox" 
                   class="artist-checkbox" 
                   data-genre="${genre}" 
                   data-artist-id="${artist.id}"
                   ${isExcluded ? '' : 'checked'}>
            <span class="artist-name">${artist.name}</span>
            <span class="artist-track-count">${artist.tracks.length} track${artist.tracks.length !== 1 ? 's' : ''}</span>
          </label>
          <button class="track-expand-btn" onclick="toggleArtistTracks('${genre}', '${artist.id}', event)">Show Tracks ▼</button>
          <div class="artist-tracks-list" id="artist-tracks-${safeGenreId}-${safeArtistId}"></div>
        </div>
      `;
    }).join('');
    
    // Add event listeners for checkboxes
    artistsList.querySelectorAll('.artist-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        handleArtistToggle(genre, checkbox.dataset.artistId, checkbox.checked);
      });
    });
    
    artistsList.classList.add('expanded');
    button.textContent = 'Hide Artists ▲';
  }
}

function showGenreMappingDialog(genre, event) {
  event.stopPropagation();
  
  const modal = document.createElement('div');
  modal.className = 'genre-mapping-modal';
  
  const familyOptions = Object.entries(genreFamilies)
    .map(([id, family]) => `<option value="${id}">${family.name}</option>`)
    .join('');
  
  modal.innerHTML = `
    <div class="genre-mapping-content">
      <h3>Map "${genre}" to Genre Family</h3>
      <p style="color: #b3b3b3; font-size: 14px; margin-bottom: 20px;">
        This genre is currently unmapped. Choose which family it belongs to:
      </p>
      <select id="family-select" class="family-select">
        <option value="">-- Select Family --</option>
        ${familyOptions}
      </select>
      <div class="genre-mapping-buttons">
        <button class="btn-small" id="cancel-genre-mapping">Cancel</button>
        <button class="btn-primary" id="confirm-genre-mapping">Map Genre</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  document.getElementById('cancel-genre-mapping').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  document.getElementById('confirm-genre-mapping').addEventListener('click', () => {
    const selectedFamily = document.getElementById('family-select').value;
    if (selectedFamily) {
      // Store the mapping
      manualGenreMappings[genre.toLowerCase()] = selectedFamily;
      
      // Save to localStorage
      localStorage.setItem('manual_genre_mappings', JSON.stringify(manualGenreMappings));
      
      // Re-render the view
      renderGenreView();
      
      updateStatus(`Mapped "${genre}" to ${genreFamilies[selectedFamily].name} family`);
    }
    document.body.removeChild(modal);
  });
}

function handleArtistToggle(genre, artistId, isChecked) {
  if (!excludedArtists.has(genre)) {
    excludedArtists.set(genre, new Set());
  }
  
  const excluded = excludedArtists.get(genre);
  
  if (isChecked) {
    // Artist is included - remove from excluded set
    excluded.delete(artistId);
  } else {
    // Artist is excluded - add to excluded set
    excluded.add(artistId);
  }
  
  // Update the track count display
  updateGenreTrackCounts();
}

function toggleArtistTracks(genre, artistId, event) {
  event.stopPropagation();
  
  const safeGenreId = genre.replace(/[^a-z0-9]/gi, '_');
  const safeArtistId = artistId.replace(/[^a-z0-9]/gi, '_');
  const tracksList = document.getElementById(`artist-tracks-${safeGenreId}-${safeArtistId}`);
  const button = event.target;
  
  if (tracksList.classList.contains('expanded')) {
    tracksList.classList.remove('expanded');
    tracksList.innerHTML = '';
    button.textContent = 'Show Tracks ▼';
  } else {
    // Get tracks for this artist in this genre
    const artists = getArtistsForGenre(genre);
    const artist = artists.find(a => a.id === artistId);
    
    if (!artist) return;
    
    // Initialize excluded tracks for this genre:artist combo
    const trackKey = `${genre}:${artistId}`;
    if (!excludedTracks.has(trackKey)) {
      excludedTracks.set(trackKey, new Set());
    }
    const excludedTrackIds = excludedTracks.get(trackKey);
    
    tracksList.innerHTML = artist.tracks.map(track => {
      const isExcluded = excludedTrackIds.has(track.id);
      return `
        <div class="track-in-artist">
          <label class="track-checkbox-label">
            <input type="checkbox" 
                   class="track-checkbox" 
                   data-genre="${genre}" 
                   data-artist-id="${artistId}"
                   data-track-id="${track.id}"
                   ${isExcluded ? '' : 'checked'}>
            <span class="track-name">${track.name}</span>
            <span class="track-duration">${formatDuration(track.duration_ms)}</span>
          </label>
        </div>
      `;
    }).join('');
    
    // Add event listeners for track checkboxes
    tracksList.querySelectorAll('.track-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        handleTrackToggle(genre, artistId, checkbox.dataset.trackId, checkbox.checked);
      });
    });
    
    tracksList.classList.add('expanded');
    button.textContent = 'Hide Tracks ▲';
  }
}

function handleTrackToggle(genre, artistId, trackId, isChecked) {
  const trackKey = `${genre}:${artistId}`;
  
  if (!excludedTracks.has(trackKey)) {
    excludedTracks.set(trackKey, new Set());
  }
  
  const excluded = excludedTracks.get(trackKey);
  
  if (isChecked) {
    // Track is included - remove from excluded set
    excluded.delete(trackId);
  } else {
    // Track is excluded - add to excluded set
    excluded.add(trackId);
  }
  
  // Update track counts
  updateGenreTrackCounts();
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function updateGenreTrackCounts() {
  // Update track counts in the UI to reflect excluded artists
  Object.keys(genreSongMap).forEach(genre => {
    const filteredTracks = getFilteredTracksForGenre(genre);
    const genreElements = document.querySelectorAll(`[data-genre="${genre}"] .genre-count`);
    
    genreElements.forEach(el => {
      const artistCount = getActiveArtistCountForGenre(genre);
      el.textContent = `${filteredTracks.length} song${filteredTracks.length !== 1 ? 's' : ''} • ${artistCount} artist${artistCount !== 1 ? 's' : ''}`;
    });
  });
}

function getFilteredTracksForGenre(genre) {
  const tracks = genreSongMap[genre] || [];
  
  // Filter out excluded artists
  let filteredTracks = tracks;
  
  if (excludedArtists.has(genre) && excludedArtists.get(genre).size > 0) {
    const excludedArtistIds = excludedArtists.get(genre);
    filteredTracks = filteredTracks.filter(track => {
      const artistId = track.artists && track.artists[0] ? track.artists[0].id : null;
      return artistId && !excludedArtistIds.has(artistId);
    });
  }
  
  // Filter out excluded tracks
  filteredTracks = filteredTracks.filter(track => {
    const artistId = track.artists && track.artists[0] ? track.artists[0].id : null;
    if (!artistId) return true;
    
    const trackKey = `${genre}:${artistId}`;
    if (excludedTracks.has(trackKey)) {
      const excludedTrackIds = excludedTracks.get(trackKey);
      return !excludedTrackIds.has(track.id);
    }
    
    return true;
  });
  
  return filteredTracks;
}

function getActiveArtistCountForGenre(genre) {
  const filteredTracks = getFilteredTracksForGenre(genre);
  const artistIds = new Set();
  
  filteredTracks.forEach(track => {
    if (track.artists && track.artists[0]) {
      artistIds.add(track.artists[0].id);
    }
  });
  
  return artistIds.size;
}

function toggleFamilySelection(familyId, family, element) {
  const allGenresInFamily = Object.keys(family.genres);
  const allSelected = allGenresInFamily.every(g => selectedGenres.has(g));
  
  if (allSelected) {
    allGenresInFamily.forEach(g => selectedGenres.delete(g));
    element.classList.remove('selected');
  } else {
    allGenresInFamily.forEach(g => selectedGenres.add(g));
    element.classList.add('selected');
  }
  
  updateSelectedCount();
  
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
      <div class="stat-label">Genres Found</div>
      <div class="stat-value">${totalGenres}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Total Tracks</div>
      <div class="stat-value">${totalTracks}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Genres Selected</div>
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
  
  const createBtn = document.getElementById('create-library-playlist');
  createBtn.disabled = selectedGenres.size === 0;
  
  if (selectedGenres.size === 0) {
    updateStatus('Select genres to create a playlist');
  } else if (selectedGenres.size === 1) {
    updateStatus(`${selectedGenres.size} genre selected`);
  } else {
    updateStatus(`${selectedGenres.size} genres selected`);
  }
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
    const items = document.querySelectorAll('.genre-family-item');
    items.forEach(item => {
      if (item.style.display !== 'none') {
        const familyId = item.getAttribute('data-family-id');
        const familyMap = buildGenreFamilyMap(genreSongMap);
        const family = familyMap[familyId];
        
        Object.keys(family.genres).forEach(g => selectedGenres.add(g));
        item.classList.add('selected');
        
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
  
  const mode = document.querySelector('input[name="playlist-mode"]:checked').value;
  
  if (mode === 'merged') {
    await createMergedPlaylist();
  } else {
    await createSeparatePlaylists();
  }
  
  document.getElementById('create-library-playlist').disabled = false;
});

async function createMergedPlaylist() {
  updateStatus('Creating merged playlist...');
  
  try {
    const trackSet = new Set();
    selectedGenres.forEach(genre => {
      // Use filtered tracks that respect artist exclusions
      const filteredTracks = getFilteredTracksForGenre(genre);
      filteredTracks.forEach(track => {
        trackSet.add(track.uri);
      });
    });
    
    const trackUris = Array.from(trackSet);
    
    const userResp = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
    });
    const userData = await userResp.json();
    
    const customName = document.getElementById('playlist-name').value.trim();
    
    // Generate funny name if none provided
    let playlistName;
    if (customName) {
      playlistName = `PA: ${customName}`;
    } else {
      const genreArray = Array.from(selectedGenres);
      const genreCount = genreArray.length;
      
      if (genreCount === 1) {
        playlistName = `PA: Pure ${genreArray[0]}`;
      } else if (genreCount === 2) {
        playlistName = `PA: ${genreArray[0]} × ${genreArray[1]}`;
      } else if (genreCount <= 4) {
        playlistName = `PA: ${genreArray.slice(0, 2).join(' + ')} & More`;
      } else if (genreCount <= 8) {
        playlistName = `PA: Genre Cocktail (${genreCount} flavors)`;
      } else {
        playlistName = `PA: The Everything Bagel (${genreCount} genres)`;
      }
    }
    
    const createResp = await fetch(`https://api.spotify.com/v1/users/${userData.id}/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${window.spotifyToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: playlistName,
        description: `${Array.from(selectedGenres).join(', ')} • Created by Playlist Alchemist`,
        public: false
      })
    });
    const playlist = await createResp.json();
    
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
    
    const tracksForExport = Array.from(trackSet).map(uri => {
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
    
    // Create clickable Spotify link
    const spotifyLink = playlist.external_urls.spotify;
    updateStatus(`Created "${playlistName}" with ${trackUris.length} tracks → Open in Spotify: ${spotifyLink}`);
    
    // Make the status message clickable
    const statusEl = document.getElementById('status');
    statusEl.innerHTML = `Created "<strong>${playlistName}</strong>" with ${trackUris.length} tracks<br><a href="${spotifyLink}" target="_blank" style="color: #1db954; text-decoration: underline;">→ Open in Spotify</a>`;
    
    document.getElementById('playlist-name').value = '';
  } catch (e) {
    updateStatus(`Error creating playlist: ${e.message}`);
  }
}

async function createSeparatePlaylists() {
  updateStatus('Creating separate playlists...');
  
  try {
    const userResp = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
    });
    const userData = await userResp.json();
    
    let createdCount = 0;
    const genreArray = Array.from(selectedGenres);
    
    for (const genre of genreArray) {
      // Use filtered tracks that respect artist exclusions
      const tracks = getFilteredTracksForGenre(genre);
      const trackUris = tracks.map(t => t.uri);
      
      const createResp = await fetch(`https://api.spotify.com/v1/users/${userData.id}/playlists`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${window.spotifyToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: `PA: ${genre}`,
          description: `${genre} playlist created by Playlist Alchemist`,
          public: false
        })
      });
      const playlist = await createResp.json();
      
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
      
      addToHistory({
        name: `PA: ${genre}`,
        external_urls: { spotify: playlist.external_urls.spotify }
      }, tracks);
      
      createdCount++;
      updateStatus(`Created ${createdCount}/${genreArray.length} playlists...`);
    }
    
    updateStatus(`Created ${createdCount} separate playlists. Check the Playlist History tab.`);
    document.getElementById('playlist-name').value = '';
  } catch (e) {
    updateStatus(`Error creating playlists: ${e.message}`);
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
  
  updateStatus('Scanning your library for artists with matching genres...');
  document.getElementById('find-related').disabled = true;
  
  try {
    // Get the selected artist's genres
    const selectedGenres = selectedArtist.genres || [];
    
    if (selectedGenres.length === 0) {
      updateStatus('This artist has no genres listed - cannot find similar artists');
      document.getElementById('find-related').disabled = false;
      return;
    }
    
    // Get all artists from cached library data with their genres
    if (!cachedLibraryData || !cachedLibraryData.items) {
      updateStatus('Please load your library first (go to My Library tab and click "Let\'s Go")');
      document.getElementById('find-related').disabled = false;
      return;
    }
    
    const tracks = cachedLibraryData.items;
    
    // Build map of artist ID -> {name, genres, imageUrl, matchCount}
    const artistMap = new Map();
    
    tracks.forEach(item => {
      if (!item.track || !item.track.artists || !item.track.artists[0]) return;
      
      const artist = item.track.artists[0];
      
      // Skip the selected artist itself
      if (artist.id === selectedArtist.id) return;
      
      if (!artistMap.has(artist.id)) {
        artistMap.set(artist.id, {
          id: artist.id,
          name: artist.name,
          genres: [],
          images: item.track.album.images,
          matchCount: 0,
          matchingGenres: []
        });
      }
    });
    
    // Fetch genres for all artists (we need to get this from Spotify)
    const artistIds = Array.from(artistMap.keys());
    
    for (let i = 0; i < artistIds.length; i += 50) {
      const batch = artistIds.slice(i, i + 50).join(',');
      const resp = await fetchWithRetry(`https://api.spotify.com/v1/artists?ids=${batch}`, {
        headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
      });
      const data = await resp.json();
      
      data.artists.forEach(a => {
        if (a && artistMap.has(a.id)) {
          const artistData = artistMap.get(a.id);
          artistData.genres = a.genres || [];
          
          // Calculate matching genres
          const matches = artistData.genres.filter(g => selectedGenres.includes(g));
          artistData.matchCount = matches.length;
          artistData.matchingGenres = matches;
        }
      });
    }
    
    // Filter to only artists with at least 1 matching genre and sort by match count
    const relatedArtists = Array.from(artistMap.values())
      .filter(a => a.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount)
      .slice(0, 20); // Top 20 matches
    
    if (relatedArtists.length === 0) {
      updateStatus('No artists in your library share genres with this artist');
      document.getElementById('find-related').disabled = false;
      return;
    }
    
    // Show how many high vs medium matches
    const highMatches = relatedArtists.filter(a => a.matchCount >= 3).length;
    const mediumMatches = relatedArtists.filter(a => a.matchCount === 2).length;
    const lowMatches = relatedArtists.filter(a => a.matchCount === 1).length;
    
    let matchSummary = `Found ${relatedArtists.length} similar artists: `;
    const parts = [];
    if (highMatches > 0) parts.push(`${highMatches} with 3+ genre matches`);
    if (mediumMatches > 0) parts.push(`${mediumMatches} with 2 matches`);
    if (lowMatches > 0) parts.push(`${lowMatches} with 1 match`);
    matchSummary += parts.join(', ');
    
    displayRelatedArtists(relatedArtists, selectedGenres);
    updateStatus(matchSummary);
    document.getElementById('find-related').disabled = false;
  } catch (e) {
    updateStatus(`Error finding related artists: ${e.message}`);
    document.getElementById('find-related').disabled = false;
  }
});

function displayRelatedArtists(artists, selectedGenres) {
  const container = document.getElementById('related-artists-grid');
  selectedRelatedArtists.clear();
  
  // Safety check for undefined or empty artists
  if (!artists || artists.length === 0) {
    container.innerHTML = '<p style="color: #7f7f7f; padding: 20px;">No related artists found.</p>';
    return;
  }
  
  container.innerHTML = artists.slice(0, 12).map(artist => {
    const imageUrl = artist.images && artist.images[0] ? artist.images[0].url : 'https://via.placeholder.com/200';
    const musicMapUrl = getMusicMapUrl(artist.name);
    
    // Show match info if available
    const matchInfo = artist.matchCount ? 
      `<div style="font-size: 11px; color: #1db954; margin-top: 4px;">${artist.matchCount} genre match${artist.matchCount !== 1 ? 'es' : ''}</div>` : 
      '';
    
    return `
      <div class="artist-item" data-artist-id="${artist.id}">
        <img src="${imageUrl}" alt="${artist.name}">
        <h4>${artist.name}</h4>
        ${matchInfo}
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
    updateStatus('Please select at least one artist first');
    return;
  }
  
  updateStatus('Creating playlist...');
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
    const playlistName = customName ? `PA: ${customName}` : `PA: ${selectedArtist.name} + Similar Vibes`;
    
    const createResp = await fetch(`https://api.spotify.com/v1/users/${userData.id}/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${window.spotifyToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: playlistName,
        description: `${selectedArtist.name}${selectedRelatedArtists.size > 0 ? ` + ${selectedRelatedArtists.size} similar artist${selectedRelatedArtists.size !== 1 ? 's' : ''}` : ''} • Created by Playlist Alchemist`,
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
    
    addToHistory({
      name: playlistName,
      external_urls: { spotify: playlist.external_urls.spotify }
    }, allTracks);
    
    // Create clickable Spotify link
    const spotifyLink = playlist.external_urls.spotify;
    const statusEl = document.getElementById('status');
    statusEl.innerHTML = `"<strong>${playlistName}</strong>" created with ${allTracks.length} tracks<br><a href="${spotifyLink}" target="_blank" style="color: #1db954; text-decoration: underline;">→ Open in Spotify</a>`;
    
    document.getElementById('generate-discovery-playlist').disabled = false;
    document.getElementById('discovery-playlist-name').value = '';
  } catch (e) {
    updateStatus(`Error: ${e.message}`);
    document.getElementById('generate-discovery-playlist').disabled = false;
  }
});

// ===== PAGE LOAD: Handle OAuth Redirect =====

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
