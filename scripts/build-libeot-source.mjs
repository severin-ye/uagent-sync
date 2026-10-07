// Preserve the adapted MPL decoder's Source Code Form in the npm data tree.
import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../src/lib/eot-lzcomp.ts', import.meta.url), new URL('../data/libeot/source/eot-lzcomp.ts', import.meta.url));
