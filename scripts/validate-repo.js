import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const REQUIRED_DIRECTORIES = [
  'apps',
  'packages',
  'services',
  'runtimes',
  'infrastructure',
  'tests',
  'tools',
  'scripts',
  'docs',
  'architecture',
  'adrs',
  'threat-models',
];

const REQUIRED_FILES = [
  'README.md',
  'package.json',
  'tsconfig.json',
  'CODEOWNERS',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'LICENSE',
  'CHANGELOG.md',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  'docs/INDEX.md',
  'adrs/0001-monorepo-foundation.md',
  'threat-models/TM-0001-phase0-baseline.md',
];

console.log('🔍 Validating NexusOS Monorepo Repository Structure & Architecture Boundaries...\n');

let failed = false;

// 1. Validate required logical directories
for (const dir of REQUIRED_DIRECTORIES) {
  const fullPath = path.join(rootDir, dir);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    console.error(`❌ MISSING DIRECTORY: ${dir}`);
    failed = true;
  } else {
    console.log(`✅ Directory present: ${dir}/`);
  }
}

// 2. Validate required root & governance files
for (const file of REQUIRED_FILES) {
  const fullPath = path.join(rootDir, file);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    console.error(`❌ MISSING FILE: ${file}`);
    failed = true;
  } else {
    console.log(`✅ File present: ${file}`);
  }
}

// 3. Verify contract packages boundary (packages/contracts must not import service implementations)
const contractsSrc = path.join(rootDir, 'packages', 'contracts', 'src');
if (fs.existsSync(contractsSrc)) {
  const files = fs.readdirSync(contractsSrc);
  for (const f of files) {
    const content = fs.readFileSync(path.join(contractsSrc, f), 'utf-8');
    if (
      content.includes('/services/') ||
      content.includes('/runtimes/') ||
      content.includes('/apps/')
    ) {
      console.error(
        `❌ BOUNDARY VIOLATION in packages/contracts/src/${f}: Contracts must be implementation-independent.`,
      );
      failed = true;
    }
  }
}

if (failed) {
  console.error('\n💥 Monorepo validation FAILED.');
  process.exit(1);
}

console.log('\n🎉 Monorepo structure & architecture boundary validation PASSED successfully!');
