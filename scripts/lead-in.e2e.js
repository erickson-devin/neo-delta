// End-to-end test for lead-in paragraphs, on a throwaway library: ⌥⌘Enter
// (Ctrl+Alt+Enter) from a chapter's title opens one beneath it, ⇧Enter goes
// on with another, Enter steps back out into prose, and the drop cap waits
// for the story's first words. Format → Lead-in Paragraph turns a paragraph
// into one and back. The chapter file keeps class="lead-in"; the web page,
// EPUB, Word, manuscript and paperback exports each set it apart, with the
// opening paragraph after it still the opening paragraph. Run with
// `npm run test:lead-in` (under xvfb-run without a display).

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-lead-in-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-lead-in-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const LIB = path.join(tmp, 'NEO Library');
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: 'Mary Ann Evans', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night', hintShown: true,
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');
const JSZip = require('jszip');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(cond, ms = 20000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out waiting: ' + cond);
    await tick(80);
  }
}
const MOD = process.platform === 'darwin' ? 'meta' : 'control';
async function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await tick(120);
}
async function type(text) { await wc.insertText(text); await tick(120); }
async function shot(name) {
  if (!process.env.NEO_TEST_SHOTS) return;
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(process.env.NEO_TEST_SHOTS, name + '.png'), img.toPNG());
}
// the first chapter's paragraphs, as the page has them
const paras = (n = 0) => js(`[...document.querySelectorAll('.chapter-body')[${n}].children].map((p) => ({ cls: p.className, first: p.hasAttribute('data-first'), italic: !!p.querySelector('i'), text: p.textContent }))`);

