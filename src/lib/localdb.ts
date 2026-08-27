'use client';

export interface LocalBook {
  novel_url: string;
  title: string;
  site_name: string;
  total_chapters: number;
  chapters_list: string;
  last_read_url: string | null;
  last_read_title: string | null;
  scroll_position: number;
  updated_at: string;
}

export interface LocalChapter {
  url: string;
  novel_url: string;
  title: string;
  content: string;
  next_url: string | null;
  prev_url: string | null;
}

export interface LocalRule {
  id: string;
  scope: 'global' | 'book' | 'chapter';
  scope_value: string | null;
  find_text: string;
  replace_with: string;
  is_regex: boolean;
  is_enabled: boolean;
  case_sensitive: boolean;
  ignore_accents: boolean;
  sort_order: number;
}

const DB_NAME = 'aetherread';
const DB_VERSION = 1;
const BOOKS_STORE = 'local-books';
const CHAPTERS_STORE = 'local-chapters';
const RULES_STORE = 'local-rules';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: 'novel_url' });
      }
      if (!db.objectStoreNames.contains(CHAPTERS_STORE)) {
        const chStore = db.createObjectStore(CHAPTERS_STORE, { keyPath: 'url' });
        chStore.createIndex('novel_url', 'novel_url', { unique: false });
      }
      if (!db.objectStoreNames.contains(RULES_STORE)) {
        db.createObjectStore(RULES_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db =>
    new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const s = transaction.objectStore(store);
      const req = fn(s);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  );
}

export async function getAllBooks(): Promise<LocalBook[]> {
  try {
    const result = await tx<LocalBook[]>(BOOKS_STORE, 'readonly', s => s.getAll() as IDBRequest<LocalBook[]>);
    result.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return result;
  } catch {
    return [];
  }
}

export async function getBook(novelUrl: string): Promise<LocalBook | null> {
  try {
    const result = await tx<LocalBook | undefined>(BOOKS_STORE, 'readonly', s => s.get(novelUrl) as IDBRequest<LocalBook | undefined>);
    return result || null;
  } catch {
    return null;
  }
}

export async function putBook(book: LocalBook): Promise<void> {
  await tx<void>(BOOKS_STORE, 'readwrite', s => s.put(book) as unknown as IDBRequest<void>);
}

export async function deleteBook(novelUrl: string): Promise<void> {
  try {
    await openDB().then(db =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([BOOKS_STORE, CHAPTERS_STORE], 'readwrite');
        tx.objectStore(BOOKS_STORE).delete(novelUrl);
        const idx = tx.objectStore(CHAPTERS_STORE).index('novel_url');
        const range = IDBKeyRange.only(novelUrl);
        const req = idx.openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      })
    );
  } catch (err) {
    console.error('Failed to delete local book chapters:', err);
  }
}

export async function getChapter(url: string): Promise<LocalChapter | null> {
  try {
    const result = await tx<LocalChapter | undefined>(CHAPTERS_STORE, 'readonly', s => s.get(url) as IDBRequest<LocalChapter | undefined>);
    return result || null;
  } catch {
    return null;
  }
}

export async function putChapter(chapter: LocalChapter): Promise<void> {
  await tx<void>(CHAPTERS_STORE, 'readwrite', s => s.put(chapter) as unknown as IDBRequest<void>);
}

export async function putChapters(chapters: LocalChapter[]): Promise<void> {
  await openDB().then(db =>
    new Promise<void>((resolve, reject) => {
      const t = db.transaction(CHAPTERS_STORE, 'readwrite');
      const s = t.objectStore(CHAPTERS_STORE);
      for (const ch of chapters) {
        s.put(ch);
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    })
  );
}

export async function getChaptersByNovel(novelUrl: string): Promise<LocalChapter[]> {
  try {
    const result = await openDB().then(db =>
      new Promise<LocalChapter[]>((resolve, reject) => {
        const t = db.transaction(CHAPTERS_STORE, 'readonly');
        const s = t.objectStore(CHAPTERS_STORE);
        const idx = s.index('novel_url');
        const req = idx.getAll(IDBKeyRange.only(novelUrl));
        req.onsuccess = () => resolve(req.result as LocalChapter[]);
        req.onerror = () => reject(req.error);
      })
    );
    return result || [];
  } catch {
    return [];
  }
}

// ---- Local Rules (applied to local/IndexedDB books) ----

export async function getAllLocalRules(): Promise<LocalRule[]> {
  try {
    const result = await tx<LocalRule[]>(RULES_STORE, 'readonly', s => s.getAll() as IDBRequest<LocalRule[]>);
    return result || [];
  } catch {
    return [];
  }
}

export async function getLocalRulesForChapter(
  novelUrl: string,
  chapterUrl: string
): Promise<LocalRule[]> {
  const all = await getAllLocalRules();
  return all
    .filter(r => r.is_enabled && (
      r.scope === 'global' ||
      (r.scope === 'book' && r.scope_value === novelUrl) ||
      (r.scope === 'chapter' && r.scope_value === chapterUrl)
    ))
    .sort((a, b) => a.sort_order - b.sort_order);
}

export async function putLocalRule(rule: LocalRule): Promise<void> {
  await tx<void>(RULES_STORE, 'readwrite', s => s.put(rule) as unknown as IDBRequest<void>);
}

export async function deleteLocalRule(id: string): Promise<void> {
  await tx<void>(RULES_STORE, 'readwrite', s => s.delete(id) as unknown as IDBRequest<void>);
}
