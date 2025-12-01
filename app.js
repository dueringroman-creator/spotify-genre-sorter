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
let genreViewMode = 'grouped';
let excludedArtists = new Map(); // Map of genre -> Set of excluded artist IDs
let excludedTracks = new Map(); // Map of "genre:artistId" -> Set of excluded track IDs
let manualGenreMappings = {}; // User-defined genre mappings: { "tekno": "techno" }

// Smart playlist settings
let playlistBuilderOpen = false;
let smartPlaylistSettings = {
  targetDuration: 7200, // 2 hours in seconds
  maxTracksPerArtist: 3,
  avoidConsecutiveSameArtist: true,
  shuffleMode: 'smart', // 'random', 'smart', 'energy', 'bpm'
  bpmRange: { min: 0, max: 200, enabled: false },
  energyRange: { min: 0, max: 100, enabled: false },
  moodRange: { min: 0, max: 100, enabled: false }
};

// Playlist templates
const playlistTemplates = {
  custom: {
    name: "Custom",
    targetDuration: 7200,
    maxTracksPerArtist: 3,
    avoidConsecutiveSameArtist: true
  },
  workout: {
    name: "Workout Mix",
    targetDuration: 3600, // 1 hour
    maxTracksPerArtist: 2,
    avoidConsecutiveSameArtist: true,
    description: "High energy tracks for your workout"
  },
  focus: {
    name: "Deep Focus",
    targetDuration: 7200, // 2 hours
    maxTracksPerArtist: 5,
    avoidConsecutiveSameArtist: false,
    description: "Low energy, minimal variation for concentration"
  },
  party: {
    name: "Party Playlist",
    targetDuration: 10800, // 3 hours
    maxTracksPerArtist: 2,
    avoidConsecutiveSameArtist: true,
    description: "Upbeat tracks to keep the energy high"
  },
  discovery: {
    name: "Discovery Mode",
    targetDuration: 3600, // 1 hour
    maxTracksPerArtist: 1,
    avoidConsecutiveSameArtist: true,
    description: "Maximum variety - explore your library"
  },
  commute: {
    name: "Commute Mix",
    targetDuration: 2700, // 45 minutes
    maxTracksPerArtist: 3,
    avoidConsecutiveSameArtist: true,
    description: "Balanced mix for your drive or transit"
  },
  background: {
    name: "Background Music",
    targetDuration: 14400, // 4 hours
    maxTracksPerArtist: 5,
    avoidConsecutiveSameArtist: false,
    description: "Long, chill playlist for background listening"
  }
};

// Broman - The Berghain Bouncer of Playlists
let bromanState = {
  score: 0,
  collapsed: false,
  comments: [
    "You just discovered Spotify?",
    "Did someone show you this link?",
    "Everyone starts somewhere.",
    "No judgment. Yet.",
    "I've seen worse."
  ],
  currentComment: 0
};

// Load Broman state from localStorage
function loadBromanState() {
  const saved = localStorage.getItem('broman_state');
  if (saved) {
    const parsed = JSON.parse(saved);
    bromanState.score = parsed.score || 0;
    bromanState.collapsed = parsed.collapsed || false;
  }
  
  // Load playlist history
  const history = localStorage.getItem('playlist_history');
  if (history) {
    playlistHistory = JSON.parse(history);
  }
}

// Save Broman state
function saveBromanState() {
  localStorage.setItem('broman_state', JSON.stringify({
    score: bromanState.score,
    collapsed: bromanState.collapsed
  }));
}

// Update Broman score
function updateBromanScore(points, reason) {
  bromanState.score += points;
  if (bromanState.score < 0) bromanState.score = 0;
  
  saveBromanState();
  updateBromanUI();
  
  // Update comment based on action
  if (points > 0) {
    showBromanReaction(reason, true);
  } else if (points < 0) {
    showBromanReaction(reason, false);
  }
}

// Broman reactions
const bromanReactions = {
  positive: [
    "Not bad.",
    "You're learning.",
    "Finally.",
    "Respectable.",
    "I'll allow it.",
    "Smart move.",
    "You might know what you're doing.",
    "Solid choice."
  ],
  negative: [
    "Really?",
    "That's cute.",
    "Bold strategy.",
    "Interesting choice.",
    "I've seen worse.",
    "You'll figure it out.",
    "Amateur hour."
  ],
  specific: {
    useAdvanced: "Advanced settings. You're not a complete amateur.",
    useBPM: "BPM filtering. Finally, someone who gets it.",
    useTemplate: "Templates are for beginners. But fine.",
    diversityLow: "Max 3 tracks per artist. Smart. You might know what you're doing.",
    diversityHigh: "10 tracks per artist? That's just Shuffle with extra steps.",
    discovery: "Discovery mode. 1 track per artist. Finally.",
    longPlaylist: "2+ hour playlist. You're committed. I respect that.",
    mapGenre: "Manual mapping. You're doing my job for me.",
    createPlaylist: "Playlist created. Let's see if it's actually good.",
    multipleGenres: "{{count}} genres. Bold. Most people stick to one.",
    firstPlaylist: "Your first playlist. Everyone starts somewhere.",
    tenthPlaylist: "10 playlists. You're a regular now."
  }
};

function showBromanReaction(key, isPositive) {
  const commentEl = document.getElementById('broman-comment');
  if (!commentEl) return;
  
  const pTag = commentEl.querySelector('p');
  if (!pTag) return;
  
  let text;
  if (bromanReactions.specific[key]) {
    text = bromanReactions.specific[key];
  } else {
    const pool = isPositive ? bromanReactions.positive : bromanReactions.negative;
    text = pool[Math.floor(Math.random() * pool.length)];
  }
  
  pTag.textContent = `"${text}"`;
  commentEl.classList.add('flash');
  setTimeout(() => commentEl.classList.remove('flash'), 500);
}

// Update Broman UI
function updateBromanUI() {
  const scoreEl = document.getElementById('broman-score');
  const labelEl = document.getElementById('broman-label');
  const progressEl = document.getElementById('broman-progress');
  
  if (!scoreEl) return;
  
  const score = bromanState.score;
  scoreEl.textContent = score;
  
  // Determine tier
  let label, progressPercent;
  if (score < 20) {
    label = "Spotify Shuffle User";
    progressPercent = (score / 20) * 100;
  } else if (score < 40) {
    label = "Amateur Hour";
    progressPercent = ((score - 20) / 20) * 100;
  } else if (score < 60) {
    label = "Getting There";
    progressPercent = ((score - 40) / 20) * 100;
  } else if (score < 80) {
    label = "Respectable";
    progressPercent = ((score - 60) / 20) * 100;
  } else if (score < 100) {
    label = "Playlist Architect";
    progressPercent = ((score - 80) / 20) * 100;
  } else {
    label = "Berghain Material";
    progressPercent = 100;
  }
  
  labelEl.textContent = label;
  progressEl.style.width = `${progressPercent}%`;
  
  // Update history
  updateBromanHistory();
}

// Update playlist history in Broman
function updateBromanHistory() {
  const historyEl = document.getElementById('broman-history');
  if (!historyEl) return;
  
  if (playlistHistory.length === 0) {
    historyEl.innerHTML = '<div class="history-empty">No playlists yet.<br>Get to work.</div>';
    return;
  }
  
  const last15 = playlistHistory.slice(-15).reverse();
  historyEl.innerHTML = last15.map(p => {
    const date = new Date(p.createdAt);
    const timeAgo = getTimeAgo(date);
    return `
      <div class="history-item">
        <a href="${p.url}" target="_blank" class="history-name">${p.name}</a>
        <div class="history-meta">${p.trackCount} tracks • ${timeAgo}</div>
      </div>
    `;
  }).join('');
}

// Helper function for time ago
function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Toggle Broman sidebar
function toggleBromanSidebar() {
  const sidebar = document.getElementById('broman-sidebar');
  const tab = document.getElementById('broman-tab');
  
  bromanState.collapsed = !bromanState.collapsed;
  saveBromanState();
  
  if (bromanState.collapsed) {
    sidebar.classList.add('collapsed');
    tab.classList.remove('hidden');
  } else {
    sidebar.classList.remove('collapsed');
    tab.classList.add('hidden');
  }
}

// Toggle Learn More
function toggleLearnMore() {
  const content = document.getElementById('learn-more-content');
  const icon = document.getElementById('learn-more-icon');
  
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    icon.textContent = '▲';
  } else {
    content.classList.add('hidden');
    icon.textContent = '▼';
  }
}

// Quick search state
let searchPanelOpen = false;
let recentSearches = [];
let manuallyAddedTracks = new Set();

