import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Constructs regex patterns without literal key substrings to prevent scanner self-triggering
const SECRET_PATTERNS = [
  new RegExp('BEGIN' + '\\s+PRIVATE\\s+KEY', 'i'),
  new RegExp('aws_' + 'secret_access_key', 'i'),
  /ghp_[a-zA-Z0-9]{36}/,
  /sk_live_[0-9a-zA-Z]{24}/,
  /api[_-]?key\s*=\s*['"][a-zA-Z0-9_-]{20,}['"]/i,
];

const FORBIDDEN_SECRET_FILES = ['.env', '.env.local', '.env.production', '.env.staging'];

console.log('🛡️ Running NexusOS Phase 0 Security & Secret Scanner...\n');

let violations = 0;

// 1. Check for uncommitted/committed forbidden secret files
for (const envFile of FORBIDDEN_SECRET_FILES) {
  if (fs.existsSync(path.join(rootDir, envFile))) {
    console.error(`🚨 SECURITY ALERT: Found unignored environment file: ${envFile}`);
    violations++;
  }
}

// 2. Scan tracked code files for secret patterns
function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && /\.(js|ts|json|md|yml|yaml|env)$/i.test(entry.name)) {
      if (entry.name === 'security-scan.js') continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(content)) {
          console.error(
            `🚨 SECRET DETECTED in file: ${path.relative(rootDir, fullPath)} matching pattern ${pattern}`,
          );
          violations++;
        }
      }
    }
  }
}

scanDir(rootDir);

if (violations > 0) {
  console.error(`\n💥 Security scan FAILED with ${violations} violation(s).`);
  process.exit(1);
}

console.log('✅ Security scan PASSED cleanly. No secrets or unignored environment files detected!');
