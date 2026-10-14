import fs from 'fs';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';

let databaseUrl = '';
for (const line of fs.readFileSync('./.env.local', 'utf8').split('\n')) {
  const t = line.trim();
  if (t.startsWith('DATABASE_URL=')) databaseUrl = t.split('=').slice(1).join('=').replace(/['"]/g, '').trim();
}
const sql = neon(databaseUrl);

const normalizeUrl = (u) => u.trim().replace(/\/+$/, '');
const getUrlId = (u) => crypto.createHash('md5').update(normalizeUrl(u).toLowerCase()).digest('hex');
const NOVEL = 'https://truyenfull.live/kiem-lai';
const shortUrl = (u) => u.replace(/\/+$/, '').replace(/(chuong-\d+)(-[a-z0-9-]+)?\.html$/i, '$1');

async function scrapeChapterHtml(url) {
  const res = await fetch(normalizeUrl(url), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

// command: node scripts/chapter-tools.mjs info
// command: node scripts/chapter-tools.mjs build-list   -> scrapes chapter dropdown, saves scratch/kiem-lai-chapters.json
// command: node scripts/chapter-tools.mjs pull <num>   -> caches raw chapter to scratch/raw/<num>.json (scrapes if needed)
// command: node scripts/chapter-tools.mjs save <num> <file> -> upserts translation from file into DB
const [cmd, a, b] = process.argv.slice(2);

if (cmd === 'info') {
  const lib = await sql`SELECT total_chapters, last_read_url FROM library WHERE novel_url = ${NOVEL} LIMIT 1`;
  const cached = await sql`SELECT COUNT(*)::int AS n FROM chapters WHERE novel_url = ${NOVEL}`;
  const trans = await sql`SELECT COUNT(*)::int AS n FROM translations WHERE novel_url = ${NOVEL}`;
  console.log(JSON.stringify({ library: lib[0] || null, cachedChapters: cached[0].n, translations: trans[0].n }));
}

else if (cmd === 'build-list') {
  const html = await scrapeChapterHtml(`${NOVEL}/chuong-1/`);
  const { DOMParser } = await import('linkedom');
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const chapters = [];
  // Try AJAX option endpoint first (truyenfull pattern)
  const idInput = doc.getElementById('truyen-id');
  if (idInput) {
    const ajaxRes = await fetch(`https://truyenfull.live/ajax.php?type=chapter_option&data=${idInput.getAttribute('value')}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: `${NOVEL}/` },
    });
    if (ajaxRes.ok) {
      const ajaxDoc = new DOMParser().parseFromString(await ajaxRes.text(), 'text/html');
      for (const opt of Array.from(ajaxDoc.querySelectorAll('option'))) {
        const v = opt.getAttribute('value') || '';
        const t = opt.textContent?.trim() || '';
        if (v && t) chapters.push({ title: t, url: shortUrl(new URL(v, NOVEL).toString()) });
      }
    }
  }
  // Fallback: inline selects
  if (chapters.length === 0) {
    for (const opt of Array.from(doc.querySelectorAll('select option'))) {
      const v = opt.getAttribute('value') || '';
      const t = opt.textContent?.trim() || '';
      if (v && t && !v.startsWith('#')) chapters.push({ title: t, url: shortUrl(new URL(v, NOVEL).toString()) });
    }
  }
  fs.mkdirSync('scratch', { recursive: true });
  fs.writeFileSync('scratch/kiem-lai-chapters.json', JSON.stringify(chapters, null, 2));
  console.log(`Saved ${chapters.length} chapters to scratch/kiem-lai-chapters.json`);
  console.log('First:', chapters[0]?.url);
  console.log('Last:', chapters[chapters.length - 1]?.url);
}

else if (cmd === 'pull') {
  const num = Number(a);
  const list = JSON.parse(fs.readFileSync('scratch/kiem-lai-chapters.json', 'utf8'));
  const entry = list.find((c) => c.num === num);
  if (!entry) throw new Error(`No chapter #${num} in list`);

  fs.mkdirSync('scratch/raw', { recursive: true });
  const outPath = `scratch/raw/${num}.json`;
  if (fs.existsSync(outPath)) {
    console.log(`Already pulled: ${outPath}`);
  } else {
    // DB cache first
    let title = entry.title.split(' - ')[0], content = null;
    const rows = await sql`SELECT title, content FROM chapters WHERE url = ${entry.url} LIMIT 1`;
    if (rows.length > 0) {
      ({ title, content } = rows[0]);
      console.log('Sourced from DB cache');
    } else {
      console.log('Scraping:', entry.url);
      const html = await scrapeChapterHtml(`${normalizeUrl(entry.url)}/`);
      const { DOMParser } = await import('linkedom');
      const { Readability } = await import('@mozilla/readability');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const article = new Readability(doc).parse();
      if (!article || !article.content) throw new Error('Readability failed');
      title = (article.title || entry.title).split(' - ')[0];
      content = article.content;
      await sql`
        INSERT INTO chapters (id, novel_url, url, title, content, is_llm_translated)
        VALUES (${getUrlId(entry.url)}, ${NOVEL}, ${entry.url}, ${title}, ${content}, false)
        ON CONFLICT (url) DO NOTHING
      `;
      console.log('Scraped and cached to DB');
    }
    fs.writeFileSync(outPath, JSON.stringify({ num, url: entry.url, title, content }, null, 2));
    console.log(`Saved: ${outPath}`);
  }
  const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const textLen = data.content.replace(/<[^>]*>/g, '').length;
  console.log(`Title: ${data.title}`);
  console.log(`Text length: ${textLen} chars`);
}

else if (cmd === 'save') {
  const num = Number(a);
  const file = b;
  const list = JSON.parse(fs.readFileSync('scratch/kiem-lai-chapters.json', 'utf8'));
  const entry = list.find((c) => c.num === num);
  if (!entry) throw new Error(`No chapter #${num}`);
  const translated = fs.readFileSync(file, 'utf8').trim();
  if (translated.length < 500) throw new Error(`Translation suspiciously short (${translated.length} chars), aborting`);
  const paragraphs = (translated.match(/<p[^>]*>/g) || []).length;
  if (paragraphs < 5) throw new Error(`Only ${paragraphs} <p> tags found, expected more — aborting`);
  const rawPath = `scratch/raw/${num}.json`;
  const rawTitle = fs.existsSync(rawPath) ? JSON.parse(fs.readFileSync(rawPath, 'utf8')).title : null;
  const title = (rawTitle && rawTitle !== 'Kiếm Lai' ? rawTitle : entry.title).split(' - ')[0];

  await sql`
    INSERT INTO translations (id, novel_url, url, title, content)
    VALUES (${getUrlId(entry.url)}, ${NOVEL}, ${entry.url}, ${title}, ${translated})
    ON CONFLICT (url) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      created_at = NOW()
  `;
  console.log(`[OK] Saved chapter ${num} -> translations table (${translated.length} chars, ${paragraphs} paragraphs): ${entry.url}`);
}

else {
  console.log('Usage:');
  console.log('  node scripts/chapter-tools.mjs info');
  console.log('  node scripts/chapter-tools.mjs build-list');
  console.log('  node scripts/chapter-tools.mjs pull <num>');
  console.log('  node scripts/chapter-tools.mjs save <num> <file>');
}
