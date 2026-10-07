# EOT compression decoder source notice

The adapted decoder `src/lib/eot-lzcomp.ts` and its packaged source copy
`data/libeot/source/eot-lzcomp.ts` are subject to the Mozilla Public License
2.0. The complete original license, Monotype MTX origin notice and patent
caveat are preserved in LICENSE and PATENTS in this directory.

Upstream: https://github.com/umanwizard/libeot
Pinned revision: 0407abddc581d32e9871ee41535183ee1d924d85
Adapted from src/lzcomp/ahuff.c, bitio.c and lzcomp.c (retained in source/).

Changes: JavaScript implementation, bounded allocation/output, range-checked
copy operations, adaptive tree limits, deadline checks, strict stream endings,
MTX v3 header and CTF/SFNT directory recognition. Every decoded stream is
returned for security scanning. This does not reconstruct, execute or install
fonts. The compression encoder is not included in the runtime.

Reproduce: run `node scripts/build-libeot-source.mjs` to synchronize the
packaged source copy, then `npm run typecheck` and the normal project build.
The normal TypeScript compiler produces dist/lib/eot-lzcomp.js; no native
compiler, WASM runtime, system font installation or downloaded executable is
required. Re-run the synchronization script after changing the decoder.

Run focused checks with:
`node --import tsx --test test/plugin-runtime-content.test.ts`.
