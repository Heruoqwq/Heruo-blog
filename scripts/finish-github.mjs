import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const html = readFileSync(new URL('../docs/index.html', import.meta.url));
const revision = createHash('sha256').update(html).digest('hex');
writeFileSync(new URL('../docs/.nojekyll', import.meta.url), `Heruo Journal static build\nRevision: ${revision}\n`);
