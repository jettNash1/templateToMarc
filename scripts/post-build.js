import { copyFileSync, cpSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

mkdirSync(dist, { recursive: true });
copyFileSync(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));
copyFileSync(resolve(root, 'src/background.js'), resolve(dist, 'background.js'));

if (existsSync(resolve(root, 'public/icons'))) {
  cpSync(resolve(root, 'public/icons'), resolve(dist, 'icons'), { recursive: true });
}

if (existsSync(resolve(root, 'public/BookDonationTemplate.xlsx'))) {
  copyFileSync(
    resolve(root, 'public/BookDonationTemplate.xlsx'),
    resolve(dist, 'BookDonationTemplate.xlsx'),
  );
}

console.log('Extension built to dist/');
