// Summarises `next experimental-analyze --output` into per-route client JS by package.
// Usage: npx next experimental-analyze --output && node scripts/bundle-report.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = '.next/diagnostics/analyze/data';
const ROUTES = ['/', '/screener', '/watchlist', '/heatmap', '/[symbol]'];

function load(route) {
  const buf = readFileSync(`${ROOT}${route === '/' ? '' : route}/analyze.data`);
  const n = buf.readUInt32BE(0);
  return JSON.parse(buf.subarray(4, 4 + n).toString());
}

function fullPath(sources, i) {
  const parts = [];
  for (let s = sources[i]; s; s = sources[s.parent_source_index]) parts.unshift(s.path);
  return parts.join('');
}

function group(path) {
  const nm = path.lastIndexOf('node_modules/');
  if (nm >= 0) {
    const rest = path.slice(nm + 13).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  const src = path.match(/src\/(app|components\/[^/]+|lib|hooks|stores|workers)/);
  return src ? `src/${src[1]}` : 'other';
}

const report = {};
for (const route of ROUTES) {
  if (!existsSync(`${ROOT}${route === '/' ? '' : route}/analyze.data`)) continue;
  const d = load(route);
  const groups = new Map();
  let raw = 0;
  let gz = 0;
  for (const part of d.chunk_parts) {
    const file = d.output_files[part.output_file_index].filename;
    if (!file.startsWith('[client-fs]/_next/static/chunks/') || !file.endsWith('.js')) continue;
    const g = group(fullPath(d.sources, part.source_index));
    const cur = groups.get(g) ?? { raw: 0, gz: 0 };
    cur.raw += part.size;
    cur.gz += part.compressed_size;
    groups.set(g, cur);
    raw += part.size;
    gz += part.compressed_size;
  }
  const kb = v => Math.round(v / 102.4) / 10;
  report[route] = {
    totalKB: kb(raw),
    compressedKB: kb(gz),
    top: [...groups]
      .sort((a, b) => b[1].raw - a[1].raw)
      .slice(0, 10)
      .map(([name, v]) => ({ name, KB: kb(v.raw), compressedKB: kb(v.gz) })),
  };
}

writeFileSync('reports/bundle.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