// Double-click tracking
let lastClickTime = 0;
let lastClickedFamily = null;

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
  },
  "uk-bass": {
    name: "UK Bass",
    keywords: ["uk garage", "garage", "2-step", "2step", "uk funky", "bassline", "grime", "uk grime", "uk drill"],
    exclude: ["future garage"],
    color: "#9B59B6"
  },
  "disco-funk": {
    name: "Disco/Funk",
    keywords: ["disco", "funk", "nu disco", "italo disco", "boogie", "g-funk"],
    exclude: ["disco house"],
    color: "#F39C12"
  },
  "indie-electronic": {
    name: "Indie Electronic",
    keywords: ["indie dance", "electroclash", "alternative dance", "new rave", "madchester"],
    exclude: [],
    color: "#3498DB"
  },
  "experimental": {
    name: "Experimental",
    keywords: ["idm", "glitch", "breakcore", "noise", "avant-garde", "avantgarde", "power electronics"],
    exclude: [],
    color: "#95A5A6"
  },
  "lo-fi-chill": {
    name: "Lo-Fi/Chill",
    keywords: ["lo-fi", "lofi", "chillwave", "chillstep", "lo-fi beats", "lofi beats"],
    exclude: [],
    color: "#1ABC9C"
  },
  "bass-music": {
    name: "Bass Music",
    keywords: ["future bass", "melodic bass", "bass music"],
    exclude: ["bass house", "drum and bass", "bassline"],
    color: "#E74C3C"
  },
  "classic-electronic": {
    name: "Classic Electronic",
    keywords: ["synthwave", "new wave", "eurodance", "italo dance", "electro swing"],
    exclude: ["new rave"],
    color: "#16A085"
  },
  "downtempo": {
    name: "Downtempo",
    keywords: ["trip-hop", "trip hop", "downtempo", "lounge", "quiet storm"],
    exclude: [],
    color: "#8E44AD"
  },
  "world-latin": {
    name: "World/Latin",
    keywords: ["reggaeton", "latin", "salsa", "cumbia", "samba", "bossa nova", "afrobeats", "amapiano", "kuduro", "zouk", "kizomba"],
    exclude: [],
    color: "#E67E22"
  },
  "hardstyle-hardcore": {
    name: "Hardstyle/Hardcore",
    keywords: ["hardstyle", "hardcore", "gabba", "speedcore", "frenchcore", "happy hardcore"],
    exclude: ["hardcore punk"],
    color: "#34495E"
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
    // UK Bass scene (comprehensive)
    'uk garage': 'uk garage',
    'uk funky': 'uk funky',
    '2-step': '2-step',
    '2step': '2-step',
    '3 step': '2-step',
    'bassline': 'bassline',
    'bass music': 'bass music',
    'grime': 'grime',
    'uk grime': 'grime',
    'uk drill': 'uk drill',
    'drill': 'uk drill',
    'chicago drill': 'uk drill',
    'footwork': 'breakbeat',
    'juke': 'breakbeat',
    'baltimore club': 'breakbeat',
    'jersey club': 'breakbeat',
    
    // Disco/Funk family
    'nu disco': 'nu disco',
    'new disco': 'nu disco',
    'nudisco': 'nu disco',
    'nu-disco': 'nu disco',
    'disco house': 'house',
    'french disco': 'disco',
    'space disco': 'disco',
    'italo disco': 'italo disco',
    'post-disco': 'disco',
    'funk': 'funk',
    'g-funk': 'g-funk',
    'boogie': 'funk',
    'boogie-woogie': 'funk',
    'funk carioca': 'funk',
    'funk belo horizonte': 'funk',
    'brasilianischer funk': 'funk',
    'afrobeat': 'funk',
    'afro tech': 'house',
    'afroswing': 'hip hop',
    'afrobeats': 'reggae',
    
    // Techno variations
    'tekno': 'techno',
    'technо': 'techno',
    'tecno': 'techno',
    'tekk': 'techno',
    'schranz': 'techno',
    'hardtechno': 'techno',
    'hard techno': 'techno',
    'minimal techno': 'techno',
    'dub techno': 'techno',
    'acid techno': 'techno',
    'detroit techno': 'techno',
    'berlin techno': 'techno',
    'industrial techno': 'techno',
    
    // House variations
    'houze': 'house',
    'housе': 'house',
    'deep house': 'house',
    'progressive house': 'house',
    'tech house': 'house',
    'bass house': 'house',
    'future house': 'house',
    'electro house': 'house',
    'tropical house': 'house',
    'afro house': 'house',
    'jackin house': 'house',
    'chicago house': 'house',
    'soulful house': 'house',
    'vocal house': 'house',
    'funky house': 'house',
    'melodic house': 'house',
    
    // Hip hop variations
    'hiphop': 'hip hop',
    'hip-hop': 'hip hop',
    'rap': 'hip hop',
    'trap': 'trap',
    'hip hop': 'hip hop',
    'boom bap': 'hip hop',
    'conscious hip hop': 'hip hop',
    'gangsta rap': 'hip hop',
    'east coast hip hop': 'hip hop',
    'west coast hip hop': 'hip hop',
    'southern hip hop': 'hip hop',
    'cloud rap': 'hip hop',
    'mumble rap': 'hip hop',
    'crunk': 'hip hop',
    'horrorcore': 'hip hop',
    
    // Indie Electronic
    'indie dance': 'indie dance',
    'electroclash': 'electroclash',
    'alternative dance': 'indie dance',
    'new rave': 'new rave',
    'madchester': 'madchester',
    'elektronischer indie': 'indie dance',
    
    // Electronic/EDM variations
    'electronica': 'indie dance',
    'electro': 'classic electronic',
    'edm': 'house',
    'electronic dance music': 'house',
    'big room': 'house',
    'complextro': 'dubstep',
    
    // Classic Electronic
    'synthwave': 'synthwave',
    'new wave': 'new wave',
    'neue deutsche welle': 'new wave',
    'cold wave': 'new wave',
    'darkwave': 'new wave',
    'eurodance': 'eurodance',
    'italo dance': 'italo dance',
    'electro swing': 'electro swing',
    
    // Lo-Fi/Chill
    'lo-fi': 'lo-fi',
    'lofi': 'lo-fi',
    'lo-fi beats': 'lo-fi beats',
    'lofi beats': 'lo-fi beats',
    'lo-fi indie': 'lo-fi',
    'chillwave': 'chillwave',
    'chillstep': 'chillstep',
    'vaporwave': 'chillwave',
    
    // Bass Music
    'future bass': 'future bass',
    'melodic bass': 'melodic bass',
    'miami bass': 'bass music',
    'brasilianischer bass': 'bass music',
    
    // Experimental/IDM
    'idm': 'idm',
    'glitch': 'glitch',
    'breakcore': 'breakcore',
    'noise': 'noise',
    'power electronics': 'power electronics',
    'avant-garde': 'experimental',
    'avantgarde': 'experimental',
    'minimalismus': 'experimental',
    'gabba': 'gabba',
    'speedcore': 'speedcore',
    'hardcore': 'hardcore',
    'frenchcore': 'frenchcore',
    'happy hardcore': 'happy hardcore',
    'hardstyle': 'hardstyle',
    'drumstep': 'drum and bass',
    
    // Industrial/experimental
    'industrial': 'techno',
    'ebm': 'techno',
    'electro-industrial': 'techno',
    'dark ambient': 'ambient',
    'drone': 'ambient',
    'space music': 'ambient',
    
    // Downtempo/Trip-hop
    'trip-hop': 'trip-hop',
    'trip hop': 'trip-hop',
    'downtempo': 'downtempo',
    'lounge': 'lounge',
    'quiet storm': 'quiet storm',
    
    // Drum & bass
    'dnb': 'drum and bass',
    'd&b': 'drum and bass',
    'jungle': 'drum and bass',
    'liquid dnb': 'drum and bass',
    'liquid funk': 'drum and bass',
    'neurofunk': 'drum and bass',
    'jump up': 'drum and bass',
    
    // Dubstep/bass
    'brostep': 'dubstep',
    'riddim': 'dubstep',
    'future garage': 'dubstep',
    
    // Trance variations
    'progressive trance': 'trance',
    'uplifting trance': 'trance',
    'psytrance': 'trance',
    'goa trance': 'trance',
    'vocal trance': 'trance',
    'tech trance': 'trance',
    
    // Ambient variations
    'chillout': 'ambient',
    'space ambient': 'ambient',
    'new age': 'ambient',
    
    // Breakbeat variations
    'big beat': 'breakbeat',
    'nu skool breaks': 'breakbeat',
    'breaks': 'breakbeat',
    
    // Rock variations
    'indie rock': 'indie rock',
    'alternative rock': 'alternative rock',
    'alt rock': 'alternative rock',
    'post-rock': 'rock',
    'post rock': 'rock',
    'prog rock': 'rock',
    'progressive rock': 'rock',
    'post-punk': 'punk',
    'post punk': 'punk',
    'grunge': 'rock',
    'post-grunge': 'rock',
    'shoegaze': 'indie rock',
    'garage rock': 'rock',
    'psychedelic rock': 'rock',
    
    // German genres
    'deutscher indie': 'indie rock',
    'chinesischer indie': 'indie rock',
    'japanischer indie': 'indie rock',
    'indischer indie': 'indie rock',
    'elektronische musik': 'house',
    'schlager': 'pop',
    'schlagerparty': 'pop',
    
    // Pop variations
    'synthpop': 'pop',
    'synth pop': 'pop',
    'electropop': 'pop',
    'indie pop': 'indie pop',
    'dream pop': 'indie pop',
    'art pop': 'pop',
    'k-pop': 'pop',
    'j-pop': 'pop',
    
    // Jazz variations
    'nu jazz': 'jazz',
    'acid jazz': 'jazz',
    'smooth jazz': 'jazz',
    'bebop': 'jazz',
    
    // Classical
    'neoklassik': 'jazz',
    'klassik': 'jazz',
    'klassisches klavier': 'jazz',
    'chormusik': 'jazz',
    'orchester': 'jazz',
    
    // Reggae/Dancehall variations
    'dub': 'reggae',
    'roots reggae': 'reggae',
    'dancehall': 'reggae',
    'ragga': 'reggae',
    
    // Latin/World music
    'reggaeton': 'reggaeton',
    'neoperreo': 'reggaeton',
    'urbano latino': 'latin',
    'latin alternative': 'latin',
    'latin indie': 'latin',
    'latin': 'latin',
    'salsa': 'salsa',
    'mambo': 'salsa',
    'cha-cha-cha': 'salsa',
    'merengue': 'salsa',
    'cumbia': 'cumbia',
    'electrocumbia': 'cumbia',
    'vallenato': 'cumbia',
    'champeta': 'cumbia',
    'samba': 'samba',
    'bossa nova': 'bossa nova',
    'mpb': 'bossa nova',
    'nova mpb': 'bossa nova',
    'soca': 'reggae',
    'zouk': 'zouk',
    'kizomba': 'kizomba',
    'kuduro': 'kuduro',
    'gqom': 'amapiano',
    'amapiano': 'amapiano',
    'highlife': 'afrobeats',
    'gnawa': 'afrobeats',
    'son cubano': 'salsa',
    'bolero': 'salsa',
    'chanson québécoise': 'folk',
    'tropische musik': 'latin',
    'maluku': 'latin',
    'alté': 'afrobeats',
    'tamilischer dance': 'latin',
    'afrikanischer gospel': 'afrobeats',
    'techengue': 'latin',
    'malaysisch': 'latin',
    
    // Dance/EDM
    'moombahton': 'house',
    'guaracha': 'house',
    'bounce': 'hip hop',
    'melbourne bounce': 'house',
    'hardstyle': 'hardstyle',
    'ballroom vogue': 'house',
    
    // Other electronic
    'phonk': 'hip hop',
    'drift phonk': 'hip hop',
    'brasilianischer phonk': 'hip hop',
    
    // Misc
    'emo': 'punk',
    'motown': 'soul',
    'swing': 'jazz',
    'big band': 'jazz',
    'ragtime': 'jazz',
    'doo-wop': 'soul',
    'adult standards': 'jazz',
    'singer-songwriter': 'folk',
    'indie folk': 'folk',
    'neo soul': 'soul',
    'new jack swing': 'r&b',
    'gesprochenes wort': 'experimental',
    'soundtrack': 'ambient',
    'weihnachten': 'pop'
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
          
          ${sortedFamilies.length > 2 ? `
          <div class="fun-fact">
            Your top 3: <strong>${sortedFamilies.slice(0, 3).map(([_, data]) => data.name).join(', ')}</strong>
          </div>
          ` : ''}
          
          ${avgDuration < 180 ? `
          <div class="fun-fact">
            Short track preference: Avg ${avgMinutes}:${avgSeconds.toString().padStart(2, '0')} — You like concise bangers
          </div>
          ` : avgDuration > 300 ? `
          <div class="fun-fact">
            Long track preference: Avg ${avgMinutes}:${avgSeconds.toString().padStart(2, '0')} — You appreciate extended journeys
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

function clearSpecificCache(dataSource) {
  clearCache(dataSource);
  updateStatus(`Cleared cache for ${dataSource}`);
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

// Fetch audio features (tempo, energy, valence) for tracks
async function fetchAudioFeatures(trackIds) {
  const token = localStorage.getItem('spotify_access_token');
  if (!token || trackIds.length === 0) return {};
  
  const audioFeaturesMap = {};
  
  // Spotify allows max 100 tracks per request
  const batchSize = 100;
  for (let i = 0; i < trackIds.length; i += batchSize) {
    const batch = trackIds.slice(i, i + batchSize);
    const ids = batch.join(',');
    
    try {
      const response = await fetchWithRetry(
        `https://api.spotify.com/v1/audio-features?ids=${ids}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      
      const data = await response.json();
      
      if (data.audio_features) {
        data.audio_features.forEach((features, index) => {
          if (features) {
            audioFeaturesMap[batch[index]] = {
              tempo: Math.round(features.tempo), // BPM
              energy: Math.round(features.energy * 100), // 0-100
              valence: Math.round(features.valence * 100), // 0-100 (mood)
              danceability: Math.round(features.danceability * 100),
              acousticness: Math.round(features.acousticness * 100)
            };
          }
        });
      }
    } catch (error) {
      console.error('Error fetching audio features:', error);
    }
  }
  
  return audioFeaturesMap;
}

