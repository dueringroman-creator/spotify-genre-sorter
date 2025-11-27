# Playlist Alchemist

Playlist Alchemist is a lightweight front-end tool that lets you log into Spotify, organize your saved songs by genre, and generate fresh playlists. The app runs entirely in the browser and uses Spotify's PKCE OAuth flow—no backend required.

## Features
- **Library-based playlists:** Fetch your liked tracks, group them by artist genres, and build playlists from any combination of genres.
- **Artist discovery:** Search for an artist, browse related artists, and generate a playlist from their top tracks.
- **Smart UI helpers:** Genre filtering, select/clear all toggles, playlist naming, and clear status updates for each step.

## Getting started
1. Open `index.html` in a browser (or deploy the repository with GitHub Pages). The current OAuth redirect is set to `https://dueringroman-creator.github.io/spotify-genre-sorter/` in `app.js`.
2. Click **Login with Spotify** and complete the PKCE authorization flow.
3. Use the **My Library** tab to load your liked songs, select genres, and create a playlist.
4. Switch to **Artist Discovery** to search for artists, pick related artists, and generate a playlist from their top tracks.

## Configuration
If you fork the project, update `CLIENT_ID` and `REDIRECT_URI` in `app.js` to match your Spotify application settings. The app requests the `user-library-read`, `playlist-modify-public`, `playlist-modify-private`, and `user-top-read` scopes to fetch saved tracks and create playlists on your behalf.

## Development notes
The project is entirely static—no build step is required. Serve the files with any static host (e.g., `python -m http.server`) if you need to test a different redirect URI locally.
