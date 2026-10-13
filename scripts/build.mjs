#!/usr/bin/env node
/**
 * Builds the repository that the webOS Homebrew Channel reads.
 *
 * Input: one YAML file per app in packages/, named <app id>.yml, in the same
 * format as the official repository (https://github.com/webosbrew/apps-repo).
 *
 * Output (public/, published to GitHub Pages), in the same layout as
 * https://repo.webosbrew.org/api/ so the Homebrew Channel and other clients
 * (e.g. webOS Dev Manager) read it the same way:
 *
 *   public/api/apps.json                              every app, one page
 *   public/api/apps/<id>/full_description.html        the description as HTML
 *   public/api/apps/<id>/releases/latest.json         one app (dev-manager-desktop)
 *   public/index.html                                 a page with the repo address
 *
 * How the Homebrew Channel uses it: it downloads apps.json, lists the
 * `packages`, and when one is opened it downloads its `manifestUrl` (the
 * version, .ipk link and SHA-256 written by each app's release) and its
 * `fullDescriptionUrl`. Relative links are resolved against the address of
 * apps.json, and the manifest's `ipkUrl` against the manifest's address.
 *
 * Apps point at their *latest* release's manifest, so a new app version is
 * picked up by TVs without rebuilding this repository. Rebuild only when an
 * entry in packages/ changes.
 *
 * Each manifest is downloaded during the build to check it (id, version,
 * .ipk link and hash) and to take the app's one-line description from it;
 * a broken one fails the build. An app whose manifest isn't there yet (HTTP
 * 404: no GitHub release with the manifest attached) is left out of the
 * listing with a warning instead, so adding an app before its first release
 * doesn't stop the other apps from being published; it appears with the
 * next build after the release. `--offline` skips all of that (for a quick local
 * preview); the one-line description then comes from `shortDescription` in
 * the YAML, if set.
 *
 * Usage: node scripts/build.mjs [--offline]   (or: npm run build)
 */
