const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read', 'playlist-modify-public', 'playlist-modify-private'];
const STATE = 'spotify_auth';
const CODE_VERIFIER_STORAGE_KEY = 'spotify_code_verifier';

// Utility
function generateRandomString(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let res = '';
  for (let i = 0; i < length; i++) {
    res += charset.charAt(Math.floor(Math.random()*charset.length));
  }
  return res;
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

function updateStatus(msg) {
  document.getElementById('status').innerText = msg;
  console.log(msg);
}

function disableButton(id) {
  document.getElementById(id).disabled = true;
}

function enableButton(id) {
  document.getElementById(id).disabled = false;
}

// Step 1: Login
document.getElementById('login').addEventListener('click', async () => {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem(CODE_VERIFIER_STORAGE_KEY, verifier);

  const url = `https://accounts.spotify.com/authorize?response_type=code` +
              `&client_id=${CLIENT_ID}` +
              `&scope=${SCOPES.join('%20')}` +
              `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
              `&state=${STATE}` +
              `&code_challenge=${challenge}&code_challenge_method=S256`;
  updateStatus('Hold on, beautiful human — redirecting you to Spotify for login 💫');
  window.location = url;
});

async function fetchAccessToken(code) {
  const verifier = localStorage.getItem(CODE_VERIFIER_STORAGE_KEY);
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
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
    updateStatus('🎉 You’re logged in, you beautiful human! Now let’s fetch your musical gems.');
    disableButton('login');
    enableButton('fetch-tracks');
  } else {
    updateStatus('🤔 Huh, login failed. Let’s try again.');
    console.error('Token error', data);
  }
}

// Step 2: Fetch Liked Songs
async function fetchLikedSongs(token) {
  let allTracks = [];
  const limit = 50;
  let offset = 0;
  updateStatus('🎵 Our music‑bots are digging into your liked songs…');
  disableButton('fetch-tracks');

  while (true) {
    const resp = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    if (!data.items || data.items.length === 0) break;
    allTracks.push(...data.items);
    offset += limit;
    updateStatus(`Fetched ${allTracks.length} songs so far…`);
  }

  window.likedTracks = allTracks;
  updateStatus(`✅ Done! We got ${allTracks.length} songs. Next, we’ll fetch genres.`);
  enableButton('fetch-genres');
}

// Step 3: Fetch Genres
async function fetchGenres(token) {
  const artistIds = new Set();
  window.likedTracks.forEach(item => {
    if (item.track && item.track.artists && item.track.artists[0]) {
      artistIds.add(item.track.artists[0].id);
    }
  });
  const idsList = Array.from(artistIds);
  updateStatus(`🔍 Scanning ${idsList.length} artists for genre data…`);
  disableButton('fetch-genres');

  const artistGenreMap = {};
  for (let i = 0; i < idsList.length; i += 50) {
    const batch = idsList.slice(i, i + 50).join(',');
    const resp = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    data.artists.forEach(artist => {
      artistGenreMap[artist.id] = artist.genres;
    });
    updateStatus(`Processed ${Math.min(i+50, idsList.length)} / ${idsList.length} artists…`);
  }

  window.artistGenreMap = artistGenreMap;
  updateStatus('🎛️ Sweet — genres fetched! Now time to detect your top‑sound buckets.');
  enableButton('normalize‑genres');
}

// Step 4: Normalize & Detect (see previous logic) …
// [Normalization and detection code remains here as before]


// Step 5: Create Playlists
// [Creation logic remains here as before]

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
      updateStatus('👆 Please login first, you beautiful human.');
      return;
    }
    fetchLikedSongs(window.spotifyToken);
  });

  document.getElementById('fetch-genres').addEventListener('click', () => {
    if (!window.likedTracks) {
      updateStatus('🧐 Please fetch your songs first, my friend.');
      return;
    }
    fetchGenres(window.spotifyToken);
  });
};














