import fs from 'node:fs';
import path from 'node:path';
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Usage: node scripts/set-version.mjs 1.2.0');
const read = p => fs.readFileSync(p, 'utf8');
const write = (p, text) => fs.writeFileSync(p, text);
const pkg = JSON.parse(read('package.json')); pkg.version = version; write('package.json', JSON.stringify(pkg, null, 2) + '\n');
for (const file of ['public/index.html', 'public/admin.html']) {
  let html = read(file).replace(/ver \d+\.\d+\.\d+/g, 'ver ' + version);
  html = html.replace(/((?:src|href)="assets\/[^"?]+\.(?:js|css))(?:\?v=[^" ]+)?"/g, '$1?v=' + version + '"');
  write(file, html);
}
for (const name of fs.readdirSync('public/assets/js').filter(n => n.endsWith('.js'))) {
  const file = path.join('public/assets/js', name);
  write(file, read(file).replace(/from (['"])(\.[^'"?]+\.js)(?:\?v=[^'"]+)?\1/g, 'from $1$2?v=' + version + '$1'));
}
write('README.md', read('README.md').replace(/\*\*バージョン: ver \d+\.\d+\.\d+\*\*/, '**バージョン: ver ' + version + '**'));
console.log('Updated app, HTML, CSS and module URLs to ' + version);