const OPENING = 'She came back to the old house at dusk.';
const STORY = 'The tide came in over the stones, and the gulls rose. The harbor light turned.';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('⌥⌘Enter from the title opens a lead-in; the drop cap waits for the story', async () => {
  await js(`(() => { const t = document.querySelector('.chapter .ch-title'); t.focus(); const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await key('Enter', [MOD, 'alt']);
  await type('Ten years earlier');
  const ps = await paras();
  assert.equal(ps[0].cls, 'lead-in');
  assert.equal(ps[0].text, 'Ten years earlier');
  assert.ok(ps[0].italic, 'born italic');
  assert.ok(!ps[0].first, 'no drop cap on the lead-in');
  assert.equal(ps[1].text, OPENING);
  assert.ok(ps[1].first, 'the story\'s first paragraph keeps the drop cap');
  assert.equal(await js(`window.getComputedStyle(document.querySelector('.chapter-body p.lead-in')).textIndent`), '0px');
});

test('⇧Enter goes on with another lead-in; Enter on an empty one steps out', async () => {
  await key('Enter', ['shift']);
  await type('Dear Mara,');
  let ps = await paras();
  assert.deepEqual(ps.slice(0, 2).map((p) => [p.cls, p.text]), [['lead-in', 'Ten years earlier'], ['lead-in', 'Dear Mara,']]);
  assert.ok(ps[1].italic);
  await key('Enter', ['shift']);
  ps = await paras();
  assert.equal(ps[2].cls, 'lead-in', 'a third, empty, ready for words');
  await key('Enter');
  ps = await paras();
  assert.equal(ps[2].cls, '', 'Enter in an empty lead-in makes it prose');
  assert.ok(!ps[2].italic, 'and takes its italic off');
  assert.ok(ps[3].first, 'the drop cap is still on the story');
  await key('Backspace');
  ps = await paras();
  assert.equal(ps[1].text, 'Dear Mara,');
  assert.equal(ps[2].text, OPENING, 'the empty line is gone again');
  await shot('lead-in-page');
});

test('Format → Lead-in Paragraph turns a paragraph into one, and back', async () => {
  await js(`(() => {
    const p = document.querySelectorAll('.chapter-body')[1].querySelector('p');
    p.closest('.chapter-body').focus();
    const r = document.createRange(); r.setStart(p.firstChild, 3); r.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    toggleLeadIn();
  })()`);
  let ps = await paras(1);
  assert.equal(ps[0].cls, 'lead-in');
  assert.ok(ps[0].italic);
  assert.ok(ps[1].first, 'the next paragraph takes the drop cap');
  await js(`toggleLeadIn()`);
  ps = await paras(1);
  assert.equal(ps[0].cls, '');
  assert.ok(!ps[0].italic, 'back to roman');
  assert.ok(ps[0].first);
});

test('the chapter file keeps class="lead-in"', async () => {
  await js(`flushAllSaves()`);
  const id = await js(`document.querySelector('.chapter').dataset.id`);
  const dir = fs.readdirSync(LIB).find((d) => d.startsWith('book-'));
  const file = path.join(LIB, dir, 'chapters', id + '.html');
  await until(() => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('Dear Mara,'));
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<p class="lead-in"><i>Ten years earlier<\/i><\/p><p class="lead-in"><i>Dear Mara,<\/i><\/p>/);
  assert.ok(!html.includes('data-first'), 'the screen\'s marks stay off the file');
});

test('PDF / web page: the lead-ins set apart, the opening paragraph after them', async () => {
  const html = await js(`buildHtml(bookExportData())`);
  const at = html.indexOf('<p class="lead-in">');
  assert.match(html.slice(at, at + 200), /<p class="lead-in"><i>Ten years earlier<\/i><\/p>\s*<p class="lead-in"><i>Dear Mara,<\/i><\/p>\s*<p class="first">She came back/);
  assert.match(html, /\.chapter p\.lead-in \{/);
});

test('EPUB: the lead-ins, then the paragraph marked first', async () => {
  const to = path.join(tmp, 'harbor.epub');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: to });
  await js(`doExport('epub')`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0);
  await tick(300);
  const zip = await JSZip.loadAsync(fs.readFileSync(to));
  const names = Object.keys(zip.files).filter((n) => n.endsWith('.xhtml'));
  let chapter = '';
  for (const n of names) {
    const x = await zip.file(n).async('string');
    if (x.includes('Ten years earlier')) chapter = x;
  }
  assert.match(chapter, /<p class="lead-in"><em>Ten years earlier<\/em><\/p>\s*<p class="lead-in"><em>Dear Mara,<\/em><\/p>\s*<p class="first">She came back/);
  const css = await zip.file(Object.keys(zip.files).find((n) => n.endsWith('.css'))).async('string');
  assert.match(css, /p\.lead-in \{/);
});

test('Word: a Lead-in paragraph style, used for both lines', async () => {
  const to = path.join(tmp, 'harbor.docx');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: to });
  await js(`doExport('docx')`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0);
  await tick(300);
  const zip = await JSZip.loadAsync(fs.readFileSync(to));
  const doc = await zip.file('word/document.xml').async('string');
  const styles = await zip.file('word/styles.xml').async('string');
  assert.match(styles, /w:styleId="LeadIn"><w:name w:val="Lead-in"\/>/);
  assert.equal((doc.match(/<w:pStyle w:val="LeadIn"\/>/g) || []).length, 2);
  assert.match(doc, /<w:pStyle w:val="LeadIn"\/><\/w:pPr><w:r><w:rPr><w:rStyle w:val="Emphasis"\/><\/w:rPr><w:t xml:space="preserve">Ten years earlier</);
});

test('manuscript format: a lead-in is a paragraph set flush, its italic kept', async () => {
  const secs = await js(`manuscriptSections()`);
  const ch = secs.find((s) => s.paras.some((p) => (p.runs || []).some((r) => r.text === 'Ten years earlier')));
  assert.equal(ch.paras[0].flush, true);
  assert.ok(ch.paras[0].runs.every((r) => r.i));
  assert.equal(ch.paras[2].flush, false, 'the story\'s paragraph keeps its indent');
});

test('paperback for KDP: the lead-ins on the chapter\'s first page, the story after', async () => {
  const to = path.join(tmp, 'harbor-paperback.pdf');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: to });
  await js(`(() => { window.__pb = printPaperback(); })()`);
  await until(() => js(`!!document.querySelector('.print-modal')`));
  await js(`document.querySelector('.print-modal').closest('.modal-backdrop').querySelector('.m-ok').click()`);
  // the interior, then the cover template beside it
  await until(() => js(`window.__pb.then(() => true)`), 180000);
  assert.ok(fs.existsSync(to) && fs.statSync(to).size > 0);
  assert.equal(fs.readFileSync(to).subarray(0, 5).toString(), '%PDF-');
  assert.equal(await js(`printPaperback.busy || false`), false);
  if (process.env.NEO_TEST_SHOTS) fs.copyFileSync(to, path.join(process.env.NEO_TEST_SHOTS, 'lead-in-paperback.pdf'));
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    const md = path.join(tmp, 'harbor.md');
    const many = (n) => Array.from({ length: n }, () => STORY).join(' ');
    fs.writeFileSync(md, ['# The Harbor', OPENING, ...Array.from({ length: 12 }, () => many(3)),
      '# Low Water', 'Morning came grey over the flats.', ...Array.from({ length: 12 }, () => many(3))].join('\n\n'));
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      const results = await window.neo.importFiles([${JSON.stringify(md)}]);
      await addImportedBooks(results, library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      book.title = 'The Harbor';
      await saveMeta();
    })()`);
    await tick(800);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.stack || err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
