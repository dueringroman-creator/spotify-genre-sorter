// ===== CONFIG =====
const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = ['user-library-read', 'playlist-modify-public', 'playlist-modify-private'];
const STATE = 'alchemist_state';

let spotifyToken = null;

// ===== UTILITY =====
function updateStatus(msg) {
  const s = document.getElementById('status');
  if (s) s.innerText = msg;
  console.log(msg);
}

function enable(id) {
  const b = document.getElementById(id);
  if (b) b.disabled = false;
}
function disable(id) {
  const b = document.getElementById(id);
  if (b) b.disabled = true;
}

// ===== AUTH & LOGIN =====
document.getElementById('login').onclick = async () => {
  const codeVerifier = generateRandomString(128);  
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem('pkce_code_verifier', codeVerifier);

  const authUrl = `https://accounts.spotify.com/authorize?` +
    `response_type=code&client_id=${CLIENT_ID}` +
    `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${STATE}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  window.location = authUrl;
};

// ===== PKCE Utils =====
function generateRandomString(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let res = '';
  const values = window.crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) {
    res += charset[values[i] % charset.length];
  }
  return res;
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem('pkce_code_verifier');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier
  });

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  });
  const data = await resp.json();
  return data.access_token;
}

// ===== FETCH LIKED SONGS =====
async function fetchLikedSongs(token) {
  let all = [];
  const limit = 50;
  let offset = 0;

  updateStatus('🎵 Fetching your saved songs…');
  disable('fetch-tracks');

  while (true) {
    const resp = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) {
      updateStatus(`❌ Error fetching songs: ${resp.status}`);
      break;
    }
    const data = await resp.json();
    if (!data.items || data.items.length === 0) break;
    all.push(...data.items);
    offset += limit;
    updateStatus(`Fetched ${all.length} songs so far…`);
  }

  window.likedTracks = all;
  updateStatus(`✅ Done! ${all.length} songs retrieved. Ready to fetch genres.`);
  enable('fetch-genres');
}

// ===== FETCH GENRES (ARTISTS) =====
async function fetchGenres(token) {
  const artistIds = new Set();
  window.likedTracks.forEach(item => {
    const track = item.track;
    if (!track || !track.artists) return;
    track.artists.forEach(a => artistIds.add(a.id));
  });

  const ids = Array.from(artistIds);
  updateStatus(`🔍 Fetching genres for ${ids.length} artists…`);
  disable('fetch-genres');

  const artistGenreMap = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(',');
    const resp = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) {
      updateStatus(`❌ Error fetching artist info: ${resp.status}`);
      continue;
    }
    const data = await resp.json();
    data.artists.forEach(a => {
      artistGenreMap[a.id] = a.genres || [];
    });
    updateStatus(`Processed ${Math.min(i + 50, ids.length)}/${ids.length} artists…`);
  }

  window.artistGenreMap = artistGenreMap;
  updateStatus('🎯 Genres loaded. Build your genre‑list now.');
  populateGenreSelector();
}

// ===== POPULATE GENRE SELECTOR =====
function populateGenreSelector() {
  const genreSet = new Set();

  window.likedTracks.forEach(item => {
    const track = item.track;
    if (!track || !track.artists) return;
    track.artists.forEach(a => {
      const gs = window.artistGenreMap[a.id] || [];
      gs.forEach(g => genreSet.add(g.toLowerCase()));
    });
  });

  const select = document.getElementById('genre-select');
  select.innerHTML = '';
  Array.from(genreSet).sort().forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.text = g;
    select.appendChild(opt);
  });

  document.getElementById('genre-select-container').style.display = 'block';
  updateStatus(`🎛️ Found ${genreSet.size} genres. Choose which to turn into playlists.`);
  enable('create-playlists');
}

// ===== PLAYLIST CREATION =====
document.getElementById('create-playlists').onclick = async () => {
  const sel = document.getElementById('genre-select');
  const chosen = Array.from(sel.selectedOptions).map(o => o.value);
  if (!chosen.length) {
    alert('Select at least one genre.');
    return;
  }

  updateStatus('🚀 Creating playlists…');
  const profile = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${spotifyToken}` }
  }).then(r => r.json());
  const userId = profile.id;

  document.getElementById('created-playlists').style.display = 'block';
  const list = document.getElementById('playlist-list');
  list.innerHTML = '';

  for (const genre of chosen) {
    const playlistName = `Alchemist – ${genre}`;
    const desc = `Playlist generated from genre: ${genre}`;
    const resp = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${spotifyToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: playlistName, description: desc, public: false })
    });
    if (!resp.ok) {
      updateStatus(`❌ Error creating playlist "${playlistName}": ${resp.status}`);
      continue;
    }
    const pd = await resp.json();
    const pid = pd.id;

    const uris = window.likedTracks
      .map(it => it.track)
      .filter(tr => tr.artists.some(a => {
        const gs = window.artistGenreMap[a.id] || [];
        return gs.map(x => x.toLowerCase()).includes(genre);
      }))
      .map(t => t.uri);

    for (let i = 0; i < uris.length; i += 100) {
      await fetch(`https://api.spotify.com/v1/playlists/${pid}/tracks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${spotifyToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uris: uris.slice(i, i + 100) })
      });
    }

    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `https://open.spotify.com/playlist/${pid}`;
    a.target = '_blank';
    a.textContent = `${playlistName} (${uris.length} songs)`;
    li.appendChild(a);
    list.appendChild(li);
  }

  updateStatus('✅ All selected playlists created.');
};

// ===== RESET SESSION =====
document.getElementById('reset-session').onclick = () => {
  localStorage.removeItem('spotify_token');
  window.likedTracks = null;
  window.artistGenreMap = null;
  document.getElementById('genre-select-container').style.display = 'none';
  document.getElementById('created-playlists').style.display = 'none';
  disable('fetch-tracks');
  disable('fetch-genres');
  disable('create-playlists');
  updateStatus('🧹 Session reset. Please login to start again.');
};

// ===== ON LOAD: check auth code or existing session =====
window.onload = async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (code && state === STATE) {
    spotifyToken = await exchangeCodeForToken(code);
    localStorage.setItem('spotify_token', spotifyToken);
    window.history.replaceState({}, document.title, REDIRECT_URI);
    updateStatus('🎉 Logged in — ready to fetch songs.');
    enable('fetch-tracks');
    return;
  }
  const stored = localStorage.getItem('spotify_token');
  if (stored) {
    spotifyToken = stored;
    updateStatus('🔄 Session resumed. Ready to fetch songs.');
    enable('fetch-tracks');
  }
};

// ===== FETCH & GENRE button handlers =====
document.getElementById('fetch-tracks').onclick = () => {
  if (!spotifyToken) {
    updateStatus('👆 Please login first.');
    return;
  }
  fetchLikedSongs(spotifyToken);
};

document.getElementById('fetch-genres').onclick = () => {
  if (!window.likedTracks) {
    updateStatus('👆 Please fetch your songs first.');
    return;
  }
  fetchGenres(spotifyToken);
};































