'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface ArticleData {
  title: string;
  content: string;
  excerpt: string;
  siteName: string;
  nextUrl: string | null;
  prevUrl: string | null;
  originalUrl: string;
  chapters?: { title: string; url: string }[];
  originalFont?: string | null;
}

function getNovelBaseUrl(chapterUrl: string): string {
  try {
    const url = new URL(chapterUrl);
    if (url.hostname.includes('royalroad.com')) {
      const match = url.pathname.match(/^\/fiction\/(\d+)\/([^/]+)/);
      if (match) {
        return `${url.origin}/fiction/${match[1]}/${match[2]}`;
      }
    }
    const paths = url.pathname.split('/').filter(Boolean);
    if (paths.length > 1) {
      const last = paths[paths.length - 1];
      if (last.includes('chuong') || last.includes('chapter') || last.includes('chap') || !isNaN(Number(last))) {
        return `${url.origin}/${paths.slice(0, -1).join('/')}/`;
      }
    }
    return `${url.origin}/${paths.join('/')}/`;
  } catch {
    return chapterUrl;
  }
}

function ReaderView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const targetUrl = searchParams.get('url');

  // Library & Sync States
  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reader Preferences State
  const [theme, setTheme] = useState('light');
  const [fontSizePx, setFontSizePx] = useState(20);
  const [lineHeight, setLineHeight] = useState('relaxed');
  const [fontFamily, setFontFamily] = useState('serif-lora');
  const [readerWidth, setReaderWidth] = useState('normal');
  
  // UI State
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ArticleData | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  const handleChapterChange = (url: string) => {
    if (url) {
      router.push(`/read?url=${encodeURIComponent(url)}`);
    }
  };

  const getCurrentChapterSelectValue = () => {
    if (!data?.chapters || data.chapters.length === 0) return data?.originalUrl || '';
    const exactMatch = data.chapters.find(c => c.url === data.originalUrl);
    if (exactMatch) return exactMatch.url;

    const normalizePath = (u: string) => {
      try {
        let p = new URL(u).pathname;
        if (p.endsWith('/')) p = p.slice(0, -1);
        return p;
      } catch {
        return u;
      }
    };
    
    const currentPath = normalizePath(data.originalUrl);
    const pathMatch = data.chapters.find(c => normalizePath(c.url) === currentPath);
    if (pathMatch) return pathMatch.url;

    return data.chapters[0].url;
  };

  // Initialize preferences from LocalStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('aetherread_theme') || 'light';
    const savedFontSize = localStorage.getItem('aetherread_fontSizePx') || '20';
    const savedLineHeight = localStorage.getItem('aetherread_lineHeight') || 'relaxed';
    const savedFontFamily = localStorage.getItem('aetherread_fontFamily') || 'serif-lora';
    const savedReaderWidth = localStorage.getItem('aetherread_readerWidth') || 'normal';

    setTheme(savedTheme);
    setFontSizePx(parseInt(savedFontSize));
    setLineHeight(savedLineHeight);
    setFontFamily(savedFontFamily);
    setReaderWidth(savedReaderWidth);

    if (savedTheme === 'auto') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  }, []);

  // Listen to prefers-color-scheme changes when Auto is selected
  useEffect(() => {
    if (theme !== 'auto') return;
    
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  // Fetch article data when targetUrl changes
  useEffect(() => {
    if (!targetUrl) {
      setError('No URL provided to read.');
      setLoading(false);
      return;
    }

    const fetchArticle = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/read?url=${encodeURIComponent(targetUrl)}`);
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Failed to fetch the chapter.');
        }

        setData(result);
        
        // Save to History in LocalStorage
        saveToHistory(targetUrl, result.title || 'Untitled Chapter', result.siteName || new URL(targetUrl).hostname);
      } catch (err: any) {
        setError(err.message || 'An error occurred while loading content.');
      } finally {
        setLoading(false);
        window.scrollTo(0, 0); // scroll to top on new chapter load
      }
    };

    fetchArticle();
  }, [targetUrl]);

  // Check library status and restore scroll position if match is found
  useEffect(() => {
    if (!data) return;
    const checkLibrary = async () => {
      try {
        const res = await fetch('/api/library');
        if (res.ok) {
          const library = await res.json();
          const novelUrl = getNovelBaseUrl(data.originalUrl);
          const matched = library.find((b: any) => b.novel_url === novelUrl);
          if (matched) {
            setIsSaved(true);
            
            // Restore scroll position only if it corresponds to current page
            if (matched.last_read_url === data.originalUrl && matched.scroll_position > 0) {
              setTimeout(() => {
                const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
                if (totalHeight > 0) {
                  window.scrollTo(0, (matched.scroll_position / 100) * totalHeight);
                }
              }, 250);
            }
          } else {
            setIsSaved(false);
          }
        }
      } catch (err) {
        console.error('Failed to verify library status:', err);
      }
    };

    checkLibrary();
  }, [data]);

  // Lazy pre-fetch next 5 chapters in background to Neon DB
  useEffect(() => {
    if (!data || !data.chapters || data.chapters.length === 0) return;

    const currentIndex = data.chapters.findIndex(c => c.url === data.originalUrl);
    if (currentIndex === -1) return;

    const nextChapters = data.chapters.slice(currentIndex + 1, currentIndex + 6);

    const prefetch = async () => {
      for (const chap of nextChapters) {
        try {
          await fetch(`/api/read?url=${encodeURIComponent(chap.url)}`);
          console.log(`Pre-fetched and cached chapter: ${chap.title}`);
        } catch (e) {
          console.error('Pre-fetch failed for:', chap.url, e);
        }
      }
    };

    const timer = setTimeout(() => {
      prefetch();
    }, 2500); // Delay slightly to avoid parsing conflicts on mount

    return () => clearTimeout(timer);
  }, [data]);

  const saveProgress = async (scrollPos: number) => {
    if (!data || !isSaved) return;
    const novelUrl = getNovelBaseUrl(data.originalUrl);
    try {
      await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'progress',
          novel_url: novelUrl,
          last_read_url: data.originalUrl,
          last_read_title: data.title,
          scroll_position: scrollPos
        })
      });
    } catch (err) {
      console.error('Failed to sync progress to database:', err);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const novelUrl = getNovelBaseUrl(data.originalUrl);
      let novelTitle = data.siteName || 'New Novel';
      if (data.title) {
        novelTitle = data.title.split('-')[0].trim().split('Chương')[0].trim().split('Chapter')[0].trim();
        if (!novelTitle) novelTitle = data.title;
      }

      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          novel_url: novelUrl,
          title: novelTitle,
          site_name: data.siteName,
          chapters_list: JSON.stringify(data.chapters || [])
        })
      });

      if (!res.ok) {
        throw new Error('Failed to save to library');
      }

      setIsSaved(true);

      // Save initial reading progress
      await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'progress',
          novel_url: novelUrl,
          last_read_url: data.originalUrl,
          last_read_title: data.title,
          scroll_position: 0
        })
      });
    } catch (err) {
      console.error(err);
      alert('Failed to save novel to library.');
    } finally {
      setSaving(false);
    }
  };

  // Track scroll progress and save progress (throttled)
  useEffect(() => {
    if (!data) return;

    let timer: NodeJS.Timeout;
    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (totalHeight > 0) {
        const progress = (window.scrollY / totalHeight) * 100;
        setScrollProgress(progress);

        if (isSaved) {
          clearTimeout(timer);
          timer = setTimeout(() => {
            saveProgress(progress);
          }, 3000);
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(timer);
    };
  }, [data, isSaved]);

  const saveToHistory = (url: string, title: string, siteName: string) => {
    const historyJSON = localStorage.getItem('aetherread_history');
    let historyList: any[] = [];
    if (historyJSON) {
      try {
        historyList = JSON.parse(historyJSON);
      } catch {}
    }

    // Remove existing item to avoid duplication and move to top
    historyList = historyList.filter(item => item.url !== url);
    
    // Add new item
    historyList.unshift({
      url,
      title,
      siteName,
      timestamp: Date.now(),
    });

    // Cap history list size to 20
    if (historyList.length > 20) {
      historyList = historyList.slice(0, 20);
    }

    localStorage.setItem('aetherread_history', JSON.stringify(historyList));
  };

  // Preference update handlers
  const updateTheme = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem('aetherread_theme', newTheme);
    
    if (newTheme === 'auto') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', newTheme);
    }
  };

  const updatePreference = (key: string, value: string, setter: (val: string) => void) => {
    setter(value);
    localStorage.setItem(`aetherread_${key}`, value);
  };

  const applyPreset = (presetName: string) => {
    switch (presetName) {
      case 'standard':
        updatePreference('fontFamily', 'sans', setFontFamily);
        updatePreference('fontSizePx', '20', (val) => setFontSizePx(parseInt(val)));
        updatePreference('lineHeight', 'relaxed', setLineHeight);
        updatePreference('readerWidth', 'normal', setReaderWidth);
        break;
      case 'book':
        updatePreference('fontFamily', 'font-literata', setFontFamily);
        updatePreference('fontSizePx', '22', (val) => setFontSizePx(parseInt(val)));
        updatePreference('lineHeight', 'relaxed', setLineHeight);
        updatePreference('readerWidth', 'narrow', setReaderWidth);
        break;
      case 'compact':
        updatePreference('fontFamily', 'font-be-vietnam', setFontFamily);
        updatePreference('fontSizePx', '16', (val) => setFontSizePx(parseInt(val)));
        updatePreference('lineHeight', 'normal', setLineHeight);
        updatePreference('readerWidth', 'wide', setReaderWidth);
        break;
      case 'focus':
        updatePreference('fontFamily', 'serif-lora', setFontFamily);
        updatePreference('fontSizePx', '24', (val) => setFontSizePx(parseInt(val)));
        updatePreference('lineHeight', 'loose', setLineHeight);
        updatePreference('readerWidth', 'narrow', setReaderWidth);
        break;
    }
  };

  const lineHeights: Record<string, string> = {
    normal: '1.6',
    relaxed: '1.8',
    loose: '2.1',
  };

  const readerWidths: Record<string, string> = {
    narrow: 'var(--reader-width-narrow)',
    normal: 'var(--reader-width-normal)',
    wide: 'var(--reader-width-wide)',
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header className="header">
          <div className="container header-inner">
            <button className="btn" onClick={() => router.push('/')}>← Back</button>
            <div className="logo">✦ Reading...</div>
            <div style={{ width: '60px' }}></div>
          </div>
        </header>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem 0' }}>
          <div className="container" style={{ maxWidth: '720px', width: '100%' }}>
            <div className="skeleton skeleton-title animate-pulse"></div>
            <div className="skeleton skeleton-line animate-pulse" style={{ width: '100%' }}></div>
            <div className="skeleton skeleton-line animate-pulse" style={{ width: '95%' }}></div>
            <div className="skeleton skeleton-line animate-pulse" style={{ width: '97%' }}></div>
            <div className="skeleton skeleton-line animate-pulse" style={{ width: '85%' }}></div>
            <div className="skeleton skeleton-line animate-pulse" style={{ width: '92%' }}></div>
            <div className="skeleton skeleton-line animate-pulse" style={{ width: '90%' }}></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header className="header">
          <div className="container header-inner">
            <button className="btn" onClick={() => router.push('/')}>← Home</button>
            <div className="logo">✦ Error</div>
            <div style={{ width: '60px' }}></div>
          </div>
        </header>
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="card" style={{ maxWidth: '500px', width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h2 style={{ marginBottom: '1rem' }}>Unable to Read Page</h2>
            <p style={{ color: 'var(--meta-fg)', marginBottom: '1.5rem' }}>{error || 'No content found.'}</p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => router.push('/')}>Go Home</button>
              {targetUrl && (
                <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="btn">
                  Open Original Site
                </a>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Scroll Progress Bar */}
      <div className="progress-bar-container">
        <div className="progress-bar" style={{ width: `${scrollProgress}%` }}></div>
      </div>

      {/* Header */}
      <header className="header">
        <div className="container header-inner">
          <button className="btn" onClick={() => router.push('/')}>← Home</button>
          {data.chapters && data.chapters.length > 0 ? (
            <select
              value={getCurrentChapterSelectValue()}
              onChange={(e) => handleChapterChange(e.target.value)}
              style={{
                maxWidth: '200px',
                padding: '0.4rem 0.6rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--card-bg)',
                color: 'var(--fg)',
                fontSize: '0.85rem',
                cursor: 'pointer',
                outline: 'none',
                fontWeight: 500
              }}
            >
              {data.chapters.map((chap, idx) => (
                <option key={idx} value={chap.url}>
                  {chap.title}
                </option>
              ))}
            </select>
          ) : (
            <div className="logo" style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--meta-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
              {data.siteName}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {!isSaved ? (
              <button className="btn btn-primary" onClick={handleSaveToLibrary} disabled={saving} style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}>
                {saving ? 'Saving...' : '❤ Save'}
              </button>
            ) : (
              <button className="btn" disabled style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', opacity: 0.7, borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-soft)', cursor: 'default' }}>
                ✔ Saved
              </button>
            )}
            <button className="btn" onClick={() => setShowSettings(!showSettings)}>
              ⚙ Settings
            </button>
          </div>
        </div>
      </header>

      {/* Floating Preference Panel */}
      <div className="floating-settings">
        {showSettings && (
          <div className="settings-panel">
            {/* Presets */}
            <div className="control-group">
              <span className="control-label">Quick Presets</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button className="control-btn btn" style={{ padding: '0.4rem 0.25rem', fontSize: '0.75rem' }} onClick={() => applyPreset('standard')}>
                  Standard
                </button>
                <button className="control-btn btn" style={{ padding: '0.4rem 0.25rem', fontSize: '0.75rem' }} onClick={() => applyPreset('book')}>
                  📖 Book Warm
                </button>
                <button className="control-btn btn" style={{ padding: '0.4rem 0.25rem', fontSize: '0.75rem' }} onClick={() => applyPreset('compact')}>
                  Compact
                </button>
                <button className="control-btn btn" style={{ padding: '0.4rem 0.25rem', fontSize: '0.75rem' }} onClick={() => applyPreset('focus')}>
                  👁 Focus
                </button>
              </div>
            </div>

            {/* Theme Selector */}
            <div className="control-group">
              <span className="control-label">Theme</span>
              <div className="theme-selector" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {['light', 'dark', 'sepia', 'slate'].map(t => (
                    <button
                      key={t}
                      className={`theme-btn theme-btn-${t} ${theme === t ? 'active' : ''}`}
                      onClick={() => updateTheme(t)}
                      title={`${t.charAt(0).toUpperCase() + t.slice(1)} Theme`}
                    />
                  ))}
                </div>
                <button
                  className={`control-btn ${theme === 'auto' ? 'active' : ''}`}
                  onClick={() => updateTheme('auto')}
                  style={{ padding: '0.375rem 0.5rem', fontSize: '0.75rem', flex: 1 }}
                >
                  🌓 Auto
                </button>
              </div>
            </div>

            {/* Font Family Selector */}
            <div className="control-group">
              <span className="control-label">Font Style</span>
              <div className="control-buttons" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', background: 'transparent', border: 'none', padding: 0 }}>
                <button
                  className={`control-btn btn ${fontFamily === 'serif-lora' ? 'active' : ''}`}
                  onClick={() => updatePreference('fontFamily', 'serif-lora', setFontFamily)}
                  style={{ flex: '1 0 45%', padding: '0.375rem 0' }}
                >
                  Lora
                </button>
                <button
                  className={`control-btn btn ${fontFamily === 'font-literata' ? 'active' : ''}`}
                  onClick={() => updatePreference('fontFamily', 'font-literata', setFontFamily)}
                  style={{ flex: '1 0 45%', padding: '0.375rem 0' }}
                >
                  Literata
                </button>
                <button
                  className={`control-btn btn ${fontFamily === 'font-be-vietnam' ? 'active' : ''}`}
                  onClick={() => updatePreference('fontFamily', 'font-be-vietnam', setFontFamily)}
                  style={{ flex: '1 0 45%', padding: '0.375rem 0' }}
                >
                  Be VN
                </button>
                <button
                  className={`control-btn btn ${fontFamily === 'sans' ? 'active' : ''}`}
                  onClick={() => updatePreference('fontFamily', 'sans', setFontFamily)}
                  style={{ flex: '1 0 45%', padding: '0.375rem 0' }}
                >
                  Inter
                </button>
                {data.originalFont && (
                  <button
                    className={`control-btn btn ${fontFamily === 'original' ? 'active' : ''}`}
                    onClick={() => updatePreference('fontFamily', 'original', setFontFamily)}
                    style={{ flex: '1 0 95%', padding: '0.375rem 0', fontSize: '0.75rem' }}
                  >
                    Copy Site Font ({data.originalFont})
                  </button>
                )}
              </div>
            </div>

            {/* Font Size Selector */}
            <div className="control-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="control-label">Size</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{fontSizePx}px</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button 
                  className="btn" 
                  style={{ padding: '0.25rem 0.5rem', minWidth: '28px' }}
                  onClick={() => updatePreference('fontSizePx', String(Math.max(14, fontSizePx - 1)), (val) => setFontSizePx(parseInt(val)))}
                >
                  -
                </button>
                <input 
                  type="range" 
                  min="14" 
                  max="36" 
                  value={fontSizePx} 
                  onChange={(e) => updatePreference('fontSizePx', e.target.value, (val) => setFontSizePx(parseInt(val)))}
                  style={{ flex: 1, cursor: 'pointer', accentColor: 'var(--accent)' }}
                />
                <button 
                  className="btn" 
                  style={{ padding: '0.25rem 0.5rem', minWidth: '28px' }}
                  onClick={() => updatePreference('fontSizePx', String(Math.min(36, fontSizePx + 1)), (val) => setFontSizePx(parseInt(val)))}
                >
                  +
                </button>
              </div>
            </div>

            {/* Line Height Selector */}
            <div className="control-group">
              <span className="control-label">Spacing</span>
              <div className="control-buttons">
                <button
                  className={`control-btn ${lineHeight === 'normal' ? 'active' : ''}`}
                  onClick={() => updatePreference('lineHeight', 'normal', setLineHeight)}
                >
                  Tight
                </button>
                <button
                  className={`control-btn ${lineHeight === 'relaxed' ? 'active' : ''}`}
                  onClick={() => updatePreference('lineHeight', 'relaxed', setLineHeight)}
                >
                  Medium
                </button>
                <button
                  className={`control-btn ${lineHeight === 'loose' ? 'active' : ''}`}
                  onClick={() => updatePreference('lineHeight', 'loose', setLineHeight)}
                >
                  Wide
                </button>
              </div>
            </div>

            {/* Reader Width Selector */}
            <div className="control-group">
              <span className="control-label">Margin</span>
              <div className="control-buttons">
                <button
                  className={`control-btn ${readerWidth === 'narrow' ? 'active' : ''}`}
                  onClick={() => updatePreference('readerWidth', 'narrow', setReaderWidth)}
                >
                  Narrow
                </button>
                <button
                  className={`control-btn ${readerWidth === 'normal' ? 'active' : ''}`}
                  onClick={() => updatePreference('readerWidth', 'normal', setReaderWidth)}
                >
                  Mid
                </button>
                <button
                  className={`control-btn ${readerWidth === 'wide' ? 'active' : ''}`}
                  onClick={() => updatePreference('readerWidth', 'wide', setReaderWidth)}
                >
                  Wide
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Reading Panel */}
      <main style={{ flex: 1 }}>
        <article 
          className="reader-container" 
          style={{ maxWidth: readerWidths[readerWidth] }}
        >
          {/* Header metadata */}
          <div className="reader-header">
            <div className="reader-meta">{data.siteName}</div>
            <h1 className="reader-title">{data.title}</h1>
            <a href={data.originalUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem', color: 'var(--meta-fg)' }}>
              🌐 View Original Website
            </a>
          </div>

          {/* Extracted story content */}
          <div 
            className={`reader-content ${fontFamily === 'sans' ? 'font-sans' : fontFamily === 'font-be-vietnam' ? 'font-be-vietnam' : fontFamily === 'font-literata' ? 'font-literata' : fontFamily === 'serif-lora' ? 'font-serif-lora' : ''}`}
            style={{ 
              fontSize: `${fontSizePx}px`, 
              lineHeight: lineHeights[lineHeight],
              fontFamily: fontFamily === 'original' && data.originalFont ? data.originalFont : undefined
            }}
            dangerouslySetInnerHTML={{ __html: data.content }}
          />

          {/* Bottom navigation */}
          <div className="chapter-nav" style={{ alignItems: 'center' }}>
            {data.prevUrl ? (
              <button 
                className="btn"
                onClick={() => router.push(`/read?url=${encodeURIComponent(data.prevUrl!)}`)}
                style={{ minWidth: '90px' }}
              >
                ◀ Prev
              </button>
            ) : (
              <div style={{ flex: 1, minWidth: '90px' }}></div>
            )}
            
            {data.chapters && data.chapters.length > 0 ? (
              <select
                value={getCurrentChapterSelectValue()}
                onChange={(e) => handleChapterChange(e.target.value)}
                style={{
                  padding: '0.625rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'var(--card-bg)',
                  color: 'var(--fg)',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  outline: 'none',
                  maxWidth: '180px',
                  textAlign: 'center',
                  fontWeight: 500
                }}
              >
                {data.chapters.map((chap, idx) => (
                  <option key={idx} value={chap.url}>
                    {chap.title}
                  </option>
                ))}
              </select>
            ) : (
              <button className="btn" onClick={() => router.push('/')}>
                Index
              </button>
            )}

            {data.nextUrl ? (
              <button 
                className="btn btn-primary"
                onClick={() => router.push(`/read?url=${encodeURIComponent(data.nextUrl!)}`)}
                style={{ minWidth: '90px' }}
              >
                Next ▶
              </button>
            ) : (
              <div style={{ flex: 1, minWidth: '90px' }}></div>
            )}
          </div>
        </article>
      </main>
    </div>
  );
}

export default function ReadPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header className="header">
          <div className="container header-inner">
            <button className="btn">← Back</button>
            <div className="logo">✦ Loading...</div>
            <div style={{ width: '60px' }}></div>
          </div>
        </header>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem 0' }}>
          <div className="container" style={{ maxWidth: '720px', width: '100%' }}>
            <div className="skeleton skeleton-title animate-pulse"></div>
            <div className="skeleton skeleton-line animate-pulse" style={{ width: '100%' }}></div>
            <div className="skeleton skeleton-line animate-pulse" style={{ width: '95%' }}></div>
            <div className="skeleton skeleton-line animate-pulse" style={{ width: '90%' }}></div>
          </div>
        </div>
      </div>
    }>
      <ReaderView />
    </Suspense>
  );
}
