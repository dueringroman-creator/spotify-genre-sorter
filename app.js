const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read','playlist-modify-public','playlist-modify-private'];
const STATE = 'spotify_auth';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';

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
    updateStatus('Logged in! Ready to fetch songs.');
    disable('login');
    enable('fetch-tracks');
  } else {
    updateStatus('Login failed.');
    console.error(data);
  }
}

async function fetchLikedSongs(token) {
  let all = [];
  const limit = 50;
  let offset = 0;
  updateStatus('Fetching liked songs...');
  disable('fetch-tracks');

  while (true) {
    const resp = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await resp.json();
    if (!d.items || d.items.length === 0) break;
    all.push(...d.items);
    offset += limit;
    updateStatus(`Fetched ${all.length} songs...`);
  }
  window.likedTracks = all;
  updateStatus(`All songs fetched (${all.length}). Next: fetch genres.`);
  enable('fetch-genres');
}

async function fetchGenres(token) {
  const artistIds = new Set();
  window.likedTracks.forEach(item => {
    const a = item.track && item.track.artists && item.track.artists[0];
    if (a && a.id) artistIds.add(a.id);
  });
  const list = Array.from(artistIds);
  updateStatus(`Fetching genres for ${list.length} artists...`);
  disable('fetch-genres');

  const map = {};
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50).join(',');
    const resp = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await resp.json();
    d.artists.forEach(a => { map[a.id] = a.genres; });
    updateStatus(`Processed ${Math.min(i+50, list.length)}/${list.length} artists...`);
  }

  window.artistGenreMap = map;
  updateStatus('Genres fetched. Detecting buckets...');
  enable('normalize-genres');
}

function normalizeAndDetect() {
  const mapping = {
    pop: "Pop", rock: "Rock", indie: "Indie",
    electronic: "Electronic", house: "Electronic", techno: "Electronic",
    trance: "Electronic", "hip hop": "Hip Hop / Rap", rap: "Hip Hop / Rap",
    "r&b": "R&B / Soul", jazz: "Jazz / Blues", blues: "Jazz / Blues",
    classical: "Classical", metal: "Metal / Hard Rock",
    punk: "Metal / Hard Rock", folk: "Folk / Acoustic", acoustic: "Folk / Acoustic",
    latin: "Latin"
  };
  const bucketMap = {}, rawByBucket = {}, rawMap = window.artistGenreMap;

  window.likedTracks.forEach(item => {
    const track = item.track;
    const aid = track && track.artists && track.artists[0] && track.artists[0].id;
    const genres = (aid && rawMap[aid]) ? rawMap[aid] : ['Unknown'];
    genres.forEach(g => {
      const lower = g.toLowerCase();
      for (const key in mapping) {
        if (lower.includes(key)) {
          const bucket = mapping[key];
          bucketMap[bucket] = bucketMap[bucket] || [];
          bucketMap[bucket].push(track);
          rawByBucket[bucket] = rawByBucket[bucket] || new Set();
          rawByBucket[bucket].add(g);
        }
      }
    });
  });

  const counts = Object.entries(bucketMap).map(([b,t]) => ({ bucket: b, count: t.length }));
  counts.sort((a,b) => b.count - a.count);
  const total = window.likedTracks.length;
  const threshold = total * 0.02;
  let selected = counts.filter(c => c.count >= threshold).map(c => c.bucket);

  if (selected.length > 0 && counts[0].count / total > 0.5) {
    const dominant = counts[0].bucket;
    const subs = Array.from(rawByBucket[dominant]).slice(0,3);
    subs.forEach(sub => {
      const name = `${dominant} – ${sub}`;
      bucketMap[name] = bucketMap[name] || bucketMap[dominant];
      rawByBucket[name] = rawByBucket[name] || rawByBucket[dominant];
      selected.push(name);
    });
  }

  window.selectedBuckets = selected;
  window.bucketTrackMap = bucketMap;
  window.rawGenresByBucket = rawByBucket;

  const container = document.getElementById('selection-container');
  container.innerHTML = '';
  selected.forEach(bucket => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${bucket}" checked> ${bucket} (${bucketMap[bucket].length})`;
    container.appendChild(label);
  });

  document.getElementById('bucket‑selection').style.display = 'block';
  document.getElementById('mode‑selection').style.display = 'block';
  updateStatus(`Detected ${selected.length} buckets. Ready to create playlists.`);
  enable('create-playlists');
}

document.getElementById('normalize-genres').addEventListener('click', () => {
  disable('normalize-genres');
  updateStatus('Normalizing...');
  normalizeAndDetect();
});

async function createPlaylistsFlow(token) {
  const prof = await (await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  })).json();
  const userId = prof.id;

  const mode = document.querySelector('input[name="mode"]:checked').value;
  const buckets = mode === 'auto'
    ? window.selectedBuckets
    : Array.from(document.querySelectorAll('#selection-container input:checked')).map(i => i.value);

  const resultsList = document.getElementById('playlist‑list');
  resultsList.innerHTML = '';
  document.getElementById('playlist‑results').style.display = 'block';

  for (const bucket of buckets) {
    const tracks = window.bucketTrackMap[bucket];
    const uris = tracks.map(t => t.uri);
    const genresStr = Array.from(window.rawGenresByBucket[bucket]).join(', ');
    const mood = document.querySelector('input[name="mood"]:checked').value;
    const name = `${mood} – ${bucket}`;
    const desc = `Original genres: ${genresStr}`;

    const resp = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ name, description: desc, public:false })
    });
    const data = await resp.json();
    const pid = data.id;
    updateStatus(`Created playlist "${name}" (ID: ${pid})`);

    const li = document.createElement('li');
    li.innerText = `"${name}" – ID: ${pid}`;
    resultsList.appendChild(li);

    for (let i = 0; i < uris.length; i += 100) {
      await fetch(`https://api.spotify.com/v1/playlists/${pid}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ uris: uris.slice(i, i+100) })
      });
    }

    updateStatus(`Added ${uris.length} tracks to "${name}".`);
  }

  updateStatus('🎉 All playlists created!');
}

document.getElementById('create-playlists').addEventListener('click', () => {
  disable('create-playlists');
  updateStatus('Creating playlists…');
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






















