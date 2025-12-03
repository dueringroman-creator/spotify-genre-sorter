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
let selectedTracks = new Set(); // Individual track selection
let allGenres = [];
let audioFeaturesCache = {};

// Smart playlist settings - FILTERS DISABLED BY DEFAULT
const smartPlaylistSettings = {
  bpm: { min: 0, max: 300, enabled: false },
  energy: { min: 0, max: 100, enabled: false },
  mood: { min: 0, max: 100, enabled: false },
  vocalType: 'any',
  maxTracks: null, // No limit by default
  maxTracksPerArtist: 3, // Diversity enabled
  shuffleMode: 'smart' // smart, random, or none
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
      
      // Fetch user profile immediately
      try {
        const user = await fetchSpotifyAPI('me');
        window.spotifyUserId = user.id;
        window.spotifyUserName = user.display_name;
        console.log(`✅ Logged in as: ${user.display_name}`);
      } catch (error) {
        console.error('Failed to fetch user profile:', error);
      }
      
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
  
  // Keep added_at by including it in the track object
  firstBatch.items.forEach(item => {
    const track = item.track;
    track.added_at = item.added_at; // Preserve the added_at timestamp
    tracks.push(track);
  });
  
  if (progressCallback) {
    progressCallback(tracks.length, total);
  }
  
  // Fetch remaining
  while (tracks.length < total) {
    offset += limit;
    const batch = await fetchSpotifyAPI(`me/tracks?limit=${limit}&offset=${offset}`);
    
    batch.items.forEach(item => {
      const track = item.track;
      track.added_at = item.added_at; // Preserve the added_at timestamp
      tracks.push(track);
    });
    
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

async function createSpotifyPlaylist(name, tracks, description = 'Created with Playlist Alchemist', isPublic = false) {
  // Get user ID if not cached
  if (!window.spotifyUserId) {
    const user = await fetchSpotifyAPI('me');
    window.spotifyUserId = user.id;
    window.spotifyUserName = user.display_name;
  }
  
  // Create playlist
  const playlist = await fetchSpotifyAPI(`users/${window.spotifyUserId}/playlists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,
      description: description,
      public: isPublic
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
    
    // BPM filter - ONLY if enabled
    if (settings.bpm.enabled) {
      const bpm = features.tempo;
      if (bpm < settings.bpm.min || bpm > settings.bpm.max) return false;
    }
    
    // Energy filter (0-100 scale) - ONLY if enabled
    if (settings.energy.enabled) {
      const energy = features.energy * 100;
      if (energy < settings.energy.min || energy > settings.energy.max) return false;
    }
    
    // Mood filter (valence - 0-100 scale) - ONLY if enabled
    if (settings.mood.enabled) {
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

// Toggle filter enabled/disabled
function toggleFilterEnabled(filterType) {
  const checkbox = document.getElementById(`${filterType}-enabled`);
  const controls = document.getElementById(`${filterType}-controls`);
  
  smartPlaylistSettings[filterType].enabled = checkbox.checked;
  controls.style.display = checkbox.checked ? 'block' : 'none';
  
  updateFilterStatus();
  updateTotals();
}

// Update filter display text
function updateFilterDisplay(filterType) {
  const min = parseInt(document.getElementById(`${filterType}-min`).value);
  const max = parseInt(document.getElementById(`${filterType}-max`).value);
  const display = document.getElementById(`${filterType}-display`);
  
  smartPlaylistSettings[filterType].min = min;
  smartPlaylistSettings[filterType].max = max;
  
  if (filterType === 'bpm') {
    display.textContent = `${min} - ${max} BPM`;
  } else if (filterType === 'energy') {
    display.textContent = `Energy: ${min} - ${max}`;
  } else if (filterType === 'mood') {
    display.textContent = `Mood: ${min} - ${max}`;
  }
  
  updateTotals();
}

// Update filter status text
function updateFilterStatus() {
  const activeFilters = [];
  if (smartPlaylistSettings.bpm.enabled) activeFilters.push('BPM');
  if (smartPlaylistSettings.energy.enabled) activeFilters.push('Energy');
  if (smartPlaylistSettings.mood.enabled) activeFilters.push('Mood');
  
  const statusEl = document.getElementById('filter-count');
  if (activeFilters.length === 0) {
    statusEl.textContent = 'No filters active - showing all tracks';
    statusEl.style.color = '#7f7f7f';
  } else {
    statusEl.textContent = `${activeFilters.length} filter${activeFilters.length > 1 ? 's' : ''} active: ${activeFilters.join(', ')}`;
    statusEl.style.color = '#1db954';
  }
}

// Update max tracks per artist
function updateMaxTracksPerArtist() {
  const value = document.getElementById('max-tracks-per-artist').value;
  smartPlaylistSettings.maxTracksPerArtist = parseInt(value);
  updateTotals();
}

// Update shuffle mode
function updateShuffleMode() {
  const value = document.getElementById('shuffle-mode').value;
  smartPlaylistSettings.shuffleMode = value;
}

// Update max playlist size
function updateMaxPlaylistSize() {
  const value = document.getElementById('max-playlist-size').value;
  smartPlaylistSettings.maxTracks = value === 'null' ? null : parseInt(value);
  updateTotals();
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
  
  // Remove excluded tracks (from preview editing)
  if (excludedFromPreview && excludedFromPreview.size > 0) {
    allTracks = allTracks.filter(t => !excludedFromPreview.has(t.id));
  }
  
  // Apply filters
  allTracks = applyFilters(allTracks, smartPlaylistSettings);
  
  // Apply max tracks per artist (diversity)
  const maxPerArtist = smartPlaylistSettings.maxTracksPerArtist;
  const artistTrackCount = new Map();
  
  if (maxPerArtist < 999) {
    allTracks = allTracks.filter(track => {
      const artistId = track.artists[0].id;
      const count = artistTrackCount.get(artistId) || 0;
      if (count >= maxPerArtist) return false;
      artistTrackCount.set(artistId, count + 1);
      return true;
    });
  }
  
  // Apply shuffle mode
  if (smartPlaylistSettings.shuffleMode === 'smart') {
    allTracks = smartShuffle(allTracks);
  } else if (smartPlaylistSettings.shuffleMode === 'random') {
    allTracks = shuffleArray(allTracks);
  }
  // 'none' = keep as-is
  
  // Apply max playlist size
  if (smartPlaylistSettings.maxTracks) {
    allTracks = allTracks.slice(0, smartPlaylistSettings.maxTracks);
  }
  
  return allTracks;
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

// ===== TIMEFRAME FILTERING =====

function filterByTimeframe(tracks, timeframe) {
  if (timeframe === 'all') return tracks;
  
  const now = Date.now();
  const cutoffs = {
    'week': 7 * 24 * 60 * 60 * 1000,        // 1 week
    'month': 30 * 24 * 60 * 60 * 1000,      // 1 month
    '3months': 90 * 24 * 60 * 60 * 1000,    // 3 months
    '6months': 180 * 24 * 60 * 60 * 1000,   // 6 months
    'year': 365 * 24 * 60 * 60 * 1000       // 1 year
  };
  
  const cutoffTime = now - (cutoffs[timeframe] || 0);
  
  return tracks.filter(item => {
    // Each track has added_at from Spotify API
    if (!item.added_at) return true; // Include if no date
    const addedAt = new Date(item.added_at).getTime();
    return addedAt >= cutoffTime;
  });
}

function getTimeframeLabel(timeframe) {
  const labels = {
    'week': 'past week',
    'month': 'past month',
    '3months': 'past 3 months',
    '6months': 'past 6 months',
    'year': 'past year',
    'all': 'all time'
  };
  return labels[timeframe] || 'all time';
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
    
    // Include timeframe in cache key for liked songs
    const cacheKey = source === 'liked-songs' && timeframe !== 'all' 
      ? `${source}-${timeframe}` 
      : source;
    
    // Check cache first
    const cached = loadFromCache(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < 86400000) { // 24 hours
      tracks = cached.data;
      progressFill.style.width = '100%';
      progressText.textContent = `Loaded ${tracks.length} tracks from cache`;
      
      // Log for debugging
      console.log(`Loaded from cache: ${cacheKey}, ${tracks.length} tracks`);
      if (tracks.length > 0 && tracks[0].added_at) {
        console.log(`Sample added_at: ${tracks[0].added_at}`);
      }
    } else {
      // Fetch fresh data
      if (source === 'liked-songs') {
        tracks = await fetchAllLikedSongs((current, total) => {
          const percent = (current / total) * 100;
          progressFill.style.width = `${percent}%`;
          progressText.textContent = `Loading ${current}/${total} tracks...`;
        });
        
        // Apply timeframe filter BEFORE caching
        if (timeframe !== 'all') {
          const originalCount = tracks.length;
          tracks = filterByTimeframe(tracks, timeframe);
          console.log(`Filtered before cache: ${originalCount} → ${tracks.length} tracks (${timeframe})`);
        }
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
      
      // Save to cache with timeframe-specific key
      saveToCache(cacheKey, tracks);
    }
    
    // Show timeframe indicator if filtered
    if (source === 'liked-songs' && timeframe !== 'all') {
      const label = getTimeframeLabel(timeframe);
      
      progressText.textContent = `Loaded ${tracks.length} tracks from ${label}`;
      progressText.style.color = '#1db954'; // Green to show filter active
      
      // Show timeframe indicator
      const indicator = document.getElementById('timeframe-indicator');
      if (indicator) {
        indicator.innerHTML = `
          <span class="indicator-icon">📅</span>
          <span class="indicator-text">Showing tracks from ${label}</span>
          <span class="indicator-count">${tracks.length} tracks</span>
        `;
        indicator.style.display = 'flex';
      }
    } else {
      progressText.style.color = '#e3e3e3'; // Normal color
      
      // Hide timeframe indicator
      const indicator = document.getElementById('timeframe-indicator');
      if (indicator) {
        indicator.style.display = 'none';
      }
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
    
    // Build library data for Library section
    buildLibraryData();
    
    // Build stats data for Stats section
    buildStatsData();
    
    // Generate smart recommendations
    generateAndDisplayRecommendations();
    
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
    
    // Hide progress bar
    progressContainer.style.display = 'none';
    
    // Show error recovery UI
    showLoadErrorRecovery(source, error);
    
    loadBtn.disabled = false;
  }
}

// Show error recovery options
function showLoadErrorRecovery(failedSource, error) {
  const errorContainer = document.getElementById('load-error-recovery');
  if (!errorContainer) return;
  
  const errorMessage = error.message || 'Unknown error occurred';
  const isNetworkError = errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError');
  const isAuthError = errorMessage.includes('401') || errorMessage.includes('403');
  
  let suggestion = '';
  if (isNetworkError) {
    suggestion = 'Check your internet connection and try again.';
  } else if (isAuthError) {
    suggestion = 'Your session may have expired. Try logging out and back in.';
  } else {
    suggestion = 'An unexpected error occurred. Try a different source or refresh the page.';
  }
  
  errorContainer.innerHTML = `
    <div class="error-recovery-panel">
      <div class="error-icon">⚠️</div>
      <h3>Couldn't Load Your ${getSourceLabel(failedSource)}</h3>
      <p class="error-message">${suggestion}</p>
      <p class="error-details">${errorMessage}</p>
      
      <div class="recovery-options">
        <h4>What would you like to do?</h4>
        
        <button class="recovery-btn retry-btn" onclick="retryLoad('${failedSource}')">
          🔄 Retry ${getSourceLabel(failedSource)}
        </button>
        
        ${failedSource !== 'liked-songs' ? `
          <button class="recovery-btn alt-btn" onclick="tryAlternativeSource('liked-songs')">
            ❤️ Try Liked Songs Instead
          </button>
        ` : ''}
        
        ${failedSource !== 'top-artists' ? `
          <button class="recovery-btn alt-btn" onclick="tryAlternativeSource('top-artists')">
            🎤 Try Top Artists Instead
          </button>
        ` : ''}
        
        ${failedSource !== 'playlists' ? `
          <button class="recovery-btn alt-btn" onclick="showPlaylistSelector()">
            📁 Choose Specific Playlists
          </button>
        ` : ''}
        
        <button class="recovery-btn secondary-btn" onclick="startOver()">
          ↺ Start Over
        </button>
        
        ${isAuthError ? `
          <button class="recovery-btn logout-btn" onclick="handleLogout()">
            🚪 Logout & Try Again
          </button>
        ` : ''}
      </div>
    </div>
  `;
  
  errorContainer.style.display = 'block';
}

function getSourceLabel(source) {
  const labels = {
    'liked-songs': 'Liked Songs',
    'top-artists': 'Top Artists',
    'playlists': 'Playlists'
  };
  return labels[source] || source;
}

function retryLoad(source) {
  // Hide error UI
  const errorContainer = document.getElementById('load-error-recovery');
  if (errorContainer) errorContainer.style.display = 'none';
  
  // Set the source radio button
  const sourceInput = document.querySelector(`input[name="data-source"][value="${source}"]`);
  if (sourceInput) sourceInput.checked = true;
  
  // Trigger load
  handleLoadLibrary();
}

function tryAlternativeSource(source) {
  // Hide error UI
  const errorContainer = document.getElementById('load-error-recovery');
  if (errorContainer) errorContainer.style.display = 'none';
  
  // Set the source radio button
  const sourceInput = document.querySelector(`input[name="data-source"][value="${source}"]`);
  if (sourceInput) sourceInput.checked = true;
  
  // Trigger load
  handleLoadLibrary();
}

function startOver() {
  // Hide error UI
  const errorContainer = document.getElementById('load-error-recovery');
  if (errorContainer) errorContainer.style.display = 'none';
  
  // Reset everything
  userTracks = [];
  selectedGenres.clear();
  genreSongMap = {};
  
  // Hide genre section
  const genreSection = document.getElementById('genre-section');
  if (genreSection) genreSection.style.display = 'none';
  
  showNotification('Ready to start fresh!', 'success');
}

function handleLogout() {
  // Clear token
  spotifyToken = null;
  window.spotifyToken = null;
  window.spotifyUserId = null;
  
  // Clear cache
  localStorage.clear();
  
  // Redirect to login
  window.location.href = REDIRECT_URI;
}

// Render genre grid
function renderGenreGrid() {
  const grid = document.getElementById('genre-grid');
  
  if (!grid) {
    console.error('Genre grid element not found!');
    return;
  }
  
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
        <a href="https://musicmap.info" 
           target="_blank" 
           class="genre-map-link"
           onclick="event.stopPropagation()"
           title="Explore genres on MusicMap">
          🗺️ MusicMap
        </a>
        <button class="genre-expand-btn" onclick="toggleGenreExpand('${escapeHtml(genre)}', event)">
          View Details →
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
  
  // Safety checks - return early if elements don't exist
  if (!list || !totalTracksEl || !totalDurationEl) {
    console.warn('Right panel elements not found');
    return;
  }
  
  if (selectedGenres.size === 0) {
    list.innerHTML = '<div class="empty-state">No genres selected yet</div>';
    totalTracksEl.textContent = '0';
    totalDurationEl.textContent = '0m';
    
    if (clearBtn) clearBtn.disabled = true;
    if (previewBtn) previewBtn.disabled = true;
    if (createBtn) createBtn.disabled = true;
    return;
  }
  
  // Render selected genres
  list.innerHTML = Array.from(selectedGenres).map(genre => {
    const tracks = genreSongMap[genre] || [];
    const filtered = applyFilters(tracks, smartPlaylistSettings);
    const count = filtered.length;
    
    return `
      <div class="selected-genre-item">
        <div class="selected-genre-info">
          <span class="selected-genre-name">${genre}</span>
          <span class="selected-genre-count">${count} tracks</span>
        </div>
        <button class="selected-genre-remove" onclick="removeGenre('${escapeHtml(genre)}')" title="Remove ${genre}">
          ×
        </button>
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

// Remove single genre
function removeGenre(genre) {
  selectedGenres.delete(genre);
  
  // Update visual state
  document.querySelectorAll('.genre-card').forEach(card => {
    if (card.dataset.genre === genre) {
      card.classList.remove('selected');
    }
  });
  
  updateRightPanel();
}

// Show preview modal
let previewTracks = [];
let excludedFromPreview = new Set();
let previewPage = 0;
const PREVIEW_TRACKS_PER_PAGE = 50;

function showPreviewModal() {
  previewTracks = generatePlaylistTracks();
  excludedFromPreview.clear();
  previewPage = 0;
  
  renderPreviewTracks();
  document.getElementById('preview-modal').style.display = 'flex';
}

function renderPreviewTracks() {
  const list = document.getElementById('preview-tracks-list');
  
  const activeTracks = previewTracks.filter(t => !excludedFromPreview.has(t.id));
  const totalPages = Math.ceil(activeTracks.length / PREVIEW_TRACKS_PER_PAGE);
  const startIdx = previewPage * PREVIEW_TRACKS_PER_PAGE;
  const endIdx = startIdx + PREVIEW_TRACKS_PER_PAGE;
  const displayTracks = activeTracks.slice(startIdx, endIdx);
  
  list.innerHTML = `
    <div class="preview-header-info">
      <span>${activeTracks.length} tracks total</span>
      ${excludedFromPreview.size > 0 ? `<span class="excluded-count">${excludedFromPreview.size} excluded</span>` : ''}
      ${excludedFromPreview.size > 0 ? `<button class="btn-small" onclick="clearExcluded()">Reset</button>` : ''}
    </div>
    
    <div class="preview-tracks-container">
      ${displayTracks.map((track, idx) => `
        <div class="preview-track-item" data-track-id="${track.id}">
          <span class="preview-track-number">${startIdx + idx + 1}</span>
          <div class="preview-track-info">
            <div class="preview-track-name">${escapeHtml(track.name)}</div>
            <div class="preview-track-artist">${escapeHtml(track.artists[0].name)}</div>
          </div>
          <span class="preview-track-duration">${formatDuration(track.duration_ms)}</span>
          <button class="preview-track-remove" onclick="excludeTrackFromPreview('${track.id}')" title="Remove from playlist">
            ×
          </button>
        </div>
      `).join('')}
    </div>
    
    ${totalPages > 1 ? `
      <div class="preview-pagination">
        <button onclick="changePreviewPage(-1)" ${previewPage === 0 ? 'disabled' : ''}>
          ← Previous
        </button>
        <span>Page ${previewPage + 1} of ${totalPages}</span>
        <button onclick="changePreviewPage(1)" ${previewPage >= totalPages - 1 ? 'disabled' : ''}>
          Next →
        </button>
      </div>
    ` : ''}
  `;
}

function excludeTrackFromPreview(trackId) {
  excludedFromPreview.add(trackId);
  renderPreviewTracks();
}

function clearExcluded() {
  excludedFromPreview.clear();
  previewPage = 0;
  renderPreviewTracks();
}

function changePreviewPage(delta) {
  const activeTracks = previewTracks.filter(t => !excludedFromPreview.has(t.id));
  const totalPages = Math.ceil(activeTracks.length / PREVIEW_TRACKS_PER_PAGE);
  previewPage = Math.max(0, Math.min(previewPage + delta, totalPages - 1));
  renderPreviewTracks();
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
  
  // If multiple genres selected, show dialog
  if (selectedGenres.size > 1) {
    showPlaylistCreationDialog(name, tracks);
    return;
  }
  
  // Single genre - create directly
  const createBtn = document.getElementById('create-btn');
  const originalText = createBtn.textContent;
  createBtn.disabled = true;
  createBtn.textContent = 'Creating...';
  
  try {
    // Generate description
    const description = generatePlaylistDescription();
    
    await createSpotifyPlaylist(name, tracks, description, false); // Private by default
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

// Show playlist creation dialog
function showPlaylistCreationDialog(name, tracks) {
  const modal = document.getElementById('playlist-creation-modal');
  const genreCount = document.getElementById('creation-genre-count');
  const genreList = document.getElementById('creation-genre-list');
  
  genreCount.textContent = selectedGenres.size;
  genreList.innerHTML = Array.from(selectedGenres).map(genre => {
    const count = (genreSongMap[genre] || []).length;
    return `<div class="creation-genre-item">• ${genre} (${count} tracks)</div>`;
  }).join('');
  
  // Store for later
  window.pendingPlaylistName = name;
  window.pendingPlaylistTracks = tracks;
  
  modal.style.display = 'flex';
}

// Close playlist creation dialog
function closePlaylistCreationDialog() {
  document.getElementById('playlist-creation-modal').style.display = 'none';
}

// Confirm and create playlists
async function confirmPlaylistCreation() {
  const mode = document.querySelector('input[name="creation-mode"]:checked').value;
  const isPublic = document.querySelector('input[name="playlist-privacy"]:checked').value === 'public';
  
  closePlaylistCreationDialog();
  
  const createBtn = document.getElementById('create-btn');
  const originalText = createBtn.textContent;
  createBtn.disabled = true;
  
  try {
    if (mode === 'single') {
      // Create single mixed playlist
      createBtn.textContent = 'Creating...';
      const description = generatePlaylistDescription();
      await createSpotifyPlaylist(window.pendingPlaylistName, window.pendingPlaylistTracks, description, isPublic);
      showNotification(`Playlist "${window.pendingPlaylistName}" created with ${window.pendingPlaylistTracks.length} tracks!`);
      
    } else if (mode === 'separate') {
      // Create separate playlists per genre
      createBtn.textContent = 'Creating playlists...';
      let created = 0;
      
      for (const genre of selectedGenres) {
        const genreTracks = genreSongMap[genre] || [];
        if (genreTracks.length === 0) continue;
        
        // Apply filters and shuffle to each genre separately
        let filteredTracks = applyFilters(genreTracks, smartPlaylistSettings);
        
        // Apply diversity
        if (smartPlaylistSettings.maxTracksPerArtist < 999) {
          const artistCount = new Map();
          filteredTracks = filteredTracks.filter(track => {
            const artistId = track.artists[0].id;
            const count = artistCount.get(artistId) || 0;
            if (count >= smartPlaylistSettings.maxTracksPerArtist) return false;
            artistCount.set(artistId, count + 1);
            return true;
          });
        }
        
        // Apply shuffle
        if (smartPlaylistSettings.shuffleMode === 'smart') {
          filteredTracks = smartShuffle(filteredTracks);
        } else if (smartPlaylistSettings.shuffleMode === 'random') {
          filteredTracks = shuffleArray(filteredTracks);
        }
        
        // Apply max size
        if (smartPlaylistSettings.maxTracks) {
          filteredTracks = filteredTracks.slice(0, smartPlaylistSettings.maxTracks);
        }
        
        const playlistName = `${genre} Mix`;
        const description = `${genre} • Created with Playlist Alchemist`;
        
        await createSpotifyPlaylist(playlistName, filteredTracks, description, isPublic);
        created++;
      }
      
      showNotification(`${created} playlists created successfully!`);
    }
    
    // Reset
    clearSelection();
    document.getElementById('playlist-name').value = 'My Playlist';
    
  } catch (error) {
    console.error('Create error:', error);
    showNotification('Error creating playlist(s). Please try again.', 'error');
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
  
  // Open genre detail modal instead of inline expansion
  showGenreDetailModal(genre);
}

// Show genre detail modal
function showGenreDetailModal(genre) {
  const modal = document.getElementById('genre-detail-modal');
  if (!modal) return;
  
  const tracks = genreSongMap[genre] || [];
  const color = getGenreColor(genre);
  
  // Set genre name in header
  const genreNameEl = document.getElementById('genre-detail-name');
  if (genreNameEl) genreNameEl.textContent = genre;
  
  // Group by artist
  const artistMap = new Map();
  tracks.forEach(track => {
    const artistName = track.artists[0].name;
    const artistId = track.artists[0].id;
    
    if (!artistMap.has(artistId)) {
      artistMap.set(artistId, {
        id: artistId,
        name: artistName,
        tracks: []
      });
    }
    artistMap.get(artistId).tracks.push(track);
  });
  
  // Sort artists by track count
  const sortedArtists = Array.from(artistMap.values())
    .sort((a, b) => b.tracks.length - a.tracks.length);
  
  // Update stats
  const statsEl = document.getElementById('genre-detail-stats');
  if (statsEl) {
    const totalDuration = tracks.reduce((sum, t) => sum + t.duration_ms, 0);
    statsEl.innerHTML = `
      <span class="genre-stat">${tracks.length} tracks</span>
      <span class="genre-stat">${sortedArtists.length} artists</span>
      <span class="genre-stat">${formatDuration(totalDuration)}</span>
    `;
  }
  
  // Render artists list
  const artistsListEl = document.getElementById('genre-detail-artists-list');
  if (artistsListEl) {
    artistsListEl.innerHTML = sortedArtists.map(artist => {
      const safeArtistId = artist.id.replace(/[^a-z0-9]/gi, '_');
      const artistMapUrl = `https://music-map.com/${encodeURIComponent(artist.name.replace(/\s+/g, '+'))}`;
      
      return `
        <div class="genre-artist-section">
          <div class="genre-artist-header">
            <div class="genre-artist-info">
              <button class="genre-artist-toggle" onclick="toggleGenreArtistTracks('${safeArtistId}')">
                ▶
              </button>
              <span class="genre-artist-name">${escapeHtml(artist.name)}</span>
              <span class="genre-artist-count">${artist.tracks.length} tracks</span>
            </div>
            <div class="genre-artist-actions">
              <a href="${artistMapUrl}" target="_blank" class="genre-artist-link" onclick="event.stopPropagation()">
                🗺️ Similar
              </a>
              <button class="btn-small" onclick="selectAllGenreArtistTracks('${safeArtistId}', event)">
                Select All
              </button>
            </div>
          </div>
          <div class="genre-artist-tracks" id="genre-artist-tracks-${safeArtistId}" style="display: none;">
            ${artist.tracks.map(track => `
              <div class="genre-track-item">
                <input 
                  type="checkbox" 
                  class="track-checkbox"
                  data-track-id="${track.id}"
                  ${selectedTracks.has(track.id) ? 'checked' : ''}
                  onchange="toggleTrackSelection('${track.id}', event)"
                />
                <div class="genre-track-info">
                  <div class="genre-track-name">${escapeHtml(track.name)}</div>
                  <div class="genre-track-album">${escapeHtml(track.album.name)}</div>
                </div>
                <div class="genre-track-duration">${formatDuration(track.duration_ms)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  }
  
  // Show modal
  modal.style.display = 'flex';
}

function closeGenreDetailModal() {
  const modal = document.getElementById('genre-detail-modal');
  if (modal) modal.style.display = 'none';
}

function toggleGenreArtistTracks(artistId) {
  const tracksEl = document.getElementById(`genre-artist-tracks-${artistId}`);
  const toggleBtn = event.target;
  
  if (!tracksEl) return;
  
  if (tracksEl.style.display === 'none') {
    tracksEl.style.display = 'block';
    toggleBtn.textContent = '▼';
  } else {
    tracksEl.style.display = 'none';
    toggleBtn.textContent = '▶';
  }
}

function selectAllGenreArtistTracks(artistId, event) {
  event.stopPropagation();
  
  const tracksEl = document.getElementById(`genre-artist-tracks-${artistId}`);
  if (!tracksEl) return;
  
  const checkboxes = tracksEl.querySelectorAll('.track-checkbox');
  checkboxes.forEach(cb => {
    const trackId = cb.dataset.trackId;
    if (!selectedTracks.has(trackId)) {
      selectedTracks.add(trackId);
      cb.checked = true;
    }
  });
  
  updateSelectionPanel();
  showNotification('All tracks selected!', 'success');
}

function toggleArtistTracks(genreId, artistId) {
  const tracksList = document.getElementById(`artist-tracks-${genreId}-${artistId}`);
  if (tracksList) {
    tracksList.classList.toggle('expanded');
  }
}

// ===== TRACK SELECTION =====

function toggleTrackSelection(trackId, event) {
  event.stopPropagation();
  
  if (selectedTracks.has(trackId)) {
    selectedTracks.delete(trackId);
  } else {
    selectedTracks.add(trackId);
  }
  
  updateSelectionPanel();
}

function clearTrackSelection() {
  selectedTracks.clear();
  updateSelectionPanel();
  
  // Update all checkboxes
  document.querySelectorAll('.track-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
}

function updateSelectionPanel() {
  const count = selectedTracks.size;
  
  // Update selection indicator if it exists
  const indicator = document.getElementById('track-selection-indicator');
  if (indicator) {
    if (count > 0) {
      indicator.innerHTML = `
        <div class="selection-info">
          <span>${count} track${count !== 1 ? 's' : ''} selected</span>
          <button class="btn-small" onclick="clearTrackSelection()">Clear</button>
          <button class="btn-small btn-primary" onclick="createPlaylistFromSelection()">Create from Selection</button>
        </div>
      `;
      indicator.style.display = 'block';
    } else {
      indicator.style.display = 'none';
    }
  }
}

// Create playlist from selected tracks
async function createPlaylistFromSelection() {
  if (selectedTracks.size === 0) {
    alert('No tracks selected');
    return;
  }
  
  // Get full track objects
  const tracks = [];
  for (const trackId of selectedTracks) {
    // Find track in genreSongMap
    for (const genre in genreSongMap) {
      const found = genreSongMap[genre].find(t => t.id === trackId);
      if (found) {
        tracks.push(found);
        break;
      }
    }
  }
  
  const name = `Custom Selection ${new Date().toLocaleDateString()}`;
  const description = `${tracks.length} hand-picked tracks • Created with Playlist Alchemist`;
  
  try {
    const createBtn = document.getElementById('create-btn');
    const originalText = createBtn ? createBtn.textContent : '';
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';
    }
    
    const isPublic = false; // Private by default
    await createSpotifyPlaylist(name, tracks, description, isPublic);
    
    showNotification(`Playlist "${name}" created with ${tracks.length} tracks!`);
    clearTrackSelection();
    
    if (createBtn) {
      createBtn.disabled = false;
      createBtn.textContent = originalText;
    }
  } catch (error) {
    console.error('Error creating playlist from selection:', error);
    showNotification('Error creating playlist. Please try again.', 'error');
  }
}


// ===== LIBRARY SECTION =====

let libraryArtistData = [];
let filteredLibraryArtists = [];
let expandedLibraryArtistId = null;

// Build library artist data
function buildLibraryData() {
  const artistMap = new Map();
  
  // Group all tracks by artist
  userTracks.forEach(track => {
    if (!track.artists || track.artists.length === 0) return;
    
    const artist = track.artists[0];
    const artistId = artist.id;
    
    if (!artistMap.has(artistId)) {
      artistMap.set(artistId, {
        id: artistId,
        name: artist.name,
        image: track.album?.images?.[0]?.url || null,
        tracks: [],
        genres: new Set(), // Track unique genres for this artist
        spotifyUrl: `https://open.spotify.com/artist/${artistId}`
      });
    }
    
    const artistData = artistMap.get(artistId);
    artistData.tracks.push(track);
    
    // Find genres for this artist's tracks
    Object.entries(genreSongMap).forEach(([genre, genreTracks]) => {
      if (genreTracks.some(t => t.id === track.id)) {
        artistData.genres.add(genre);
      }
    });
  });
  
  // Convert to array and convert genres Set to Array
  libraryArtistData = Array.from(artistMap.values())
    .map(artist => ({
      ...artist,
      genres: Array.from(artist.genres)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  
  filteredLibraryArtists = [...libraryArtistData];
  
  // Populate genre filter dropdown
  populateLibraryGenreFilter();
  
  renderLibraryArtistGrid();
}

// Populate genre filter dropdown
function populateLibraryGenreFilter() {
  const genreFilter = document.getElementById('library-genre-filter');
  if (!genreFilter) return;
  
  // Get all unique genres from library
  const allGenres = new Set();
  libraryArtistData.forEach(artist => {
    artist.genres.forEach(genre => allGenres.add(genre));
  });
  
  const sortedGenres = Array.from(allGenres).sort();
  
  genreFilter.innerHTML = '<option value="">All Genres</option>' +
    sortedGenres.map(genre => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join('');
}

// Render artist grid
function renderLibraryArtistGrid() {
  const grid = document.getElementById('library-artist-grid');
  
  if (!grid) return;
  
  if (filteredLibraryArtists.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <p>No artists found</p>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = filteredLibraryArtists.map(artist => `
    <div class="library-artist-card" onclick="showLibraryArtistDetail('${artist.id}')">
      ${artist.image ? 
        `<img src="${artist.image}" class="library-artist-image" alt="${escapeHtml(artist.name)}">` :
        `<div class="library-artist-placeholder">🎤</div>`
      }
      <div class="library-artist-info">
        <div class="library-artist-name">${escapeHtml(artist.name)}</div>
        <div class="library-artist-count">${artist.tracks.length} track${artist.tracks.length !== 1 ? 's' : ''}</div>
        ${artist.genres.length > 0 ? `
          <div class="library-artist-genres">
            ${artist.genres.slice(0, 3).map(genre => 
              `<span class="artist-genre-tag" onclick="selectGenreFromLibrary('${escapeHtml(genre)}', event)">${escapeHtml(genre)}</span>`
            ).join('')}
            ${artist.genres.length > 3 ? `<span class="artist-genre-tag">+${artist.genres.length - 3}</span>` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

// Filter artists by search
function filterLibraryArtists() {
  filterLibraryByGenre(); // Use combined filter
}

// Sort artists
function sortLibraryArtists() {
  const sortBy = document.getElementById('library-sort').value;
  
  if (sortBy === 'name') {
    filteredLibraryArtists.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === 'tracks') {
    filteredLibraryArtists.sort((a, b) => b.tracks.length - a.tracks.length);
  }
  
  renderLibraryArtistGrid();
}

// Show artist detail
function showLibraryArtistDetail(artistId) {
  const artist = libraryArtistData.find(a => a.id === artistId);
  if (!artist) return;
  
  expandedLibraryArtistId = artistId;
  
  const grid = document.getElementById('library-artist-grid');
  const detail = document.getElementById('library-artist-detail');
  const name = document.getElementById('artist-detail-name');
  const content = document.getElementById('artist-detail-content');
  
  grid.style.display = 'none';
  detail.style.display = 'block';
  name.textContent = artist.name;
  
  const musicMapUrl = `https://music-map.com/${encodeURIComponent(artist.name.replace(/\s+/g, '+'))}`;
  
  content.innerHTML = `
    ${artist.genres.length > 0 ? `
      <div class="artist-detail-genres">
        <strong>Genres:</strong>
        ${artist.genres.map(genre => 
          `<span class="artist-genre-tag clickable" onclick="selectGenreFromLibrary('${escapeHtml(genre)}', event)">${escapeHtml(genre)}</span>`
        ).join(' ')}
      </div>
    ` : ''}
    
    <div class="artist-detail-links">
      <a href="${artist.spotifyUrl}" target="_blank" class="artist-link">
        🎵 View on Spotify
      </a>
      <a href="${musicMapUrl}" target="_blank" class="artist-link">
        🗺️ Music-Map.com
      </a>
      <button class="artist-link artist-btn" onclick="findSimilarArtists('${artistId}')">
        🔍 Find Similar in Library
      </button>
    </div>
    
    <div class="artist-detail-actions">
      <button class="btn-secondary" onclick="selectAllArtistTracks('${artistId}')">
        Select All (${artist.tracks.length})
      </button>
      <button class="btn-secondary" onclick="deselectAllArtistTracks('${artistId}')">
        Deselect All
      </button>
    </div>
    
    <div class="artist-detail-tracks">
      ${artist.tracks.map(track => `
        <div class="library-track-item">
          <input 
            type="checkbox" 
            class="track-checkbox"
            ${selectedTracks.has(track.id) ? 'checked' : ''}
            onchange="toggleTrackSelection('${track.id}', event)"
          />
          <div class="library-track-info">
            <div class="library-track-name">${escapeHtml(track.name)}</div>
            <div class="library-track-album">${escapeHtml(track.album?.name || 'Unknown Album')}</div>
          </div>
          <div class="library-track-duration">${formatDuration(track.duration_ms)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// Close artist detail
function closeLibraryArtistDetail() {
  document.getElementById('library-artist-grid').style.display = 'grid';
  document.getElementById('library-artist-detail').style.display = 'none';
  expandedLibraryArtistId = null;
}

// Select/deselect all tracks for artist
function selectAllArtistTracks(artistId) {
  const artist = libraryArtistData.find(a => a.id === artistId);
  if (!artist) return;
  
  artist.tracks.forEach(track => selectedTracks.add(track.id));
  
  // Update all checkboxes
  document.querySelectorAll('.track-checkbox').forEach(checkbox => {
    checkbox.checked = selectedTracks.has(checkbox.onchange.toString().match(/'([^']+)'/)?.[1]);
  });
  
  updateSelectionPanel();
  showLibraryArtistDetail(artistId); // Refresh view
}

function deselectAllArtistTracks(artistId) {
  const artist = libraryArtistData.find(a => a.id === artistId);
  if (!artist) return;
  
  artist.tracks.forEach(track => selectedTracks.delete(track.id));
  
  // Update all checkboxes
  document.querySelectorAll('.track-checkbox').forEach(checkbox => {
    const trackId = checkbox.onchange.toString().match(/'([^']+)'/)?.[1];
    if (trackId && artist.tracks.some(t => t.id === trackId)) {
      checkbox.checked = false;
    }
  });
  
  updateSelectionPanel();
  showLibraryArtistDetail(artistId); // Refresh view
}

// ===== STATS SECTION =====

function buildStatsData() {
  if (userTracks.length === 0) return;
  
  // Calculate overview stats
  const totalTracks = userTracks.length;
  const totalArtists = new Set(userTracks.map(t => t.artists[0].id)).size;
  const totalGenres = Object.keys(genreSongMap).length;
  const totalDuration = userTracks.reduce((sum, t) => sum + t.duration_ms, 0);
  
  // Update overview - with null checks
  const statTracks = document.getElementById('stat-total-tracks');
  const statArtists = document.getElementById('stat-total-artists');
  const statGenres = document.getElementById('stat-total-genres');
  const statDuration = document.getElementById('stat-total-duration');
  
  if (statTracks) statTracks.textContent = totalTracks.toLocaleString();
  if (statArtists) statArtists.textContent = totalArtists.toLocaleString();
  if (statGenres) statGenres.textContent = totalGenres.toLocaleString();
  if (statDuration) statDuration.textContent = Math.round(totalDuration / 3600000) + 'h';
  
  // Top Genres
  const genreCounts = Object.entries(genreSongMap)
    .map(([genre, tracks]) => ({ genre, count: tracks.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  const topGenresList = document.getElementById('top-genres-list');
  if (!topGenresList) return; // Exit if element doesn't exist
  
  topGenresList.innerHTML = genreCounts.map((item, index) => {
    const percentage = ((item.count / totalTracks) * 100).toFixed(1);
    const color = getGenreColor(item.genre);
    return `
      <div class="stat-item" onclick="selectGenreFromStats('${escapeHtml(item.genre)}')">
        <div class="stat-rank">#${index + 1}</div>
        <div class="stat-info">
          <div class="stat-name">${escapeHtml(item.genre)}</div>
          <div class="stat-bar-container">
            <div class="stat-bar" style="width: ${percentage}%; background: ${color};"></div>
          </div>
        </div>
        <div class="stat-count">${item.count} (${percentage}%)</div>
      </div>
    `;
  }).join('');
  
  // Top Artists
  const artistCounts = new Map();
  userTracks.forEach(track => {
    const artistName = track.artists[0].name;
    artistCounts.set(artistName, (artistCounts.get(artistName) || 0) + 1);
  });
  
  const topArtists = Array.from(artistCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  const topArtistsList = document.getElementById('top-artists-list');
  topArtistsList.innerHTML = topArtists.map((item, index) => {
    const percentage = ((item.count / totalTracks) * 100).toFixed(1);
    return `
      <div class="stat-item">
        <div class="stat-rank">#${index + 1}</div>
        <div class="stat-info">
          <div class="stat-name">${escapeHtml(item.name)}</div>
          <div class="stat-bar-container">
            <div class="stat-bar" style="width: ${percentage}%; background: #1db954;"></div>
          </div>
        </div>
        <div class="stat-count">${item.count} (${percentage}%)</div>
      </div>
    `;
  }).join('');
  
  // Audio Features (if available)
  const features = Object.values(audioFeaturesCache);
  if (features.length > 0) {
    const avgEnergy = features.reduce((sum, f) => sum + f.energy, 0) / features.length;
    const avgValence = features.reduce((sum, f) => sum + f.valence, 0) / features.length;
    const avgDanceability = features.reduce((sum, f) => sum + f.danceability, 0) / features.length;
    const avgTempo = features.reduce((sum, f) => sum + f.tempo, 0) / features.length;
    
    const featureStats = document.getElementById('audio-features-stats');
    featureStats.innerHTML = `
      <div class="feature-stat">
        <div class="feature-label">Energy</div>
        <div class="feature-bar-container">
          <div class="feature-bar" style="width: ${avgEnergy * 100}%; background: #ff4444;"></div>
        </div>
        <div class="feature-value">${(avgEnergy * 100).toFixed(0)}%</div>
      </div>
      
      <div class="feature-stat">
        <div class="feature-label">Mood (Valence)</div>
        <div class="feature-bar-container">
          <div class="feature-bar" style="width: ${avgValence * 100}%; background: #44ff44;"></div>
        </div>
        <div class="feature-value">${(avgValence * 100).toFixed(0)}%</div>
      </div>
      
      <div class="feature-stat">
        <div class="feature-label">Danceability</div>
        <div class="feature-bar-container">
          <div class="feature-bar" style="width: ${avgDanceability * 100}%; background: #4444ff;"></div>
        </div>
        <div class="feature-value">${(avgDanceability * 100).toFixed(0)}%</div>
      </div>
      
      <div class="feature-stat">
        <div class="feature-label">Average BPM</div>
        <div class="feature-bar-container">
          <div class="feature-bar" style="width: ${(avgTempo / 200) * 100}%; background: #ff44ff;"></div>
        </div>
        <div class="feature-value">${avgTempo.toFixed(0)} BPM</div>
      </div>
    `;
    
    // BPM Distribution
    const bpmRanges = {
      '0-80': 0,
      '80-100': 0,
      '100-120': 0,
      '120-140': 0,
      '140-160': 0,
      '160-180': 0,
      '180+': 0
    };
    
    features.forEach(f => {
      const bpm = f.tempo;
      if (bpm < 80) bpmRanges['0-80']++;
      else if (bpm < 100) bpmRanges['80-100']++;
      else if (bpm < 120) bpmRanges['100-120']++;
      else if (bpm < 140) bpmRanges['120-140']++;
      else if (bpm < 160) bpmRanges['140-160']++;
      else if (bpm < 180) bpmRanges['160-180']++;
      else bpmRanges['180+']++;
    });
    
    const maxBpmCount = Math.max(...Object.values(bpmRanges));
    const bpmDistribution = document.getElementById('bpm-distribution');
    bpmDistribution.innerHTML = Object.entries(bpmRanges).map(([range, count]) => {
      const percentage = maxBpmCount > 0 ? (count / maxBpmCount) * 100 : 0;
      return `
        <div class="bpm-range-item">
          <div class="bpm-range-label">${range}</div>
          <div class="bpm-range-bar-container">
            <div class="bpm-range-bar" style="width: ${percentage}%;"></div>
          </div>
          <div class="bpm-range-count">${count}</div>
        </div>
      `;
    }).join('');
  }
}

function refreshStats() {
  buildStatsData();
  showNotification('Stats refreshed!', 'success');
}

function selectGenreFromStats(genre) {
  // Switch to creator section and select genre
  switchToSection('creator');
  selectedGenres.add(genre);
  renderGenreGrid();
  updateTotals();
  showNotification(`${genre} selected!`, 'success');
}

// ===== SMART RECOMMENDATIONS =====

let currentRecommendations = [];

async function generateRecommendations() {
  if (Object.keys(genreSongMap).length === 0) {
    return [];
  }
  
  const recommendations = [];
  
  // Get all tracks and features
  const allTracks = userTracks;
  const features = Object.values(audioFeaturesCache);
  
  // Calculate statistics
  const genreCounts = Object.entries(genreSongMap)
    .map(([genre, tracks]) => ({ genre, count: tracks.length, tracks }))
    .sort((a, b) => b.count - a.count);
  
  const topGenres = genreCounts.slice(0, 5);
  const avgEnergy = features.length > 0 ? features.reduce((sum, f) => sum + f.energy, 0) / features.length : 0.5;
  const avgValence = features.length > 0 ? features.reduce((sum, f) => sum + f.valence, 0) / features.length : 0.5;
  const avgTempo = features.length > 0 ? features.reduce((sum, f) => sum + f.tempo, 0) / features.length : 120;
  
  // ==============================================
  // 1. 💎 HIDDEN GEMS - Rare tracks with low popularity
  // ==============================================
  const tracksWithPopularity = allTracks.filter(t => t.popularity !== undefined);
  if (tracksWithPopularity.length > 20) {
    const hiddenGems = tracksWithPopularity
      .filter(t => t.popularity < 30 && t.popularity > 0) // Rare but not completely unknown
      .sort((a, b) => a.popularity - b.popularity)
      .slice(0, 50);
    
    if (hiddenGems.length >= 15) {
      recommendations.push({
        type: 'hidden-gems',
        icon: '💎',
        title: 'Hidden Gems',
        description: `Found ${hiddenGems.length} rare tracks (popularity < 30) across your library. Perfect for a unique discovery playlist!`,
        action: 'create-playlist',
        data: {
          name: '💎 Hidden Gems',
          tracks: hiddenGems,
          description: 'Rare and underrated tracks from my collection'
        }
      });
    }
  }
  
  // ==============================================
  // 2. 🌅 SUNRISE SET - Progressive morning energy
  // ==============================================
  if (features.length > 30) {
    const morningTracks = allTracks
      .filter(t => {
        const f = audioFeaturesCache[t.id];
        return f && f.energy > 0.3 && f.energy < 0.7 && f.valence > 0.5 && f.tempo > 100 && f.tempo < 130;
      })
      .slice(0, 40);
    
    if (morningTracks.length >= 20) {
      // Sort by energy (low to high) for progressive feel
      morningTracks.sort((a, b) => {
        const af = audioFeaturesCache[a.id];
        const bf = audioFeaturesCache[b.id];
        return (af?.energy || 0) - (bf?.energy || 0);
      });
      
      recommendations.push({
        type: 'sunrise',
        icon: '🌅',
        title: 'Sunrise Set',
        description: `${morningTracks.length} tracks with progressive energy (${Math.round(morningTracks[0].tempo || 110)}-${Math.round(morningTracks[morningTracks.length-1].tempo || 125)} BPM). Perfect morning warm-up!`,
        action: 'create-playlist',
        data: {
          name: '🌅 Sunrise Set',
          tracks: morningTracks,
          description: 'Progressive morning energy builder'
        }
      });
    }
  }
  
  // ==============================================
  // 3. 🔥 PEAK TIME - High-energy bangers
  // ==============================================
  if (features.length > 20) {
    const peakTracks = allTracks
      .filter(t => {
        const f = audioFeaturesCache[t.id];
        return f && f.energy > 0.75 && f.danceability > 0.7 && f.tempo > 125;
      })
      .sort((a, b) => {
        const af = audioFeaturesCache[a.id] || {};
        const bf = audioFeaturesCache[b.id] || {};
        return (bf.energy + bf.danceability) - (af.energy + af.danceability);
      })
      .slice(0, 40);
    
    if (peakTracks.length >= 15) {
      recommendations.push({
        type: 'peak-time',
        icon: '🔥',
        title: 'Peak Time Bangers',
        description: `${peakTracks.length} high-energy, highly danceable tracks (energy > 75%, BPM > 125). Your hardest hitters!`,
        action: 'create-playlist',
        data: {
          name: '🔥 Peak Time',
          tracks: peakTracks,
          description: 'Maximum energy bangers for peak moments'
        }
      });
    }
  }
  
  // ==============================================
  // 4. 🌙 LATE NIGHT - Dark, deep, hypnotic
  // ==============================================
  if (features.length > 20) {
    const lateNightTracks = allTracks
      .filter(t => {
        const f = audioFeaturesCache[t.id];
        return f && f.valence < 0.4 && f.energy > 0.4 && f.energy < 0.75 && f.tempo > 115 && f.tempo < 130;
      })
      .slice(0, 40);
    
    if (lateNightTracks.length >= 15) {
      recommendations.push({
        type: 'late-night',
        icon: '🌙',
        title: 'Late Night Deep',
        description: `${lateNightTracks.length} dark, hypnotic tracks (low mood, steady energy). Perfect for 3am vibes!`,
        action: 'create-playlist',
        data: {
          name: '🌙 Late Night Deep',
          tracks: lateNightTracks,
          description: 'Dark and hypnotic late-night grooves'
        }
      });
    }
  }
  
  // ==============================================
  // 5. 🎯 GENRE FUSION - Best of top 3 genres combined
  // ==============================================
  if (topGenres.length >= 3) {
    const top3Genres = topGenres.slice(0, 3);
    const fusionTracks = [];
    
    // Take best tracks from each genre (sorted by popularity or energy)
    top3Genres.forEach(g => {
      const genreTracks = g.tracks
        .filter(t => audioFeaturesCache[t.id])
        .sort((a, b) => {
          const af = audioFeaturesCache[a.id] || {};
          const bf = audioFeaturesCache[b.id] || {};
          return (bf.energy + (b.popularity || 50)/100) - (af.energy + (a.popularity || 50)/100);
        })
        .slice(0, 15);
      fusionTracks.push(...genreTracks);
    });
    
    if (fusionTracks.length >= 30) {
      const genreNames = top3Genres.map(g => g.genre).join(' × ');
      recommendations.push({
        type: 'fusion',
        icon: '🎯',
        title: 'Genre Fusion',
        description: `Best of ${genreNames} (${fusionTracks.length} tracks). Your top genres in one perfect mix!`,
        action: 'create-playlist',
        data: {
          name: `🎯 ${genreNames}`,
          tracks: fusionTracks,
          description: `Fusion of my top genres: ${genreNames}`
        }
      });
    }
  }
  
  // ==============================================
  // 6. 🎪 GENRE RARITY - Explore underrepresented genres
  // ==============================================
  const rareGenres = genreCounts.filter(g => g.count >= 5 && g.count <= 20);
  if (rareGenres.length >= 3) {
    const rarityTracks = [];
    rareGenres.slice(0, 5).forEach(g => {
      rarityTracks.push(...g.tracks);
    });
    
    if (rarityTracks.length >= 20) {
      const genreList = rareGenres.slice(0, 5).map(g => g.genre).join(', ');
      recommendations.push({
        type: 'rarity',
        icon: '🎪',
        title: 'Genre Exploration',
        description: `${rarityTracks.length} tracks from underrepresented genres (${genreList}). Discover what you've been missing!`,
        action: 'create-playlist',
        data: {
          name: '🎪 Genre Exploration',
          tracks: rarityTracks.slice(0, 50),
          description: 'Deep cuts from my less-explored genres'
        }
      });
    }
  }
  
  // ==============================================
  // 7. 🏃 WORKOUT READY - High BPM + High Energy
  // ==============================================
  if (features.length > 20) {
    const workoutTracks = allTracks
      .filter(t => {
        const f = audioFeaturesCache[t.id];
        return f && f.energy > 0.7 && f.tempo > 140 && f.danceability > 0.6;
      })
      .sort((a, b) => {
        const af = audioFeaturesCache[a.id] || {};
        const bf = audioFeaturesCache[b.id] || {};
        return bf.tempo - af.tempo;
      })
      .slice(0, 40);
    
    if (workoutTracks.length >= 15) {
      const avgBpm = workoutTracks.reduce((sum, t) => sum + (audioFeaturesCache[t.id]?.tempo || 0), 0) / workoutTracks.length;
      recommendations.push({
        type: 'workout',
        icon: '🏃',
        title: 'Workout Power',
        description: `${workoutTracks.length} high-intensity tracks (avg ${Math.round(avgBpm)} BPM, energy > 70%). Perfect for pushing limits!`,
        action: 'create-playlist',
        data: {
          name: '🏃 Workout Power',
          tracks: workoutTracks,
          description: 'High-energy, high-BPM tracks for intense workouts'
        }
      });
    }
  }
  
  // ==============================================
  // 8. 🧠 FLOW STATE - Focus tracks (medium energy, low vocals)
  // ==============================================
  if (features.length > 20) {
    const flowTracks = allTracks
      .filter(t => {
        const f = audioFeaturesCache[t.id];
        return f && f.energy > 0.4 && f.energy < 0.7 && f.instrumentalness > 0.3 && f.tempo > 100 && f.tempo < 130;
      })
      .slice(0, 40);
    
    if (flowTracks.length >= 15) {
      recommendations.push({
        type: 'flow',
        icon: '🧠',
        title: 'Flow State',
        description: `${flowTracks.length} instrumental-heavy, steady-tempo tracks. Perfect for deep focus and productivity!`,
        action: 'create-playlist',
        data: {
          name: '🧠 Flow State',
          tracks: flowTracks,
          description: 'Instrumental focus music for deep work'
        }
      });
    }
  }
  
  // ==============================================
  // 9. 🌊 ENERGY WAVE - Rollercoaster of dynamics
  // ==============================================
  if (features.length > 30) {
    const dynamicTracks = allTracks
      .filter(t => audioFeaturesCache[t.id])
      .sort((a, b) => {
        // Sort by energy variance to create waves
        return Math.random() - 0.5;
      })
      .slice(0, 50);
    
    // Re-sort to create energy waves (low-high-low pattern)
    const waveTracks = [];
    const lowEnergy = dynamicTracks.filter(t => audioFeaturesCache[t.id]?.energy < 0.5);
    const highEnergy = dynamicTracks.filter(t => audioFeaturesCache[t.id]?.energy >= 0.5);
    
    for (let i = 0; i < Math.min(lowEnergy.length, highEnergy.length); i++) {
      waveTracks.push(lowEnergy[i]);
      waveTracks.push(highEnergy[i]);
    }
    
    if (waveTracks.length >= 20) {
      recommendations.push({
        type: 'wave',
        icon: '🌊',
        title: 'Energy Waves',
        description: `${waveTracks.length} tracks arranged in energy waves (peaks & valleys). Dynamic journey through your library!`,
        action: 'create-playlist',
        data: {
          name: '🌊 Energy Waves',
          tracks: waveTracks,
          description: 'Dynamic energy rollercoaster'
        }
      });
    }
  }
  
  // ==============================================
  // 10. 📅 RECENTLY ADDED - Your latest discoveries
  // ==============================================
  if (allTracks.some(t => t.added_at)) {
    const recentTracks = allTracks
      .filter(t => t.added_at)
      .sort((a, b) => new Date(b.added_at) - new Date(a.added_at))
      .slice(0, 40);
    
    if (recentTracks.length >= 15) {
      const oldestDate = new Date(recentTracks[recentTracks.length - 1].added_at);
      const daysAgo = Math.floor((Date.now() - oldestDate) / (1000 * 60 * 60 * 24));
      
      recommendations.push({
        type: 'recent',
        icon: '📅',
        title: 'Fresh Finds',
        description: `Your ${recentTracks.length} most recently added tracks (from the past ${daysAgo} days). Rediscover your latest discoveries!`,
        action: 'create-playlist',
        data: {
          name: '📅 Fresh Finds',
          tracks: recentTracks,
          description: 'My most recently added tracks'
        }
      });
    }
  }
  
  // Return top 6-8 recommendations (more variety!)
  return recommendations.slice(0, 8);
}

function displayRecommendations(recommendations) {
  const container = document.getElementById('recommendations-list-top');
  if (!container) return;
  
  if (recommendations.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No recommendations available. Try loading more music!</p>
      </div>
    `;
    return;
  }
  
  // Show as prominent cards in grid layout
  container.innerHTML = recommendations.map((rec, index) => `
    <div class="recommendation-card-large">
      <div class="rec-icon-large">${rec.icon}</div>
      <div class="rec-content-large">
        <h4>${rec.title}</h4>
        <p>${rec.description}</p>
      </div>
      <button class="btn-primary btn-rec-apply-large" onclick="applyRecommendation(${index})">
        Try This
      </button>
    </div>
  `).join('');
}

async function generateAndDisplayRecommendations() {
  currentRecommendations = await generateRecommendations();
  displayRecommendations(currentRecommendations);
}

function applyRecommendation(index) {
  const rec = currentRecommendations[index];
  if (!rec) return;
  
  if (rec.action === 'create-playlist') {
    // INSTANT PLAYLIST CREATION!
    const { name, tracks, description } = rec.data;
    
    if (!tracks || tracks.length === 0) {
      showNotification('No tracks available for this playlist', 'error');
      return;
    }
    
    // Show confirmation with preview
    showRecommendationPlaylistPreview(name, tracks, description);
    
  } else if (rec.action === 'select-genre') {
    // Switch to creator section
    switchToSection('creator');
    selectedGenres.add(rec.data);
    renderGenreGrid();
    updateRightPanel();
    showNotification(`${rec.data} selected!`, 'success');
    
  } else if (rec.action === 'select-genres') {
    // Switch to creator section
    switchToSection('creator');
    rec.data.forEach(genre => selectedGenres.add(genre));
    renderGenreGrid();
    updateRightPanel();
    showNotification(`${rec.data.length} genres selected!`, 'success');
    
  } else if (rec.action === 'apply-filter') {
    // Switch to creator section
    switchToSection('creator');
    Object.assign(smartPlaylistSettings, rec.data);
    
    // Update UI
    if (rec.data.bpm) {
      document.getElementById('bpm-enabled').checked = true;
      document.getElementById('bpm-controls').style.display = 'block';
      document.getElementById('bpm-min').value = rec.data.bpm.min;
      document.getElementById('bpm-max').value = rec.data.bpm.max;
      updateFilterDisplay('bpm');
    }
    if (rec.data.energy) {
      document.getElementById('energy-enabled').checked = true;
      document.getElementById('energy-controls').style.display = 'block';
      document.getElementById('energy-min').value = rec.data.energy.min;
      document.getElementById('energy-max').value = rec.data.energy.max;
      updateFilterDisplay('energy');
    }
    if (rec.data.mood) {
      document.getElementById('mood-enabled').checked = true;
      document.getElementById('mood-controls').style.display = 'block';
      document.getElementById('mood-min').value = rec.data.mood.min;
      document.getElementById('mood-max').value = rec.data.mood.max;
      updateFilterDisplay('mood');
    }
    
    updateFilterStatus();
    updateRightPanel();
    showNotification('Filter applied!', 'success');
  }
}

// Show preview of recommendation playlist before creating
function showRecommendationPlaylistPreview(name, tracks, description) {
  const modal = document.getElementById('recommendation-preview-modal');
  if (!modal) return;
  
  const nameEl = document.getElementById('rec-preview-name');
  const descEl = document.getElementById('rec-preview-description');
  const countEl = document.getElementById('rec-preview-count');
  const tracksListEl = document.getElementById('rec-preview-tracks');
  
  if (nameEl) nameEl.textContent = name;
  if (descEl) descEl.textContent = description;
  if (countEl) countEl.textContent = `${tracks.length} tracks`;
  
  if (tracksListEl) {
    const totalDuration = tracks.reduce((sum, t) => sum + t.duration_ms, 0);
    
    tracksListEl.innerHTML = `
      <div class="rec-preview-stats">
        <span>${tracks.length} tracks</span>
        <span>•</span>
        <span>${formatDuration(totalDuration)}</span>
      </div>
      <div class="rec-preview-track-list">
        ${tracks.slice(0, 10).map((track, i) => `
          <div class="rec-preview-track">
            <span class="rec-preview-track-num">${i + 1}</span>
            <span class="rec-preview-track-name">${escapeHtml(track.name)}</span>
            <span class="rec-preview-track-artist">${escapeHtml(track.artists[0].name)}</span>
          </div>
        `).join('')}
        ${tracks.length > 10 ? `<div class="rec-preview-more">+ ${tracks.length - 10} more tracks</div>` : ''}
      </div>
    `;
  }
  
  // Store tracks for creation
  window.currentRecommendationPlaylist = { name, tracks, description };
  
  modal.style.display = 'flex';
}

function closeRecommendationPreview() {
  const modal = document.getElementById('recommendation-preview-modal');
  if (modal) modal.style.display = 'none';
}

async function createRecommendationPlaylist() {
  const { name, tracks, description } = window.currentRecommendationPlaylist || {};
  
  if (!tracks || tracks.length === 0) {
    showNotification('No tracks to create playlist', 'error');
    return;
  }
  
  closeRecommendationPreview();
  
  try {
    showNotification('Creating playlist...', 'info');
    
    const playlistId = await createSpotifyPlaylist(name, description, false);
    const trackUris = tracks.map(t => t.uri);
    await addTracksToSpotifyPlaylist(playlistId, trackUris);
    
    showNotification(`✅ "${name}" created with ${tracks.length} tracks!`, 'success');
    
  } catch (error) {
    console.error('Error creating recommendation playlist:', error);
    showNotification('Failed to create playlist', 'error');
  }
}

// ===== PLAYLIST SELECTOR =====

async function showPlaylistSelector() {
  // Hide error UI
  const errorContainer = document.getElementById('load-error-recovery');
  if (errorContainer) errorContainer.style.display = 'none';
  
  // Show loading
  showNotification('Loading your playlists...', 'info');
  
  try {
    // Fetch user's playlists
    const playlists = await fetchUserPlaylists();
    
    // Show selector modal
    showPlaylistSelectorModal(playlists);
    
  } catch (error) {
    console.error('Error fetching playlists:', error);
    showNotification('Could not load playlists. Please try again.', 'error');
  }
}

function showPlaylistSelectorModal(playlists) {
  const modal = document.getElementById('playlist-selector-modal');
  if (!modal) return;
  
  const listContainer = document.getElementById('playlist-selector-list');
  if (!listContainer) return;
  
  listContainer.innerHTML = playlists.map(playlist => `
    <label class="playlist-selector-item">
      <input 
        type="checkbox" 
        class="playlist-checkbox"
        value="${playlist.id}"
        data-name="${escapeHtml(playlist.name)}"
        data-tracks="${playlist.tracks.total}"
      />
      <div class="playlist-info">
        ${playlist.images && playlist.images[0] ? 
          `<img src="${playlist.images[0].url}" class="playlist-thumb" alt="${escapeHtml(playlist.name)}">` :
          `<div class="playlist-thumb-placeholder">📁</div>`
        }
        <div class="playlist-details">
          <div class="playlist-name">${escapeHtml(playlist.name)}</div>
          <div class="playlist-track-count">${playlist.tracks.total} tracks</div>
        </div>
      </div>
    </label>
  `).join('');
  
  modal.style.display = 'flex';
}

function closePlaylistSelector() {
  const modal = document.getElementById('playlist-selector-modal');
  if (modal) modal.style.display = 'none';
}

async function loadSelectedPlaylists() {
  const checkboxes = document.querySelectorAll('.playlist-checkbox:checked');
  
  if (checkboxes.length === 0) {
    alert('Please select at least one playlist');
    return;
  }
  
  closePlaylistSelector();
  
  // Show progress
  const progressContainer = document.getElementById('load-progress-container');
  const progressFill = document.getElementById('load-progress-fill');
  const progressText = document.getElementById('load-progress-text');
  
  if (progressContainer && progressFill && progressText) {
    progressContainer.style.display = 'block';
    progressText.textContent = `Loading ${checkboxes.length} playlist(s)...`;
  }
  
  try {
    let allTracks = [];
    
    for (let i = 0; i < checkboxes.length; i++) {
      const checkbox = checkboxes[i];
      const playlistId = checkbox.value;
      const playlistName = checkbox.dataset.name;
      
      if (progressText) {
        progressText.textContent = `Loading ${playlistName} (${i + 1}/${checkboxes.length})...`;
      }
      
      const tracks = await fetchPlaylistTracks(playlistId);
      allTracks.push(...tracks);
      
      if (progressFill) {
        progressFill.style.width = `${((i + 1) / checkboxes.length) * 100}%`;
      }
    }
    
    // Remove duplicates
    const seen = new Set();
    allTracks = allTracks.filter(track => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
    
    userTracks = allTracks;
    
    // Build genre maps
    if (progressText) progressText.textContent = 'Analyzing genres...';
    await buildGenreMaps(allTracks);
    
    // Fetch audio features
    if (progressText) progressText.textContent = 'Loading audio features...';
    await getAudioFeaturesForTracks(allTracks);
    
    // Build library data
    buildLibraryData();
    buildStatsData();
    generateAndDisplayRecommendations();
    
    // Show genre section
    const genreSection = document.getElementById('genre-section');
    if (genreSection) genreSection.style.display = 'block';
    renderGenreGrid();
    
    if (progressText) progressText.textContent = `Complete! ${allTracks.length} tracks loaded from ${checkboxes.length} playlist(s)`;
    
    setTimeout(() => {
      if (progressContainer) progressContainer.style.display = 'none';
    }, 2000);
    
  } catch (error) {
    console.error('Error loading playlists:', error);
    if (progressText) {
      progressText.textContent = 'Error loading playlists';
      progressText.style.color = '#ff4444';
    }
    showLoadErrorRecovery('playlists', error);
  }
}

function selectAllPlaylists() {
  document.querySelectorAll('.playlist-checkbox').forEach(cb => cb.checked = true);
}

function deselectAllPlaylists() {
  document.querySelectorAll('.playlist-checkbox').forEach(cb => cb.checked = false);
}

// Filter library by genre
function filterLibraryByGenre() {
  const genreFilter = document.getElementById('library-genre-filter').value;
  const searchQuery = document.getElementById('library-search').value.toLowerCase();
  
  if (!genreFilter && !searchQuery) {
    filteredLibraryArtists = [...libraryArtistData];
  } else {
    filteredLibraryArtists = libraryArtistData.filter(artist => {
      const matchesGenre = !genreFilter || artist.genres.includes(genreFilter);
      const matchesSearch = !searchQuery || artist.name.toLowerCase().includes(searchQuery);
      return matchesGenre && matchesSearch;
    });
  }
  
  renderLibraryArtistGrid();
}

// Select genre from library (tag click)
function selectGenreFromLibrary(genre, event) {
  event.stopPropagation();
  
  // Switch to creator section
  switchToSection('creator');
  
  // Select the genre
  selectedGenres.add(genre);
  renderGenreGrid();
  updateRightPanel();
  
  showNotification(`${genre} selected!`, 'success');
}

// Find similar artists
function findSimilarArtists(artistId) {
  const artist = libraryArtistData.find(a => a.id === artistId);
  if (!artist) return;
  
  // Find artists with overlapping genres
  const similarArtists = libraryArtistData
    .filter(a => a.id !== artistId)
    .map(a => {
      const sharedGenres = a.genres.filter(g => artist.genres.includes(g));
      return {
        ...a,
        sharedGenres,
        similarity: sharedGenres.length
      };
    })
    .filter(a => a.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10);
  
  showSimilarArtistsModal(artist, similarArtists);
}

// Show similar artists modal
function showSimilarArtistsModal(artist, similarArtists) {
  const modal = document.getElementById('similar-artists-modal');
  if (!modal) return;
  
  const nameEl = document.getElementById('similar-artists-for');
  const listEl = document.getElementById('similar-artists-list');
  
  if (nameEl) nameEl.textContent = artist.name;
  
  if (listEl) {
    if (similarArtists.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p>No similar artists found in your library</p></div>';
    } else {
      listEl.innerHTML = similarArtists.map(similar => `
        <div class="similar-artist-item" onclick="showLibraryArtistDetail('${similar.id}'); closeSimilarArtistsModal();">
          ${similar.image ? 
            `<img src="${similar.image}" class="similar-artist-image" alt="${escapeHtml(similar.name)}">` :
            `<div class="similar-artist-placeholder">🎤</div>`
          }
          <div class="similar-artist-info">
            <div class="similar-artist-name">${escapeHtml(similar.name)}</div>
            <div class="similar-artist-genres">
              ${similar.sharedGenres.map(g => `<span class="shared-genre-tag">${escapeHtml(g)}</span>`).join(' ')}
            </div>
            <div class="similar-artist-count">${similar.tracks.length} tracks</div>
          </div>
        </div>
      `).join('');
    }
  }
  
  modal.style.display = 'flex';
}

function closeSimilarArtistsModal() {
  const modal = document.getElementById('similar-artists-modal');
  if (modal) modal.style.display = 'none';
}

// Select genre from genre detail modal
function selectGenreFromModal() {
  const genreNameEl = document.getElementById('genre-detail-name');
  if (!genreNameEl) return;
  
  const genre = genreNameEl.textContent;
  
  // Add to selected genres
  selectedGenres.add(genre);
  renderGenreGrid();
  updateRightPanel();
  
  closeGenreDetailModal();
  showNotification(`${genre} selected!`, 'success');
}

// Select all tracks in genre detail modal
function selectAllGenreTracksInModal() {
  const checkboxes = document.querySelectorAll('#genre-detail-artists-list .track-checkbox');
  
  checkboxes.forEach(cb => {
    const trackId = cb.dataset.trackId;
    if (!selectedTracks.has(trackId)) {
      selectedTracks.add(trackId);
      cb.checked = true;
    }
  });
  
  updateSelectionPanel();
  showNotification(`All tracks selected!`, 'success');
}
