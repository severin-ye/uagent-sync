import { assertProfileContentSafe } from './repo/dist/lib/profile-secret-scan.js';

const cases = [
  ['M13-P1', 'const token=process.env.KEY\n && "SYNTHETIC_NONEMPTY"'],
  ['M13-P2', 'const token=process.env.KEY && "SYNTHETIC_NONEMPTY"'],
  ['M13-P3', 'const token=process.env.KEY\n || "SYNTHETIC_NONEMPTY"'],
];

for (const [id, source] of cases) {
  new Function(source);
  let blocked = false;
  try {
    assertProfileContentSafe(source, 'fixture.ts');
  } catch {
    blocked = true;
  }
  console.log(`${id} blocked=${blocked}`);
}
