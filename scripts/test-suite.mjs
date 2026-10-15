import assert from 'node:assert';
import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const PROD_BASE = 'https://project-zca8z.vercel.app';
const AUTH_SECRET = process.env.AUTH_SECRET || 'aetherread-secret-32-chars-long-key-string';

// Helper to create session cookie
function createSessionToken(username = 'anhnt314') {
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = `${username}:${expiresAt}`;
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return `${payload}:${signature}`;
}

const sessionCookie = `aetherread_session=${createSessionToken('anhnt314')}`;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
  totalTests++;
  process.stdout.write(`  [TEST] ${name} ... `);
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`✅ PASS (${duration}ms)`);
    passedTests++;
  } catch (err) {
    const duration = Date.now() - start;
    console.log(`❌ FAIL (${duration}ms)`);
    console.error(`         Error: ${err.message}`);
    failedTests++;
  }
}

async function runAll() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING AETHERREAD COMPREHENSIVE TEST SUITE');
  console.log(`🎯 Target Production: ${PROD_BASE}`);
  console.log('======================================================\n');

  // --------------------------------------------------------------------------
  console.log('📦 1. UNIT TESTS: Novel & Manga URL Utilities');
  // --------------------------------------------------------------------------
  const { normalizeUrl, getNovelBaseUrl, inferPrevNextFromUrl } = await import('../src/lib/novel-utils.ts');

  await test('normalizeUrl: strips trailing slashes and whitespace', () => {
    assert.strictEqual(normalizeUrl('  https://site.com/novel/  '), 'https://site.com/novel');
    assert.strictEqual(normalizeUrl('https://site.com/novel'), 'https://site.com/novel');
    assert.strictEqual(normalizeUrl(''), '');
  });

  await test('getNovelBaseUrl: handles TruyenFull novel/chapter URLs', () => {
    assert.strictEqual(
      getNovelBaseUrl('https://truyenfull.live/kiem-lai/chuong-795'),
      'https://truyenfull.live/kiem-lai/'
    );
    assert.strictEqual(
      normalizeUrl(getNovelBaseUrl('https://truyenfull.live/kiem-lai/chuong-795')),
      'https://truyenfull.live/kiem-lai'
    );
  });

  await test('getNovelBaseUrl: handles TruyenQQ composite manga chapter URLs', () => {
    assert.strictEqual(
      normalizeUrl(getNovelBaseUrl('https://truyenqqko.com/truyen-tranh/yeu-than-ky-746-chap-0')),
      'https://truyenqqko.com/truyen-tranh/yeu-than-ky-746'
    );
    assert.strictEqual(
      normalizeUrl(getNovelBaseUrl('https://truyenqqko.com/truyen-tranh/toi-thang-cap-mot-minh-5898-chap-22')),
      'https://truyenqqko.com/truyen-tranh/toi-thang-cap-mot-minh-5898'
    );
  });

  await test('getNovelBaseUrl: preserves base novel URLs without mangling', () => {
    assert.strictEqual(
      normalizeUrl(getNovelBaseUrl('https://truyenqqko.com/truyen-tranh/yeu-than-ky-746')),
      'https://truyenqqko.com/truyen-tranh/yeu-than-ky-746'
    );
    assert.strictEqual(
      normalizeUrl(getNovelBaseUrl('https://truyenfull.live/kiem-lai')),
      'https://truyenfull.live/kiem-lai'
    );
  });

  await test('getNovelBaseUrl: handles local:// URLs for uploaded books', () => {
    assert.strictEqual(
      getNovelBaseUrl('local://abc12345/chapter-1'),
      'local://abc12345'
    );
  });

  await test('inferPrevNextFromUrl: handles Chapter 0 indexing correctly', () => {
    const chap0 = inferPrevNextFromUrl('https://truyenqqko.com/truyen-tranh/yeu-than-ky-746-chap-0');
    assert.strictEqual(chap0.prevUrl, null, 'Chapter 0 should have NO previous chapter');
    assert.strictEqual(
      chap0.nextUrl,
      'https://truyenqqko.com/truyen-tranh/yeu-than-ky-746-chap-1',
      'Chapter 0 next should be Chapter 1'
    );

    const chap1 = inferPrevNextFromUrl('https://truyenqqko.com/truyen-tranh/yeu-than-ky-746-chap-1');
    assert.strictEqual(
      chap1.prevUrl,
      'https://truyenqqko.com/truyen-tranh/yeu-than-ky-746-chap-0',
      'Chapter 1 prev should be Chapter 0'
    );
    assert.strictEqual(
      chap1.nextUrl,
      'https://truyenqqko.com/truyen-tranh/yeu-than-ky-746-chap-2'
    );
  });

  // --------------------------------------------------------------------------
  console.log('\n📦 2. UNIT TESTS: Text Replace Rules & Regex Matching');
  // --------------------------------------------------------------------------
  const { applyTextRules } = await import('../src/lib/replace-utils.ts');

  await test('applyTextRules: exact string replacement', () => {
    const input = 'Nhân vật chính là Tiêu Viêm.';
    const rules = [
      {
        id: '1',
        find_text: 'Tiêu Viêm',
        replace_with: 'Xiao Yan',
        is_regex: false,
        is_enabled: true,
        case_sensitive: true,
        ignore_accents: false,
      },
    ];
    const output = applyTextRules(input, rules);
    assert.strictEqual(output, 'Nhân vật chính là Xiao Yan.');
  });

  await test('applyTextRules: regex replacement with capture groups', () => {
    const input = 'Chương 123: Hỗn Loạn';
    const rules = [
      {
        id: '2',
        find_text: 'Chương (\\d+)',
        replace_with: 'Chapter [$1]',
        is_regex: true,
        is_enabled: true,
        case_sensitive: false,
        ignore_accents: false,
      },
    ];
    const output = applyTextRules(input, rules);
    assert.strictEqual(output, 'Chapter [123]: Hỗn Loạn');
  });

  // --------------------------------------------------------------------------
  console.log('\n📦 3. UNIT TESTS: Offline Chapter Detection for Uploaded Files');
  // --------------------------------------------------------------------------
  const { detectChapters, splitIntoBatches } = await import('../src/lib/chapters-client.ts');

  await test('detectChapters: extracts multiple chapters from plain text', () => {
    const sampleText = `
Chương 1: Mở Đầu
Nội dung chương 1 rất dài...

Chương 2: Khởi Hành
Nội dung chương 2 tiếp diễn...
    `;
    const detected = detectChapters(sampleText);
    assert.ok(detected && detected.length === 2, `Expected 2 chapters, got ${detected?.length}`);
    assert.strictEqual(detected[0].title, 'Chương 1: Mở Đầu');
    assert.strictEqual(detected[1].title, 'Chương 2: Khởi Hành');
  });

  await test('splitIntoBatches: partitions long unstructured text into parts', () => {
    const paragraphs = Array.from({ length: 50 }, (_, i) => `Đoạn văn số ${i + 1} với rất nhiều từ ngữ miêu tả...`).join('\n\n');
    const batches = splitIntoBatches(paragraphs, 300);
    assert.ok(batches.length > 1, 'Should split into multiple batches');
    assert.ok(batches[0].title.startsWith('Part 1'));
  });

  // --------------------------------------------------------------------------
  console.log('\n🌐 4. INTEGRATION TESTS: Auth & Middleware Protection');
  // --------------------------------------------------------------------------
  await test('Middleware: unauthenticated request to /api/read returns 401', async () => {
    const res = await fetch(`${PROD_BASE}/api/read?url=https://truyenfull.live/kiem-lai/chuong-1`);
    assert.strictEqual(res.status, 401, 'Should be blocked with 401');
    const json = await res.json();
    assert.ok(json.error && json.error.includes('Unauthorized'));
  });

  await test('Middleware: unauthenticated request to /library redirects to /login', async () => {
    const res = await fetch(`${PROD_BASE}/library`, { redirect: 'manual' });
    assert.ok(res.status === 307 || res.status === 302, `Expected redirect, got ${res.status}`);
    const location = res.headers.get('location') || '';
    assert.ok(location.includes('/login'), `Expected redirect to /login, got ${location}`);
  });

  await test('Middleware: authenticated request with valid cookie is accepted', async () => {
    const res = await fetch(`${PROD_BASE}/api/library`, {
      headers: { Cookie: sessionCookie },
    });
    assert.strictEqual(res.status, 200, 'Authenticated request should return 200 OK');
  });

  // --------------------------------------------------------------------------
  console.log('\n🛡️ 5. INTEGRATION TESTS: Image Proxy & SSRF Protection');
  // --------------------------------------------------------------------------
  await test('SSRF Protection: blocks private IP localhost', async () => {
    const res = await fetch(`${PROD_BASE}/api/proxy-image?url=http://localhost:3000/secret`);
    assert.strictEqual(res.status, 403, 'Localhost must be blocked with 403');
    const json = await res.json();
    assert.ok(json.error && json.error.includes('forbidden'));
  });

  await test('SSRF Protection: blocks 127.0.0.1 and 192.168.x.x', async () => {
    const res1 = await fetch(`${PROD_BASE}/api/proxy-image?url=http://127.0.0.1/admin`);
    assert.strictEqual(res1.status, 403);
    const res2 = await fetch(`${PROD_BASE}/api/proxy-image?url=http://192.168.1.1/router`);
    assert.strictEqual(res2.status, 403);
  });

  await test('Image Proxy: successfully fetches TruyenQQ CDN image with Referer', async () => {
    const targetImg = 'https://s135.hinhhinh.com/746/0/0.jpg?gt=hdfgdfg';
    const res = await fetch(
      `${PROD_BASE}/api/proxy-image?url=${encodeURIComponent(targetImg)}&referer=${encodeURIComponent('https://truyenqqko.com/')}`
    );
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.startsWith('image/'), `Expected image content-type, got ${contentType}`);
    const cacheControl = res.headers.get('cache-control') || '';
    assert.ok(cacheControl.includes('public') && cacheControl.includes('max-age'), 'Should have immutable caching');
  });

  // --------------------------------------------------------------------------
  console.log('\n📖 6. INTEGRATION TESTS: Novel & Manga Scraper API');
  // --------------------------------------------------------------------------
  await test('Novel Reader: scrapes text novel chapter (TruyenFull)', async () => {
    const url = 'https://truyenfull.live/kiem-lai/chuong-795';
    const res = await fetch(`${PROD_BASE}/api/read?url=${encodeURIComponent(url)}`, {
      headers: { Cookie: sessionCookie },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.title, 'Should have title');
    assert.ok(data.content && data.content.length > 500, 'Should have rich text content');
    assert.strictEqual(data.isManga, false, 'Text novel should NOT be manga');
    assert.ok(Array.isArray(data.chapters) && data.chapters.length > 0, 'Should have chapters list');
  });

  await test('Manga Reader: scrapes TruyenQQ chapter 0 (Bypasses Cloudflare 403)', async () => {
    const url = 'https://truyenqqko.com/truyen-tranh/yeu-than-ky-746-chap-0';
    const res = await fetch(`${PROD_BASE}/api/read?url=${encodeURIComponent(url)}`, {
      headers: { Cookie: sessionCookie },
    });
    assert.strictEqual(res.status, 200, 'Cloudflare 403 must be bypassed');
    const data = await res.json();
    assert.strictEqual(data.isManga, true, 'TruyenQQ chapter must be flagged as manga');
    assert.ok(data.content.includes('manga-viewer'), 'Must include .manga-viewer container');
    assert.ok(data.content.includes('/api/proxy-image?url='), 'Must proxy image URLs');
    assert.ok(Array.isArray(data.chapters) && data.chapters.length > 500, `Expected 500+ chapters, got ${data.chapters?.length}`);
  });

  await test('Manga Overview: scrapes base novel page for chapter list (TruyenQQ)', async () => {
    const url = 'https://truyenqqko.com/truyen-tranh/yeu-than-ky-746';
    const res = await fetch(`${PROD_BASE}/api/read?url=${encodeURIComponent(url)}`, {
      headers: { Cookie: sessionCookie },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.title.includes('Yêu Thần Ký'), `Expected title to include Yêu Thần Ký, got: ${data.title}`);
    assert.ok(Array.isArray(data.chapters) && data.chapters.length >= 700, `Expected 700+ chapters, got ${data.chapters?.length}`);
    assert.ok(data.chapters[0].title.includes('0') || data.chapters[0].url.includes('chap-0'), 'First chapter should be Chapter 0');
  });

  await test('Database Cache: repeated read is instantaneous', async () => {
    const url = 'https://truyenqqko.com/truyen-tranh/yeu-than-ky-746-chap-0';
    const start = Date.now();
    const res = await fetch(`${PROD_BASE}/api/read?url=${encodeURIComponent(url)}`, {
      headers: { Cookie: sessionCookie },
    });
    const duration = Date.now() - start;
    assert.strictEqual(res.status, 200);
    // Cached response typically finishes within 200ms
    assert.ok(duration < 800, `Cache hit should be fast, took ${duration}ms`);
  });

  // --------------------------------------------------------------------------
  console.log('\n🔊 7. INTEGRATION TESTS: Text-to-Speech (TTS) Proxy');
  // --------------------------------------------------------------------------
  await test('TTS Proxy: returns audio/mpeg stream for Vietnamese text', async () => {
    const res = await fetch(`${PROD_BASE}/api/tts?text=${encodeURIComponent('Thử nghiệm giọng đọc')}&lang=vi`);
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('audio') || contentType.includes('mpeg'), `Expected audio content-type, got ${contentType}`);
  });

  await test('TTS Proxy: returns 400 when text parameter is missing', async () => {
    const res = await fetch(`${PROD_BASE}/api/tts`);
    assert.strictEqual(res.status, 400);
  });

  // --------------------------------------------------------------------------
  console.log('\n🗄️ 8. DATABASE INTEGRATION TESTS: Neon PostgreSQL Connection');
  // --------------------------------------------------------------------------
  await test('Neon DB: verifies schema and table existence', async () => {
    const sql = neon(process.env.DATABASE_URL);
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
    const tableNames = tables.map((t) => t.table_name);
    assert.ok(tableNames.includes('library'), 'library table must exist');
    assert.ok(tableNames.includes('chapters'), 'chapters table must exist');
    assert.ok(tableNames.includes('replace_rules'), 'replace_rules table must exist');
    assert.ok(tableNames.includes('translations'), 'translations table must exist');
  });

  // --------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
