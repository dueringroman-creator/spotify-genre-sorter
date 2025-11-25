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

// Login button → Spotify authorization
document.getElementById("login").addEventListener("click", async () => {
  const codeVerifier = generateRandomString(128);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem(CODE_VERIFIER_STORAGE_KEY, codeVerifier);

  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${SCOPES.join('%20')}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${STATE}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

  window.location = authUrl;
});

// Fetch token using the returned "code"
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

// Fetch ALL liked songs (paginated)
async function fetchAllLikedSongs(token) {
  let allTracks = [];
  let limit = 50;
  let offset = 0;
  let totalFetched = 0;
  let hasMore = true;

  document.getElementById("status").innerText = "🔄 Fetching liked songs...";

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

// Handle fetch button click
document.getElementById("fetch-tracks").addEventListener("click", () => {
  if (window.spotifyToken) {
    fetchAllLikedSongs(window.spotifyToken);
  } else {
    alert("Please log in to Spotify first!");
  }
});

// On page load: look for code param to exchange
window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");

  if (code && state === STATE) {
    fetchAccessToken(code);
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }
};




