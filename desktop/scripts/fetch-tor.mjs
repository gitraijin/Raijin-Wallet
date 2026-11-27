#!/usr/bin/env node
/**
 * Downloads the Tor Expert Bundle for a desktop target into
 * tor-bundle/<os>-<arch>/ (tor/ = binary + libraries, data/ = geoip).
 * electron-builder copies that folder into the app (extraResources).
 *
 *   node scripts/fetch-tor.mjs                      # this computer
 *   node scripts/fetch-tor.mjs --os mac --arch arm64
 *   node scripts/fetch-tor.mjs --os mac --arch all  # arm64 + x64
 *
 * TOR_VERSION pins a Tor Browser release (e.g. 16.0.1); default: latest.
 * The archive's SHA-256 is checked against the release's
 * sha256sums-signed-build.txt.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = 'https://dist.torproject.org/torbrowser';

const OS_NAMES = { win32: 'win', darwin: 'mac', linux: 'linux' };
const TOR_PLATFORM = {
  'win-x64': 'windows-x86_64',
  'mac-arm64': 'macos-aarch64',
  'mac-x64': 'macos-x86_64',
  'linux-x64': 'linux-x86_64',
  'linux-arm64': 'linux-aarch64',
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/**
 * tar ships with Windows 10+, macOS and Linux. On Windows use the system
 * bsdtar: GNU tar from Git Bash reads "C:\..." as a remote host.
 */
function tarBinary() {
  if (process.platform !== 'win32') return 'tar';
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(system) ? system : 'tar';
}

async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

async function latestVersion() {
  const data = await (await fetchOk('https://aus1.torproject.org/torbrowser/update_3/release/download-linux-x86_64.json')).json();
  return data.version;
}

async function fetchTarget(version, sums, target) {
  const platform = TOR_PLATFORM[target];
  if (!platform) throw new Error(`No Tor Expert Bundle for ${target}`);
  const name = `tor-expert-bundle-${platform}-${version}.tar.gz`;
  const expected = sums.get(name);
  if (!expected) throw new Error(`${name} is not listed in the release checksums`);

  console.log(`> ${target}: downloading ${name}`);
  const archive = Buffer.from(await (await fetchOk(`${DIST}/${version}/${name}`)).arrayBuffer());
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error(`${name}: checksum mismatch (${actual} != ${expected})`);

  const dest = path.join(ROOT, 'tor-bundle', target);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const tmp = path.join(os.tmpdir(), `raijin-${name}`);
  fs.writeFileSync(tmp, archive);
  try {
    execFileSync(tarBinary(), ['-xzf', tmp, '-C', dest], { stdio: 'inherit' });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  // Pluggable transports are not used; keep the app small.
  fs.rmSync(path.join(dest, 'tor', 'pluggable_transports'), { recursive: true, force: true });
  fs.rmSync(path.join(dest, 'docs'), { recursive: true, force: true });
  fs.rmSync(path.join(dest, 'debug'), { recursive: true, force: true });
  fs.writeFileSync(path.join(dest, 'VERSION'), `${version}\n`);
  console.log(`> ${target}: tor ${version} -> ${path.relative(ROOT, dest)}`);
}

const targetOs = arg('os', OS_NAMES[process.platform]);
const archArg = arg('arch', process.arch);
const arches = archArg === 'all' ? (targetOs === 'mac' ? ['arm64', 'x64'] : ['x64']) : [archArg];

const version = process.env.TOR_VERSION || (await latestVersion());
const sumsText = await (await fetchOk(`${DIST}/${version}/sha256sums-signed-build.txt`)).text();
const sums = new Map(
  sumsText
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 2)
    .map(([hash, file]) => [file, hash]),
);

for (const arch of arches) await fetchTarget(version, sums, `${targetOs}-${arch}`);
