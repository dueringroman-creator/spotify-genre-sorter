const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read', 'playlist-modify-private'];
const STATE = 'auth_state';
const CODE_VERIFIER_KEY = 'code_verifier';
const SESSION_KEY = 'alchemist_session';

let token = null;
let step = 0;
let savedTracks = [];
let artistGenres = {};
let buckets = {};
let selectedBuckets = [];

const steps = document.querySelectorAll('.step');

function updateStep(newStep) {
  steps.forEach((s, i) => {
    s.classList.toggle('active', i === newStep);
  });
}

function updateStatus(msg) {
  document.getElementById('status').textContent = msg;
  console.log(msg);
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    token, savedTracks, artistGenres, buckets
  }));
}

function restoreSession() {
  const data = JSON.parse(localStorage.getItem(SESSION_KEY));
  if (data?.token) {
    token = data.token;
    savedTracks = data.savedTracks || [];
    artistGenres = data.artistGenres || {};
    buckets = data.buckets || {};
    updateStatus("🔄 Resumed previous session.");
    step = 2;
    updateStep(step);
    document.getElementById('fetch-tracks').disabled = false;
    document.getElementById('fetch-genres').disabled = false;
    document.getElementById('analyze-buckets').disabled = false;
  }
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateRandomString(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map(x => charset[x % charset.length]).join('');
}

document.getElementById('login').onclick = async () => {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem(CODE_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES.join(' '),
    redirect_uri: REDIRECT_URI,
    state: STATE,
    code_challenge_method: 'S256',
    code_challenge: challenge
  });

  window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
};

async function exchangeToken(code) {
  const verifier = localStorage.getItem(CODE_VERIFIER_KEY);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  const data = await res.json();
  token = data.access_token;
  localStorage.removeItem(CODE_VERIFIER_KEY);
  updateStatus("🔓 Logged in successfully!");
  document.getElementById('fetch-tracks').disabled = false;
  updateStep(1);
}

async function fetchSavedTracks() {
  updateStatus("🎵 Fetching your saved songs...");
  document.getElementById('fetch-tracks').disabled = true;

  let offset = savedTracks.length;
  const limit = 50;

  while (true) {
    const res = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401) {
      updateStatus("⚠️ Unauthorized. Please log in again.");
      return;
    }

    const data = await res.json();
    if (!data.items || data.items.length === 0) break;

    savedTracks.push(...data.items);
    offset += limit;
    updateStatus(`✅ ${savedTracks.length} songs fetched...`);
    saveSession();
  }

  updateStatus(`🎶 All songs retrieved!`);
  updateStep(2);
  document.getElementById('fetch-genres').disabled = false;
}

async function fetchGenres() {
  updateStatus("🔍 Fetching artist genres...");
  document.getElementById('fetch-genres').disabled = true;

  const artistIds = [...new Set(savedTracks.map(t => t.track.artists[0]?.id).filter(Boolean))];

  for (let i = 0; i < artistIds.length; i += 50) {
    const ids = artistIds.slice(i, i + 50).join(',');
    const res = await fetch(`https://api.spotify.com/v1/artists?ids=${ids}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    for (const artist of data.artists) {
      artistGenres[artist.id] = artist.genres;
    }
    updateStatus(`Genres fetched for ${i + 50}/${artistIds.length} artists...`);
    saveSession();
  }

  updateStep(3);
  document.getElementById('analyze-buckets').disabled = false;
}

function detectBuckets() {
  updateStatus("🧪 Analyzing genres into buckets...");
  buckets = {};
  for (const item of savedTracks) {
    const id = item.track.artists[0]?.id;
    const genres = artistGenres[id] || [];
    for (const genre of genres) {
      if (!buckets[genre]) buckets[genre] = [];
      buckets[genre].push(item.track);
    }
  }

  const bucketList = document.getElementById('bucket-list');
  bucketList.innerHTML = '';
  Object.entries(buckets)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([genre, tracks]) => {
      const row = document.createElement('label');
      row.innerHTML = `<input type="checkbox" value="${genre}"/> ${genre} (${tracks.length})`;
      bucketList.appendChild(row);
    });

  document.getElementById('buckets').style.display = 'block';
  document.getElementById('create-playlists').disabled = false;
  updateStep(4);
  saveSession();
}

document.getElementById('select-all-buckets').addEventListener('change', (e) => {
  document.querySelectorAll('#bucket-list input[type=checkbox]').forEach(cb => {
    cb.checked = e.target.checked;
  });
});

async function createPlaylists() {
  updateStatus("🎁 Creating your playlists…");
  const selected = Array.from(document.querySelectorAll('#bucket-list input[type=checkbox]:checked')).map(cb => cb.value);
  const profileRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const profile = await profileRes.json();

  document.getElementById('playlists').style.display = 'block';
  const list = document.getElementById('playlist-links');
  list.innerHTML = '';

  for (const genre of selected) {
    const tracks = buckets[genre].map(t => t.uri);
    const res = await fetch(`https://api.spotify.com/v1/users/${profile.id}/playlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `Alchemist: ${genre}`,
        description: `Auto-generated genre playlist for ${genre}`,
        public: false
      })
    });

    const data = await res.json();
    for (let i = 0; i < tracks.length; i += 100) {
      await fetch(`https://api.spotify.com/v1/playlists/${data.id}/tracks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uris: tracks.slice(i, i + 100) })
      });
    }

    const li = document.createElement('li');
    li.innerHTML = `<a href="${data.external_urls.spotify}" target="_blank">${data.name}</a>`;
    list.appendChild(li);
  }

  updateStatus("✅ Done! Playlists created.");
  updateStep(5);
}

document.getElementById('fetch-tracks').onclick = fetchSavedTracks;
document.getElementById('fetch-genres').onclick = fetchGenres;
document.getElementById('analyze-buckets').onclick = detectBuckets;
document.getElementById('create-playlists').onclick = createPlaylists;
document.getElementById('reset-session').onclick = () => {
  localStorage.removeItem(SESSION_KEY);
  location.reload();
};

// Initialize
(async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    await exchangeToken(code);
    window.history.replaceState({}, document.title, REDIRECT_URI);
  } else {
    restoreSession();
  }
})();





























