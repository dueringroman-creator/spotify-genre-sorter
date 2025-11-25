const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read', 'playlist-modify-public', 'playlist-modify-private'];
const STATE = 'spotify_auth';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';

function updateStatus(msg) {
  document.getElementById('status').innerText = msg;
  console.log(msg);
}
function disable(id) { document.getElementById(id).disabled = true; }
function enable(id) { document.getElementById(id).disabled = false; }

function generateRandomString(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let res = '';
  for (let i = 0; i < length; i++) {
    res += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return res;
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

document.getElementById('login').addEventListener('click', async () => {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem(CODE_VERIFIER_KEY, verifier);

  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${SCOPES.join('%20')}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${STATE}&code_challenge=${challenge}&code_challenge_method=S256`;
  window.location = authUrl;
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

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await response.json();
  if (data.access_token) {
    window.spotifyToken = data.access_token;
    updateStatus('🔑 Authenticated. Let’s gather your song collection.');
    disable('login');
    enable('fetch-tracks');
  } else {
    updateStatus('❌ Login failed. Try again.');
    console.error(data);
  }
}

async function fetchAllLikedSongs(token) {
  const all = [];
  let offset = 0;
  const limit = 50;

  updateStatus('🎵 Fetching liked tracks...');
  disable('fetch-tracks');

  while (true) {
    const res = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.items || data.items.length === 0) break;
    all.push(...data.items);
    offset += limit;
    updateStatus(`Fetched ${all.length} tracks...`);
  }

  window.likedTracks = all;
  updateStatus(`✅ Done. ${all.length} tracks ready for genre analysis.`);
  enable('fetch-genres');
}

async function fetchGenres(token) {
  const artistIds = new Set();
  window.likedTracks.forEach(t => t.track && t.track.artists[0] && artistIds.add(t.track.artists[0].id));
  const ids = Array.from(artistIds);
  const map = {};

  updateStatus('🔍 Looking up artist genres...');
  disable('fetch-genres');

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(',');
    const res = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    data.artists.forEach(a => map[a.id] = a.genres);
  }

  window.artistGenreMap = map;
  updateStatus('✨ Genres found. Let’s cook up some genre buckets.');
  enable('normalize-genres');
}

function normalizeAndDetect() {
  const raw = window.artistGenreMap;
  const tracks = window.likedTracks;
  const genreBuckets = {};
  const rawGenres = {};

  tracks.forEach(item => {
    const track = item.track;
    const artist = track?.artists[0];
    if (!artist) return;

    const genres = raw[artist.id] || ['Unknown'];
    genres.forEach(g => {
      const norm = g.toLowerCase().split(' ').slice(0, 2).join(' ');
      if (!genreBuckets[norm]) genreBuckets[norm] = [];
      genreBuckets[norm].push(track);

      if (!rawGenres[norm]) rawGenres[norm] = new Set();
      rawGenres[norm].add(g);
    });
  });

  const filtered = Object.entries(genreBuckets)
    .filter(([_, songs]) => songs.length >= 30)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15);

  const selection = document.getElementById('selection-container');
  selection.innerHTML = '';
  filtered.forEach(([key, songs]) => {
    const gSet = Array.from(rawGenres[key]).join(', ');
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${key}" checked> ${key} (${songs.length}) <br><small>${gSet}</small>`;
    selection.appendChild(label);
  });

  window.bucketMap = genreBuckets;
  window.filteredBuckets = filtered.map(([k]) => k);
  document.getElementById('bucket-selection').style.display = 'block';
  enable('create-playlists');
  updateStatus('📦 Genre buckets ready. Choose what to transform.');
}

async function createPlaylists(token) {
  const profile = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  }).then(res => res.json());

  const selected = Array.from(document.querySelectorAll('#selection-container input:checked'))
    .map(i => i.value);

  for (const genre of selected) {
    const name = `${genre} ✨ Alchemy`;
    const tracks = window.bucketMap[genre].slice(0, 200);
    const uris = tracks.map(t => t.uri);

    const create = await fetch(`https://api.spotify.com/v1/users/${profile.id}/playlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        description: `Infused from genres: ${Array.from(window.artistGenreMap[genre] || []).join(', ')}`,
        public: false
      })
    }).then(res => res.json());

    for (let i = 0; i < uris.length; i += 100) {
      const chunk = uris.slice(i, i + 100);
      await fetch(`https://api.spotify.com/v1/playlists/${create.id}/tracks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uris: chunk })
      });
    }

    updateStatus(`✅ Playlist created: ${name}`);
  }

  updateStatus('🎉 All playlists are ready in your Spotify library.');
}

document.getElementById('normalize-genres').addEventListener('click', () => {
  disable('normalize-genres');
  normalizeAndDetect();
});

document.getElementById('create-playlists').addEventListener('click', () => {
  disable('create-playlists');
  createPlaylists(window.spotifyToken);
});

document.getElementById('fetch-tracks').addEventListener('click', () => {
  if (window.spotifyToken) fetchAllLikedSongs(window.spotifyToken);
});
document.getElementById('fetch-genres').addEventListener('click', () => {
  if (window.spotifyToken) fetchGenres(window.spotifyToken);
});

window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (code && state === STATE) {
    fetchAccessToken(code);
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }
};


























