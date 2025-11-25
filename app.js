const CLIENT_ID = '97762324651b49d1bb703566c9c36072';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
const SCOPES = [
  'user-library-read',
  'playlist-modify-public',
  'playlist-modify-private'
];

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
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

document.getElementById("login").addEventListener("click", async () => {
  const codeVerifier = generateRandomString(128);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem(CODE_VERIFIER_STORAGE_KEY, codeVerifier);

  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${SCOPES.join('%20')}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${STATE}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body
  });

  const data = await response.json();
  if (data.access_token) {
    console.log("Access Token:", data.access_token);
    window.spotifyToken = data.access_token;
    document.getElementById("status").innerText = "✅ Logged in and ready!";
  } else {
    console.error("Failed to get token", data);
  }
}

async function fetchAllLikedSongs(token) {
  let allTracks = [];
  let limit = 50;
  let offset = 0;
  let totalFetched = 0;
  let hasMore = true;

  document.getElementById("status").innerText = "🔄 Fetching liked songs...";
  document.getElementById("fetch-tracks").disabled = true;

  while (hasMore) {
    const response = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (data.items.length === 0) {
      hasMore = false;
    } else {
      allTracks.push(...data.items);
      offset += limit;
      totalFetched += data.items.length;
      console.log(`Fetched ${totalFetched} tracks so far...`);
    }
  }

  console.log(`✅ Fetched total of ${allTracks.length} liked songs`);
  document.getElementById("status").innerText = `✅ Fetched ${allTracks.length} liked songs`;
  window.likedTracks = allTracks;
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
  console.log(`🎨 Found ${artistIdList.length} unique artists`);

  for (let i = 0; i < artistIdList.length; i += 50) {
    const batch = artistIdList.slice(i, i + 50);
    const idsParam = batch.join(',');

    const response = await fetch(`https://api.spotify.com/v1/artists?ids=${idsParam}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();

    data.artists.forEach(artist => {
      artistGenreMap[artist.id] = artist.genres;
    });

    console.log(`Fetched genres for ${Math.min(i + 50, artistIdList.length)} of ${artistIdList.length} artists`);
  }

  console.log("✅ All artist genres fetched");
  return artistGenreMap;
}

function groupTracksByGenre(tracks, artistGenreMap) {
  const genreMap = {};

  tracks.forEach(item => {
    const track = item.track;
    if (!track || !track.artists || track.artists.length === 0) return;

    const artistId = track.artists[0].id;
    const genres = artistGenreMap[artistId] || ['Unknown'];

    genres.forEach(genre => {
      if (!genreMap[genre]) {
        genreMap[genre] = [];
      }
      genreMap[genre].push(track);
    });
  });

  console.log("🎶 Tracks grouped by genre:");
  console.log(genreMap);

  window.genreTrackMap = genreMap;
  return genreMap;
}

window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");

  if (code && state === STATE) {
    fetchAccessToken(code);
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }

  document.getElementById("fetch-tracks").addEventListener("click", () => {
    if (window.spotifyToken) {
      fetchAllLikedSongs(window.spotifyToken);
    } else {
      alert("Please log in to Spotify first!");
    }
  });

  document.getElementById("fetch-genres").addEventListener("click", async () => {
    if (window.likedTracks && window.spotifyToken) {
      const genreMap = await fetchGenresForArtists(window.likedTracks, window.spotifyToken);
      window.artistGenreMap = genreMap;
    } else {
      alert("Make sure you've fetched your liked songs first.");
    }
  });

  document.getElementById("group-by-genre").addEventListener("click", () => {
    if (window.likedTracks && window.artistGenreMap) {
      const result = groupTracksByGenre(window.likedTracks, window.artistGenreMap);
      document.getElementById("status").innerText = `✅ Grouped tracks into ${Object.keys(result).length} genres`;
    } else {
      alert("Make sure you've fetched songs and genres first.");
    }
  });
};





