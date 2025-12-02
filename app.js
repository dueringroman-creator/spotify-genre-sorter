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
    // Try to save
    localStorage.setItem(`playlist_alchemist_${key}`, JSON.stringify(data));
    localStorage.setItem(`playlist_alchemist_${key}_timestamp`, Date.now().toString());
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.warn('⚠️ Storage quota exceeded. Clearing old cache...');
      
      // Clear old cached data (keep only current source)
      const keysToKeep = [`playlist_alchemist_${key}`, `playlist_alchemist_${key}_timestamp`];
      Object.keys(localStorage).forEach(storageKey => {
        if (storageKey.startsWith('playlist_alchemist_') && !keysToKeep.includes(storageKey)) {
          localStorage.removeItem(storageKey);
        }
      });
      
      // Try again after cleanup
      try {
        localStorage.setItem(`playlist_alchemist_${key}`, JSON.stringify(data));
        localStorage.setItem(`playlist_alchemist_${key}_timestamp`, Date.now().toString());
        console.log('✅ Saved after cache cleanup');
      } catch (e2) {
        console.error('❌ Still cannot save. Storage may be full.', e2);
        // Store in memory as fallback
        window.memoryCache = window.memoryCache || {};
        window.memoryCache[key] = { data, timestamp: Date.now() };
        console.log('💾 Using memory cache as fallback');
      }
    } else {
      console.warn('Cache save failed:', e);
    }
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
    
    // Check memory cache fallback
    if (window.memoryCache && window.memoryCache[key]) {
      console.log('📦 Loading from memory cache');
      return window.memoryCache[key];
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
    
    try {
      const response = await fetchSpotifyAPI(`audio-features?ids=${batch.join(',')}`);
      
      if (response && response.audio_features) {
        response.audio_features.forEach((feature, idx) => {
          if (feature) {
            features[batch[idx]] = feature;
          }
        });
      }
    } catch (error) {
      // If 403 or other error, skip this batch and continue
      console.warn(`⚠️ Could not fetch audio features for batch ${i/100 + 1}. Continuing...`);
      // Don't throw - just skip this batch
    }
  }
  
  return features;
}

