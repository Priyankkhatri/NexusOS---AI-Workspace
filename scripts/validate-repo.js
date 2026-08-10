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
  const fullPath = path.join(rootDir, ...dir.split('/'));
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    console.error(`❌ MISSING DIRECTORY: ${dir}`);
    failed = true;
  } else {
    console.log(`✅ Directory present: ${dir}/`);
  }
}

// 2. Validate required root & governance files
for (const file of REQUIRED_FILES) {
  const fullPath = path.join(rootDir, ...file.split('/'));
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    console.error(`❌ MISSING FILE: ${file}`);
    failed = true;
  } else {
    console.log(`✅ File present: ${file}`);
  }
}

// 3. Verify contract packages boundary (packages/contracts must not import service implementations)
function checkContractsBoundary(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      checkContractsBoundary(fullPath);
    } else if (entry.isFile() && /\.(js|ts)$/i.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (
        content.includes('/services/') ||
        content.includes('/runtimes/') ||
        content.includes('/apps/')
      ) {
        console.error(
          `❌ BOUNDARY VIOLATION in ${path.relative(rootDir, fullPath)}: Contracts must be implementation-independent.`,
        );
        failed = true;
      }
    }
  }
}

const contractsSrc = path.join(rootDir, 'packages', 'contracts', 'src');
checkContractsBoundary(contractsSrc);

if (failed) {
  console.error('\n💥 Monorepo validation FAILED.');
  process.exit(1);
}

console.log('\n🎉 Monorepo structure & architecture boundary validation PASSED successfully!');
