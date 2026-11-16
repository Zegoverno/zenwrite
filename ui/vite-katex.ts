// KaTeX ships each font three times (woff2, woff, ttf). Every browser that can run this app takes
// woff2, so the others are dropped: the MCP App's single HTML file stays small and the PWA caches
// a third of the fonts.
import type { Plugin } from 'vite';

export function katexWoff2Only(): Plugin {
  return {
    name: 'zenwrite-katex-woff2',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('katex.min.css')) return null;
      return { code: code.replace(/,url\([^)]*\.(?:woff|ttf)\) format\("[a-z]+"\)/g, ''), map: null };
    },
  };
}
