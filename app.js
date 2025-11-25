const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read','playlist-modify-public','playlist-modify-private'];
const STATE = 'spotify_auth';
const CODE_VERIFIER_STORAGE_KEY = 'spotify_code_verifier';

// Utility functions
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

  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}` +
            `&scope=${SCOPES.join('%20')}` +
            `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
            `&state=${STATE}&code_challenge=${challenge}&code_challenge_method=S256`;
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
    headers: {'Content-Type':'application/x-www-form-urlencoded'},
    body: body
  });
  const data = await resp.json();
  if (data.access_token) {
    window.spotifyToken = data.access_token;
    updateStatus('✅ Logged in. Fetch your liked songs.');
    disableButton('login');
    enableButton('fetch-tracks');
  } else {
    updateStatus('❌ Login failed. Please retry.');
    console.error('Token error', data);
  }
}

// Step 2: Fetch Liked Songs
async function fetchLikedSongs(token) {
  let allTracks = [];
  let limit = 50;
  let offset = 0;
  updateStatus('Fetching liked songs...');
  disableButton('fetch-tracks');

  while (true) {
    const resp = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    if (!data.items || data.items.length === 0) break;
    allTracks.push(...data.items);
    offset += limit;
    updateStatus(`Fetched ${allTracks.length} songs…`);
  }

  window.likedTracks = allTracks;
  updateStatus(`✅ All liked songs fetched (${allTracks.length}). Now fetch genres.`);
  enableButton('fetch-genres');
}

// Step 3: Fetch Genres for Artists
async function fetchGenres(token) {
  const artistIds = new Set();
  window.likedTracks.forEach(item => {
    if (item.track && item.track.artists && item.track.artists[0]) {
      artistIds.add(item.track.artists[0].id);
    }
  });
  const idsList = Array.from(artistIds);
  updateStatus(`Found ${idsList.length} unique artists.`);
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
    updateStatus(`Processed ${Math.min(i+50, idsList.length)} of ${idsList.length} artists…`);
  }

  window.artistGenreMap = artistGenreMap;
  updateStatus('✅ All artist genres fetched. Now normalize and detect prominent buckets.');
  enableButton('normalize-genres');
}

// Step 4: Normalize Genres & Detect Prominent Buckets
function detectProminentBuckets(rawGenreMap) {
  // Count raw genres
  const counts = {};
  window.likedTracks.forEach(item => {
    if (item.track && item.track.artists && item.track.artists[0]) {
      const artistId = item.track.artists[0].id;
      const genres = rawGenreMap[artistId] || ['Unknown'];
      genres.forEach(g => {
        counts[g] = (counts[g]||0) + 1;
      });
    }
  });
  // Convert to array and sort
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  // Choose top 8 raw genres as buckets for example
  const topN = 8;
  const topBuckets = sorted.slice(0, topN).map(e => e[0]);
  return topBuckets;
}

function normalizeAndDetect() {
  const mapping = {
    pop: "Pop",
    rock: "Rock",
    indie: "Indie / Alternative",
    electronic: "Electronic",
    house: "Electronic",
    techno: "Electronic",
    trance: "Electronic",
    "hip hop": "Hip Hop / Rap",
    rap: "Hip Hop / Rap",
    r&b: "R&B / Soul",
    jazz: "Jazz / Blues",
    blues: "Jazz / Blues",
    classical: "Classical / Instrumental",
    metal: "Metal / Hard Rock",
    punk: "Metal / Hard Rock",
    folk: "Folk / Acoustic",
    acoustic: "Folk / Acoustic",
    latin: "Latin"
  };

  const rawMap = window.artistGenreMap;
  const bucketTrackMap = {};
  const rawGenresByBucket = {};
  
  window.likedTracks.forEach(item => {
    const track = item.track;
    if (!track || !track.artists || !track.artists[0]) return;
    const aid = track.artists[0].id;
    const genres = rawMap[aid] || ['Unknown'];
    // Find first matching bucket
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
      genres.forEach(g=> rawGenresByBucket["Other / Unmapped"].add(g));
    }
  });

  // Now detect which buckets are large
  const bucketCounts = Object.entries(bucketTrackMap).map(([b, tracks]) => ({ bucket: b, count: tracks.length }));
  bucketCounts.sort((a,b) => b.count - a.count);
  
  // Choose only buckets above threshold, e.g., >2% of total
  const totalTracks = window.likedTracks.length;
  const threshold = totalTracks * 0.02;
  const selected = bucketCounts.filter(bc => bc.count >= threshold).map(bc => bc.bucket);

  window.selectedBuckets = selected;
  window.bucketTrackMap = bucketTrackMap;
  window.rawGenresByBucket = rawGenresByBucket;

  updateStatus(`Detected ${selected.length} prominent buckets out of ${bucketCounts.length} possible.`);
  
  // Show selection UI
  const container = document.getElementById('selection-container');
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
  normalizeAndDetect();
});

// Step 5: Create Playlists
document.getElementById('create-playlists').addEventListener('click', async () => {
  const autoMode = true; // you can add radio UI to select
  let buckets = [];
  if (autoMode) {
    buckets = window.selectedBuckets;
  } else {
    document.querySelectorAll('#selection-container input[type=checkbox]').forEach(cb => {
      if (cb.checked) buckets.push(cb.value);
    });
  }

  updateStatus(`Creating playlists for: ${buckets.join(', ')}`);
  for (const bucket of buckets) {
    const tracks = window.bucketTrackMap[bucket];
    const origGenres = Array.from(window.rawGenresByBucket[bucket]).join(', ');
    const name = `${bucket} Vibes`; // simple name or you can use funnyName(bucket)
    const description = `A curated mix of ${bucket} — original genres include: ${origGenres}`;
    // you need to implement createPlaylist + add tracks via Spotify Web API
    updateStatus(`Would create playlist "${name}" with ${tracks.length} tracks.`);
    // placeholder: actual API calls omitted here
  }
  updateStatus('🎉 Playlist creation step complete (placeholder).');
});
  
// On page load — check for code
window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (code && state === STATE) {
    fetchAccessToken(code);
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }
};












