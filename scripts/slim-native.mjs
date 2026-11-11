// Removes the heavy offline assets from the Android bundle (dist/) so the APK is ~25-30 MB smaller: OCR ("Edit text" in the image
// editor) and the meeting background-blur model. ON by default. Inside the app those two features download their files from the
// website the first time they are used (src/lib/heavyAssets.js); the website itself is unaffected.
//   SLIM_NATIVE=0 npm run android:sync     -> keep them inside the APK (fully offline, bigger APK).
import { rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.env.SLIM_NATIVE === '0') process.exit(0);
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
for (const d of ['ocr', 'mediapipe']) if (existsSync(join(dist, d))) { rmSync(join(dist, d), { recursive: true, force: true }); console.log('[slim-native] removed dist/' + d); }