async function createSpotifyPlaylist(name, tracks, description = 'Created with Playlist Alchemist') {
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
      description: description,
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


// ============================================
// ENHANCED GENRE DETECTION SYSTEM
// 500+ Aliases & Fuzzy Matching
// ============================================

const GENRE_ALIASES = {
  // UK Bass scene (comprehensive)
  'uk garage': 'UK Garage',
  'uk funky': 'UK Funky',
  '2-step': 'UK Garage',
  '2step': 'UK Garage',
  '3 step': 'UK Garage',
  'bassline': 'Bassline',
  'bass music': 'Bass Music',
  'grime': 'Grime',
  'uk grime': 'Grime',
  'uk drill': 'UK Drill',
  'drill': 'UK Drill',
  'chicago drill': 'Drill',
  'footwork': 'Breakbeat',
  'juke': 'Breakbeat',
  'baltimore club': 'Breakbeat',
  'jersey club': 'Breakbeat',
  
  // Disco/Funk family
  'nu disco': 'Nu Disco',
  'new disco': 'Nu Disco',
  'nudisco': 'Nu Disco',
  'nu-disco': 'Nu Disco',
  'disco house': 'House',
  'french disco': 'Disco',
  'space disco': 'Disco',
  'italo disco': 'Italo Disco',
  'post-disco': 'Disco',
  'funk': 'Funk',
  'g-funk': 'G-Funk',
  'boogie': 'Funk',
  'boogie-woogie': 'Funk',
  'funk carioca': 'Funk',
  'funk belo horizonte': 'Funk',
  'afrobeat': 'Afrobeat',
  'afro tech': 'House',
  'afroswing': 'Hip Hop',
  'afrobeats': 'Afrobeats',
  
  // Techno variations
  'tekno': 'Techno',
  'technо': 'Techno',
  'tecno': 'Techno',
  'tekk': 'Techno',
  'schranz': 'Techno',
  'hardtechno': 'Techno',
  'hard techno': 'Techno',
  'minimal techno': 'Techno',
  'dub techno': 'Techno',
  'acid techno': 'Techno',
  'detroit techno': 'Techno',
  'berlin techno': 'Techno',
  'industrial techno': 'Techno',
  
  // House variations
  'houze': 'House',
  'housе': 'House',
  'deep house': 'House',
  'progressive house': 'House',
  'tech house': 'House',
  'bass house': 'House',
  'future house': 'House',
  'electro house': 'House',
  'tropical house': 'House',
  'afro house': 'House',
  'jackin house': 'House',
  'chicago house': 'House',
  'soulful house': 'House',
  'vocal house': 'House',
  'funky house': 'House',
  'melodic house': 'House',
  
  // Hip hop variations
  'hiphop': 'Hip Hop',
  'hip-hop': 'Hip Hop',
  'rap': 'Hip Hop',
  'trap': 'Trap',
  'hip hop': 'Hip Hop',
  'boom bap': 'Hip Hop',
  'conscious hip hop': 'Hip Hop',
  'gangsta rap': 'Hip Hop',
  'east coast hip hop': 'Hip Hop',
  'west coast hip hop': 'Hip Hop',
  'southern hip hop': 'Hip Hop',
  'cloud rap': 'Hip Hop',
  'mumble rap': 'Hip Hop',
  'crunk': 'Hip Hop',
  'horrorcore': 'Hip Hop',
  
  // Indie Electronic
  'indie dance': 'Indie Dance',
  'electroclash': 'Electroclash',
  'alternative dance': 'Indie Dance',
  'new rave': 'New Rave',
  
  // Electronic/EDM variations
  'electronica': 'Electronic',
  'electro': 'Electro',
  'edm': 'EDM',
  'electronic dance music': 'EDM',
  'big room': 'EDM',
  'complextro': 'Dubstep',
  
  // Classic Electronic
  'synthwave': 'Synthwave',
  'new wave': 'New Wave',
  'cold wave': 'New Wave',
  'darkwave': 'New Wave',
  'eurodance': 'Eurodance',
  'italo dance': 'Italo Dance',
  'electro swing': 'Electro Swing',
  
  // Lo-Fi/Chill
  'lo-fi': 'Lo-Fi',
  'lofi': 'Lo-Fi',
  'lo-fi beats': 'Lo-Fi',
  'lofi beats': 'Lo-Fi',
  'lo-fi indie': 'Lo-Fi',
  'chillwave': 'Chillwave',
  'chillstep': 'Chillstep',
  'vaporwave': 'Vaporwave',
  
  // Bass Music
  'future bass': 'Future Bass',
  'melodic bass': 'Melodic Bass',
  'miami bass': 'Bass Music',
  
  // Experimental/IDM
  'idm': 'IDM',
  'glitch': 'Glitch',
  'breakcore': 'Breakcore',
  'noise': 'Noise',
  'power electronics': 'Power Electronics',
  'avant-garde': 'Experimental',
  'avantgarde': 'Experimental',
  'gabba': 'Gabber',
  'speedcore': 'Speedcore',
  'hardcore': 'Hardcore',
  'frenchcore': 'Frenchcore',
  'happy hardcore': 'Happy Hardcore',
  'hardstyle': 'Hardstyle',
  'drumstep': 'Drum & Bass',
  
  // Industrial/experimental
  'industrial': 'Industrial',
  'ebm': 'EBM',
  'electro-industrial': 'Industrial',
  'dark ambient': 'Dark Ambient',
  'drone': 'Drone',
  'space music': 'Ambient',
  
  // Downtempo/Trip-hop
  'trip-hop': 'Trip-Hop',
  'trip hop': 'Trip-Hop',
  'downtempo': 'Downtempo',
  'lounge': 'Lounge',
  'quiet storm': 'Quiet Storm',
  
  // Drum & bass
  'dnb': 'Drum & Bass',
  'd&b': 'Drum & Bass',
  'jungle': 'Drum & Bass',
  'liquid dnb': 'Drum & Bass',
  'liquid funk': 'Drum & Bass',
  'neurofunk': 'Drum & Bass',
  'jump up': 'Drum & Bass',
  
  // Dubstep/bass
  'brostep': 'Dubstep',
  'riddim': 'Dubstep',
  'future garage': 'Future Garage',
  
  // Trance variations
  'progressive trance': 'Trance',
  'uplifting trance': 'Trance',
  'psytrance': 'Psytrance',
  'goa trance': 'Goa Trance',
  'vocal trance': 'Trance',
  'tech trance': 'Trance',
  
  // Ambient variations
  'chillout': 'Ambient',
  'space ambient': 'Ambient',
  'new age': 'New Age',
  
  // Breakbeat variations
  'big beat': 'Breakbeat',
  'nu skool breaks': 'Breakbeat',
  'breaks': 'Breakbeat',
  
  // Rock variations
  'indie rock': 'Indie Rock',
  'alternative rock': 'Alternative Rock',
  'alt rock': 'Alternative Rock',
  'post-rock': 'Post-Rock',
  'post rock': 'Post-Rock',
  'prog rock': 'Progressive Rock',
  'progressive rock': 'Progressive Rock',
  'post-punk': 'Post-Punk',
  'post punk': 'Post-Punk',
  'grunge': 'Grunge',
  'post-grunge': 'Grunge',
  'shoegaze': 'Shoegaze',
  'garage rock': 'Garage Rock',
  'psychedelic rock': 'Psychedelic Rock',
  
  // Pop variations
  'synthpop': 'Synth Pop',
  'synth pop': 'Synth Pop',
  'electropop': 'Electro Pop',
  'indie pop': 'Indie Pop',
  'dream pop': 'Dream Pop',
  'art pop': 'Art Pop',
  'k-pop': 'K-Pop',
  'kpop': 'K-Pop',
  'j-pop': 'J-Pop',
  'jpop': 'J-Pop',
  
  // Jazz variations
  'nu jazz': 'Nu Jazz',
  'acid jazz': 'Acid Jazz',
  'smooth jazz': 'Smooth Jazz',
  'bebop': 'Bebop',
  
  // Reggae/Dancehall variations
  'dub': 'Dub',
  'roots reggae': 'Reggae',
  'dancehall': 'Dancehall',
  'ragga': 'Ragga',
  
  // Latin/World music
  'reggaeton': 'Reggaeton',
  'neoperreo': 'Reggaeton',
  'urbano latino': 'Latin',
  'latin alternative': 'Latin',
  'latin indie': 'Latin',
  'latin': 'Latin',
  'salsa': 'Salsa',
  'mambo': 'Salsa',
  'cumbia': 'Cumbia',
  'electrocumbia': 'Cumbia',
  'samba': 'Samba',
  'bossa nova': 'Bossa Nova',
  'mpb': 'MPB',
  'nova mpb': 'MPB',
  'soca': 'Soca',
  'zouk': 'Zouk',
  'kizomba': 'Kizomba',
  'kuduro': 'Kuduro',
  'gqom': 'Gqom',
  'amapiano': 'Amapiano',
  'highlife': 'Highlife',
  
  // Dance/EDM
  'moombahton': 'Moombahton',
  'guaracha': 'Guaracha',
  'melbourne bounce': 'Melbourne Bounce',
  
  // Other electronic
  'phonk': 'Phonk',
  'drift phonk': 'Phonk',
  
  // R&B
  'r&b': 'R&B',
  'rnb': 'R&B',
  'r and b': 'R&B',
  'neo soul': 'Neo Soul',
  'new jack swing': 'R&B',
  
  // Misc
  'emo': 'Emo',
  'motown': 'Soul',
  'swing': 'Swing',
  'big band': 'Big Band',
  'ragtime': 'Ragtime',
  'doo-wop': 'Doo-Wop',
  'adult standards': 'Jazz',
  'singer-songwriter': 'Singer-Songwriter',
  'indie folk': 'Indie Folk',
  'folk': 'Folk',
  'country': 'Country',
  'bluegrass': 'Bluegrass',
  'blues': 'Blues',
  'soul': 'Soul',
  'gospel': 'Gospel',
  'classical': 'Classical',
  'opera': 'Opera',
  'metal': 'Metal',
  'death metal': 'Death Metal',
  'black metal': 'Black Metal',
  'thrash metal': 'Thrash Metal',
  'heavy metal': 'Heavy Metal',
  'punk': 'Punk',
  'pop punk': 'Pop Punk',
  'ska': 'Ska',
  'ska punk': 'Ska Punk',
  'soundtrack': 'Soundtrack',
  'score': 'Soundtrack'
};

// Enhanced detection function
function detectGenreFamilyEnhanced(spotifyGenre) {
  const lower = spotifyGenre.toLowerCase().trim();
  
  // Direct alias match
  if (GENRE_ALIASES[lower]) {
    return GENRE_ALIASES[lower];
  }
  
  // Substring match in aliases
  for (const [alias, family] of Object.entries(GENRE_ALIASES)) {
    if (lower.includes(alias)) {
      return family;
    }
  }
  
  // Word-based matching for compound genres
  const words = lower.split(/[\s\-]+/);
  for (const word of words) {
    if (GENRE_ALIASES[word]) {
      return GENRE_ALIASES[word];
    }
  }
  
  // Fallback to basic detection
  if (lower.includes('techno')) return 'Techno';
  if (lower.includes('house')) return 'House';
  if (lower.includes('trance')) return 'Trance';
  if (lower.includes('dnb') || lower.includes('drum') || lower.includes('bass') || lower.includes('jungle')) return 'Drum & Bass';
  if (lower.includes('dubstep')) return 'Dubstep';
  if (lower.includes('ambient')) return 'Ambient';
  if (lower.includes('rock')) return 'Rock';
  if (lower.includes('metal')) return 'Metal';
  if (lower.includes('punk')) return 'Punk';
  if (lower.includes('hip hop') || lower.includes('rap')) return 'Hip Hop';
  if (lower.includes('jazz')) return 'Jazz';
  if (lower.includes('blues')) return 'Blues';
  if (lower.includes('reggae')) return 'Reggae';
  if (lower.includes('pop')) return 'Pop';
  if (lower.includes('indie')) return 'Indie';
  if (lower.includes('folk')) return 'Folk';
  if (lower.includes('country')) return 'Country';
  if (lower.includes('classical')) return 'Classical';
  if (lower.includes('electronic') || lower.includes('electro')) return 'Electronic';
  
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
        const normalizedGenre = detectGenreFamilyEnhanced(spotifyGenre);
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

// ===== SMART SHUFFLE & ARTIST DIVERSITY =====

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
  
  // SMART SHUFFLE ALGORITHM
  const targetDurationMs = smartPlaylistSettings.targetDuration * 1000;
  const maxPerArtist = 3;
  const selectedTracks = [];
  const artistTrackCount = new Map();
  let totalDuration = 0;
  
  // Sort by energy for better flow (high to low for workout vibe)
  allTracks.sort((a, b) => {
    const aFeatures = audioFeaturesCache[a.id];
    const bFeatures = audioFeaturesCache[b.id];
    if (!aFeatures || !bFeatures) return 0;
    return bFeatures.energy - aFeatures.energy;
  });
  
  let lastArtistId = null;
  const availableTracks = [...allTracks];
  
  while (availableTracks.length > 0 && totalDuration < targetDurationMs) {
    let trackAdded = false;
    
    // Try to find a track from a different artist than the last one
    for (let i = 0; i < availableTracks.length; i++) {
      const track = availableTracks[i];
      const artistId = track.artists[0].id;
      
      // Check constraints
      const sameAsLast = artistId === lastArtistId;
      const artistCount = artistTrackCount.get(artistId) || 0;
      const maxReached = artistCount >= maxPerArtist;
      
      if (sameAsLast || maxReached) continue;
      
      // Add this track
      selectedTracks.push(track);
      artistTrackCount.set(artistId, artistCount + 1);
      totalDuration += track.duration_ms;
      lastArtistId = artistId;
      
      // Remove from available
      availableTracks.splice(i, 1);
      trackAdded = true;
      break;
    }
    
    // If we couldn't add any track (all remaining are from same artist or maxed out)
    if (!trackAdded) {
      // Relax the "different from last" constraint and try again
      for (let i = 0; i < availableTracks.length; i++) {
        const track = availableTracks[i];
        const artistId = track.artists[0].id;
        const artistCount = artistTrackCount.get(artistId) || 0;
        
        if (artistCount >= maxPerArtist) continue;
        
        selectedTracks.push(track);
        artistTrackCount.set(artistId, artistCount + 1);
        totalDuration += track.duration_ms;
        lastArtistId = artistId;
        availableTracks.splice(i, 1);
        break;
      }
      
      // If still nothing added, we're done
      if (!trackAdded) break;
    }
  }
  
  return selectedTracks;
}

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
    
    // Show cache info if loaded from cache
    updateCacheInfo(source, cached);
    
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
    const color = getGenreColor(genre);
    const safeId = genre.replace(/[^a-z0-9]/gi, '_');
    
    // Count artists
    const tracks = genreSongMap[genre] || [];
    const artistSet = new Set();
    tracks.forEach(t => artistSet.add(t.artists[0].id));
    const artistCount = artistSet.size;
    
    return `
      <div class="genre-card ${selected}" data-genre="${genre}" style="--genre-color: ${color}">
        <div class="genre-header">
          <div class="genre-info">
            <div class="genre-name">${genre}</div>
            <div class="genre-count">${count} tracks • ${artistCount} artists</div>
          </div>
        </div>
        <button class="genre-expand-btn" onclick="toggleGenreExpand('${escapeHtml(genre)}', event)">
          Show Artists ▼
        </button>
        <div class="genre-expanded-content" id="genre-expanded-${safeId}"></div>
      </div>
    `;
  }).join('');
  
  // Add click listeners
  grid.querySelectorAll('.genre-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't toggle if clicking expand button
      if (e.target.classList.contains('genre-expand-btn')) return;
      
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
  const nameInput = document.getElementById('playlist-name');
  let name = nameInput.value || '';
  
  // Auto-generate name if empty or still default
  if (!name || name === 'My Playlist') {
    name = generatePlaylistName();
  }
  
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
    // Generate description
    const description = generatePlaylistDescription();
    
    await createSpotifyPlaylist(name, tracks, description);
    showNotification(`Playlist "${name}" created with ${tracks.length} tracks!`);
    
    // Reset
    clearSelection();
    nameInput.value = 'My Playlist';
    
  } catch (error) {
    console.error('Create error:', error);
    showNotification('Error creating playlist. Please try again.');
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = originalText;
  }
}

