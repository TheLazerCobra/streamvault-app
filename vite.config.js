import { defineConfig } from 'vite';

// Served at the custom domain https://streamvault.quest/ (root), via
// GitHub Pages — assets resolve at the domain root, not under a repo-name
// subpath. (The old thelazercobra.github.io/streamvault-app/ URL now
// 404s on assets since the underlying files aren't nested under that
// path; GitHub redirects that URL to the custom domain anyway.)
export default defineConfig({
  base: '/',
});
