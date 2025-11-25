const CLIENT_ID = 'fbfe6cf7e22a42d09ddeaab6449c7c1f';
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
  } else {
    console.error("Failed to get token", data);
  }
}

window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");

  if (code && state === STATE) {
    fetchAccessToken(code);
    // Optional: clear URL
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }
};