import {
  mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');
const outDir = join(root, 'public');
const apiDir = join(outDir, 'api');

/** Where the repository is published (GitHub Pages of pustal/webos-repo). */
const SITE_URL = 'https://pustal.github.io/webos-repo/';
/** The address to add in the Homebrew Channel's settings. */
const REPO_URL = `${SITE_URL}api/apps.json`;

const offline = process.argv.includes('--offline');

/** Fields copied from the YAML into apps.json, as the official repository does. */
const LIST_KEYS = ['title', 'iconUri', 'manifestUrl', 'category', 'pool', 'requirements', 'screenshots'];
/** Every field an entry may have; anything else is probably a typo. */
const KNOWN_KEYS = LIST_KEYS.concat(['description', 'shortDescription', 'funding', 'detailIconUri']);
const REQUIRED_KEYS = ['title', 'iconUri', 'manifestUrl', 'description'];
/**
 * Categories the official repository's site groups apps by. Others are
 * allowed (the Homebrew Channel doesn't use categories) but get a warning.
 */
const CATEGORIES = ['multimedia', 'game', 'amblight', 'screensaver', 'launcher', 'utility', 'system'];

/** Problems found; the build fails if there are any. */
const errors = [];
function fail(id, message) {
  errors.push(`${id}: ${message}`);
}

/** True for an https:// link (or, for icons, a data: URI). */
function isHttps(url, allowData) {
  return typeof url === 'string' && (/^https:\/\/\S+$/.test(url) || (allowData && /^data:image\//.test(url)));
}

/** Text made safe to put inside HTML. */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * Reads and checks one entry of packages/.
 * @param {string} file  e.g. "org.stashwebos.app.yml"
 * @returns {Object|null} the entry with its `id`, or null when it can't be read
 */
function readPackage(file) {
  const id = file.replace(/\.ya?ml$/, '');
  let info;
  try {
    info = parseYaml(readFileSync(join(packagesDir, file), 'utf8'));
  } catch (err) {
    fail(id, `not valid YAML: ${err.message}`);
    return null;
  }
  if (!info || typeof info !== 'object') {
    fail(id, 'empty file');
    return null;
  }
  for (const k of REQUIRED_KEYS) if (!info[k]) fail(id, `"${k}" is missing`);
  for (const k of Object.keys(info)) if (!KNOWN_KEYS.includes(k)) fail(id, `unknown field "${k}"`);
  if (info.iconUri && !isHttps(info.iconUri, true)) fail(id, 'iconUri must be an https:// link or a data: URI');
  if (info.iconUri && /github\.com\/[^/]+\/[^/]+\/blob\//.test(info.iconUri)) {
    fail(id, 'iconUri is a github.com ".../blob/..." page; use the raw.githubusercontent.com link to the image');
  }
  if (info.manifestUrl && !isHttps(info.manifestUrl)) fail(id, 'manifestUrl must be an https:// link');
  if (info.category && !CATEGORIES.includes(info.category)) {
    console.warn(`Warning: ${id}: category "${info.category}" is not one of ${CATEGORIES.join(', ')}`);
  }
  if (info.pool && !['main', 'non-free'].includes(info.pool)) fail(id, 'pool must be "main" or "non-free"');
  return Object.assign({ id }, info);
}

/** Marks an app whose manifest doesn't exist yet (see fetchManifest). */
const UNRELEASED = Symbol('unreleased');

/**
 * Downloads and checks an app's manifest.
 * @returns {Promise<Object|null|symbol>} the manifest; null when it is broken
 *   (an error is recorded); UNRELEASED when there is no release with it yet
 */
async function fetchManifest(pkg) {
  let manifest;
  try {
    const res = await fetch(pkg.manifestUrl, { redirect: 'follow' });
    if (res.status === 404) {
      console.warn(`Warning: ${pkg.id}: left out, its manifest isn't released yet (HTTP 404 for ${pkg.manifestUrl}). `
        + 'Attach it to a GitHub release of the app and build again.');
      return UNRELEASED;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    fail(pkg.id, `couldn't download the manifest ${pkg.manifestUrl}: ${err.message}`);
    return null;
  }
  if (manifest.id !== pkg.id) fail(pkg.id, `the manifest is for "${manifest.id}"; the file name must be the app id`);
  if (!manifest.version) fail(pkg.id, 'the manifest has no version');
  if (!manifest.ipkUrl) fail(pkg.id, 'the manifest has no ipkUrl');
  if (!manifest.ipkHash || !/^[0-9a-f]{64}$/.test(manifest.ipkHash.sha256 || '')) {
    fail(pkg.id, 'the manifest has no ipkHash.sha256');
  }
  return manifest;
}

/**
 * The entry as clients see it.
 * @param {Object} pkg
 * @param {string} descriptionUrl  fullDescriptionUrl, relative to the JSON file it's in
 */
function listItem(pkg, descriptionUrl) {
  const item = { id: pkg.id };
  for (const k of LIST_KEYS) if (pkg[k] !== undefined) item[k] = pkg[k];
  if (!item.pool) item.pool = 'main';
  // As the official repository: the manifest's appDescription first.
  item.shortDescription = (pkg.manifest && pkg.manifest.appDescription) || pkg.shortDescription || '';
  item.fullDescriptionUrl = descriptionUrl;
  return item;
}

/** Screenshots (if any) and the Markdown description, as HTML. */
function descriptionHtml(pkg) {
  const shots = (pkg.screenshots || []).map((s) => {
    const url = typeof s === 'string' ? s : s.url;
    const caption = typeof s === 'string' ? '' : s.caption || '';
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(caption)}" title="${escapeHtml(caption)}" style="max-width:100%">`;
  });
  return (shots.length ? `<p>${shots.join('\n')}</p>\n` : '') + marked.parse(pkg.description || '');
}

/** A plain page with the repository address and its apps. */
function indexHtml(packages) {
  const apps = packages.map((p) => {
    const source = p.manifest && p.manifest.sourceUrl;
    const version = p.manifest && p.manifest.version ? ` <small>${escapeHtml(p.manifest.version)}</small>` : '';
    return `<li><img src="${escapeHtml(p.iconUri)}" alt="" width="48" height="48">
      <div><strong>${escapeHtml(p.title)}</strong>${version}<br>${escapeHtml(listItem(p, '').shortDescription)}
      ${source ? `<br><a href="${escapeHtml(source)}">${escapeHtml(source)}</a>` : ''}</div></li>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pustal's webOS apps</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; color: #222; background: #fff; }
  code { background: #f0f0f0; padding: 0.15rem 0.35rem; border-radius: 4px; word-break: break-all; }
  ul { list-style: none; padding: 0; }
  li { display: flex; gap: 1rem; align-items: flex-start; margin: 1rem 0; }
  li img { border-radius: 8px; flex: none; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #161616; } code { background: #2a2a2a; } a { color: #8cf; } }
</style>
</head>
<body>
<h1>pustal's webOS apps</h1>
<p>A repository for the <a href="https://github.com/webosbrew/webos-homebrew-channel">webOS Homebrew Channel</a>.
On the TV, open Homebrew Channel → Settings → Add repository and enter:</p>
<p><code>${escapeHtml(REPO_URL)}</code></p>
<h2>Apps</h2>
<ul>
${apps}
</ul>
</body>
</html>
`;
}

/** Writes a file, creating its folder. */
function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

async function main() {
  const files = readdirSync(packagesDir).filter((f) => /\.ya?ml$/.test(f)).sort();
  let packages = files.map(readPackage).filter(Boolean);
  if (!offline) {
    const manifests = await Promise.all(packages.map((p) => (p.manifestUrl ? fetchManifest(p) : null)));
    packages.forEach((p, i) => { p.manifest = manifests[i]; });
    // Apps without a release yet aren't listed: the TV couldn't install them.
    packages = packages.filter((p) => p.manifest !== UNRELEASED);
  }
  if (errors.length) {
    console.error(`The repository was not built:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  packages.sort((a, b) => a.title.localeCompare(b.title));

  rmSync(outDir, { recursive: true, force: true });
  // GitHub Pages: serve the files as they are (no Jekyll processing).
  write(join(outDir, '.nojekyll'), '');
  write(join(outDir, 'index.html'), indexHtml(packages));

  for (const p of packages) {
    const appDir = join(apiDir, 'apps', p.id);
    write(join(appDir, 'full_description.html'), descriptionHtml(p));
    write(join(appDir, 'releases', 'latest.json'), `${JSON.stringify(listItem(p, '../full_description.html'), null, 2)}\n`);
  }

  // The Homebrew Channel reads only this file and never asks for another
  // page, so it holds every app and says it is the only page.
  const list = {
    paging: {
      page: 1, count: packages.length, maxPage: 1, itemsTotal: packages.length, prevUrl: null, nextUrl: null,
    },
    packages: packages.map((p) => listItem(p, `apps/${p.id}/full_description.html`)),
  };
  write(join(apiDir, 'apps.json'), `${JSON.stringify(list, null, 2)}\n`);

  console.log(`Built ${packages.length} app${packages.length === 1 ? '' : 's'} into public/${offline ? ' (offline: manifests not checked)' : ''}.`);
  console.log(`Repository address for the Homebrew Channel: ${REPO_URL}`);
}

main();
