// Replace this with the Client ID from your Spotify Developer app
const CLIENT_ID = 'YOUR_SPOTIFY_CLIENT_ID';
const REDIRECT_URI = 'http://localhost:5500/callback';
const SCOPES = [
  'user-library-read',
  'playlist-modify-public',
  'playlist-modify-private'
];

document.getElementById("login").onclick = () => {
  const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${SCOPES.join('%20')}&response_type=token`;
  window.location = authUrl;
};

let token = null;

if (window.location.hash) {
  token = new URLSearchParams(window.location.hash.substring(1)).get('access_token');
  window.history.pushState("", document.title, window.location.pathname); // Clean the URL
  console.log("Access Token:", token);
}
