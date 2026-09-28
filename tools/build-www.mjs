// Copia la web tal cual a www/ para que Capacitor la meta en la app de iPhone.
// No transforma nada (la web sigue sin build): solo deja afuera tests, docs, tools y js/dev.
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const ITEMS = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'icons', 'js'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ITEMS) {
  await cp(join(root, item), join(out, item), {
    recursive: true,
    // js/dev (datos de prueba) no va a la app publicada.
    filter: (src) => !src.replace(/\\/g, '/').includes('/js/dev'),
  });
}
process.stdout.write('www/ listo\n');
