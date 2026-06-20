'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface LibraryBook {
  id: string;
  novel_url: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  site_name: string | null;
  total_chapters: number;
  last_read_url: string | null;
  last_read_title: string | null;
  scroll_position: number;
  updated_at: string;
  chapters_list: string; // JSON string of { title: string, url: string }[]
}

export default function LibraryPage() {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Search & Import State
  const [inputUrl, setInputUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const router = useRouter();

  // Load books on mount
  useEffect(() => {
    fetchLibrary();
  }, []);

  const fetchLibrary = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/library');
      if (!res.ok) {
        throw new Error('Failed to fetch library list');
      }
      const data = await res.json();
      setBooks(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred while loading your library.');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    setImporting(true);
    setImportError(null);

    try {
      // 1. Fetch novel info using the scraper API to extract chapter options list
      const scrapeRes = await fetch(`/api/read?url=${encodeURIComponent(inputUrl.trim())}`);
      const scrapeData = await scrapeRes.json();

      if (!scrapeRes.ok) {
        throw new Error(scrapeData.error || 'Failed to scrape novel information');
      }

      const chaptersList = scrapeData.chapters || [];
      if (chaptersList.length === 0) {
        // Fallback: create a single-chapter list if no dropdown was found
        chaptersList.push({ title: scrapeData.title || 'Chapter 1', url: inputUrl.trim() });
      }

      // Infer novel base URL
      let novelUrl = inputUrl.trim();
      try {
        const urlObj = new URL(inputUrl.trim());
        if (urlObj.hostname.includes('royalroad.com')) {
          const match = urlObj.pathname.match(/^\/fiction\/(\d+)\/([^/]+)/);
          if (match) {
            novelUrl = `${urlObj.origin}/fiction/${match[1]}/${match[2]}`;
          }
        } else {
          const paths = urlObj.pathname.split('/').filter(Boolean);
          if (paths.length > 1) {
            const last = paths[paths.length - 1];
            if (last.includes('chuong') || last.includes('chapter') || last.includes('chap') || !isNaN(Number(last))) {
              novelUrl = `${urlObj.origin}/${paths.slice(0, -1).join('/')}/`;
            }
          }
        }
      } catch {}

      // Infer title (remove chapter suffix if possible)
      let novelTitle = scrapeData.siteName || 'New Novel';
      if (scrapeData.title) {
        novelTitle = scrapeData.title.split('-')[0].trim().split('Chương')[0].trim().split('Chapter')[0].trim();
        if (!novelTitle) novelTitle = scrapeData.title;
      }

      // 2. Add to database via library API
      const libRes = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          novel_url: novelUrl,
          title: novelTitle,
          site_name: scrapeData.siteName || new URL(inputUrl).hostname,
          chapters_list: JSON.stringify(chaptersList)
        })
      });

      if (!libRes.ok) {
        const libData = await libRes.json();
        throw new Error(libData.error || 'Failed to save novel to library');
      }

      // Reset form and reload
      setInputUrl('');
      await fetchLibrary();
    } catch (err: any) {
      setImportError(err.message || 'An error occurred during import.');
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (novelUrl: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering card click
    
    if (!confirm('Are you sure you want to remove this novel and delete all its cached chapters?')) {
      return;
    }

    try {
      const res = await fetch(`/api/library?novel_url=${encodeURIComponent(novelUrl)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        throw new Error('Failed to delete book');
      }
      setBooks(prev => prev.filter(b => b.novel_url !== novelUrl));
    } catch (err: any) {
      alert(err.message || 'Error deleting book');
    }
  };

  const handleCardClick = (book: LibraryBook) => {
    // Navigate to last read chapter, or first chapter if not read yet
    const urlToRead = book.last_read_url || getFirstChapterUrl(book);
    if (urlToRead) {
      router.push(`/read?url=${encodeURIComponent(urlToRead)}`);
    } else {
      alert('No chapters found for this novel.');
    }
  };

  const getFirstChapterUrl = (book: LibraryBook): string | null => {
    try {
      const list = JSON.parse(book.chapters_list);
      return list.length > 0 ? list[0].url : null;
    } catch {
      return null;
    }
  };

  const calculateProgress = (book: LibraryBook) => {
    if (!book.last_read_url) return 0;
    try {
      const list = JSON.parse(book.chapters_list) as { title: string; url: string }[];
      const index = list.findIndex(c => c.url === book.last_read_url);
      if (index === -1) return 0;
      return Math.round(((index + 1) / list.length) * 100);
    } catch {
      return 0;
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header className="header">
        <div className="container header-inner">
          <div className="logo" style={{ cursor: 'pointer' }} onClick={() => router.push('/library')}>
            ✦ AetherRead
          </div>
          <button 
            className="btn" 
            onClick={async () => {
              // Sign out by clearing session cookie
              document.cookie = 'aetherread_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
              router.push('/login');
              router.refresh();
            }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '3rem 0' }}>
        <div className="container" style={{ maxWidth: '960px' }}>
          
          {/* Header Title */}
          <div style={{ marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 900, marginBottom: '0.25rem' }}>Your Library</h1>
              <p style={{ color: 'var(--meta-fg)', fontSize: '0.9rem' }}>
                Cloud synced across your devices. Distraction-free novel reading.
              </p>
            </div>
            <div style={{ fontSize: '0.85rem', background: 'var(--accent-soft)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '20px', fontWeight: 600 }}>
              {books.length} Saved {books.length === 1 ? 'Novel' : 'Novels'}
            </div>
          </div>

          {/* Import / Add Form Card */}
          <div className="card" style={{ marginBottom: '3rem', padding: '1.75rem', backdropFilter: 'blur(10px)' }}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: '1rem', fontWeight: 700 }}>
              ✦ Add New Novel Chapter Link
            </h2>
            <form onSubmit={handleImport} style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="url"
                className="input"
                placeholder="Paste any chapter URL (e.g. https://truyenfull.today/truyen-slug/chuong-1/)"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                disabled={importing}
                required
                style={{ flex: 1 }}
              />
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={importing}
                style={{ minWidth: '120px', whiteSpace: 'nowrap' }}
              >
                {importing ? 'Importing...' : 'Add Book +'}
              </button>
            </form>
            {importError && (
              <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.75rem', paddingLeft: '0.25rem' }}>
                ⚠️ {importError}
              </div>
            )}
          </div>

          {/* Library Grid */}
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
              {[1, 2, 3].map(i => (
                <div key={i} className="card animate-pulse" style={{ height: '180px' }}>
                  <div className="skeleton skeleton-title" style={{ width: '80%', height: '20px', marginBottom: '1rem' }}></div>
                  <div className="skeleton skeleton-line" style={{ width: '40%', height: '12px', marginBottom: '1.5rem' }}></div>
                  <div className="skeleton skeleton-line" style={{ width: '100%', height: '8px' }}></div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '3rem 1.5rem', background: 'var(--card-bg)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚠️</div>
              <h3 style={{ marginBottom: '0.5rem' }}>Connection Failed</h3>
              <p style={{ color: 'var(--meta-fg)', marginBottom: '1.5rem' }}>{error}</p>
              <button className="btn btn-primary" onClick={fetchLibrary}>Try Again</button>
            </div>
          ) : books.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 1.5rem', background: 'var(--card-bg)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1.25rem' }}>📚</div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: 700 }}>Your library is empty</h3>
              <p style={{ color: 'var(--meta-fg)', maxWidth: '400px', margin: '0 auto 1.5rem auto', fontSize: '0.9rem' }}>
                Paste a web novel chapter link in the search bar above to scrape, save, and sync it to your personal reader account.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
              {books.map(book => {
                const progress = calculateProgress(book);
                return (
                  <div 
                    key={book.id} 
                    className="card"
                    onClick={() => handleCardClick(book)}
                    style={{ 
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: '200px',
                      padding: '1.5rem',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Delete Hover Icon */}
                    <button
                      onClick={(e) => handleDelete(book.novel_url, e)}
                      style={{
                        position: 'absolute',
                        top: '0.75rem',
                        right: '0.75rem',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: 'none',
                        borderRadius: '6px',
                        width: '28px',
                        height: '28px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ef4444',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        opacity: 0.8
                      }}
                      title="Remove from Library"
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = '#ef4444';
                        e.currentTarget.style.color = '#ffffff';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                        e.currentTarget.style.color = '#ef4444';
                      }}
                    >
                      🗑
                    </button>

                    <div>
                      {/* Source badge */}
                      <span style={{ 
                        fontSize: '0.7rem', 
                        color: 'var(--meta-fg)', 
                        textTransform: 'uppercase', 
                        fontWeight: 700, 
                        letterSpacing: '0.05em',
                        display: 'block',
                        marginBottom: '0.5rem'
                      }}>
                        {book.site_name}
                      </span>
                      
                      {/* Novel Title */}
                      <h3 style={{ 
                        fontSize: '1.15rem', 
                        fontWeight: 800, 
                        margin: '0 0 0.5rem 0',
                        lineHeight: 1.3,
                        paddingRight: '1.5rem',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        {book.title}
                      </h3>

                      {/* Author */}
                      {book.author && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--meta-fg)', margin: '0 0 1rem 0' }}>
                          By {book.author}
                        </p>
                      )}
                    </div>

                    <div style={{ marginTop: '1.5rem' }}>
                      {/* Reading position text */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--meta-fg)', marginBottom: '0.375rem' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                          {book.last_read_title || 'Not started'}
                        </span>
                        <span style={{ fontWeight: 600 }}>{progress}%</span>
                      </div>

                      {/* Reading progress bar */}
                      <div style={{ width: '100%', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden', marginBottom: '1rem' }}>
                        <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', borderRadius: '3px' }}></div>
                      </div>

                      {/* Resume link */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--meta-fg)' }}>
                          {book.total_chapters} chapters
                        </span>
                        <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          {book.last_read_url ? 'Resume →' : 'Start Reading →'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '2rem 0', color: 'var(--meta-fg)', fontSize: '0.85rem', marginTop: '4rem' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>© {new Date().getFullYear()} AetherRead. All rights reserved.</div>
          <div>Bypassing ads for the ultimate reading comfort.</div>
        </div>
      </footer>
    </div>
  );
}
