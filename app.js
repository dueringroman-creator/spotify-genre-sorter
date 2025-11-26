const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read', 'playlist-modify-public', 'playlist-modify-private'];
const STATE = 'alchemist_state';
let spotifyToken = null;

const dbName = 'alchemist_db';
const storeName = 'session_data';

// IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = e => {
      e.target.result.createObjectStore(storeName);
    };
    request.onsuccess = e => resolve(e.target.result);
    request.onerror = () => reject(request.error);
  });
}

function saveToDB(key, value) {
  return openDB().then(db => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    return tx.complete;
  });
}

function loadFromDB(key) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName);
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

function clearDB() {
  return openDB().then(db => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    return tx.complete;
  });
}

// UI helpers
function updateStatus(text) {
  document.getElementById('status').innerText = text;
}

function enable(id) {
  document.getElementById(id).disabled = false;
}

function disable(id) {
  document.getElementById(id).disabled = true;
}

// Auth
async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateRandomString(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => charset[Math.floor(Math.random() * charset.length)]).join('');
}

async function fetchAccessToken(code) {
  const verifier = localStorage.getItem('code_verifier');
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
  return data.access_token;
}

// Step 1: Login
document.getElementById('login').onclick = async () => {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem('code_verifier', verifier);
  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${SCOPES.join('%20')}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${STATE}&code_challenge=${challenge}&code_challenge_method=S256`;
  window.location = url;
};

// Step 2: Fetch songs with retry + resume logic
async function fetchSavedTracks(token) {
  let allTracks = await loadFromDB('saved_tracks') || [];
  let offset = allTracks.length;
  const limit = 50;

  updateStatus(`🎵 Fetching your saved songs...`);
  while (true) {
    try {
      const res = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.items.length) break;
      allTracks = allTracks.concat(data.items);
      offset += limit;
      await saveToDB('saved_tracks', allTracks);
      updateStatus(`🎧 ${allTracks.length} songs fetched...`);
    } catch (err) {
      updateStatus(`⚠️ Error at offset ${offset}. Retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  updateStatus(`✅ Done fetching ${allTracks.length} tracks!`);
  enable('fetch-genres');
}

// Step 3: Fetch genres
async function fetchGenres() {
  const savedTracks = await loadFromDB('saved_tracks');
  const artistIds = [...new Set(savedTracks.map(item => item.track.artists[0].id))];
  const genreMap = {};
  updateStatus(`🔍 Fetching genres for ${artistIds.length} artists...`);

  for (let i = 0; i < artistIds.length; i += 50) {
    const batch = artistIds.slice(i, i + 50).join(',');
    const res = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { Authorization: `Bearer ${spotifyToken}` }
    });
    const data = await res.json();
    data.artists.forEach(artist => {
      genreMap[artist.id] = artist.genres;
    });
    updateStatus(`🔎 Scanned ${Math.min(i + 50, artistIds.length)} / ${artistIds.length}`);
  }

  await saveToDB('genre_map', genreMap);
  updateStatus(`✅ Genre mapping complete.`);
  enable('detect-buckets');
}

// Init resume
window.onload = async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (code && state === STATE) {
    spotifyToken = await fetchAccessToken(code);
    window.history.replaceState({}, document.title, REDIRECT_URI);
    updateStatus('🎉 Logged in successfully!');
    enable('fetch-tracks');
    return;
  }

  const tokenFromStorage = localStorage.getItem('spotify_token');
  if (tokenFromStorage) {
    spotifyToken = tokenFromStorage;
    updateStatus('🔄 Resumed session.');
    enable('fetch-tracks');
  }
};

// Events
document.getElementById('fetch-tracks').onclick = () => {
  if (!spotifyToken) return;
  disable('fetch-tracks');
  fetchSavedTracks(spotifyToken);
};

document.getElementById('fetch-genres').onclick = () => {
  disable('fetch-genres');
  fetchGenres();
};

document.getElementById('reset-session').onclick = async () => {
  await clearDB();
  localStorage.clear();
  updateStatus('🧹 Session reset. Reload to start over.');
};






























