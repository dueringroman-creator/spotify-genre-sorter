const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read', 'playlist-modify-public', 'playlist-modify-private'];
const STATE = 'spotify_auth';
const CODE_VERIFIER_STORAGE_KEY = 'spotify_code_verifier';

function generateRandomString(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => charset.charAt(Math.floor(Math.random() * charset.length))).join('');
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
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

document.getElementById('login').addEventListener('click', async () => {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem(CODE_VERIFIER_STORAGE_KEY, verifier);

  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${SCOPES.join('%20')}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${STATE}&code_challenge=${challenge}&code_challenge_method=S256`;
  window.location = url;
});

async function fetchAccessToken(code) {
  const verifier = localStorage.getItem(CODE_VERIFIER_STORAGE_KEY);
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
    updateStatus('🎉 Logged in! Let’s grab your liked songs.');
    disableButton('login');
    enableButton('fetch-tracks');
  } else {
    updateStatus('❌ Login failed.');
    console.error('Token error', data);
  }
}

async function fetchLikedSongs(token) {
  let allTracks = [];
  const limit = 50;
  let offset = 0;
  updateStatus('🎵 Fetching liked songs...');
  disableButton('fetch-tracks');

  while (true) {
    const resp = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    if (!data.items?.length) break;
    allTracks.push(...data.items);
    offset += limit;
    updateStatus(`Fetched ${allTracks.length} songs...`);
  }

  window.likedTracks = allTracks;
  updateStatus(`✅ Done! ${allTracks.length} songs retrieved.`);
  enableButton('fetch-genres');
}

async function fetchGenres(token) {
  const artistIds = new Set(window.likedTracks.map(t => t.track?.artists[0]?.id).filter(Boolean));
  const idsList = Array.from(artistIds);
  updateStatus(`🔍 Fetching genres for ${idsList.length} artists...`);
  disableButton('fetch-genres');

  const artistGenreMap = {};
  for (let i = 0; i < idsList.length; i += 50) {
    const batch = idsList.slice(i, i + 50).join(',');
    const resp = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    data.artists.forEach(a => artistGenreMap[a.id] = a.genres);
    updateStatus(`Processed ${Math.min(i + 50, idsList.length)} / ${idsList.length} artists...`);
  }

  window.artistGenreMap = artistGenreMap;
  updateStatus('🎛️ Genres fetched! Ready to bucket them.');
  enableButton('normalize-genres');
}

function normalizeAndDetect() {
  const mapping = {
    pop: "Pop", rock: "Rock", indie: "Indie / Alternative",
    electronic: "Electronic", house: "Electronic", techno: "Electronic",
    trance: "Electronic", "hip hop": "Hip Hop / Rap", rap: "Hip Hop / Rap",
    r&b: "R&B / Soul", jazz: "Jazz / Blues", blues: "Jazz / Blues",
    classical: "Classical / Instrumental", metal: "Metal / Hard Rock",
    punk: "Metal / Hard Rock", folk: "Folk / Acoustic", acoustic: "Folk / Acoustic",
    latin: "Latin"
  };

  const bucketTrackMap = {}, rawGenresByBucket = {}, rawMap = window.artistGenreMap;

  window.likedTracks.forEach(item => {
    const track = item.track, aid = track?.artists[0]?.id;
    const genres = rawMap[aid] || ['Unknown'];
    let bucketFound = false;

    for (const g of genres) {
      const lower = g.toLowerCase();
      for (const key in mapping) {
        if (lower.includes(key)) {
          const bucket = mapping[key];
          (bucketTrackMap[bucket] ||= []).push(track);
          (rawGenresByBucket[bucket] ||= new Set()).add(g);
          bucketFound = true;
          break;
        }
      }
      if (bucketFound) break;
    }
    if (!bucketFound) {
      (bucketTrackMap["Other / Unmapped"] ||= []).push(track);
      (rawGenresByBucket["Other / Unmapped"] ||= new Set()).add(...genres);
    }
  });

  const bucketCounts = Object.entries(bucketTrackMap).map(([bucket, tracks]) => ({ bucket, count: tracks.length }));
  const totalTracks = window.likedTracks.length;
  const selected = bucketCounts.filter(({ count }) => count >= totalTracks * 0.02).map(({ bucket }) => bucket);

  window.selectedBuckets = selected;
  window.bucketTrackMap = bucketTrackMap;
  window.rawGenresByBucket = rawGenresByBucket;

  const container = document.getElementById('selection-container');
  container.innerHTML = '';
  selected.forEach(bucket => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${bucket}" checked> ${bucket} (${bucketTrackMap[bucket].length} songs)`;
    container.appendChild(label);
  });

  document.getElementById('bucket-selection').style.display = 'block';
  updateStatus('🧮 Genre buckets detected. Ready to make playlists.');
  enableButton('create-playlists');
}

document.getElementById('normalize-genres').addEventListener('click', () => {
  disableButton('normalize-genres');
  updateStatus('🔍 Detecting genre buckets...');
  normalizeAndDetect();
});

async function createPlaylistsFlow(token) {
  const profile = await (await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  })).json();
  const userId = profile.id;

  for (const bucket of window.selectedBuckets) {
    const tracks = window.bucketTrackMap[bucket];
    const uris = tracks.map(t => t.uri);
    const genres = Array.from(window.rawGenresByBucket[bucket]).join(', ');
    const name = `${bucket} Vibes`;
    const desc = `Includes original genres: ${genres}`;

    const resp = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: desc, public: false })
    });
    const data = await resp.json();
    const playlistId = data.id;

    for (let i = 0; i < uris.length; i += 100) {
      await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: uris.slice(i, i + 100) })
      });
    }
    updateStatus(`✅ Playlist "${name}" created with ${uris.length} songs.`);
  }

  updateStatus('🎉 All playlists created!');
}

document.getElementById('create-playlists').addEventListener('click', () => {
  disableButton('create-playlists');
  updateStatus('🚀 Creating playlists...');
  createPlaylistsFlow(window.spotifyToken);
});

window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code && params.get('state') === STATE) {
    fetchAccessToken(code);
    history.replaceState({}, document.title, REDIRECT_URI);
  }

  document.getElementById('fetch-tracks').addEventListener('click', () => fetchLikedSongs(window.spotifyToken));
  document.getElementById('fetch-genres').addEventListener('click', () => fetchGenres(window.spotifyToken));
};




















