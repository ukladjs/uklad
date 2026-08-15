#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CORE_PACKAGE = '@ukladjs/core';
const AGENTS_FILE = 'AGENTS.md';
const START_MARKER = '<!-- uklad-agent:start -->';
const END_MARKER = '<!-- uklad-agent:end -->';

const ROUTER_LINES = [
  START_MARKER,
  '## Uklad',
  '',
  'This project uses Uklad (`@ukladjs/core`) for application state.',
  '',
  "For changes involving Uklad state, events, subscriptions, effects, coeffects, contracts, runtime composition, or DevTools, use the Uklad Agent Toolkit's `uklad` skill first. If that skill is unavailable, read `node_modules/@ukladjs/core/templates/agent/AGENTS.md`.",
  '',
  "Preserve the project's existing Uklad structure and state ownership.",
  END_MARKER,
] as const;

interface CliOptions {
  dryRun: boolean;
  help: boolean;
  remove: boolean;
  root?: string;
}

interface PackageManifest {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
}

interface MarkerRange {
  end: number;
  start: number;
}

type Change = { kind: 'create' | 'update'; content: string } | { kind: 'delete' | 'none' };

function printHelp(): void {
  console.log(`
Uklad agent setup

Usage: uklad-agent init [options]

Options:
  --dry-run          Show what would change without writing files
  --remove           Remove the managed Uklad section
  --root <directory> Target a package directory instead of searching upward
  -h, --help         Show this help

The command creates or updates only the section between
${START_MARKER} and ${END_MARKER} in AGENTS.md.
`);
}

function readOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${option} requires a directory.`);
  }
  return value;
}

function parseArgs(args: readonly string[]): CliOptions {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return { dryRun: false, help: true, remove: false };
  }
  if (args[0] !== 'init') {
    throw new Error(`Unknown command: ${args[0]}. Run \`uklad-agent --help\` for usage.`);
  }

  let dryRun = false;
  let help = false;
  let remove = false;
  let root: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--remove':
        remove = true;
        break;
      case '--root':
        root = readOptionValue(args, index, arg);
        index += 1;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}. Run \`uklad-agent --help\` for usage.`);
    }
  }

  return root === undefined ? { dryRun, help, remove } : { dryRun, help, remove, root };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readManifest(packageRoot: string): PackageManifest {
  const manifestPath = path.join(packageRoot, 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${manifestPath}: ${message}`, { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error(`${manifestPath} must contain a JSON object.`);
  }
  return parsed;
}

function findNearestPackageRoot(start: string): string {
  let candidate = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`No package.json found from ${path.resolve(start)} upward.`);
}

function resolvePackageRoot(options: CliOptions): string {
  if (options.root === undefined) return findNearestPackageRoot(process.cwd());

  const explicitRoot = path.resolve(process.cwd(), options.root);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(explicitRoot);
  } catch {
    throw new Error(`Target directory does not exist: ${explicitRoot}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Target is not a directory: ${explicitRoot}`);
  }
  if (!fs.existsSync(path.join(explicitRoot, 'package.json'))) {
    throw new Error(`No package.json found in target directory: ${explicitRoot}`);
  }
  return explicitRoot;
}

function declaresCoreDependency(manifest: PackageManifest): boolean {
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ] as const) {
    const dependencies = manifest[field];
    if (isRecord(dependencies) && typeof dependencies[CORE_PACKAGE] === 'string') return true;
  }
  return false;
}

function countOccurrences(content: string, value: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(value, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + value.length;
  }
}

function isWholeLine(content: string, start: number, marker: string): boolean {
  const before = start === 0 ? '' : content[start - 1];
  const after = content[start + marker.length];
  return (
    (before === '' || before === '\n' || before === '\r') &&
    (after === undefined || after === '\n' || after === '\r')
  );
}

function findManagedRange(content: string): MarkerRange | undefined {
  const starts = countOccurrences(content, START_MARKER);
  const ends = countOccurrences(content, END_MARKER);
  if (starts === 0 && ends === 0) return undefined;
  if (starts !== 1 || ends !== 1) {
    throw new Error(
      `${AGENTS_FILE} has duplicate or incomplete Uklad management markers; no changes were made.`,
    );
  }

  const start = content.indexOf(START_MARKER);
  const endStart = content.indexOf(END_MARKER);
  if (
    endStart < start ||
    !isWholeLine(content, start, START_MARKER) ||
    !isWholeLine(content, endStart, END_MARKER)
  ) {
    throw new Error(`${AGENTS_FILE} has malformed Uklad management markers; no changes were made.`);
  }
  return { start, end: endStart + END_MARKER.length };
}

function detectEol(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function routerSection(eol: string): string {
  return ROUTER_LINES.join(eol);
}

function hasUnmanagedUkladGuidance(content: string): boolean {
  return /@ukladjs\/core/u.test(content) || /^#{1,6}[ \t]+Uklad(?:[ \t]|$)/imu.test(content);
}

function appendSection(content: string, section: string, eol: string): string {
  if (content.length === 0) return `${section}${eol}`;
  if (content.endsWith(`${eol}${eol}`)) return `${content}${section}${eol}`;
  if (content.endsWith(eol)) return `${content}${eol}${section}${eol}`;
  return `${content}${eol}${eol}${section}${eol}`;
}

function createOrUpdate(content: string | undefined): Change {
  const eol = detectEol(content ?? '');
  const section = routerSection(eol);
  if (content === undefined) return { kind: 'create', content: `${section}${eol}` };

  const range = findManagedRange(content);
  if (range !== undefined) {
    const next = `${content.slice(0, range.start)}${section}${content.slice(range.end)}`;
    return next === content ? { kind: 'none' } : { kind: 'update', content: next };
  }
  if (hasUnmanagedUkladGuidance(content)) {
    throw new Error(
      `${AGENTS_FILE} already contains unmanaged Uklad guidance. Add the management markers manually or reconcile the existing guidance before rerunning.`,
    );
  }
  return { kind: 'update', content: appendSection(content, section, eol) };
}

function trimTrailingLineBreaks(content: string): string {
  return content.replace(/(?:\r\n|\n|\r)+$/u, '');
}

function trimLeadingLineBreaks(content: string): string {
  return content.replace(/^(?:\r\n|\n|\r)+/u, '');
}

function removeSection(content: string | undefined): Change {
  if (content === undefined) return { kind: 'none' };
  const range = findManagedRange(content);
  if (range === undefined) return { kind: 'none' };

  const before = trimTrailingLineBreaks(content.slice(0, range.start));
  const after = trimLeadingLineBreaks(content.slice(range.end));
  if (before.trim().length === 0 && after.trim().length === 0) return { kind: 'delete' };

  const eol = detectEol(content);
  if (before.length === 0) return { kind: 'update', content: after };
  if (after.length === 0) return { kind: 'update', content: `${before}${eol}` };
  return { kind: 'update', content: `${before}${eol}${eol}${after}` };
}

function readAgentsFile(agentsPath: string): string | undefined {
  if (!fs.existsSync(agentsPath)) return undefined;
  const stats = fs.lstatSync(agentsPath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to modify symbolic link: ${agentsPath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Expected a regular file: ${agentsPath}`);
  }
  return fs.readFileSync(agentsPath, 'utf8');
}