// Attach audio features to tracks
async function enrichTracksWithAudioFeatures(tracks) {
  // Check if we have cached features
  const cachedFeatures = localStorage.getItem('audio_features_cache');
  let featuresCache = cachedFeatures ? JSON.parse(cachedFeatures) : {};
  
  // Find tracks that don't have features yet
  const tracksNeedingFeatures = tracks.filter(t => !featuresCache[t.id]);
  
  if (tracksNeedingFeatures.length > 0) {
    updateStatus(`Analyzing ${tracksNeedingFeatures.length} tracks for BPM, energy, and mood...`);
    
    const trackIds = tracksNeedingFeatures.map(t => t.id);
    const newFeatures = await fetchAudioFeatures(trackIds);
    
    // Merge with cache
    featuresCache = { ...featuresCache, ...newFeatures };
    
    // Save to localStorage
    localStorage.setItem('audio_features_cache', JSON.stringify(featuresCache));
  }
  
  // Attach features to tracks
  return tracks.map(track => ({
    ...track,
    audioFeatures: featuresCache[track.id] || null
  }));
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

function toggleAboutSection(sectionId) {
  const content = document.getElementById(`about-${sectionId}`);
  const icon = document.getElementById(`icon-${sectionId}`);
  
  if (!content || !icon) return;
  
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    content.classList.add('visible');
    icon.classList.add('expanded');
  } else {
    content.classList.remove('visible');
    content.classList.add('hidden');
    icon.classList.remove('expanded');
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
  // Initialize Broman helper
  initBroman();
  
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
  } else {
    // Show Broman welcome on subsequent visits (after login)
    const checkLogin = setInterval(() => {
      if (!document.getElementById('app-section').classList.contains('hidden')) {
        // Check if first visit (no shown tips)
        if (bromanState.shownTips.size === 0 && bromanState.settings.showOnFirstVisit) {
          setTimeout(() => triggerBroman('onFirstVisit'), 2000);
        }
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
  
  // Check for cache conflicts (different data source)
  const allCacheSources = ['liked', 'playlists', 'top-artists'];
  let conflictingCache = null;
  
  for (const source of allCacheSources) {
    if (source !== dataSource) {
      const cache = loadFromCache(source);
      if (cache) {
        conflictingCache = { source, cache };
        break;
      }
    }
  }
  
  if (conflictingCache) {
    const sourceName = {
      'liked': 'Liked Songs',
      'playlists': 'Playlists',
      'top-artists': 'Top Artists'
    }[conflictingCache.source];
    
    const targetName = {
      'liked': 'Liked Songs',
      'playlists': 'Playlists',
      'top-artists': 'Top Artists'
    }[dataSource];
    
    const shouldClear = confirm(
      `You have cached data from "${sourceName}" (${getTimeAgo(new Date(conflictingCache.cache.timestamp))}).\n\n` +
      `Do you want to clear it and load fresh data from "${targetName}"?\n\n` +
      `Click OK to clear cache and load ${targetName}\n` +
      `Click Cancel to keep using ${sourceName} cache`
    );
    
    if (shouldClear) {
      // Clear the conflicting cache
      clearSpecificCache(conflictingCache.source);
    } else {
      // Switch to the cached source
      document.querySelector(`input[value="${conflictingCache.source}"]`).checked = true;
      document.getElementById('fetch-tracks').disabled = false;
      return;
    }
  }
  
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
  
  // Get timeframe filter first
  const timeframe = document.getElementById('liked-timeframe')?.value || 'all';
  const now = Date.now();
  const cutoffs = {
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    '3months': 90 * 24 * 60 * 60 * 1000,
    '6months': 180 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000
  };
  const cutoffTime = timeframe !== 'all' ? now - cutoffs[timeframe] : null;
  
  while (true) {
    const resp = await fetchWithRetry(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { 'Authorization': `Bearer ${window.spotifyToken}` }
    });
    const data = await resp.json();
    
    // If using timeframe filter, check if we've gone past the cutoff
    if (cutoffTime) {
      for (const item of data.items) {
        const addedAt = new Date(item.added_at).getTime();
        if (addedAt >= cutoffTime) {
          all.push(item);
        } else {
          // Spotify returns tracks in reverse chronological order (newest first)
          // Once we hit a track older than cutoff, we can stop
          cachedLibraryData = { type: 'tracks', items: all };
          updateStatus(`Loaded ${all.length} tracks from ${getTimeframeLabel(timeframe)}`);
          return;
        }
      }
    } else {
      all.push(...data.items);
    }
    
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

function filterByTimeframe(tracks, timeframe) {
  const now = Date.now();
  const cutoffs = {
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    '3months': 90 * 24 * 60 * 60 * 1000,
    '6months': 180 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000
  };
  
  const cutoffTime = now - cutoffs[timeframe];
  
  return tracks.filter(item => {
    if (!item.added_at) return true;
    const addedAt = new Date(item.added_at).getTime();
    return addedAt >= cutoffTime;
  });
}

function getTimeframeLabel(timeframe) {
  const labels = {
    week: 'past week',
    month: 'past month',
    '3months': 'past 3 months',
    '6months': 'past 6 months',
    year: 'past year',
    all: 'all time'
  };
  return labels[timeframe] || 'all time';
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
          <button class="btn-small" onclick="toggleShortPlaylists()">Toggle <10 Tracks</button>
          <button class="btn-small" onclick="toggleLargePlaylists()">Toggle 100+ Tracks</button>
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

function toggleShortPlaylists() {
  const checkboxes = document.querySelectorAll('.playlist-selection-checkbox');
  checkboxes.forEach((checkbox, index) => {
    const playlistItem = checkbox.closest('.playlist-selection-item');
    const tracksText = playlistItem.querySelector('.playlist-tracks-count').textContent;
    const trackCount = parseInt(tracksText);
    
    if (trackCount < 10) {
      checkbox.checked = !checkbox.checked;
    }
  });
}

function toggleLargePlaylists() {
  const checkboxes = document.querySelectorAll('.playlist-selection-checkbox');
  checkboxes.forEach((checkbox, index) => {
    const playlistItem = checkbox.closest('.playlist-selection-item');
    const tracksText = playlistItem.querySelector('.playlist-tracks-count').textContent;
    const trackCount = parseInt(tracksText);
    
    if (trackCount >= 100) {
      checkbox.checked = !checkbox.checked;
    }
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
  
  // Trigger Broman: Library loaded
  const genreCount = Object.keys(genreSongMap).length;
  const otherCount = genreSongMap['other'] ? genreSongMap['other'].length : 0;
  
  triggerBroman('onLibraryLoad', { 
    trackCount: tracks.length, 
    genreCount: genreCount 
  });
  
  // Check for large "Other" bucket
  if (otherCount > 200) {
    setTimeout(() => {
      triggerBroman('onLargeOther', { trackCount: otherCount });
    }, 5000); // Show after 5 seconds
  }
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
  
  // Setup view toggle buttons
  const viewButtons = document.querySelectorAll('.view-btn');
  viewButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Remove active from all buttons
      viewButtons.forEach(b => b.classList.remove('active'));
      // Add active to clicked button
      e.target.classList.add('active');
      // Update view mode
      genreViewMode = e.target.getAttribute('data-view');
      renderGenreView();
    });
  });
}

function renderGenreView() {
  const grid = document.getElementById('genre-grid');
  
  if (genreViewMode === 'grouped') {
    renderGroupedView(grid);
  } else {
    renderFlatView(grid);
  }
}

function renderGroupedView(grid) {
  const familyMap = buildGenreFamilyMap(genreSongMap);
  
  const sortedFamilies = Object.entries(familyMap)
    .sort((a, b) => b[1].totalTracks - a[1].totalTracks);
  
  grid.innerHTML = sortedFamilies.map(([familyId, family]) => {
    const subgenresHTML = Object.entries(family.genres)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([genre, tracks]) => {
        const genreFamily = detectGenreFamily(genre);
        const isOther = genreFamily.id === 'other';
        const artistCount = getArtistCountForGenre(genre);
        const safeGenreId = genre.replace(/[^a-z0-9]/gi, '_');
        
        return `
          <div class="subgenre-item ${selectedGenres.has(genre) ? 'selected' : ''}" 
               data-genre="${genre}">
            <div class="subgenre-header">
              <span class="subgenre-name">${genre}</span>
              <span class="subgenre-count">${tracks.length} tracks • ${artistCount} artists</span>
              ${isOther ? `<button class="genre-map-btn-inline" onclick="showGenreMappingDialog('${genre}', event)" title="Map to family">Map</button>` : ''}
            </div>
            <button class="genre-expand-btn-inline" onclick="toggleGenreArtists('${genre}', event)">Show Artists ▼</button>
            <div class="genre-artists-list" id="genre-artists-${safeGenreId}"></div>
          </div>
        `;
      }).join('');
    
    return `
      <div class="genre-family-item" data-family-id="${familyId}"
           style="border-color: ${family.color}40">
        <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: ${family.color};"></div>
        <div class="genre-family-header">
          <div class="genre-family-name">${family.name}</div>
          <button class="genre-family-expand" onclick="toggleFamilyExpand('${familyId}', event)">
            ${Object.keys(family.genres).length} genres ▼
          </button>
        </div>
        <div class="genre-family-count">${family.totalTracks} tracks</div>
        <div class="genre-family-subgenres collapsed" id="family-${familyId}-subgenres">
          ${subgenresHTML}
        </div>
      </div>
    `;
  }).join('');
  
  // Add click handlers for subgenres
  grid.querySelectorAll('.subgenre-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't toggle if clicking buttons
      if (e.target.classList.contains('genre-map-btn-inline') || 
          e.target.classList.contains('genre-expand-btn-inline')) return;
      
      e.stopPropagation();
      const genre = item.getAttribute('data-genre');
      toggleGenreSelection(genre, item);
    });
  });
  
  // Add click handlers for family items (select all subgenres)
  grid.querySelectorAll('.genre-family-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('genre-family-expand')) return;
      const familyId = item.getAttribute('data-family-id');
      toggleFamilySelection(familyId, familyMap[familyId], item);
    });
  });
}


