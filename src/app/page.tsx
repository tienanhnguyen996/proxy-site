'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface HistoryItem {
  url: string;
  title: string;
  siteName: string;
  timestamp: number;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [theme, setTheme] = useState('light');
  const router = useRouter();

  useEffect(() => {
    // Load reading history from localStorage
    const savedHistory = localStorage.getItem('aetherread_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }

    // Load theme from localStorage
    const savedTheme = localStorage.getItem('aetherread_theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    // Direct redirection to the reader page with encoded url
    router.push(`/read?url=${encodeURIComponent(url.trim())}`);
  };

  const handleDemoClick = (demoUrl: string) => {
    router.push(`/read?url=${encodeURIComponent(demoUrl)}`);
  };

  const clearHistory = () => {
    localStorage.removeItem('aetherread_history');
    setHistory([]);
  };

  const toggleTheme = () => {
    const nextThemeMap: Record<string, string> = {
      light: 'sepia',
      sepia: 'dark',
      dark: 'slate',
      slate: 'light',
    };
    const nextTheme = nextThemeMap[theme] || 'light';
    setTheme(nextTheme);
    localStorage.setItem('aetherread_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  // Demo novels for the user to try
  const demoNovels = [
    {
      title: "Mother of Learning - Chapter 1",
      site: "RoyalRoad",
      url: "https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301777/1-good-morning-brother"
    },
    {
      title: "Super Supportive - Chapter 1",
      site: "RoyalRoad",
      url: "https://www.royalroad.com/fiction/63759/super-supportive/chapter/1102285/one-the-boy-who-wasnt-there"
    },
    {
      title: "The Wandering Inn - 1.00",
      site: "Wandering Inn",
      url: "https://wanderinginn.com/2016/07/27/1-00/"
    }
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header className="header">
        <div className="container header-inner">
          <div className="logo" style={{ cursor: 'pointer' }} onClick={() => router.push('/')}>
            ✦ AetherRead
          </div>
          <button className="btn" onClick={toggleTheme}>
            Theme: {theme.charAt(0).toUpperCase() + theme.slice(1)}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '4rem 0' }}>
        <div className="container" style={{ maxWidth: '800px' }}>
          
          {/* Hero Section */}
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h1 style={{ fontSize: '3rem', fontWeight: 900, letterSpacing: '-0.03em', marginBottom: '1rem' }}>
              Your Novels. Clean & Ad-Free.
            </h1>
            <p style={{ color: 'var(--meta-fg)', fontSize: '1.125rem', maxWidth: '600px', margin: '0 auto' }}>
              Paste any web novel chapter link below. We strip the ads, clutter, and trackers, leaving you with a premium, fully customizable reader interface.
            </p>
          </div>

          {/* Search Card */}
          <div className="card" style={{ marginBottom: '3rem' }}>
            <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="control-group">
                <label className="control-label" htmlFor="novel-url">Novel Chapter URL</label>
                <input
                  id="novel-url"
                  type="url"
                  className="input"
                  placeholder="https://www.royalroad.com/fiction/... or any web novel link"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ padding: '0.875rem' }}>
                Open in Reader Mode →
              </button>
            </form>
          </div>

          {/* Presets / Demo Section */}
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '1.25rem', color: 'var(--meta-fg)', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
              Try a Sample Chapter
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {demoNovels.map((novel, index) => (
                <div 
                  key={index}
                  className="card"
                  onClick={() => handleDemoClick(novel.url)}
                  style={{ 
                    cursor: 'pointer', 
                    padding: '1rem 1.25rem', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '1rem', margin: 0 }}>{novel.title}</h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--meta-fg)' }}>Source: {novel.site}</span>
                  </div>
                  <span style={{ color: 'var(--accent)', fontWeight: '600', fontSize: '0.875rem' }}>Read Now →</span>
                </div>
              ))}
            </div>
          </div>

          {/* History Section */}
          {history.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.25rem', color: 'var(--meta-fg)', margin: 0 }}>
                  Recently Read
                </h2>
                <button 
                  onClick={clearHistory}
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    color: 'var(--meta-fg)', 
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseOut={(e) => (e.currentTarget.style.color = 'var(--meta-fg)')}
                >
                  Clear History
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {history.map((item, index) => (
                  <div 
                    key={index} 
                    className="card"
                    onClick={() => handleDemoClick(item.url)}
                    style={{ 
                      cursor: 'pointer', 
                      padding: '1rem 1.25rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <h3 style={{ fontSize: '1rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '400px' }}>
                        {item.title}
                      </h3>
                      <span style={{ fontSize: '0.8rem', color: 'var(--meta-fg)' }}>
                        {item.siteName} • {new Date(item.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <span style={{ color: 'var(--accent)', fontSize: '0.875rem' }}>Resume →</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '2rem 0', color: 'var(--meta-fg)', fontSize: '0.875rem' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>© {new Date().getFullYear()} AetherRead. All rights reserved.</div>
          <div>Bypassing ads for the ultimate reading comfort.</div>
        </div>
      </footer>
    </div>
  );
}
