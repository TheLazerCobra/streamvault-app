import { defineConfig } from 'vite';

// Deployed as a GitHub Pages project site at
// https://thelazercobra.github.io/streamvault-app/ — assets must resolve
// under that subpath, not the domain root.
export default defineConfig({
  base: '/streamvault-app/',
});