function renderFlatView(grid) {
  const sortedGenres = Object.entries(genreSongMap)
    .sort((a, b) => b[1].length - a[1].length);
  
  // Count unmapped genres
  const unmappedGenres = sortedGenres.filter(([genre]) => {
    const family = detectGenreFamily(genre);
    return family.id === 'other';
  });
  
  // Show/hide unmapped filter checkbox
  const unmappedFilterWrapper = document.getElementById('unmapped-filter-wrapper');
  const unmappedCount = document.getElementById('unmapped-count');
  
  if (unmappedGenres.length > 0) {
    unmappedFilterWrapper.classList.remove('hidden');
    unmappedCount.textContent = unmappedGenres.length;
  } else {
    unmappedFilterWrapper.classList.add('hidden');
  }
  
  grid.innerHTML = sortedGenres.map(([genre, tracks]) => {
    const artistCount = getArtistCountForGenre(genre);
    const safeGenreId = genre.replace(/[^a-z0-9]/gi, '_');
    const family = detectGenreFamily(genre);
    const isOther = family.id === 'other';
    
    return `
      <div class="genre-item ${selectedGenres.has(genre) ? 'selected' : ''} ${isOther ? 'unmapped-genre' : ''}" 
           data-genre="${genre}"
           data-unmapped="${isOther}">
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

function showOnlyUnmapped() {
  const genreItems = document.querySelectorAll('.genre-item');
  genreItems.forEach(item => {
    const isUnmapped = item.getAttribute('data-unmapped') === 'true';
    item.style.display = isUnmapped ? 'block' : 'none';
  });
}

function showAllGenres() {
  const genreItems = document.querySelectorAll('.genre-item');
  genreItems.forEach(item => {
    item.style.display = 'block';
  });
  
  // Clear unmapped filter input
  const unmappedFilter = document.getElementById('unmapped-filter');
  if (unmappedFilter) unmappedFilter.value = '';
}

function toggleFamilyExpand(familyId, event) {
  event.stopPropagation();
  const subgenresDiv = document.getElementById(`family-${familyId}-subgenres`);
  const button = event.target;
  const familyItem = button.closest('.genre-family-item');
  
  if (subgenresDiv.classList.contains('collapsed')) {
    subgenresDiv.classList.remove('collapsed');
    subgenresDiv.classList.add('expanded');
    familyItem.classList.add('expanded');
    button.textContent = button.textContent.replace('▼', '▲').replace(/\d+ genres/, 'Collapse');
  } else {
    subgenresDiv.classList.remove('expanded');
    subgenresDiv.classList.add('collapsed');
    familyItem.classList.remove('expanded');
    const count = subgenresDiv.querySelectorAll('.subgenre-item').length;
    button.textContent = `${count} genres ▼`;
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

function scrollToPlaylistControls() {
  const playlistControls = document.querySelector('.playlist-controls');
  if (playlistControls) {
    playlistControls.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center' 
    });
    
    // Flash the create button to draw attention
    const createBtn = document.getElementById('create-library-playlist');
    if (createBtn) {
      createBtn.style.animation = 'pulse 0.5s ease';
      setTimeout(() => {
        createBtn.style.animation = '';
      }, 500);
    }
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
  
  // Update visual state of subgenres
  element.querySelectorAll('.subgenre-item').forEach(subItem => {
    const genre = subItem.getAttribute('data-genre');
    if (selectedGenres.has(genre)) {
      subItem.classList.add('selected');
    } else {
      subItem.classList.remove('selected');
    }
  });
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
  
  // Update FAB count and visibility
  const fabCount = document.getElementById('fab-count');
  const fabButton = document.getElementById('floating-create-btn');
  
  if (fabCount) {
    fabCount.textContent = selectedGenres.size === 1 
      ? '1 genre' 
      : `${selectedGenres.size} genres`;
  }
  
  if (fabButton) {
    if (selectedGenres.size > 0) {
      fabButton.classList.remove('hidden');
    } else {
      fabButton.classList.add('hidden');
    }
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
  
  // Refresh playlist preview
  refreshPreview();
  
  // Update sticky bar
  updateStickyBar();
  
  // Broman triggers
  if (selectedGenres.size === 1 && !bromanState.shownTips.has('genreSelection')) {
    setTimeout(() => triggerBroman('onFirstGenreSelect'), 1000);
  } else if (selectedGenres.size === 3 && !bromanState.shownTips.has('previewFeature')) {
    setTimeout(() => triggerBroman('onGenreSelect'), 1500);
  } else if (selectedGenres.size >= 8 && !bromanState.shownTips.has('largeSelection')) {
    setTimeout(() => triggerBroman('onLargeSelection', { genreCount: selectedGenres.size }), 1000);
  }
}

// ===== GENRE FILTER =====

document.getElementById('genre-filter').addEventListener('input', (e) => {
  const filter = e.target.value.toLowerCase();
  
  if (genreViewMode === 'flat') {
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
  if (genreViewMode === 'flat') {
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

// Unmapped filter checkbox
document.getElementById('unmapped-filter').addEventListener('change', (e) => {
  if (e.target.checked) {
    showOnlyUnmapped();
  } else {
    showAllGenres();
  }
});

// ===== PLAYLIST BUILDER EVENT LISTENERS =====

// Duration slider
// Template selector
document.getElementById('template-selector').addEventListener('change', (e) => {
  const templateId = e.target.value;
  applyPlaylistTemplate(templateId);
});

// Duration slider
document.getElementById('duration-slider').addEventListener('input', (e) => {
  const seconds = parseInt(e.target.value);
  smartPlaylistSettings.targetDuration = seconds;
  updateDurationDisplay(seconds);
  refreshPreview();
  
  // Reset template selector to "custom" when manually adjusting
  document.getElementById('template-selector').value = 'custom';
});

// Diversity slider
document.getElementById('diversity-slider').addEventListener('input', (e) => {
  const value = parseInt(e.target.value);
  smartPlaylistSettings.maxTracksPerArtist = value;
  updateDiversityDisplay(value);
  refreshPreview();
  
  // Reset template selector to "custom" when manually adjusting
  document.getElementById('template-selector').value = 'custom';
});

// Avoid consecutive checkbox
document.getElementById('avoid-consecutive').addEventListener('change', (e) => {
  smartPlaylistSettings.avoidConsecutiveSameArtist = e.target.checked;
  refreshPreview();
  
  // Reset template selector to "custom" when manually adjusting
  document.getElementById('template-selector').value = 'custom';
});

// ===== AUDIO FEATURE FILTERS =====

// BPM Filter
document.getElementById('bpm-filter-enabled').addEventListener('change', (e) => {
  smartPlaylistSettings.bpmRange.enabled = e.target.checked;
  document.getElementById('bpm-filter-controls').classList.toggle('hidden', !e.target.checked);
  if (e.target.checked) enrichAndRefresh();
  else refreshPreview();
  document.getElementById('template-selector').value = 'custom';
});

document.getElementById('bpm-min-slider').addEventListener('input', (e) => {
  const min = parseInt(e.target.value);
  const max = parseInt(document.getElementById('bpm-max-slider').value);
  if (min > max) {
    document.getElementById('bpm-max-slider').value = min;
    smartPlaylistSettings.bpmRange.max = min;
  }
  smartPlaylistSettings.bpmRange.min = min;
  document.getElementById('bpm-display').textContent = `${min} - ${smartPlaylistSettings.bpmRange.max}`;
  refreshPreview();
});

document.getElementById('bpm-max-slider').addEventListener('input', (e) => {
  const max = parseInt(e.target.value);
  const min = parseInt(document.getElementById('bpm-min-slider').value);
  if (max < min) {
    document.getElementById('bpm-min-slider').value = max;
    smartPlaylistSettings.bpmRange.min = max;
  }
  smartPlaylistSettings.bpmRange.max = max;
  document.getElementById('bpm-display').textContent = `${smartPlaylistSettings.bpmRange.min} - ${max}`;
  refreshPreview();
});

// Energy Filter
document.getElementById('energy-filter-enabled').addEventListener('change', (e) => {
  smartPlaylistSettings.energyRange.enabled = e.target.checked;
  document.getElementById('energy-filter-controls').classList.toggle('hidden', !e.target.checked);
  if (e.target.checked) enrichAndRefresh();
  else refreshPreview();
  document.getElementById('template-selector').value = 'custom';
});

document.getElementById('energy-min-slider').addEventListener('input', (e) => {
  const min = parseInt(e.target.value);
  const max = parseInt(document.getElementById('energy-max-slider').value);
  if (min > max) {
    document.getElementById('energy-max-slider').value = min;
    smartPlaylistSettings.energyRange.max = min;
  }
  smartPlaylistSettings.energyRange.min = min;
  updateEnergyDisplay(min, smartPlaylistSettings.energyRange.max);
  refreshPreview();
});

document.getElementById('energy-max-slider').addEventListener('input', (e) => {
  const max = parseInt(e.target.value);
  const min = parseInt(document.getElementById('energy-min-slider').value);
  if (max < min) {
    document.getElementById('energy-min-slider').value = max;
    smartPlaylistSettings.energyRange.min = max;
  }
  smartPlaylistSettings.energyRange.max = max;
  updateEnergyDisplay(smartPlaylistSettings.energyRange.min, max);
  refreshPreview();
});

// Mood Filter
document.getElementById('mood-filter-enabled').addEventListener('change', (e) => {
  smartPlaylistSettings.moodRange.enabled = e.target.checked;
  document.getElementById('mood-filter-controls').classList.toggle('hidden', !e.target.checked);
  if (e.target.checked) enrichAndRefresh();
  else refreshPreview();
  document.getElementById('template-selector').value = 'custom';
});

document.getElementById('mood-min-slider').addEventListener('input', (e) => {
  const min = parseInt(e.target.value);
  const max = parseInt(document.getElementById('mood-max-slider').value);
  if (min > max) {
    document.getElementById('mood-max-slider').value = min;
    smartPlaylistSettings.moodRange.max = min;
  }
  smartPlaylistSettings.moodRange.min = min;
  updateMoodDisplay(min, smartPlaylistSettings.moodRange.max);
  refreshPreview();
});

document.getElementById('mood-max-slider').addEventListener('input', (e) => {
  const max = parseInt(e.target.value);
  const min = parseInt(document.getElementById('mood-min-slider').value);
  if (max < min) {
    document.getElementById('mood-min-slider').value = max;
    smartPlaylistSettings.moodRange.min = max;
  }
  smartPlaylistSettings.moodRange.max = max;
  updateMoodDisplay(smartPlaylistSettings.moodRange.min, max);
  refreshPreview();
});

// Helper function to enrich tracks and refresh
async function enrichAndRefresh() {
  const allTracks = getAllSelectedTracks();
  if (allTracks.length > 0 && !allTracks[0].audioFeatures) {
    const enriched = await enrichTracksWithAudioFeatures(allTracks);
    // Update tracks in genreSongMap
    Object.keys(genreSongMap).forEach(genre => {
      genreSongMap[genre] = genreSongMap[genre].map(track => {
        const enrichedTrack = enriched.find(t => t.id === track.id);
        return enrichedTrack || track;
      });
    });
  }
  refreshPreview();
}

function updateEnergyDisplay(min, max) {
  let display = '';
  if (min === 0 && max === 100) {
    display = 'Low → High';
  } else if (min === 0) {
    display = `Low → ${max}`;
  } else if (max === 100) {
    display = `${min} → High`;
  } else {
    display = `${min} - ${max}`;
  }
  document.getElementById('energy-display').textContent = display;
}

function updateMoodDisplay(min, max) {
  let display = '';
  if (min === 0 && max === 100) {
    display = 'All moods';
  } else if (min === 0 && max < 50) {
    display = 'Sad/Melancholic';
  } else if (min > 50 && max === 100) {
    display = 'Happy/Upbeat';
  } else if (min < 30 && max < 50) {
    display = 'Very sad';
  } else if (min > 70 && max > 90) {
    display = 'Very happy';
  } else {
    display = `${min} - ${max}`;
  }
  document.getElementById('mood-display').textContent = display;
}

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

// ===== STICKY CONTROL BAR =====

function updateStickyBar() {
  const stickyBar = document.getElementById('sticky-playlist-bar');
  if (!stickyBar) return;
  
  // Show/hide based on selection
  if (selectedGenres.size > 0) {
    stickyBar.classList.remove('hidden');
    
    // Update genre count
    const genreCountEl = document.getElementById('sticky-genre-count');
    if (genreCountEl) {
      genreCountEl.textContent = selectedGenres.size === 1 
        ? '1 genre selected' 
        : `${selectedGenres.size} genres selected`;
    }
    
    // Update stats
    const allTracks = getAllSelectedTracks();
    const stats = calculatePlaylistStats(allTracks);
    const statsEl = document.getElementById('sticky-bar-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <span class="stat-item">${stats.totalTracks} tracks</span>
        <span class="stat-separator">•</span>
        <span class="stat-item">${stats.durationFormatted}</span>
        <span class="stat-separator">•</span>
        <span class="stat-item">${stats.uniqueArtists} artists</span>
      `;
    }
    
    // Show bar when scrolled past genres
    window.addEventListener('scroll', checkStickyBarVisibility);
    checkStickyBarVisibility();
  } else {
    stickyBar.classList.add('hidden');
    window.removeEventListener('scroll', checkStickyBarVisibility);
  }
}

