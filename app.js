const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read','playlist-modify-public','playlist-modify-private'];
const STATE = 'spotify_auth';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';

// Genre → Sub‑genre mapping
const GENRE_HIERARCHY = {
  "Electronic": {
    "House": ["house","deep house","progressive house","melodic house"],
    "Techno": ["techno","minimal techno","melodic techno"],
    "Ambient / Chill": ["ambient","downtempo","chillout","lo‑fi"],
    "Drum & Bass": ["drum & bass","dnb","liquid funk"]
  },
  "Hip Hop / Rap": {
    "Trap": ["trap","drill","trap latino"],
    "Old School": ["old school hip hop","boom bap"],
    "Lo‑Fi Hip Hop": ["lo‑fi hip hop","beats to study to"]
  },
  "Rock / Alternative": {
    "Indie Rock": ["indie rock","indie pop","indie"],
    "Hard Rock / Metal": ["hard rock","metal","metalcore"],
    "Classic Rock": ["classic rock","album rock"]
  },
  "Pop": {
    "Mainstream Pop": ["dance pop","pop rock","electropop"],
    "Synth Pop": ["synthpop","vaporwave","dream pop"]
  },
  "Jazz / Blues": {
    "Soulful Jazz": ["jazz","soul jazz","vocal jazz"],
    "Blues Rock": ["blues rock","electric blues"]
  },
  "Other / Unmapped": {}
};

// Find matching buckets
function findBucketsForGenre(rawGenre) {
  const lower = rawGenre.toLowerCase();
  const matches = [];
  for (const primary in GENRE_HIERARCHY) {
    const subMap = GENRE_HIERARCHY[primary];
    for (const sub in subMap) {
      const keywords = subMap[sub];
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          matches.push({ bucket: `${primary} > ${sub}`, primary, sub });
        }
      }
    }
    if (Object.keys(subMap).length === 0 && lower.includes(primary.toLowerCase())) {
      matches.push({ bucket: primary, primary, sub: null });
    }
  }
  if (matches.length === 0) {
    matches.push({ bucket: "Other / Unmapped", primary: "Other / Unmapped", sub: null });
  }
  return matches;
}

function updateStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.innerText = msg;
  console.log(msg);
}

function disable(id) {
  const btn = document.getElementById(id);
  if (btn) btn.disabled = true;
}
function enable(id) {
  const btn = document.getElementById(id);
  if (btn) btn.disabled = false;
}

// Login
document.getElementById('login').addEventListener('click', async () => {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem(CODE_VERIFIER_KEY, verifier);

  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}` +
              `&scope=${SCOPES.join('%20')}` +
              `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
              `&state=${STATE}&code_challenge=${challenge}&code_challenge_method=S256`;
  window.location = url;
});

async function fetchAccessToken(code) {
  const verifier = localStorage.getItem(CODE_VERIFIER_KEY);
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  });
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await resp.json();
  if (data.access_token) {
    window.spotifyToken = data.access_token;
    updateStatus('🎉 Logged in! Ready to fetch songs.');
    disable('login');
    enable('fetch-tracks');
  } else {
    updateStatus('❌ Login failed. Please retry.');
    console.error(data);
  }
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < length; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