function describeChange(change: Change, agentsPath: string, dryRun: boolean): string {
  const prefix = dryRun ? 'Would' : 'Did';
  switch (change.kind) {
    case 'create':
      return `${prefix} create ${agentsPath}`;
    case 'update':
      return `${prefix} update ${agentsPath}`;
    case 'delete':
      return `${prefix} remove ${agentsPath} because it contained only managed Uklad guidance`;
    case 'none':
      return `No managed Uklad changes needed in ${agentsPath}`;
  }
}

function applyChange(change: Change, agentsPath: string, dryRun: boolean): void {
  if (!dryRun) {
    if (change.kind === 'create' || change.kind === 'update') {
      fs.writeFileSync(agentsPath, change.content, 'utf8');
    } else if (change.kind === 'delete') {
      fs.unlinkSync(agentsPath);
    }
  }
  console.log(describeChange(change, agentsPath, dryRun));
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const packageRoot = resolvePackageRoot(options);
  const manifest = readManifest(packageRoot);
  if (!options.remove && !declaresCoreDependency(manifest)) {
    throw new Error(
      `${path.join(packageRoot, 'package.json')} does not directly declare ${CORE_PACKAGE}. Run the command from the consuming package or pass --root <directory>.`,
    );
  }

  const agentsPath = path.join(packageRoot, AGENTS_FILE);
  const content = readAgentsFile(agentsPath);
  const change = options.remove ? removeSection(content) : createOrUpdate(content);
  applyChange(change, agentsPath, options.dryRun);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`uklad-agent: ${message}`);
  process.exitCode = 1;
}