function checkStickyBarVisibility() {
  const stickyBar = document.getElementById('sticky-playlist-bar');
  const genreGrid = document.getElementById('genre-grid');
  const builder = document.getElementById('playlist-builder');
  
  if (!stickyBar || !genreGrid) return;
  
  const genreGridBottom = genreGrid.getBoundingClientRect().bottom;
  const builderTop = builder ? builder.getBoundingClientRect().top : 9999;
  
  // Show when scrolled past genre grid but not yet at builder
  if (genreGridBottom < 100 && builderTop > window.innerHeight / 2) {
    stickyBar.classList.add('visible');
  } else {
    stickyBar.classList.remove('visible');
  }
}

function scrollToPreview() {
  const preview = document.getElementById('preview-section');
  if (preview) {
    preview.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function scrollToBuilder() {
  const builder = document.getElementById('playlist-builder');
  if (builder) {
    builder.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ===== BROMAN HELPER SYSTEM =====

const bromanTips = {
  // First-time welcome
  welcome: {
    id: 'welcome',
    text: "Hey there! 👋 I'm Broman, your playlist guide. I'll help you discover cool features as you go!",
    actions: [
      { text: "Show me around!", action: () => startTour() },
      { text: "I'll explore myself", action: () => dismissBroman() }
    ],
    trigger: 'onFirstVisit',
    priority: 10
  },
  
  // After loading library
  libraryLoaded: {
    id: 'libraryLoaded',
    text: "Nice! You've got ${trackCount} tracks organized into ${genreCount} genres. Ready to make some playlists?",
    actions: [
      { text: "Let's do it!", action: () => dismissBroman() },
      { text: "Tell me more", action: () => showTip('genreSelection') }
    ],
    trigger: 'onLibraryLoad',
    priority: 9
  },
  
  // Genre selection
  genreSelection: {
    id: 'genreSelection',
    text: "Click on genres to select them. You can select as many as you want - the smart mixer will create one perfect playlist!",
    actions: [
      { text: "Got it!", action: () => dismissBroman() }
    ],
    trigger: 'onFirstGenreSelect',
    priority: 8
  },
  
  // Preview feature
  previewFeature: {
    id: 'previewFeature',
    text: "Check out the preview panel! 📊 You can see exactly what you're creating before hitting that button.",
    actions: [
      { text: "Cool!", action: () => dismissBroman() },
      { text: "Show me advanced settings", action: () => { toggleAdvancedSettings(); dismissBroman(); } }
    ],
    trigger: 'onGenreSelect',
    priority: 7
  },
  
  // Large selection
  largeSelection: {
    id: 'largeSelection',
    text: "Whoa! ${genreCount} genres selected. The smart mixer will balance all of these perfectly. Want to adjust the duration?",
    actions: [
      { text: "Let's adjust", action: () => { document.getElementById('duration-slider').focus(); dismissBroman(); } },
      { text: "Looks good!", action: () => dismissBroman() }
    ],
    trigger: 'onLargeSelection',
    priority: 6
  },
  
  // Large "Other" bucket
  largeOther: {
    id: 'largeOther',
    text: "Your 'Other' bucket has ${trackCount} tracks! Want help mapping unmapped genres? Click the filter to see them.",
    actions: [
      { text: "Show unmapped", action: () => { document.getElementById('unmapped-filter').checked = true; document.getElementById('unmapped-filter').dispatchEvent(new Event('change')); dismissBroman(); } },
      { text: "Later", action: () => dismissBroman() }
    ],
    trigger: 'onLargeOther',
    priority: 8
  },
  
  // Advanced settings
  advancedSettings: {
    id: 'advancedSettings',
    text: "Pro tip: The diversity slider controls how many tracks per artist. Set it to 1 for maximum variety!",
    actions: [
      { text: "Nice!", action: () => dismissBroman() }
    ],
    trigger: 'onAdvancedOpen',
    priority: 5
  },
  
  // Artist exclusion
  artistExclusion: {
    id: 'artistExclusion',
    text: "You can exclude specific artists from genres! Right-click (or long-press on mobile) on any artist in the genre list.",
    actions: [
      { text: "Good to know!", action: () => dismissBroman() }
    ],
    trigger: 'onArtistExclude',
    priority: 6
  },
  
  // Created first playlist
  firstPlaylist: {
    id: 'firstPlaylist',
    text: "🎉 Awesome! Your playlist is live in Spotify. Notice how the artists are nicely distributed? That's the smart mixer at work!",
    actions: [
      { text: "Love it!", action: () => dismissBroman() },
      { text: "Make another", action: () => { document.getElementById('clear-genres').click(); dismissBroman(); } }
    ],
    trigger: 'onFirstPlaylist',
    priority: 9
  },
  
  // Artist discovery
  artistDiscovery: {
    id: 'artistDiscovery',
    text: "Want to discover similar artists from your library? Try the Artist Discovery tab! 🔍",
    actions: [
      { text: "Show me!", action: () => { switchTab('artist'); dismissBroman(); } },
      { text: "Maybe later", action: () => dismissBroman() }
    ],
    trigger: 'onSecondPlaylist',
    priority: 5
  }
};

// Initialize Broman from localStorage
function initBroman() {
  // Load state
  loadBromanState();
  
  // Initialize UI
  updateBromanUI();
  
  // Set initial comment
  const comments = bromanState.comments;
  const commentEl = document.getElementById('broman-comment');
  if (commentEl) {
    const pTag = commentEl.querySelector('p');
    if (pTag) {
      pTag.textContent = `"${comments[bromanState.currentComment]}"`;
    }
  }
  
  // Apply collapsed state
  if (bromanState.collapsed) {
    document.getElementById('broman-sidebar')?.classList.add('collapsed');
    document.getElementById('broman-tab')?.classList.remove('hidden');
  }
}

// Old save function removed - using new one from above

// Show Broman tip
function showBromanTip(tipId, context = {}) {
  if (!bromanState.enabled || bromanState.dismissed) return;
  if (bromanState.shownTips.has(tipId)) return;
  
  const tip = bromanTips[tipId];
  if (!tip) return;
  
  bromanState.currentTip = tipId;
  bromanState.shownTips.add(tipId);
  saveBromanState();
  
  // Replace template variables
  let text = tip.text;
  Object.keys(context).forEach(key => {
    text = text.replace(`\${${key}}`, context[key]);
  });
  
  // Update Broman UI
  const bromanEl = document.getElementById('broman-helper');
  const contentEl = document.getElementById('broman-content');
  const actionsEl = document.getElementById('broman-actions');
  
  contentEl.innerHTML = `<p class="broman-text">${text}</p>`;
  
  // Add action buttons
  actionsEl.innerHTML = '';
  if (tip.actions && tip.actions.length > 0) {
    tip.actions.forEach(action => {
      const btn = document.createElement('button');
      btn.className = 'broman-action-btn';
      btn.textContent = action.text;
      btn.onclick = action.action;
      actionsEl.appendChild(btn);
    });
  }
  
  // Show Broman
  bromanEl.classList.remove('hidden');
  setTimeout(() => bromanEl.classList.add('visible'), 10);
  
  // Add animation
  const avatarEl = document.getElementById('broman-avatar');
  avatarEl.classList.add('bounce');
  setTimeout(() => avatarEl.classList.remove('bounce'), 600);
}

// Dismiss Broman
function dismissBroman(permanent = false) {
  const dontShow = document.getElementById('broman-dont-show');
  
  if (dontShow && dontShow.checked) {
    bromanState.enabled = false;
    saveBromanState();
  }
  
  if (permanent) {
    bromanState.dismissed = true;
    saveBromanState();
  }
  
  const bromanEl = document.getElementById('broman-helper');
  bromanEl.classList.remove('visible');
  setTimeout(() => bromanEl.classList.add('hidden'), 300);
  
  bromanState.currentTip = null;
}

// Trigger Broman based on event
function triggerBroman(event, context = {}) {
  if (!bromanState.enabled) return;
  
  // Track user interactions
  bromanState.userInteractions++;
  
  // Find matching tips
  const matchingTips = Object.values(bromanTips)
    .filter(tip => tip.trigger === event)
    .sort((a, b) => b.priority - a.priority);
  
  // Show first unshown tip
  for (const tip of matchingTips) {
    if (!bromanState.shownTips.has(tip.id)) {
      showBromanTip(tip.id, context);
      break;
    }
  }
}

// Helper to switch tabs
function switchTab(tabName) {
  const tabs = ['library', 'artist'];
  tabs.forEach(tab => {
    const btn = document.querySelector(`button[onclick*="${tab}-tab"]`);
    const content = document.getElementById(`${tab}-tab`);
    if (tab === tabName) {
      btn?.classList.add('active');
      content?.classList.add('active');
    } else {
      btn?.classList.remove('active');
      content?.classList.remove('active');
    }
  });
}

// Start tour
function startTour() {
  dismissBroman();
  const helpBtn = document.getElementById('help-button');
  if (helpBtn) {
    helpBtn.click();
  }
}

// ===== QUICK SEARCH SYSTEM =====

let searchFilter = 'all';
let searchResults = [];
let selectedSearchIndex = 0;

// Open quick search panel
function openQuickSearch() {
  const panel = document.getElementById('quick-search-panel');
  const input = document.getElementById('quick-search-input');
  
  panel.classList.remove('hidden');
  setTimeout(() => {
    panel.classList.add('visible');
    input.focus();
  }, 10);
  
  // Load recent searches
  loadRecentSearches();
  
  searchPanelOpen = true;
}

// Close quick search panel
function closeQuickSearch() {
  const panel = document.getElementById('quick-search-panel');
  panel.classList.remove('visible');
  setTimeout(() => panel.classList.add('hidden'), 300);
  
  // Clear search
  document.getElementById('quick-search-input').value = '';
  document.getElementById('quick-search-results').innerHTML = `
    <div class="search-placeholder">
      <div class="placeholder-icon">🎵</div>
      <div class="placeholder-text">Start typing to search your library</div>
      <div class="placeholder-hint">Press <kbd>Esc</kbd> to close</div>
    </div>
  `;
  
  searchPanelOpen = false;
}

// Keyboard shortcut: Ctrl/Cmd+K
document.addEventListener('keydown', (e) => {
  // Ctrl+K or Cmd+K
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (searchPanelOpen) {
      closeQuickSearch();
    } else {
      openQuickSearch();
    }
  }
  
  // Escape to close
  if (e.key === 'Escape' && searchPanelOpen) {
    closeQuickSearch();
  }
  
  // Arrow navigation in search results
  if (searchPanelOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    navigateSearchResults(e.key === 'ArrowDown' ? 1 : -1);
  }
  
  // Enter to select
  if (searchPanelOpen && e.key === 'Enter') {
    e.preventDefault();
    selectSearchResult(selectedSearchIndex);
  }
});

// Search input handler
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('quick-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      performQuickSearch(e.target.value);
    });
  }
  
  // Filter chips
  const filterChips = document.querySelectorAll('.filter-chip');
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      searchFilter = chip.dataset.filter;
      performQuickSearch(document.getElementById('quick-search-input').value);
    });
  });
});

