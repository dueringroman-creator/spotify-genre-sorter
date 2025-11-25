const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read', 'playlist-modify-public', 'playlist-modify-private'];
const STATE = 'spotify_auth';
const CODE_VERIFIER_STORAGE_KEY = 'spotify_code_verifier';

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
  updateStatus('Hold on, beautiful human — redirecting you to Spotify for login 💫 (Our little music‑bots are button‑pushing behind the scenes…)');
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
    updateStatus('🎉 You’re logged in, you beautiful human! Our music‑bots are now ready to rummage your library.');
    disableButton('login');
    enableButton('fetch-tracks');
  } else {
    updateStatus('🤔 Huh, login failed. Let’s try again (our music‑bots tripped over a cord…).');
    console.error('Token error', data);
  }
}

// Step 2: Fetch Liked Songs
async function fetchLikedSongs(token) {
  let allTracks = [];
  const limit = 50;
  let offset = 0;
  updateStatus('🎵 Our music‑bots are digging through your liked songs… (let’s see those hits!).');
  disableButton('fetch-tracks');

  while (true) {
    const resp = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    if (!data.items || data.items.length === 0) break;
    allTracks.push(...data.items);
    offset += limit;
    updateStatus(`Fetched ${allTracks.length} songs so far… (chomping through your stash!)`);
  }

  window.likedTracks = allTracks;
  updateStatus(`✅ Done! We found ${allTracks.length} songs. Next up: discovering your genre‑wildlife 🦜.`);
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
  updateStatus(`🔍 Scanning ${idsList.length} artists for genre clues… (our detective bots are at work)`);
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
    updateStatus(`Processed ${Math.min(i+50, idsList.length)} / ${idsList.length} artists… (detective bots still analysing)`);
  }

  window.artistGenreMap = artistGenreMap;
  updateStatus('🎛️ Sweet — genres fetched! Time to spin those tracks into vibe‑buckets.');
  enableButton('normalize-genres');
}

// Step 4: Normalize & Detect Prominent Buckets
function normalizeAndDetect() {
  const mapping = {
    pop: "Pop", rock: "Rock", indie: "Indie / Alternative",
    electronic: "Electronic", house: "Electronic", techno: "Electronic",
    trance: "Electronic", "hip hop": "Hip Hop / Rap", rap: "Hip Hop / Rap",
    r&b: "R&B / Soul", jazz: "Jazz / Blues", blues: "Jazz / Blues",
    classical: "Classical / Instrumental", metal: "Metal / Hard Rock",
    punk: "Metal / Hard Rock", folk: "Folk / Acoustic",
    acoustic: "Folk / Acoustic", latin: "Latin"
  };

  const rawMap = window.artistGenreMap;
  const bucketTrackMap = {};
  const rawGenresByBucket = {};

  window.likedTracks.forEach(item => {
    const track = item.track;
    if (!track || !track.artists || !track.artists[0]) return;
    const aid = track.artists[0].id;
    const genres = rawMap[aid] || ['Unknown'];
    let bucketFound = false;
    for (const g of genres) {
      const lower = g.toLowerCase();
      for (const key in mapping) {
        if (lower.includes(key)) {
          const bucket = mapping[key];
          bucketTrackMap[bucket] = bucketTrackMap[bucket] || [];
          bucketTrackMap[bucket].push(track);
          rawGenresByBucket[bucket] = rawGenresByBucket[bucket] || new Set();
          rawGenresByBucket[bucket].add(g);
          bucketFound = true;
          break;
        }
      }
      if (bucketFound) break;
    }
    if (!bucketFound) {
      bucketTrackMap["Other / Unmapped"] = bucketTrackMap["Other / Unmapped"] || [];
      bucketTrackMap["Other / Unmapped"].push(track);
      rawGenresByBucket["Other / Unmapped"] = rawGenresByBucket["Other / Unmapped"] || new Set();
      genres.forEach(g => rawGenresByBucket["Other / Unmapped"].add(g));
    }
  });

  const bucketCounts = Object.entries(bucketTrackMap).map(([b,tracks]) => ({ bucket: b, count: tracks.length }));
  bucketCounts.sort((a,b) => b.count - a.count);
  const total = window.likedTracks.length;
  const threshold = total * 0.02;
  const selected = bucketCounts.filter(bc => bc.count >= threshold).map(bc => bc.bucket);

  window.selectedBuckets = selected;
  window.bucketTrackMap = bucketTrackMap;
  window.rawGenresByBucket = rawGenresByBucket;

  updateStatus(`🧮 Buckets detected: ${selected.length}. Choose your favourites or go wild with all.`);
  const container = document.getElementById('selection-container');
  container.innerHTML = '';
  selected.forEach(bucket => {
    const cnt = bucketTrackMap[bucket].length;
    const orig = Array.from(rawGenresByBucket[bucket]).join(', ');
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${bucket}" checked> ${bucket} (${cnt} songs) — includes: ${orig}`;
    container.appendChild(label);
  });
  document.getElementById('bucket-selection').style.display = 'block';
  enableButton('create-playlists');
}

document.getElementById('normalize-genres').addEventListener('click', () => {
  disableButton('normalize-genres');
  updateStatus('🧮 Crunching your sounds… building vibe‑buckets in our music lab!');
  normalizeAndDetect();
});

// Step 5: Create Playlists
async function createPlaylistAndAddTracks(userId, token, name, description, trackUris) {
  const createResp = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,
      description: description,
      public: false
    })
  });
  const createData = await createResp.json();
  const playlistId = createData.id;
  updateStatus(`Created playlist "${name}" — naming the dancefloor!`);

  for (let i = 0; i < trackUris.length; i += 100) {
    const batch = trackUris.slice(i, i + 100);
    await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: batch })
    });
    updateStatus(`Adding tracks to "${name}"… (${Math.min(i+100, trackUris.length)}/${trackUris.length})`);
  }

  updateStatus(`✅ Playlist "${name}" loaded with ${trackUris.length} songs. Enjoy!`);
}

async function createPlaylistsFlow(token) {
  const profileResp = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const profileData = await profileResp.json();
  const userId = profileData.id;

  updateStatus('🚀 Launching playlist creation… our party‑bots are assembling your mixes!');
  const buckets = window.selectedBuckets;
  for (const bucket of buckets) {
    const tracks = window.bucketTrackMap[bucket];
    const uris = tracks.map(t => t.uri);
    const orig = Array.from(window.rawGenresByBucket[bucket]).join(', ');
    const name = `${bucket} Vibes`;
    const desc = `Curated mix of ${bucket} — includes original genres: ${orig}`;
    await createPlaylistAndAddTracks(userId, token, name, desc, uris);
  }

  updateStatus('🎉 All done! Your custom playlists are ready — go jam out, you beautiful human!');
}

document.getElementById('create-playlists').addEventListener('click', async () => {
  disableButton('create-playlists');
  updateStatus('🚀 Starting playlist creation… sit tight, fun is loading.');
  await createPlaylistsFlow(window.spotifyToken);
});

// On load: check for auth code & wire buttons
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

  document.getElementById('normalize-genres').addEventListener('click', () => {
    if (!window.artistGenreMap) {
      updateStatus('🧐 Please fetch genres first, my friend.');
      return;
    }
  });
};
















