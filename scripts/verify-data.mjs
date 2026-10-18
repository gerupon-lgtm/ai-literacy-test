import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { questionSetErrors } from '../public/assets/js/question-set.js';
import { buildQuizQuestions } from '../public/assets/js/quiz.js';
import { buildResultSummary } from '../public/assets/js/scoring.js';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const files = ['public/data/current-question-set.json', 'public/data/sample-question-set.json', 'public/docs/security-sample.json',
  ...fs.readdirSync('public/data/sets').filter(n => n.endsWith('.json')).map(n => 'public/data/sets/' + n)];
for (const file of files) {
  const set = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(questionSetErrors(set), [], file);
  for (let round = 0; round < 10; round++) {
    const qs = buildQuizQuestions(set);
    assert.equal(qs.length, set.settings.questionCount, file);
    assert.equal(new Set(qs.map(q => q.id)).size, qs.length, file);
    assert.equal(buildResultSummary(qs, qs.map(q => q.answer)).scoreRate, 100, file);
  }
}
const active = JSON.parse(fs.readFileSync('public/data/active-set.json', 'utf8'));
assert.deepEqual(JSON.parse(fs.readFileSync('public/data/current-question-set.json', 'utf8')),
  JSON.parse(fs.readFileSync('public/data/sets/' + active.activeSetId + '.json', 'utf8')), 'active/public data differ');
for (const file of ['public/index.html', 'public/admin.html']) {
  const html = fs.readFileSync(file, 'utf8');
  assert(html.includes('ver ' + pkg.version), file);
  for (const match of html.matchAll(/(?:src|href)="(assets\/[^"?]+\.(?:js|css))(\?v=[^"]+)?"/g)) assert.equal(match[2], '?v=' + pkg.version, file + ': ' + match[1]);
}
for (const name of fs.readdirSync('public/assets/js').filter(n => n.endsWith('.js'))) {
  const file = 'public/assets/js/' + name;
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/from ['"](\.[^'"]+\.js)(\?v=[^'"]+)?['"]/g)) {
    assert.equal(match[2], '?v=' + pkg.version, file + ': ' + match[1]);
    assert(fs.existsSync(path.resolve(path.dirname(file), match[1])), file + ': missing import');
  }
}
for (const name of ['question-set-format.md', 'security-sample.json']) {
  assert.equal(fs.readFileSync('docs/' + name, 'utf8'), fs.readFileSync('public/docs/' + name, 'utf8'), 'public doc differs: ' + name);
}
const spec = fs.readFileSync('docs/question-set-format.md', 'utf8');
for (const block of spec.matchAll(/```json\s*\n([\s\S]*?)```/g)) JSON.parse(block[1]);
console.log(files.length + ' data sets, ' + files.length * 10 + ' quiz draws, public docs and versioned asset imports passed');