// Perform search
function performQuickSearch(query) {
  if (!query || query.length < 2) {
    showRecentSearches();
    return;
  }
  
  const lowerQuery = query.toLowerCase();
  searchResults = [];
  
  // Get all tracks from library
  const allTracks = [];
  Object.values(genreSongMap).forEach(tracks => {
    tracks.forEach(track => {
      if (!allTracks.find(t => t.uri === track.uri)) {
        allTracks.push(track);
      }
    });
  });
  
  // Search tracks
  if (searchFilter === 'all' || searchFilter === 'tracks') {
    allTracks.forEach(track => {
      const trackName = track.name.toLowerCase();
      const artistName = track.artists[0]?.name.toLowerCase() || '';
      
      if (trackName.includes(lowerQuery) || artistName.includes(lowerQuery)) {
        searchResults.push({
          type: 'track',
          track: track,
          relevance: trackName.startsWith(lowerQuery) ? 2 : 1
        });
      }
    });
  }
  
  // Search artists
  if (searchFilter === 'all' || searchFilter === 'artists') {
    const artistMap = new Map();
    allTracks.forEach(track => {
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
    
    artistMap.forEach(artist => {
      if (artist.name.toLowerCase().includes(lowerQuery)) {
        searchResults.push({
          type: 'artist',
          artist: artist,
          relevance: artist.name.toLowerCase().startsWith(lowerQuery) ? 2 : 1
        });
      }
    });
  }
  
  // Search genres
  if (searchFilter === 'all' || searchFilter === 'genres') {
    Object.keys(genreSongMap).forEach(genre => {
      if (genre.toLowerCase().includes(lowerQuery)) {
        searchResults.push({
          type: 'genre',
          genre: genre,
          trackCount: genreSongMap[genre].length,
          relevance: genre.toLowerCase().startsWith(lowerQuery) ? 2 : 1
        });
      }
    });
  }
  
  // Sort by relevance
  searchResults.sort((a, b) => b.relevance - a.relevance);
  
  // Limit results
  searchResults = searchResults.slice(0, 50);
  
  renderSearchResults();
}

// Render search results
function renderSearchResults() {
  const resultsEl = document.getElementById('quick-search-results');
  
  if (searchResults.length === 0) {
    resultsEl.innerHTML = `
      <div class="search-placeholder">
        <div class="placeholder-icon">🔍</div>
        <div class="placeholder-text">No results found</div>
      </div>
    `;
    return;
  }
  
  const html = searchResults.map((result, index) => {
    const isSelected = index === selectedSearchIndex;
    
    if (result.type === 'track') {
      const track = result.track;
      const duration = formatDuration(track.duration_ms);
      return `
        <div class="search-result-item ${isSelected ? 'selected' : ''}" data-index="${index}">
          <div class="result-icon">🎵</div>
          <div class="result-info">
            <div class="result-title">${escapeHtml(track.name)}</div>
            <div class="result-subtitle">${escapeHtml(track.artists[0]?.name || 'Unknown')}</div>
          </div>
          <div class="result-meta">${duration}</div>
          <button class="result-action" onclick="event.stopPropagation(); addTrackToPlaylist('${track.uri}')">
            + Add
          </button>
        </div>
      `;
    } else if (result.type === 'artist') {
      const artist = result.artist;
      return `
        <div class="search-result-item ${isSelected ? 'selected' : ''}" data-index="${index}">
          <div class="result-icon">👤</div>
          <div class="result-info">
            <div class="result-title">${escapeHtml(artist.name)}</div>
            <div class="result-subtitle">${artist.tracks.length} tracks in library</div>
          </div>
          <button class="result-action" onclick="event.stopPropagation(); addArtistToPlaylist('${artist.id}')">
            + Add All
          </button>
        </div>
      `;
    } else if (result.type === 'genre') {
      return `
        <div class="search-result-item ${isSelected ? 'selected' : ''}" data-index="${index}">
          <div class="result-icon">🎭</div>
          <div class="result-info">
            <div class="result-title">${escapeHtml(result.genre)}</div>
            <div class="result-subtitle">${result.trackCount} tracks</div>
          </div>
          <button class="result-action" onclick="event.stopPropagation(); selectGenre('${result.genre}')">
            Select
          </button>
        </div>
      `;
    }
  }).join('');
  
  resultsEl.innerHTML = html;
  
  // Add click handlers
  resultsEl.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      selectSearchResult(parseInt(item.dataset.index));
    });
  });
}

