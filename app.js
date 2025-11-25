// Replace this with the Client ID from your Spotify Developer app
const CLIENT_ID = 'fbfe6cf7e22a42d09ddeaab6449c7c1f';
const REDIRECT_URI = 'https://dueringroman-creator.github.io/spotify-genre-sorter/';
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

window.onload = () => {
  if (window.location.hash) {
    const token = new URLSearchParams(window.location.hash.substring(1)).get('access_token');
    console.log("Access Token:", token);

    // You can now store it globally if needed
    window.spotifyToken = token;
  }
};

