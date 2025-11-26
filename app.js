// Wrap everything to run after DOM is ready
function readyMain() {
  const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
  const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
  const SCOPES = ['user-library-read','playlist-modify-public','playlist-modify-private'];
  const STATE = 'spotify_auth';
  const CODE_VERIFIER_KEY = 'spotify_code_verifier';
  const STORAGE_KEY = 'playlistAlchemistState';

  function updateStep(stepIndex) {
    const steps = document.querySelectorAll('.stepper .step');
    steps.forEach((s,i) => {
      if (i === stepIndex) s.classList.add('active');
      else s.classList.remove('active');
    });
  }

  function updateStatus(msg) {
    const st = document.getElementById('status');
    if (st) st.innerText = msg;
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

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  function clearState() {
    localStorage.removeItem(STORAGE_KEY);
  }

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
      const st = { spotifyToken: data.access_token };
      saveState(st);
      updateStatus('✅ Logged in — you can fetch your saved songs.');
      disable('login');
      enable('fetch-tracks');
      updateStep(1);
    } else {
      updateStatus('❌ Login failed. Please retry.');
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
      try {
        const resp = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data.items || data.items.length === 0) break;
        all.push(...data.items);
        offset += limit;
        updateStatus(`Fetched ${all.length} songs...`);
      } catch (err) {
        console.error('Error fetching songs:', err);
        updateStatus(`⚠️ Error at offset ${offset}. Retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
    }
    window.savedTracks = all;
    saveState({ spotifyToken: token, savedTracks: all.map(i => i.track.id) });
    updateStatus(`✅ Retrieved ${all.length} songs. Next: gather artist genres.`);
    enable('fetch-genres');
    updateStep(2);
  }

  // Step 3: Fetch artist genres
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
      try {
        const resp = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        data.artists.forEach(a => {
          genreMap[a.id] = a.genres || [];
        });
        updateStatus(`Fetched genres for ${Math.min(i + 50, artistIds.length)} / ${artistIds.length} artists...`);
      } catch (err) {
        console.error('Error fetching artist genres:', err);
        updateStatus(`⚠️ Error at batch starting ${i}. Retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        i -= 50;
        continue;
      }
    }

    window.artistGenreMap = genreMap;
    saveState({
      spotifyToken: token,
      savedTracks: window.savedTracks.map(i => i.track.id),
      artistGenreMap: genreMap
    });
    updateStatus('✅ Genres gathered. Building genre buckets...');
    buildGenreBuckets();
    updateStep(3);
  }

  // Build genre → tracks map
  function buildGenreBuckets() {
    const buckets = {};
    window.savedTracks.forEach(item => {
      const track = item.track;
      const a = track.artists[0];
      const genres = window.artistGenreMap[a.id] || [];
      genres.forEach(g => {
        const key = g;
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(track);
      });
    });
    window.genreBuckets = buckets;

    const genreListEl = document.getElementById('genre-list');
    genreListEl.innerHTML = '';
    Object.entries(buckets)
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([genre, tracks]) => {
        const label = document.createElement('label');
        label.innerHTML = `<input type="checkbox" value="${genre}"> ${genre} — ${tracks.length} songs`;
        genreListEl.appendChild(label);
      });

    document.getElementById('genre-selection').style.display = 'block';
    updateStatus('Select which genres (or combinations) you want playlists for.');
    updateStep(4);
  }

  // Step 4 → Step 5: Playlist creation
  async function createPlaylists(token) {
    updateStatus('🚀 Creating playlists …');
    disable('create-playlists');

    const allowOverlap = document.getElementById('allow-overlap')?.checked ?? true;
    const profile = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    const uid = profile.id;

    const selected = Array.from(document.querySelectorAll('#genre-list input:checked')).map(el => el.value);
    const resultsEl = document.getElementById('playlist-list');
    resultsEl.innerHTML = '';
    document.getElementById('playlist-results').style.display = 'block';

    const usedTrackUris = new Set();

    for (const genre of selected) {
      let tracks = window.genreBuckets[genre];
      if (!allowOverlap) {
        tracks = tracks.filter(t => !usedTrackUris.has(t.uri));
      }
      if (tracks.length === 0) continue;

      const uris = tracks.map(t => t.uri);
      uris.forEach(u => usedTrackUris.add(u));

      const playlistName = `Alchemist: ${genre}`;
      const description = `Generated playlist for genre: ${genre}`;

      const resp = await fetch(`https://api.spotify.com/v1/users/${uid}/playlists`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ name: playlistName, description, public: false })
      });
      const data = await resp.json();
      const pid = data.id;

      for (let i = 0; i < uris.length; i += 100) {
        const chunk = uris.slice(i, i + 100);
        await fetch(`https://api.spotify.com/v1/playlists/${pid}/tracks`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ uris: chunk })
        });
      }

      const link = `https://open.spotify.com/playlist/${pid}`;
      resultsEl.innerHTML += `<li>✅ <a class="playlist-link" href="${link}" target="_blank">${playlistName}</a> — ${uris.length} songs</li>`;
    }

    updateStatus('🎉 Done! Your playlists are ready.');
    updateStep(4); // Stay on Create step
  }

  function resetSession() {
    clearState();
    window.location.reload();
  }

  // Hook up buttons safely
  document.getElementById('login')?.addEventListener('click', async () => {
    const verifier = generateRandomString(128);
    const challenge = await generateCodeChallenge(verifier);
    localStorage.setItem(CODE_VERIFIER_KEY, verifier);

    const url = `https://accounts.spotify.com/authorize?response_type=code` +
                `&client_id=${CLIENT_ID}` +
                `&scope=${SCOPES.join('%20')}` +
                `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
                `&state=${STATE}` +
                `&code_challenge=${challenge}&code_challenge_method=S256`;
    window.location = url;
  });
  document.getElementById('fetch-tracks')?.addEventListener('click', () => {
    fetchSavedTracks(window.spotifyToken);
  });
  document.getElementById('fetch-genres')?.addEventListener('click', () => {
    fetchArtistGenres(window.spotifyToken);
  });
  document.getElementById('create-playlists')?.addEventListener('click', () => {
    createPlaylists(window.spotifyToken);
  });
  document.getElementById('select-all-genres')?.addEventListener('click', () => {
    document.querySelectorAll('#genre-list input[type="checkbox"]').forEach(cb => cb.checked = true);
  });
  document.getElementById('clear-genres')?.addEventListener('click', () => {
    document.querySelectorAll('#genre-list input[type="checkbox"]').forEach(cb => cb.checked = false);
  });
  document.getElementById('reset-session')?.addEventListener('click', resetSession);

  // On load, handle auth callback or restore session
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const stateParam = params.get('state');
  if (code && stateParam === STATE) {
    fetchAccessToken(code);
    window.history.replaceState({}, document.title, REDIRECT_URI);
  } else {
    const st = loadState();
    if (st && st.spotifyToken) {
      window.spotifyToken = st.spotifyToken;
      updateStatus('Resumed previous session.');
      disable('login');
      enable('fetch-tracks');
      updateStep(1);
    }
  }
}

// Wait until DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', readyMain);
} else {
  readyMain();
}




