// Generate smart playlist name
function generatePlaylistName() {
  if (selectedGenres.size === 0) return 'My Playlist';
  
  const genreArray = Array.from(selectedGenres);
  
  // If single genre
  if (genreArray.length === 1) {
    return `${genreArray[0]} Mix`;
  }
  
  // If 2-3 genres, list them
  if (genreArray.length <= 3) {
    return `${genreArray.join(' + ')} Mix`;
  }
  
  // If many genres, use creative names
  const date = new Date();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[date.getMonth()];
  
  return `${month} ${date.getFullYear()} Mix`;
}

// Generate description
function generatePlaylistDescription() {
  if (selectedGenres.size === 0) return 'Created with Playlist Alchemist';
  
  const genreArray = Array.from(selectedGenres);
  const genreList = genreArray.slice(0, 5).join(', ');
  const remaining = genreArray.length > 5 ? ` and ${genreArray.length - 5} more` : '';
  
  return `${genreList}${remaining} • Created with Playlist Alchemist`;
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
  
  // Initialize navigation
  initNavigation();
  
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
  
  // Refresh cache button
  const refreshBtn = document.getElementById('refresh-cache-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', handleRefreshCache);
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
  
  // Close modals on overlay click (not on modal content)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === this) {
        this.style.display = 'none';
      }
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