// Navigate search results with keyboard
function navigateSearchResults(direction) {
  selectedSearchIndex += direction;
  
  if (selectedSearchIndex < 0) {
    selectedSearchIndex = searchResults.length - 1;
  } else if (selectedSearchIndex >= searchResults.length) {
    selectedSearchIndex = 0;
  }
  
  renderSearchResults();
  
  // Scroll selected item into view
  const selectedEl = document.querySelector('.search-result-item.selected');
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Select search result
function selectSearchResult(index) {
  if (index < 0 || index >= searchResults.length) return;
  
  const result = searchResults[index];
  
  if (result.type === 'track') {
    addTrackToPlaylist(result.track.uri);
  } else if (result.type === 'artist') {
    addArtistToPlaylist(result.artist.id);
  } else if (result.type === 'genre') {
    selectGenre(result.genre);
  }
}

// Add track to manual selection
function addTrackToPlaylist(uri) {
  manuallyAddedTracks.add(uri);
  saveRecentSearch('track', uri);
  updateStatus('Track added to playlist selection');
  
  // Show success feedback
  showNotification('✅ Track added');
  
  // Trigger Broman if first manual add
  if (manuallyAddedTracks.size === 1) {
    setTimeout(() => triggerBroman('search_tip'), 1000);
  }
}

// Add all artist tracks to manual selection
function addArtistToPlaylist(artistId) {
  let addedCount = 0;
  
  Object.values(genreSongMap).forEach(tracks => {
    tracks.forEach(track => {
      if (track.artists[0]?.id === artistId) {
        manuallyAddedTracks.add(track.uri);
        addedCount++;
      }
    });
  });
  
  saveRecentSearch('artist', artistId);
  updateStatus(`${addedCount} tracks added to playlist selection`);
  showNotification(`✅ ${addedCount} tracks added`);
}

// Select genre from search
function selectGenre(genre) {
  if (selectedGenres.has(genre)) {
    selectedGenres.delete(genre);
  } else {
    selectedGenres.add(genre);
  }
  
  updateSelectedCount();
  renderGenreView();
  closeQuickSearch();
  
  showNotification(`✅ ${genre} ${selectedGenres.has(genre) ? 'selected' : 'deselected'}`);
}

// Show notification toast
function showNotification(message) {
  // Remove existing notification
  const existing = document.querySelector('.notification-toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = 'notification-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('visible'), 10);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// Recent searches
function loadRecentSearches() {
  try {
    const saved = localStorage.getItem('recentSearches');
    if (saved) {
      recentSearches = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load recent searches');
  }
}

function saveRecentSearch(type, value) {
  const search = { type, value, timestamp: Date.now() };
  recentSearches = recentSearches.filter(s => !(s.type === type && s.value === value));
  recentSearches.unshift(search);
  recentSearches = recentSearches.slice(0, 10); // Keep last 10
  
  try {
    localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
  } catch (e) {
    console.error('Failed to save recent searches');
  }
}

function showRecentSearches() {
  const resultsEl = document.getElementById('quick-search-results');
  
  if (recentSearches.length === 0) {
    resultsEl.innerHTML = `
      <div class="search-placeholder">
        <div class="placeholder-icon">🎵</div>
        <div class="placeholder-text">Start typing to search your library</div>
        <div class="placeholder-hint">Press <kbd>Esc</kbd> to close</div>
      </div>
    `;
    return;
  }
  
  const html = `
    <div class="recent-searches-header">Recent Searches</div>
    ${recentSearches.map(search => `
      <div class="search-result-item" onclick="performRecentSearch('${search.type}', '${search.value}')">
        <div class="result-icon">🕐</div>
        <div class="result-info">
          <div class="result-title">${search.type}</div>
          <div class="result-subtitle">${search.value}</div>
        </div>
      </div>
    `).join('')}
  `;
  
  resultsEl.innerHTML = html;
}

function performRecentSearch(type, value) {
  // Implement recent search selection
  if (type === 'genre') {
    selectGenre(value);
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== PLAYLIST BUILDER UI CONTROLS =====

function toggleAdvancedSettings() {
  const advanced = document.getElementById('advanced-settings');
  const wasHidden = advanced.classList.contains('hidden');
  advanced.classList.toggle('hidden');
  
  // Trigger Broman on first open
  if (wasHidden && !bromanState.shownTips.has('advancedSettings')) {
    setTimeout(() => triggerBroman('onAdvancedOpen'), 500);
  }
}

function setDuration(seconds) {
  smartPlaylistSettings.targetDuration = seconds;
  document.getElementById('duration-slider').value = seconds;
  updateDurationDisplay(seconds);
  refreshPreview();
  
  // Update active preset button
  document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
}

function applyPlaylistTemplate(templateId) {
  const template = playlistTemplates[templateId];
  if (!template) return;
  
  // Apply template settings
  smartPlaylistSettings.targetDuration = template.targetDuration;
  smartPlaylistSettings.maxTracksPerArtist = template.maxTracksPerArtist;
  smartPlaylistSettings.avoidConsecutiveSameArtist = template.avoidConsecutiveSameArtist;
  
  // Update UI elements
  document.getElementById('duration-slider').value = template.targetDuration;
  updateDurationDisplay(template.targetDuration);
  
  document.getElementById('diversity-slider').value = template.maxTracksPerArtist;
  updateDiversityDisplay(template.maxTracksPerArtist);
  
  document.getElementById('avoid-consecutive').checked = template.avoidConsecutiveSameArtist;
  
  // Update preset buttons (remove all active states)
  document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
  
  // Refresh preview with new settings
  refreshPreview();
  
  // Show a subtle notification if not custom
  if (templateId !== 'custom') {
    showStatus(`Applied template: ${template.name}`, 'success');
  }
}

function updateDurationDisplay(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  let display = '';
  if (hours > 0) display += `${hours}h `;
  display += `${minutes}m`;
  
  document.getElementById('duration-display').textContent = display;
}

function updateDiversityDisplay(value) {
  const messages = {
    1: 'Max 1 track per artist',
    2: 'Max 2 tracks per artist',
    3: 'Max 3 tracks per artist',
    4: 'Max 4 tracks per artist',
    5: 'Max 5 tracks per artist',
    6: 'Max 6 tracks per artist',
    7: 'Max 7 tracks per artist',
    8: 'Max 8 tracks per artist',
    9: 'Max 9 tracks per artist',
    10: 'Max 10 tracks per artist'
  };
  
  document.getElementById('diversity-display').textContent = messages[value] || `Max ${value} tracks per artist`;
}

function refreshPreview() {
  if (selectedGenres.size === 0) return;
  
  // Get all tracks
  const allTracks = getAllSelectedTracks();
  
  // Apply smart selection
  const selectedTracks = selectSmartTracks(allTracks, smartPlaylistSettings);
  const stats = calculatePlaylistStats(selectedTracks);
  
  // Update preview stats
  document.getElementById('preview-tracks').textContent = stats.totalTracks;
  document.getElementById('preview-duration').textContent = stats.durationFormatted;
  document.getElementById('preview-artists').textContent = stats.uniqueArtists;
  document.getElementById('preview-avg').textContent = stats.avgTracksPerArtist;
  
  // Store selected tracks for preview list
  window.currentPreviewTracks = selectedTracks;
}

function togglePreviewList() {
  const list = document.getElementById('preview-tracks-list');
  const toggleText = document.getElementById('preview-toggle-text');
  
  if (list.classList.contains('hidden')) {
    // Show list
    renderPreviewTrackList();
    list.classList.remove('hidden');
    toggleText.textContent = 'Hide Track List ▲';
  } else {
    // Hide list
    list.classList.add('hidden');
    toggleText.textContent = 'Show Track List ▼';
  }
}

function renderPreviewTrackList() {
  const list = document.getElementById('preview-tracks-list');
  const tracks = window.currentPreviewTracks || [];
  
  if (tracks.length === 0) {
    list.innerHTML = '<p style="color: #7f7f7f; text-align: center; padding: 20px;">No tracks to preview</p>';
    return;
  }
  
  // Show first 20 tracks
  const displayTracks = tracks.slice(0, 20);
  
  const html = displayTracks.map((track, index) => {
    const artistName = track.artists[0].name;
    const trackName = track.name;
    const duration = formatDuration(track.duration_ms);
    
    return `
      <div class="preview-track-item">
        <span class="track-number">${index + 1}</span>
        <div class="track-info">
          <div class="track-name">${trackName}</div>
          <div class="track-artist">${artistName}</div>
        </div>
        <span class="track-duration">${duration}</span>
      </div>
    `;
  }).join('');
  
  list.innerHTML = html;
  
  if (tracks.length > 20) {
    list.innerHTML += `<p style="color: #7f7f7f; text-align: center; padding: 10px; font-size: 12px;">... and ${tracks.length - 20} more tracks</p>`;
  }
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ===== SMART PLAYLIST CREATION ALGORITHMS =====

/**
 * Smart track selection with artist diversity and duration control
 */
function selectSmartTracks(allTracks, settings) {
  const {
    targetDuration = 7200, // 2 hours default
    maxTracksPerArtist = 3,
    avoidConsecutiveSameArtist = true,
    bpmRange = { min: 0, max: 200, enabled: false },
    energyRange = { min: 0, max: 100, enabled: false },
    moodRange = { min: 0, max: 100, enabled: false }
  } = settings;
  
  // Apply audio feature filters if enabled
  let filteredTracks = allTracks;
  
  if (bpmRange.enabled && filteredTracks.some(t => t.audioFeatures)) {
    filteredTracks = filteredTracks.filter(track => {
      if (!track.audioFeatures || !track.audioFeatures.tempo) return false;
      return track.audioFeatures.tempo >= bpmRange.min && track.audioFeatures.tempo <= bpmRange.max;
    });
  }
  
  if (energyRange.enabled && filteredTracks.some(t => t.audioFeatures)) {
    filteredTracks = filteredTracks.filter(track => {
      if (!track.audioFeatures || track.audioFeatures.energy === undefined) return false;
      return track.audioFeatures.energy >= energyRange.min && track.audioFeatures.energy <= energyRange.max;
    });
  }
  
  if (moodRange.enabled && filteredTracks.some(t => t.audioFeatures)) {
    filteredTracks = filteredTracks.filter(track => {
      if (!track.audioFeatures || track.audioFeatures.valence === undefined) return false;
      return track.audioFeatures.valence >= moodRange.min && track.audioFeatures.valence <= moodRange.max;
    });
  }
  
  // If filtering removed too many tracks, show warning
  if (filteredTracks.length < allTracks.length * 0.1) {
    console.warn('Audio filters too restrictive - very few tracks match');
  }
  
  // If no tracks match filters, use original set
  if (filteredTracks.length === 0) {
    filteredTracks = allTracks;
  }
  
  // Calculate average track duration from sample
  const sampleSize = Math.min(100, filteredTracks.length);
  const avgDuration = filteredTracks
    .slice(0, sampleSize)
    .reduce((sum, t) => sum + (t.duration_ms || 0), 0) / sampleSize;
  
  const targetDurationMs = targetDuration * 1000;
  const estimatedTrackCount = Math.floor(targetDurationMs / avgDuration);
  
  // Group tracks by artist
  const tracksByArtist = {};
  filteredTracks.forEach(track => {
    const artistId = track.artists && track.artists[0] ? track.artists[0].id : 'unknown';
    if (!tracksByArtist[artistId]) {
      tracksByArtist[artistId] = [];
    }
    tracksByArtist[artistId].push(track);
  });
  
  const artistIds = Object.keys(tracksByArtist);
  
  // If we have few artists, adjust max tracks per artist
  const adjustedMaxPerArtist = Math.max(
    maxTracksPerArtist,
    Math.ceil(estimatedTrackCount / artistIds.length)
  );
  
  // Round-robin selection to ensure artist diversity
  const selected = [];
  const artistUsageCount = {};
  let totalDuration = 0;
  let rounds = 0;
  const maxRounds = 100; // Safety limit
  
  while (totalDuration < targetDurationMs && rounds < maxRounds) {
    let addedInRound = false;
    
    // Shuffle artist order each round for variety
    const shuffledArtists = [...artistIds].sort(() => Math.random() - 0.5);
    
    for (const artistId of shuffledArtists) {
      if (totalDuration >= targetDurationMs) break;
      
      const usageCount = artistUsageCount[artistId] || 0;
      if (usageCount >= adjustedMaxPerArtist) continue;
      
      const availableTracks = tracksByArtist[artistId].filter(
        t => !selected.includes(t)
      );
      
      if (availableTracks.length === 0) continue;
      
      // Pick random track from this artist
      const track = availableTracks[Math.floor(Math.random() * availableTracks.length)];
      selected.push(track);
      totalDuration += track.duration_ms || avgDuration;
      artistUsageCount[artistId] = (artistUsageCount[artistId] || 0) + 1;
      addedInRound = true;
    }
    
    if (!addedInRound) break; // No more tracks to add
    rounds++;
  }
  
  // Shuffle but avoid consecutive same artist if enabled
  if (avoidConsecutiveSameArtist) {
    return shuffleWithArtistSeparation(selected);
  } else {
    return shuffleArray(selected);
  }
}

/**
 * Shuffle tracks while avoiding consecutive tracks from same artist
 */
function shuffleWithArtistSeparation(tracks) {
  if (tracks.length <= 1) return tracks;
  
  const shuffled = [];
  const remaining = [...tracks];
  
  // Start with random track
  const firstIndex = Math.floor(Math.random() * remaining.length);
  shuffled.push(remaining[firstIndex]);
  remaining.splice(firstIndex, 1);
  
  while (remaining.length > 0) {
    const lastArtist = shuffled[shuffled.length - 1].artists[0].id;
    
    // Find tracks from different artists
    const differentArtists = remaining.filter(
      t => t.artists[0].id !== lastArtist
    );
    
    if (differentArtists.length > 0) {
      // Pick random track from different artist
      const nextIndex = Math.floor(Math.random() * differentArtists.length);
      const nextTrack = differentArtists[nextIndex];
      shuffled.push(nextTrack);
      remaining.splice(remaining.indexOf(nextTrack), 1);
    } else {
      // No choice but to use same artist
      const nextTrack = remaining[0];
      shuffled.push(nextTrack);
      remaining.splice(0, 1);
    }
  }
  
  return shuffled;
}

/**
 * Simple array shuffle (Fisher-Yates)
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get all tracks from selected genres with exclusions applied
 */
function getAllSelectedTracks() {
  const allTracks = [];
  selectedGenres.forEach(genre => {
    const filteredTracks = getFilteredTracksForGenre(genre);
    filteredTracks.forEach(track => {
      // Avoid duplicates
      if (!allTracks.find(t => t.uri === track.uri)) {
        allTracks.push(track);
      }
    });
  });
  return allTracks;
}

/**
 * Calculate playlist stats
 */
function calculatePlaylistStats(tracks) {
  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration_ms || 0), 0);
  const hours = Math.floor(totalDuration / (1000 * 60 * 60));
  const minutes = Math.floor((totalDuration % (1000 * 60 * 60)) / (1000 * 60));
  
  const artistCounts = {};
  tracks.forEach(track => {
    const artistName = track.artists[0].name;
    artistCounts[artistName] = (artistCounts[artistName] || 0) + 1;
  });
  
  const uniqueArtists = Object.keys(artistCounts).length;
  const avgTracksPerArtist = (tracks.length / uniqueArtists).toFixed(1);
  
  return {
    totalTracks: tracks.length,
    totalDuration,
    durationFormatted: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
    uniqueArtists,
    avgTracksPerArtist,
    artistCounts
  };
}

async function createMergedPlaylist() {
  updateStatus('Creating smart playlist...');
  
  try {
    // Get all tracks from selected genres
    const allTracks = getAllSelectedTracks();
    
    // Apply smart selection
    const selectedTracks = selectSmartTracks(allTracks, smartPlaylistSettings);
    const trackUris = selectedTracks.map(t => t.uri);
    
    const stats = calculatePlaylistStats(selectedTracks);
    
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
        description: `${Array.from(selectedGenres).join(', ')} • ${stats.uniqueArtists} artists • ${stats.durationFormatted} • Created by Playlist Alchemist`,
        public: false
      })
    });
    const playlist = await createResp.json();
    
    // Add tracks in batches
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
      name: playlistName,
      external_urls: { spotify: playlist.external_urls.spotify }
    }, selectedTracks);
    
    // Update Broman history display
    updateBromanHistory();
    
    // Create clickable Spotify link
    const spotifyLink = playlist.external_urls.spotify;
    
    // Make the status message clickable with stats
    const statusEl = document.getElementById('status');
    statusEl.innerHTML = `Created "<strong>${playlistName}</strong>"<br>
      ${stats.totalTracks} tracks • ${stats.uniqueArtists} artists • ${stats.durationFormatted}<br>
      <a href="${spotifyLink}" target="_blank" style="color: #1db954; text-decoration: underline;">→ Open in Spotify</a>`;
    
    document.getElementById('playlist-name').value = '';
    
    // Broman trigger for first playlist
    const playlistCount = playlistHistory.length;
    if (playlistCount === 1 && !bromanState.shownTips.has('firstPlaylist')) {
      setTimeout(() => triggerBroman('onFirstPlaylist'), 2000);
    } else if (playlistCount === 2 && !bromanState.shownTips.has('artistDiscovery')) {
      setTimeout(() => triggerBroman('onSecondPlaylist'), 3000);
    }
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
      
      updateBromanHistory();
      
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
  
  updateStatus('Creating smart discovery playlist...');
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
      
      // Get top tracks for each artist, convert to expected format
      data.tracks.slice(0, 5).forEach(track => {
        if (!track.duration_ms) track.duration_ms = 210000; // Default 3.5 min
        if (!track.artists) track.artists = [{id: artistId, name: 'Unknown'}];
        allTracks.push(track);
      });
    }
    
    // Apply smart selection (1 hour, max 3 per artist)
    const smartTracks = selectSmartTracks(allTracks, {
      targetDuration: 3600, // 1 hour for discovery
      maxTracksPerArtist: 3,
      avoidConsecutiveSameArtist: true
    });
    
    const stats = calculatePlaylistStats(smartTracks);
    
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
        description: `${selectedArtist.name}${selectedRelatedArtists.size > 0 ? ` + ${selectedRelatedArtists.size} similar artist${selectedRelatedArtists.size !== 1 ? 's' : ''}` : ''} • ${stats.uniqueArtists} artists • ${stats.durationFormatted} • Created by Playlist Alchemist`,
        public: false
      })
    });
    const playlist = await createResp.json();
    
    const trackUris = smartTracks.map(t => t.uri);
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
    }, smartTracks);
    
    // Update Broman history display
    updateBromanHistory();
    
    // Create clickable Spotify link with stats
    const spotifyLink = playlist.external_urls.spotify;
    const statusEl = document.getElementById('status');
    statusEl.innerHTML = `"<strong>${playlistName}</strong>" created<br>${stats.totalTracks} tracks • ${stats.uniqueArtists} artists • ${stats.durationFormatted}<br><a href="${spotifyLink}" target="_blank" style="color: #1db954; text-decoration: underline;">→ Open in Spotify</a>`;
    
    document.getElementById('generate-discovery-playlist').disabled = false;
    document.getElementById('discovery-playlist-name').value = '';
  } catch (e) {
    updateStatus(`Error: ${e.message}`);
    document.getElementById('generate-discovery-playlist').disabled = false;
  }
});

// ===== PAGE LOAD: Handle OAuth Redirect =====

window.toggleAboutSection = toggleAboutSection;
window.toggleBromanSidebar = toggleBromanSidebar;
window.toggleLearnMore = toggleLearnMore;
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
