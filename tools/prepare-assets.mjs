import { cp, mkdir } from 'node:fs/promises';
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await mkdir(`public/pdfjs/${name}`, { recursive: true });
  await cp(`node_modules/pdfjs-dist/${name}`, `public/pdfjs/${name}`, { recursive: true });
}
await mkdir('public/licenses', { recursive: true });
await cp('LICENSE', 'public/licenses/PROJECT-GPL-3.0.txt');
await cp('node_modules/pdfjs-dist/LICENSE', 'public/licenses/PDFJS-APACHE-2.0.txt');
await cp('src/_logo/LUCIDE-LICENSE', 'public/licenses/LUCIDE.txt');
await cp('src/_logo/FLUENT-LICENSE', 'public/licenses/FLUENT-EMOJI.txt');
await cp('src/_logo/LOBE-ICONS-LICENSE', 'public/licenses/LOBE-ICONS.txt');