// ===== NAVIGATION SYSTEM =====

function switchSection(sectionId) {
  // Hide all sections
  document.querySelectorAll('.content-section').forEach(section => {
    section.classList.remove('active');
    section.style.display = 'none';
  });
  
  // Show selected section
  const targetSection = document.getElementById(`${sectionId}-section`);
  if (targetSection) {
    targetSection.classList.add('active');
    targetSection.style.display = 'block';
  }
  
  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const activeNav = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (activeNav) {
    activeNav.classList.add('active');
  }
}

// Initialize navigation listeners
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;
      switchSection(section);
    });
  });
}

// ===== INTERACTIVE TOUR SYSTEM =====

const tourSteps = [
  {
    target: '#load-library-btn',
    title: 'Step 1: Load Your Music',
    message: 'Click here to analyze your Spotify library. Takes about 30 seconds for most collections.',
    position: 'bottom',
    highlight: true
  },
  {
    target: '.genre-grid',
    title: 'Step 2: Pick Your Genres',
    message: 'Click the genres you want in your playlist. Mix and match—create a workout mix, chill vibes, whatever you\'re feeling.',
    position: 'left',
    highlight: true
  },
  {
    target: '.filters-section',
    title: 'Step 3: Fine-Tune (Optional)',
    message: 'Want high-energy tracks? Specific BPM range? Set filters here. Or skip this—filters are totally optional.',
    position: 'right',
    highlight: true
  },
  {
    target: '#preview-btn',
    title: 'Step 4: Preview',
    message: 'Check what you\'re about to create. See the track list before committing.',
    position: 'top',
    highlight: true
  },
  {
    target: '#create-btn',
    title: 'Step 5: Create!',
    message: 'Hit this button and your playlist appears in Spotify. Literally magic.',
    position: 'top',
    highlight: true
  }
];

