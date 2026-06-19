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
}

function ReaderView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const targetUrl = searchParams.get('url');

  // Reader Preferences State
  const [theme, setTheme] = useState('light');
  const [fontSize, setFontSize] = useState('normal');
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
    const savedFontSize = localStorage.getItem('aetherread_fontSize') || 'normal';
    const savedLineHeight = localStorage.getItem('aetherread_lineHeight') || 'relaxed';
    const savedFontFamily = localStorage.getItem('aetherread_fontFamily') || 'serif-lora';
    const savedReaderWidth = localStorage.getItem('aetherread_readerWidth') || 'normal';

    setTheme(savedTheme);
    setFontSize(savedFontSize);
    setLineHeight(savedLineHeight);
    setFontFamily(savedFontFamily);
    setReaderWidth(savedReaderWidth);

    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

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

  // Track scroll progress
  useEffect(() => {
    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (totalHeight > 0) {
        const progress = (window.scrollY / totalHeight) * 100;
        setScrollProgress(progress);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  const updatePreference = (key: string, value: string, setter: (val: string) => void) => {
    setter(value);
    localStorage.setItem(`aetherread_${key}`, value);
  };

  const fontSizes: Record<string, string> = {
    small: '1.05rem',
    normal: '1.25rem',
    large: '1.45rem',
    'extra-large': '1.65rem',
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
          <button className="btn" onClick={() => setShowSettings(!showSettings)}>
            ⚙ Settings
          </button>
        </div>
      </header>

      {/* Floating Preference Panel */}
      <div className="floating-settings">
        {showSettings && (
          <div className="settings-panel">
            {/* Theme Selector */}
            <div className="control-group">
              <span className="control-label">Theme</span>
              <div className="theme-selector">
                {['light', 'dark', 'sepia', 'slate'].map(t => (
                  <button
                    key={t}
                    className={`theme-btn theme-btn-${t} ${theme === t ? 'active' : ''}`}
                    onClick={() => updateTheme(t)}
                    title={`${t.charAt(0).toUpperCase() + t.slice(1)} Theme`}
                  />
                ))}
              </div>
            </div>

            {/* Font Family Selector */}
            <div className="control-group">
              <span className="control-label">Font Style</span>
              <div className="control-buttons">
                <button
                  className={`control-btn ${fontFamily === 'serif-lora' ? 'active' : ''}`}
                  onClick={() => updatePreference('fontFamily', 'serif-lora', setFontFamily)}
                >
                  Lora
                </button>
                <button
                  className={`control-btn ${fontFamily === 'serif-merriweather' ? 'active' : ''}`}
                  onClick={() => updatePreference('fontFamily', 'serif-merriweather', setFontFamily)}
                >
                  Merri
                </button>
                <button
                  className={`control-btn ${fontFamily === 'sans' ? 'active' : ''}`}
                  onClick={() => updatePreference('fontFamily', 'sans', setFontFamily)}
                >
                  Inter
                </button>
              </div>
            </div>

            {/* Font Size Selector */}
            <div className="control-group">
              <span className="control-label">Size</span>
              <div className="control-buttons">
                {['small', 'normal', 'large', 'extra-large'].map((size, idx) => (
                  <button
                    key={size}
                    className={`control-btn ${fontSize === size ? 'active' : ''}`}
                    onClick={() => updatePreference('fontSize', size, setFontSize)}
                  >
                    {idx === 0 ? 'A-' : idx === 3 ? 'A+' : size === 'normal' ? 'A' : 'A'}
                  </button>
                ))}
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
            className={`reader-content ${fontFamily === 'sans' ? 'font-sans' : fontFamily === 'serif-merriweather' ? 'font-serif-merriweather' : 'font-serif-lora'}`}
            style={{ 
              fontSize: fontSizes[fontSize], 
              lineHeight: lineHeights[lineHeight] 
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