// RESUMABLE: fetch liked songs
async function fetchLikedSongs(token) {
  let allTracks = [];
  let offset = 0;
  const limit = 50;

  const prog = localStorage.getItem('likedTracksProgress');
  if (prog) {
    const obj = JSON.parse(prog);
    offset = obj.offset;
    const ids = JSON.parse(localStorage.getItem('likedTracksIds') || '[]');
    updateStatus(`Resuming from offset ${offset}...`);
    // we don’t restore full objects for demo simplicity
  } else {
    updateStatus('📥 Fetching liked songs...');
    disable('fetch-tracks');
  }

  while (true) {
    try {
      const resp = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error(`Fetch error: ${resp.status}`);
      const d = await resp.json();
      if (!d.items || d.items.length === 0) break;
      allTracks.push(...d.items);
      offset += limit;
      updateStatus(`Fetched ${allTracks.length} songs…`);
      localStorage.setItem('likedTracksProgress', JSON.stringify({ offset, total: allTracks.length }));
      localStorage.setItem('likedTracksIds', JSON.stringify(allTracks.map(it => it.track.id)));
    } catch (err) {
      console.error('Error fetching liked songs:', err);
      updateStatus(`⚠️ Network or error at offset ${offset}. Retrying...`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
  }

  window.likedTracks = allTracks;
  localStorage.removeItem('likedTracksProgress');
  localStorage.removeItem('likedTracksIds');
  updateStatus(`✅ All songs fetched (${allTracks.length}).`);
  enable('fetch-genres');
}

// RESUMABLE: fetch artist genres
async function fetchGenres(token) {
  const artistIds = new Set();
  window.likedTracks.forEach(item => {
    const a = item.track && item.track.artists && item.track.artists[0];
    if (a && a.id) artistIds.add(a.id);
  });
  const list = Array.from(artistIds);
  updateStatus(`🔍 Fetching genres for ${list.length} artists…`);
  disable('fetch-genres');

  const prog = localStorage.getItem('artistGenreMapProgress');
  let startIndex = 0;
  if (prog) {
    const obj = JSON.parse(prog);
    startIndex = obj.index;
    updateStatus(`Resuming genres at index ${startIndex}…`);
  }
  const map = window.artistGenreMap || {};

  for (let i = startIndex; i < list.length; i += 50) {
    try {
      const batch = list.slice(i, i + 50).join(',');
      const resp = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error(`Fetch error: ${resp.status}`);
      const d = await resp.json();
      d.artists.forEach(a => { map[a.id] = a.genres; });
      localStorage.setItem('artistGenreMapProgress', JSON.stringify({ index: i + 50 }));
      updateStatus(`Processed ${Math.min(i+50, list.length)} / ${list.length} artists…`);
    } catch (err) {
      console.error('Error fetching artist genres:', err);
      updateStatus(`⚠️ Error at index ${i}. Retrying...`);
      await new Promise(r => setTimeout(r, 2000));
      i -= 50;
      continue;
    }
  }

  window.artistGenreMap = map;
  localStorage.removeItem('artistGenreMapProgress');
  updateStatus('✅ Genres fetched.');
  enable('normalize-genres');
}

// Bucket detection
function normalizeAndDetect() {
  const bucketTrackMap = {};
  const rawByBucket = {};
  window.likedTracks.forEach(item => {
    const track = item.track;
    const aid = track && track.artists && track.artists[0] && track.artists[0].id;
    const genres = (aid && window.artistGenreMap[aid]) ? window.artistGenreMap[aid] : ['Unknown'];
    const bucketSet = new Set();
    genres.forEach(g => {
      const bs = findBucketsForGenre(g);
      bs.forEach(b => bucketSet.add(b.bucket));
    });
    bucketSet.forEach(bucket => {
      bucketTrackMap[bucket] = bucketTrackMap[bucket] || [];
      bucketTrackMap[bucket].push(track);
      rawByBucket[bucket] = rawByBucket[bucket] || new Set();
      genres.forEach(g => rawByBucket[bucket].add(g));
    });
  });

  const counts = Object.entries(bucketTrackMap).map(([b,t]) => ({ bucket: b, count: t.length }));
  counts.sort((a,b) => b.count - a.count);
  const total = window.likedTracks.length;
  const threshold = total * 0.02;
  let selected = counts.filter(c => c.count >= threshold).map(c => c.bucket);

  if (counts.length > 0 && counts[0].count / total > 0.5) {
    const dominant = counts[0].bucket;
    const subs = Array.from(rawByBucket[dominant]).slice(0,3);
    subs.forEach(sub => {
      const name = `${dominant} – ${sub}`;
      bucketTrackMap[name] = bucketTrackMap[name] || bucketTrackMap[dominant];
      rawByBucket[name] = rawByBucket[name] || rawByBucket[dominant];
      selected.push(name);
    });
  }

  window.selectedBuckets = selected;
  window.bucketTrackMap = bucketTrackMap;
  window.rawGenresByBucket = rawByBucket;

  const container = document.getElementById('selection-container');
  container.innerHTML = '';
  selected.forEach(bucket => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${bucket}" checked> ${bucket} (${bucketTrackMap[bucket].length} songs)`;
    container.appendChild(label);
  });

  document.getElementById('mood‑selection').classList.add('visible');
  document.getElementById('mode‑selection').classList.add('visible');
  document.getElementById('bucket‑selection').classList.add('visible');
  updateStatus(`🧮 Detected ${selected.length} buckets. Choose mood & mode then create playlists.`);
  enable('create-playlists');
}

document.getElementById('normalize-genres').addEventListener('click', () => {
  disable('normalize-genres');
  updateStatus('🧮 Detecting buckets…');
  normalizeAndDetect();
});

// Create playlists
async function createPlaylistsFlow(token) {
  const profile = await (await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  })).json();
  const userId = profile.id;

  const mode = document.querySelector('input[name="mode"]:checked').value;
  const mood = document.querySelector('input[name="mood"]:checked').value;
  const allowOverlap = document.getElementById('allow‑overlap').checked;
  const buckets = mode === 'auto'
    ? window.selectedBuckets
    : Array.from(document.querySelectorAll('#selection-container input:checked')).map(i => i.value);

  const resultsList = document.getElementById('playlist‑list');
  resultsList.innerHTML = '';
  document.getElementById('playlist‑results').classList.add('visible');

  const usedTrackIds = new Set();

  for (const bucket of buckets) {
    const tracks = window.bucketTrackMap[bucket];
    const uris = tracks
      .filter(t => allowOverlap || !usedTrackIds.has(t.uri))
      .map(t => ( usedTrackIds.add(t.uri), t.uri) );

    const genresStr = Array.from(window.rawGenresByBucket[bucket]).join(', ');
    const name = `${mood} • ${bucket}`;
    const desc = `Original genres: ${genresStr}`;

    const createResp = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: desc, public:false })
    });
    const createData = await createResp.json();
    const playlistId = createData.id || '[ID unavailable]';

    resultsList.innerHTML += `<li>${name} — ID: ${playlistId} — ${uris.length} songs</li>`;

    for (let i = 0; i < uris.length; i += 100) {
      await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method:'POST',
        headers:{ Authorization: `Bearer ${token}`, 'Content-Type':'application/json'},
        body: JSON.stringify({ uris: uris.slice(i, i+100) })
      });
    }
    updateStatus(`✅ Playlist "${name}" created (${uris.length} songs).`);
  }

  updateStatus('🎉 All playlists created!');
  enable('login');
}

document.getElementById('create-playlists').addEventListener('click', () => {
  disable('create-playlists');
  updateStatus('🚀 Creating playlists…');
  createPlaylistsFlow(window.spotifyToken);
});

window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (code && state === STATE) {
    fetchAccessToken(code);
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }

  document.getElementById('fetch-tracks').addEventListener('click', () => {
    if (!window.spotifyToken) {
      updateStatus('Please login first.');
      return;
    }
    fetchLikedSongs(window.spotifyToken);
  });
  document.getElementById('fetch-genres').addEventListener('click', () => {
    if (!window.likedTracks) {
      updateStatus('Please fetch songs first.');
      return;
    }
    fetchGenres(window.spotifyToken);
  });
};
























