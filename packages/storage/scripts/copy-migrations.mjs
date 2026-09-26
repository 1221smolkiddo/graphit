import { cpSync } from 'node:fs';
import { URL } from 'node:url';

cpSync(new URL('../migrations/', import.meta.url), new URL('../dist/migrations/', import.meta.url), {
  recursive: true,
});