let currentTourStep = 0;
let tourActive = false;

function startTour() {
  currentTourStep = 0;
  tourActive = true;
  showTourStep(0);
}

function showTourStep(stepIndex) {
  if (stepIndex >= tourSteps.length) {
    endTour();
    return;
  }
  
  const step = tourSteps[stepIndex];
  const targetElement = document.querySelector(step.target);
  
  if (!targetElement) {
    // Skip to next step if element doesn't exist
    showTourStep(stepIndex + 1);
    return;
  }
  
  // Remove existing tour elements
  document.querySelectorAll('.tour-highlight, .tour-tooltip, .tour-overlay').forEach(el => el.remove());
  
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.onclick = () => nextTourStep();
  document.body.appendChild(overlay);
  
  // Highlight target
  if (step.highlight) {
    targetElement.classList.add('tour-highlight');
  }
  
  // Create tooltip
  const tooltip = document.createElement('div');
  tooltip.className = `tour-tooltip tour-${step.position}`;
  tooltip.innerHTML = `
    <div class="tour-header">
      <h3 class="tour-title">${step.title}</h3>
      <button class="tour-close" onclick="endTour()">×</button>
    </div>
    <p class="tour-message">${step.message}</p>
    <div class="tour-footer">
      <div class="tour-progress">${stepIndex + 1} of ${tourSteps.length}</div>
      <div class="tour-buttons">
        ${stepIndex > 0 ? '<button class="btn-secondary btn-sm" onclick="previousTourStep()">Back</button>' : ''}
        <button class="btn-primary btn-sm" onclick="nextTourStep()">${stepIndex < tourSteps.length - 1 ? 'Next' : 'Done'}</button>
      </div>
    </div>
  `;
  
  // Position tooltip near target
  document.body.appendChild(tooltip);
  positionTooltip(tooltip, targetElement, step.position);
}

