// Wait until DOM is ready
document.addEventListener('DOMContentLoaded', main);

function main() {
  const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
  const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
  const SCOPES = ['user-library-read','playlist-modify-public','playlist-modify-private'];
  const STATE = 'spotify_auth';
  const CODE_VERIFIER_KEY = 'spotify_code_verifier';
  const STORAGE_KEY = 'playlistAlchemistState';

  const stepElems = {
    login: document.getElementById('step-1'),
    songs: document.getElementById('step-2'),
    genres: document.getElementById('step-3'),
    buckets: document.getElementById('step-4'),
    playlists: document.getElementById('step-5')
  };

  function updateStep(key) {
    Object.values(stepElems).forEach(el => el.classList.remove('active'));
    if (stepElems[key]) stepElems[key].classList.add('active');
  }

  function updateStatus(msg) {
    const st = document.getElementById('status');
    if (st) st.innerText = msg;
    console.log(msg);
  }
  function showError(msg) {
    const em = document.getElementById('error-msg');
    if (em) em.innerText = msg;
    console.error(msg);
  }
  function clearError() {
    const em = document.getElementById('error-msg');
    if (em) em.innerText = '';
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
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
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
  function saveState(obj) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      console.warn('Failed to save state', e);
    }
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
      saveState({ spotifyToken: data.access_token });
      updateStatus('✅ Logged in — you can fetch your saved songs.');
      clearError();
      disable('login');
      enable('fetch-songs');
      updateStep('songs');
    } else {
      showError('Login failed. Please try again.');
      console.error('Token error', data);
    }
  }

  async function fetchSavedTracks(token) {
    updateStatus('🎵 Fetching your saved songs…');
    clearError();
    disable('fetch-songs');
    let all = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const resp = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resp.status === 401) {
        // Unauthorized – token invalid or expired
        showError('❗ Authorization expired — please login again.');
        resetToLogin();
        return;
      }
      if (!resp.ok) {
        showError(`Error fetching songs (HTTP ${resp.status}).`);
        return;
      }
      const data = await resp.json();
      if (!data.items || data.items.length === 0) break;
      all.push(...data.items);
      offset += limit;
      updateStatus(`Fetched ${all.length} songs...`);
    }

    window.savedTracks = all;
    saveState({
      spotifyToken: token,
      savedTrackIDs: all.map(i => i.track.id)
    });
    updateStatus(`✅ Retrieved ${all.length} songs. Next: fetch genres.`);
    enable('fetch-genres');
    updateStep('genres');
  }

  async function fetchArtistGenres(token) {
    updateStatus('🔍 Gathering artist genres…');
    clearError();
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
      const resp = await fetch(`https://api.spotify.com/v1/artists?ids=${batch}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resp.status === 401) {
        showError('❗ Authorization expired — please login again.');
        resetToLogin();
        return;
      }
      if (!resp.ok) {
        showError(`Error fetching artist data (HTTP ${resp.status}).`);
        return;
      }
      const data = await resp.json();
      data.artists.forEach(a => {
        genreMap[a.id] = a.genres || [];
      });
      updateStatus(`Processed ${Math.min(i+50, artistIds.length)} of ${artistIds.length} artists...`);
    }

    window.artistGenreMap = genreMap;
    saveState({
      spotifyToken: token,
      savedTrackIDs: window.savedTracks.map(i => i.track.id),
      artistGenreMap: genreMap
    });
    updateStatus('✅ Genres gathered. Build buckets now.');
    updateStep('buckets');
    buildGenreBuckets();
  }

  function buildGenreBuckets() {
    const buckets = {};
    window.savedTracks.forEach(item => {
      const track = item.track;
      const a = track.artists[0];
      const genres = window.artistGenreMap[a.id] || [];
      genres.forEach(g => {
        if (!buckets[g]) buckets[g] = [];
        buckets[g].push(track);
      });
    });
    window.genreBuckets = buckets;

    const container = document.getElementById('genre-buckets');
    container.innerHTML = '';
    Object.entries(buckets)
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([genre, tracks]) => {
        const label = document.createElement('label');
        label.innerHTML = `<input type="checkbox" value="${genre}"> ${genre} — ${tracks.length} songs`;
        container.appendChild(label);
      });

    document.getElementById('genre-section').style.display = 'flex';
    enable('create-playlists');
    updateStatus('Select genre buckets to create playlists.');
  }

  async function createPlaylists(token) {
    updateStatus('🚀 Creating playlists…');
    clearError();
    disable('create-playlists');

    const allowOverlap = document.getElementById('allow-overlap')?.checked ?? true; // if you implement, else default true
    const respProfile = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (respProfile.status === 401) {
      showError('❗ Authorization expired — please login again.');
      resetToLogin();
      return;
    }
    const profile = await respProfile.json();
    const uid = profile.id;

    const selected = Array.from(document.querySelectorAll('#genre-buckets input:checked'))
      .map(el => el.value);
    const resultsEl = document.getElementById('playlist-links');
    resultsEl.innerHTML = '';
    document.getElementById('created-playlists').style.display = 'block';

    const usedURIs = new Set();

    for (const genre of selected) {
      let tracks = window.genreBuckets[genre];
      if (!allowOverlap) {
        tracks = tracks.filter(t => !usedURIs.has(t.uri));
      }
      if (!tracks.length) continue;

      const uris = tracks.map(t => t.uri);
      uris.forEach(u => usedURIs.add(u));

      const playlistName = `Alchemist: ${genre}`;
      const description = `Playlist with tracks of genre: ${genre}`;

      const respCreate = await fetch(`https://api.spotify.com/v1/users/${uid}/playlists`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ name: playlistName, description, public: false })
      });
      if (respCreate.status === 401) {
        showError('❗ Authorization expired — please login again.');
        resetToLogin();
        return;
      }
      const data = await respCreate.json();
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
      const li = document.createElement('li');
      li.innerHTML = `✅ <a class="playlist-link" href="${link}" target="_blank">${playlistName}</a> — ${uris.length} songs`;
      resultsEl.appendChild(li);
    }

    updateStatus('🎉 All playlists created.');
    updateStep('playlists');
  }

  function resetToLogin() {
    clearState();
    window.spotifyToken = null;
    updateStatus('Session cleared. Please login again.');
    disable('fetch-songs');
    disable('fetch-genres');
    disable('detect-buckets');
    disable('create-playlists');
    enable('login');
    document.getElementById('genre-section').style.display = 'none';
    document.getElementById('created-playlists').style.display = 'none';
    updateStep('login');
  }

  function resetSessionHandler() {
    resetToLogin();
    clearError();
  }

  // Attach listeners safely
  document.getElementById('login')?.addEventListener('click', async () => {
    const verifier = generateRandomString(128);
    const challenge = await generateCodeChallenge(verifier);
    localStorage.setItem(CODE_VERIFIER_KEY, verifier);
    const url = `https://accounts.spotify.com/authorize?response_type=code` +
                `&client_id=${CLIENT_ID}` +
                `&scope=${SCOPES.join('%20')}` +
                `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
                `&state=${STATE}` +
                `&code_challenge=${challenge}` +
                `&code_challenge_method=S256`;
    window.location = url;
  });

  document.getElementById('fetch-songs')?.addEventListener('click', () => {
    if (!window.spotifyToken) {
      showError('Please login first.');
      return;
    }
    fetchSavedTracks(window.spotifyToken);
  });

  document.getElementById('fetch-genres')?.addEventListener('click', () => {
    if (!window.savedTracks) {
      showError('No songs fetched yet.');
      return;
    }
    fetchArtistGenres(window.spotifyToken);
  });

  document.getElementById('detect-buckets')?.addEventListener('click', () => {
    if (!window.artistGenreMap) {
      showError('No genre data available.');
      return;
    }
    buildGenreBuckets();
  });

  document.getElementById('create-playlists')?.addEventListener('click', () => {
    createPlaylists(window.spotifyToken);
  });

  document.getElementById('select-all')?.addEventListener('click', () => {
    document.querySelectorAll('#genre-buckets input[type="checkbox"]').forEach(cb => cb.checked = true);
  });
  document.getElementById('deselect-all')?.addEventListener('click', () => {
    document.querySelectorAll('#genre-buckets input[type="checkbox"]').forEach(cb => cb.checked = false);
  });

  document.getElementById('reset-session')?.addEventListener('click', resetSessionHandler);

  // On load: auth callback or resume
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
      updateStatus('Session restored. You may resume.');
      disable('login');
      enable('fetch-songs');
      updateStep('songs');
    }
  }
}




























