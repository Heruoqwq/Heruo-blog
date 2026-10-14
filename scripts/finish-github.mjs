import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../docs/.nojekyll',import.meta.url),'');