function positionTooltip(tooltip, target, position) {
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  
  let top, left;
  
  switch (position) {
    case 'top':
      top = targetRect.top - tooltipRect.height - 20;
      left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
      break;
    case 'bottom':
      top = targetRect.bottom + 20;
      left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
      break;
    case 'left':
      top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
      left = targetRect.left - tooltipRect.width - 20;
      break;
    case 'right':
      top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
      left = targetRect.right + 20;
      break;
  }
  
  tooltip.style.top = `${Math.max(10, top)}px`;
  tooltip.style.left = `${Math.max(10, Math.min(window.innerWidth - tooltipRect.width - 10, left))}px`;
}

function nextTourStep() {
  currentTourStep++;
  showTourStep(currentTourStep);
}

function previousTourStep() {
  currentTourStep--;
  showTourStep(currentTourStep);
}

function endTour() {
  tourActive = false;
  document.querySelectorAll('.tour-highlight, .tour-tooltip, .tour-overlay').forEach(el => el.remove());
  localStorage.setItem('tour_completed', 'true');
}


// ===== CACHE INFO DISPLAY =====

function updateCacheInfo(source, cachedData) {
  const cacheInfoDiv = document.getElementById('cache-info');
  const cacheMessage = document.getElementById('cache-message');
  
  if (cachedData && cachedData.timestamp) {
    const ageMs = Date.now() - cachedData.timestamp;
    const ageText = formatCacheAge(ageMs);
    
    cacheMessage.textContent = `Loaded from cache (${ageText} ago)`;
    cacheInfoDiv.style.display = 'flex';
  } else {
    cacheMessage.textContent = 'Freshly loaded';
    cacheInfoDiv.style.display = 'flex';
  }
}

