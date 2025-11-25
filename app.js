const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read','playlist-modify-public','playlist-modify-private'];
const STATE = 'spotify_auth';
const CODE_VERIFIER_STORAGE_KEY = 'spotify_code_verifier';

function generateRandomString(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}

async function generateCodeChallenge(codeVerifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

function markStepDone(id) {
  document.getElementById(id).classList.add('done');
}

function markStepActive(id) {
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function updateStatus(msg) {
  document.getElementById('status').innerText = msg;
  console.log(msg);
}

function updateCount(msg) {
  document.getElementById('count').innerText = msg;
}

function setButtonLoading(buttonId, isLoading) {
  const btn = document.getElementById(buttonId);
  if (isLoading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    // Keep disabled state logic separately as per step flow
  }
}

// LOGIN
document.getElementById('login').addEventListener('click', async () => {
  const codeVerifier = generateRandomString(128);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem(CODE_VERIFIER_STORAGE_KEY, codeVerifier);

  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}` +
    `&scope=${SCOPES.join('%20')}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${STATE}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

  window.location = authUrl;
});

async function fetchAccessToken(code) {
  const codeVerifier = localStorage.getItem(CODE_VERIFIER_STORAGE_KEY);
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier
  });

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  });
  const data = await response.json();

  if (data.access_token) {
    window.spotifyToken = data.access_token;
    markStepDone('step-login');
    markStepActive('step-fetch');
    document.getElementById('login').disabled = true;
    document.getElementById('fetch-tracks').disabled = false;
    updateStatus('✅ Logged in. You may now fetch your liked songs.');
  } else {
    updateStatus('❌ Login failed. Please try again.');
    console.error('Token error:', data);
  }
}

async function fetchAllLikedSongs(token) {
  let allTracks = [];
  const limit = 50;
  let offset = 0;
  let totalFetched = 0;
  let hasMore = true;

  markStepActive('step-fetch');
  setButtonLoading('fetch-tracks', true);
  updateStatus('Fetching your liked songs…');
  updateCount(`Fetched: ${totalFetched} songs`);

  while (hasMore) {
    const response = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      hasMore = false;
    } else {
      allTracks.push(...data.items);
      offset += limit;
      totalFetched += data.items.length;
      updateCount(`Fetched: ${totalFetched} songs`);
    }
  }

  window.likedTracks = allTracks;
  setButtonLoading('fetch-tracks', false);
  markStepDone('step-fetch');
  markStepActive('step-genres');
  document.getElementById('fetch-genres').disabled = false;
  updateStatus(`✅ All liked songs fetched: ${allTracks.length}`);
}

async function fetchGenresForArtists(tracks, token) {
  const artistGenreMap = {};
  const artistIds = new Set();
  tracks.forEach(item => {
    if (item.track && item.track.artists && item.track.artists.length > 0) {
      artistIds.add(item.track.artists[0].id);
    }
  });
  const artistIdList = Array.from(artistIds);

  markStepActive('step-genres');
  setButtonLoading('fetch-genres', true);
  updateStatus(`Found ${artistIdList.length} unique artists`);
  updateCount(`Processed: 0 artists`);

  for (let i = 0; i < artistIdList.length; i += 50) {
    const batch = artistIdList.slice(i, i + 50).join(',');
    const response = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    data.artists.forEach(artist => {
      artistGenreMap[artist.id] = artist.genres;
    });
    updateCount(`Processed: ${Math.min(i + 50, artistIdList.length)} artists`);
  }

  window.artistGenreMap = artistGenreMap;
  setButtonLoading('fetch-genres', false);
  markStepDone('step-genres');
  markStepActive('step-group');
  document.getElementById('group-by-genre').disabled = false;
  updateStatus('✅ All artist genres fetched.');
}

function groupTracksByGenre(tracks, artistGenreMap) {
  markStepActive('step-group');
  setButtonLoading('group-by-genre', true);

  const genreMap = {};
  tracks.forEach(item => {
    const track = item.track;
    if (!track || !track.artists || track.artists.length === 0) return;
    const artistId = track.artists[0].id;
    const genres = artistGenreMap[artistId] || ['Unknown'];
    genres.forEach(genre => {
      if (!genreMap[genre]) genreMap[genre] = [];
      genreMap[genre].push(track);
    });
  });

  window.genreTrackMap = genreMap;
  setButtonLoading('group-by-genre', false);
  markStepDone('step-group');
  markStepActive('step-normalize');
  document.getElementById('normalize-genres').disabled = false;
  updateStatus(`Grouped tracks into ${Object.keys(genreMap).length} genres.`);
}

function normalizeGenres() {
  markStepActive('step-normalize');
  setButtonLoading('normalize-genres', true);

  const mapping = {
    pop: "Pop",
    "dance pop": "Pop",
    electropop: "Pop",
    rock: "Rock",
    indie: "Indie / Alternative",
    alternative: "Indie / Alternative",
    "hip hop": "Hip Hop / Rap",
    rap: "Hip Hop / Rap",
    trap: "Hip Hop / Rap",
    "r&b": "R&B / Soul",
    soul: "R&B / Soul",
    funk: "R&B / Soul",
    edm: "Electronic",
    electronic: "Electronic",
    house: "Electronic",
    techno: "Electronic",
    metal: "Metal / Hard Rock",
    punk: "Rock",
    folk: "Folk / Acoustic",
    acoustic: "Folk / Acoustic",
    jazz: "Jazz / Blues",
    blues: "Jazz / Blues",
    classical: "Classical / Instrumental",
    reggae: "Reggae / Dancehall",
    latin: "Latin",
    country: "Country / Americana"
  };

  const normalized = {};
  Object.entries(window.genreTrackMap).forEach(([genre, tracks]) => {
    let placed = false;
    const lower = genre.toLowerCase();
    for (const key in mapping) {
      if (lower.includes(key)) {
        const bucket = mapping[key];
        normalized[bucket] = (normalized[bucket] || []).concat(tracks);
        placed = true;
        break;
      }
    }
    if (!placed) {
      normalized["Other / Unmapped"] = (normalized["Other / Unmapped"] || []).concat(tracks);
    }
  });

  window.normalizedGenres = normalized;
  setButtonLoading('normalize-genres', false);
  markStepDone('step-normalize');
  updateStatus(`✅ Normalized into ${Object.keys(normalized).length} main genre buckets.`);
}

// On load: setup
window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');

  if (code && state === STATE) {
    fetchAccessToken(code);
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }

  let isFetchingTracks = false;

  document.getElementById('fetch-tracks').addEventListener('click', () => {
    if (isFetchingTracks || !window.spotifyToken) return;
    isFetchingTracks = true;
    fetchAllLikedSongs(window.spotifyToken).finally(() => { isFetchingTracks = false; });
  });

  document.getElementById('fetch-genres').addEventListener('click', async () => {
    if (!window.likedTracks || !window.spotifyToken) return;
    document.getElementById('fetch-genres').disabled = false; // ensure
    await fetchGenresForArtists(window.likedTracks, window.spotifyToken);
  });

  document.getElementById('group-by-genre').addEventListener('click', () => {
    if (!window.likedTracks || !window.artistGenreMap) return;
    groupTracksByGenre(window.likedTracks, window.artistGenreMap);
  });

  document.getElementById('normalize-genres').addEventListener('click', () => {
    if (!window.genreTrackMap) return;
    normalizeGenres();
  });
};











