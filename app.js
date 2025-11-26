const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read','playlist-modify-public','playlist-modify-private'];
const STATE = 'spotify_auth';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';

function updateStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.innerText = msg;
  console.log(msg);
}
function disable(id) {
  const b = document.getElementById(id);
  if (b) b.disabled = true;
}
function enable(id) {
  const b = document.getElementById(id);
  if (b) b.disabled = false;
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
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

// Step 1: Login
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
    headers: { 'Content-Type':'application/x-www-form-urlencoded' },
    body
  });
  const data = await resp.json();
  if (data.access_token) {
    window.spotifyToken = data.access_token;
    updateStatus('✅ Logged in — you can fetch your saved songs.');
    disable('login');
    enable('fetch-tracks');
  } else {
    updateStatus('❌ Login failed. Try again.');
    console.error(data);
  }
}

// Step 2: Fetch saved tracks
async function fetchSavedTracks(token) {
  updateStatus('🎵 Fetching your saved songs...');
  disable('fetch-tracks');
  let all = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const resp = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    if (!data.items || data.items.length === 0) break;
    all.push(...data.items);
    offset += limit;
    updateStatus(`Fetched ${all.length} songs...`);
  }
  window.savedTracks = all;
  updateStatus(`✅ Retrieved ${all.length} songs. Next: gather artist genres.`);
  enable('fetch-genres');
}

// Step 3: Gather genres from artists
async function fetchArtistGenres(token) {
  updateStatus('🔍 Gathering artist genres...');
  disable('fetch-genres');

  const artistSet = new Set();
  window.savedTracks.forEach(item => {
    const a = item.track && item.track.artists && item.track.artists[0];
    if (a && a.id) artistSet.add(a.id);
  });
  const artistIds = Array.from(artistSet);
  const genreMap = {};

  for (let i = 0; i < artistIds.length; i += 50) {
    const batch = artistIds.slice(i, i + 50).join(',');
    const resp = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    data.artists.forEach(a => {
      genreMap[a.id] = a.genres || [];
    });
  }

  window.artistGenreMap = genreMap;
  updateStatus('✅ Genres gathered. Building genre buckets...');
  buildGenreBuckets();
}

// Build map: genre → track list  
function buildGenreBuckets() {
  const buckets = {};
  window.savedTracks.forEach(item => {
    const track = item.track;
    const a = track.artists[0];
    const genres = window.artistGenreMap[a.id] || [];
    genres.forEach(g => {
      const key = g; // use Spotify genre directly
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(track);
    });
  });
  window.genreBuckets = buckets;

  const genreListEl = document.getElementById('genre‑list');
  genreListEl.innerHTML = '';
  Object.entries(buckets)
    .sort((a,b) => b[1].length - a[1].length)
    .forEach(([genre, tracks]) => {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${genre}" checked> ${genre} (${tracks.length} songs)`;
      genreListEl.appendChild(label);
    });

  document.getElementById('genre‑selection').style.display = 'block';
  enable('create-playlists');
  updateStatus('Select which genres you want playlists for.');
}

// Step 4: Create playlists for selected genres
async function createPlaylists(token) {
  updateStatus('🚀 Creating playlists...');
  disable('create-playlists');

  const profile = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  const uid = profile.id;

  const selected = Array.from(document.querySelectorAll('#genre‑list input:checked')).map(el => el.value);
  const resultsEl = document.getElementById('playlist‑list');
  resultsEl.innerHTML = '';
  document.getElementById('playlist‑results').style.display = 'block';

  for (const genre of selected) {
    const tracks = window.genreBuckets[genre];
    const uris = tracks.map(t => t.uri);
    const playlistName = `${genre} Vibes`;
    const description = `Playlist generated by Playlist Alchemist — based on genre: ${genre}`;

    const resp = await fetch(`https://api.spotify.com/v1/users/${uid}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ name: playlistName, description, public:false })
    });
    const data = await resp.json();
    const pid = data.id;

    // add tracks
    for (let i = 0; i < uris.length; i += 100) {
      const chunk = uris.slice(i, i + 100);
      await fetch(`https://api.spotify.com/v1/playlists/${pid}/tracks`, {
        method:'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ uris: chunk })
      });
    }
    resultsEl.innerHTML += `<li>✅ ${playlistName} — ${uris.length} songs — ID: ${pid}</li>`;
  }

  updateStatus('🎉 Done! Check your Spotify account.');
}

document.getElementById('fetch-tracks').addEventListener('click', () => {
  fetchSavedTracks(window.spotifyToken);
});
document.getElementById('fetch-genres').addEventListener('click', () => {
  fetchArtistGenres(window.spotifyToken);
});
document.getElementById('create-playlists').addEventListener('click', () => {
  createPlaylists(window.spotifyToken);
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


