function formatCacheAge(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  return 'just now';
}

async function handleRefreshCache() {
  // Clear cache for current source
  const sourceInput = document.querySelector('input[name="data-source"]:checked');
  if (!sourceInput) return;
  
  const source = sourceInput.value;
  
  // Clear cache
  localStorage.removeItem(`playlist_alchemist_${source}`);
  localStorage.removeItem(`playlist_alchemist_${source}_timestamp`);
  
  // Hide cache info
  document.getElementById('cache-info').style.display = 'none';
  
  // Reload
  await handleLoadLibrary();
}

// ===== GENRE COLOR SYSTEM =====

const GENRE_COLORS = {
  // Electronic colors (blues & purples)
  'Techno': '#00d4ff',
  'House': '#0088ff',
  'Trance': '#b19cd9',
  'Drum & Bass': '#ff00ff',
  'Dubstep': '#9d00ff',
  'EDM': '#00ccff',
  'Ambient': '#4db8ff',
  'Breakbeat': '#ff66cc',
  'Electro': '#00ffcc',
  'IDM': '#6699ff',
  
  // UK Bass (greens & teals)
  'UK Garage': '#00ff88',
  'UK Drill': '#00cc66',
  'Grime': '#00ff99',
  'Bassline': '#00ffaa',
  'Bass Music': '#00ddaa',
  'Future Bass': '#00ffbb',
  'Melodic Bass': '#66ffcc',
  
  // Hip Hop / Urban (oranges & reds)
  'Hip Hop': '#ff6600',
  'Rap': '#ff7700',
  'Trap': '#ff4400',
  'R&B': '#ff8844',
  'Soul': '#ff9966',
  'Funk': '#ffaa44',
  'G-Funk': '#ff7744',
  
  // Rock / Alternative (reds & pinks)
  'Rock': '#ff3333',
  'Metal': '#cc0000',
  'Punk': '#ff0066',
  'Indie Rock': '#ff6699',
  'Alternative Rock': '#ff4488',
  'Grunge': '#cc3366',
  'Post-Rock': '#ff77aa',
  'Shoegaze': '#ff88bb',
  
  // Pop (pinks & magentas)
  'Pop': '#ff00aa',
  'K-Pop': '#ff44cc',
  'Synth Pop': '#ff66dd',
  'Indie Pop': '#ff88ee',
  'Dream Pop': '#ffaaff',
  'Electro Pop': '#ff77dd',
  
  // Dance / Disco (yellows & golds)
  'Disco': '#ffdd00',
  'Nu Disco': '#ffee44',
  'Dance': '#ffcc00',
  'Eurodance': '#ffaa00',
  'Italo Disco': '#ffbb22',
  'Funk': '#ffcc33',
  
  // World / Latin (warm oranges)
  'Reggae': '#ffaa00',
  'Reggaeton': '#ff9900',
  'Latin': '#ff8800',
  'Salsa': '#ff7700',
  'Samba': '#ff9944',
  'Bossa Nova': '#ffaa66',
  'Afrobeats': '#ff8833',
  'Amapiano': '#ff9955',
  
  // Jazz / Blues (warm browns & golds)
  'Jazz': '#dda000',
  'Blues': '#aa7700',
  'Swing': '#cc9900',
  'Bebop': '#eebb00',
  'Acid Jazz': '#ddaa22',
  'Nu Jazz': '#eebb44',
  
  // Chill / Lo-Fi (soft pastels)
  'Lo-Fi': '#88ddff',
  'Chillwave': '#99eeff',
  'Chillstep': '#aaffff',
  'Downtempo': '#77ccee',
  'Trip-Hop': '#6699cc',
  'Lounge': '#99bbdd',
  
  // Classical / World (elegant purples)
  'Classical': '#bb88ff',
  'Opera': '#aa77ee',
  'Folk': '#998866',
  'Country': '#aa8855',
  'Bluegrass': '#bb9966',
  
  // Indie / Alternative (varied)
  'Indie': '#ff9999',
  'Indie Dance': '#ff88cc',
  'Electroclash': '#ff77dd',
  
  // Experimental (grays & cyans)
  'Experimental': '#00dddd',
  'Glitch': '#00cccc',
  'Noise': '#00bbbb',
  'IDM': '#00aacc',
  
  // Hardcore / Hard styles (bright reds)
  'Hardcore': '#ff0000',
  'Hardstyle': '#ff2200',
  'Gabber': '#ff1100',
  'Speedcore': '#ff0033',
  'Frenchcore': '#ff2244',
  
  // Default
  'Other': '#666666'
};

