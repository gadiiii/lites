#!/usr/bin/env npx tsx
/**
 * scripts/import-ofl.ts
 *
 * Processes an Open Fixture Library JSON export zip (or extracted directory)
 * and writes server/src/assets/ofl-starter.json — a flat array of every
 * fixture mode with its lites-compatible param mapping.
 *
 * Usage:
 *   npx tsx scripts/import-ofl.ts /path/to/ofl_export_ofl.zip
 *   npx tsx scripts/import-ofl.ts /path/to/extracted-ofl-directory
 *
 * Output: server/src/assets/ofl-starter.json
 *
 * Zip structure expected (OFL JSON plugin export):
 *   manufacturers.json
 *   manufacturer-key/fixture-key.json
 *   ...
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── OFL capability type → lites param name ────────────────────────────────────

const CAP_TYPE_MAP: Record<string, string> = {
  Intensity:               'dimmer',
  ShutterStrobe:           'strobe',
  Pan:                     'pan',
  PanContinuous:           'pan',
  Tilt:                    'tilt',
  TiltContinuous:          'tilt',
  Zoom:                    'zoom',
  Focus:                   'focus',
  Iris:                    'iris',
  Speed:                   'speed',
  EffectSpeed:             'speed',
  Effect:                  'auto',
  EffectParameter:         'effect',
  Rotation:                'rotation',
  PrismRotation:           'prism',
  Prism:                   'prism',
  Fog:                     'fog',
  FogOutput:               'fog',
  Temperature:             'colorTemp',
  ColorWheelIndex:         'colorWheel',
  ColorWheelRotation:      'colorWheelRot',
  Gobo:                    'gobo',
  GoboIndex:               'gobo',
  GoboRotation:            'goboRot',
  GoboStencilRotation:     'goboRot',
  GoboShake:               'goboShake',
  ColorPreset:             'colorMacro',
  BeamAngle:               'beam',
  Generic:                 'generic',
  Maintenance:             'maintenance',
};

const COLOR_MAP: Record<string, string> = {
  Red:          'red',
  Green:        'green',
  Blue:         'blue',
  White:        'white',
  Amber:        'amber',
  UV:           'uv',
  'Warm White': 'warmwhite',
  'Cold White': 'coldwhite',
  Cyan:         'cyan',
  Magenta:      'magenta',
  Yellow:       'yellow',
  Lime:         'lime',
  Indigo:       'indigo',
  Mint:         'mint',
  Pink:         'pink',
  'Warm Yellow':'warmyellow',
  'Cold Blue':  'coldblue',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface OflCap {
  type: string;
  color?: string;
}

interface OflChannel {
  // OFL uses either singular or plural capability field
  capability?: OflCap;
  capabilities?: OflCap[];
  fineChannelAliases?: string[];
}

interface OflMode {
  name: string;
  shortName?: string;
  channels: Array<string | null>;
}

interface OflFixture {
  name: string;
  availableChannels?: Record<string, OflChannel>;
  templateChannels?: Record<string, OflChannel>;
  matrix?: unknown;
  modes: OflMode[];
  fixtureKey?: string;
  manufacturerKey?: string;
}

export interface StarterEntry {
  key: string;         // "manufacturer-key/fixture-key"
  mode: string;        // mode short name, e.g. "7ch"
  name: string;        // display name, e.g. "SlimPAR T12 BT (7ch)"
  manufacturer: string;
  channelCount: number;
  params: Record<string, number>;
}

// ── Channel → param name ──────────────────────────────────────────────────────

function getCaps(ch: OflChannel): OflCap[] {
  if (ch.capabilities) return ch.capabilities;
  if (ch.capability) return [ch.capability];
  return [];
}

function channelToParam(ch: OflChannel, channelKey: string): string {
  const caps = getCaps(ch);

  // Walk all capabilities, skip NoFunction, return first meaningful match
  for (const cap of caps) {
    if (!cap.type || cap.type === 'NoFunction') continue;

    if (cap.type === 'ColorIntensity' && cap.color) {
      return COLOR_MAP[cap.color] ?? cap.color.toLowerCase().replace(/\s+/g, '');
    }
    if (CAP_TYPE_MAP[cap.type]) return CAP_TYPE_MAP[cap.type];
  }

  // Fallback: infer from channel key text
  const lower = channelKey.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  if (/\bred\b/.test(lower))                              return 'red';
  if (/\bgreen\b/.test(lower))                           return 'green';
  if (/\bblue\b/.test(lower))                            return 'blue';
  if (/warm\s*white/.test(lower))                        return 'warmwhite';
  if (/cold\s*white|cool\s*white/.test(lower))           return 'coldwhite';
  if (/\bwhite\b/.test(lower))                           return 'white';
  if (/\bamber\b/.test(lower))                           return 'amber';
  if (/\buv\b|ultraviolet/.test(lower))                  return 'uv';
  if (/\bcyan\b/.test(lower))                            return 'cyan';
  if (/\bmagenta\b/.test(lower))                         return 'magenta';
  if (/\byellow\b/.test(lower))                          return 'yellow';
  if (/\blime\b/.test(lower))                            return 'lime';
  if (/dimmer|master|intensity/.test(lower))             return 'dimmer';
  if (/strobe|shutter/.test(lower))                      return 'strobe';
  if (/\bspeed\b/.test(lower))                           return 'speed';
  if (/\bpan\b/.test(lower))                             return 'pan';
  if (/\btilt\b/.test(lower))                            return 'tilt';
  if (/\bzoom\b/.test(lower))                            return 'zoom';
  if (/\bgobo\b/.test(lower))                            return 'gobo';
  if (/\bprism\b/.test(lower))                           return 'prism';
  if (/color|colour/.test(lower))                        return 'colorWheel';
  if (/auto|program|macro/.test(lower))                  return 'auto';
  if (/focus/.test(lower))                               return 'focus';
  if (/iris/.test(lower))                                return 'iris';
  if (/fog|haze/.test(lower))                            return 'fog';
  if (/rotation|rotate/.test(lower))                     return 'rotation';

  // Last resort: slugify the channel key
  return channelKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'ch';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: npx tsx scripts/import-ofl.ts <zip-or-directory>');
    process.exit(1);
  }

  let rootDir: string;
  let tmpDir: string | null = null;

  const stat = fs.statSync(input);
  if (stat.isDirectory()) {
    const resolved = path.resolve(input);
    // Support providing the repo root directly — check for fixtures/ subdir
    const fixturesSub = path.join(resolved, 'fixtures');
    rootDir = fs.existsSync(fixturesSub) ? fixturesSub : resolved;
    console.log(`Using directory: ${rootDir}`);
  } else {
    // Extract zip
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofl-import-'));
    console.log(`Extracting zip to ${tmpDir}…`);
    execSync(`unzip -q "${path.resolve(input)}" -d "${tmpDir}"`, { stdio: 'inherit' });

    // Determine root: OFL export puts files flat at zip root;
    // GitHub archive wraps in a repo dir + fixtures/ subdir.
    const contents = fs.readdirSync(tmpDir);
    if (contents.includes('manufacturers.json')) {
      // OFL export format: flat at zip root
      rootDir = tmpDir;
    } else {
      // GitHub archive: open-fixture-library-master/ → fixtures/
      const nested = contents.find(d => fs.statSync(path.join(tmpDir!, d)).isDirectory());
      const candidate = nested ? path.join(tmpDir, nested) : tmpDir;
      // Check for fixtures/ subdirectory (GitHub repo layout)
      const fixturesSubdir = path.join(candidate, 'fixtures');
      rootDir = fs.existsSync(fixturesSubdir) ? fixturesSubdir : candidate;
    }
    console.log(`Root dir: ${rootDir}`);
  }

  // Load manufacturers.json
  const mfrPath = path.join(rootDir, 'manufacturers.json');
  const manufacturers: Record<string, { name: string }> = fs.existsSync(mfrPath)
    ? JSON.parse(fs.readFileSync(mfrPath, 'utf8'))
    : {};

  const entries: StarterEntry[] = [];
  let fixtureCount = 0;
  let modeCount = 0;
  let skippedMatrix = 0;
  let skippedParse = 0;

  // Walk all manufacturer subdirectories
  const mfrDirs = fs.readdirSync(rootDir).filter(entry => {
    if (entry === 'manufacturers.json') return false;
    const fullPath = path.join(rootDir, entry);
    try { return fs.statSync(fullPath).isDirectory(); } catch { return false; }
  });

  console.log(`Found ${mfrDirs.length} manufacturer directories.`);

  for (const mfrKey of mfrDirs) {
    const mfrInfo = manufacturers[mfrKey];
    const mfrName = mfrInfo?.name ?? mfrKey;
    const mfrDir = path.join(rootDir, mfrKey);

    const fixtureFiles = fs.readdirSync(mfrDir).filter(f => f.endsWith('.json'));

    for (const fixtureFile of fixtureFiles) {
      const fixturePath = path.join(mfrDir, fixtureFile);
      let data: OflFixture;

      try {
        data = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as OflFixture;
      } catch {
        skippedParse++;
        continue;
      }

      if (!data.name || !Array.isArray(data.modes) || data.modes.length === 0) {
        skippedParse++;
        continue;
      }

      // Skip matrix fixtures (variable pixel count, complex channel layout)
      if (data.matrix) {
        skippedMatrix++;
        continue;
      }

      // Use fixtureKey/manufacturerKey from the export if available, else derive from path
      const fixtureKey = data.fixtureKey ?? fixtureFile.replace(/\.json$/, '');
      const mKey = data.manufacturerKey ?? mfrKey;
      const fullKey = `${mKey}/${fixtureKey}`;

      const availableChannels: Record<string, OflChannel> = data.availableChannels ?? {};

      // Build set of fine-channel aliases to skip them
      const fineAliases = new Set<string>();
      for (const ch of Object.values(availableChannels)) {
        for (const alias of ch.fineChannelAliases ?? []) fineAliases.add(alias);
      }

      for (const mode of data.modes) {
        const modeShort = mode.shortName ?? mode.name;
        const channels = mode.channels ?? [];

        const params: Record<string, number> = {};
        const paramCounts: Record<string, number> = {};
        let realChannels = 0;

        channels.forEach((ch, offset) => {
          if (ch === null || ch === undefined) return; // fine-byte placeholder

          // Strip matrix pixel key (e.g. "Red $pixelKey") — shouldn't appear after matrix skip
          const resolvedKey = ch.replace(/\s+\$.*$/, '').trim();
          if (!resolvedKey) return;

          // Skip if this is a fine-channel alias (16-bit low byte)
          if (fineAliases.has(resolvedKey)) return;

          const channelDef = availableChannels[resolvedKey] ?? {};
          let param = channelToParam(channelDef, resolvedKey);

          // Deduplicate: dimmer, dimmer2, dimmer3 …
          paramCounts[param] = (paramCounts[param] ?? 0) + 1;
          if (paramCounts[param] > 1) param = `${param}${paramCounts[param]}`;

          params[param] = offset;
          realChannels++;
        });

        if (Object.keys(params).length === 0) continue;

        entries.push({
          key: fullKey,
          mode: modeShort,
          name: `${data.name} (${modeShort})`,
          manufacturer: mfrName,
          channelCount: realChannels,
          params,
        });
        modeCount++;
      }

      fixtureCount++;
    }
  }

  // Sort: manufacturer A→Z, then name A→Z
  entries.sort((a, b) =>
    a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name)
  );

  console.log(`\nResults:`);
  console.log(`  Manufacturers:     ${mfrDirs.length}`);
  console.log(`  Fixtures:          ${fixtureCount}`);
  console.log(`  Profiles (modes):  ${modeCount}`);
  console.log(`  Skipped (matrix):  ${skippedMatrix}`);
  console.log(`  Skipped (error):   ${skippedParse}`);

  // Write output — compact JSON (no pretty-print) to keep file small
  const outDir = path.resolve(__dirname, '..', 'server', 'src', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'ofl-starter.json');
  fs.writeFileSync(outPath, JSON.stringify(entries));

  const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`\nWritten: ${outPath}`);
  console.log(`Size:    ${sizeMb} MB`);

  // Cleanup temp dir
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('Temp files removed.');
  }

  console.log('\nDone! Rebuild the server (`npm run build -w server`) then restart.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