function getGenreColor(genre) {
  return GENRE_COLORS[genre] || '#666666';
}


// ===== GENRE INLINE EXPANSION =====

function toggleGenreExpand(genre, event) {
  event.stopPropagation();
  
  const safeId = genre.replace(/[^a-z0-9]/gi, '_');
  const expandedDiv = document.getElementById(`genre-expanded-${safeId}`);
  const button = event.target;
  
  if (expandedDiv.classList.contains('expanded')) {
    // Collapse
    expandedDiv.classList.remove('expanded');
    expandedDiv.innerHTML = '';
    button.textContent = 'Show Artists ▼';
  } else {
    // Expand
    const tracks = genreSongMap[genre] || [];
    const color = getGenreColor(genre);
    
    // Group by artist
    const artistMap = new Map();
    tracks.forEach(track => {
      const artistName = track.artists[0].name;
      const artistId = track.artists[0].id;
      
      if (!artistMap.has(artistId)) {
        artistMap.set(artistId, {
          name: artistName,
          tracks: []
        });
      }
      artistMap.get(artistId).tracks.push(track);
    });
    
    // Sort artists by track count
    const sortedArtists = Array.from(artistMap.entries())
      .sort((a, b) => b[1].tracks.length - a[1].tracks.length);
    
    // Render artists
    expandedDiv.innerHTML = `
      <div class="genre-artists-section">
        ${sortedArtists.map(([artistId, artistData]) => {
          const safeArtistId = artistId.replace(/[^a-z0-9]/gi, '_');
          return `
            <div class="artist-item">
              <div class="artist-header" onclick="toggleArtistTracks('${safeId}', '${safeArtistId}')">
                <span class="artist-name">${escapeHtml(artistData.name)}</span>
                <span class="artist-count">${artistData.tracks.length} tracks</span>
              </div>
              <div class="artist-tracks-list" id="artist-tracks-${safeId}-${safeArtistId}">
                ${artistData.tracks.map(track => `
                  <div class="track-item-inline">
                    <span class="track-name-inline">${escapeHtml(track.name)}</span>
                    <span class="track-duration-inline">${formatDuration(track.duration_ms)}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    
    expandedDiv.classList.add('expanded');
    button.textContent = 'Hide Artists ▲';
  }
}

function toggleArtistTracks(genreId, artistId) {
  const tracksList = document.getElementById(`artist-tracks-${genreId}-${artistId}`);
  if (tracksList) {
    tracksList.classList.toggle('expanded');
  }
}
