'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState('light');
  const router = useRouter();

  useEffect(() => {
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('aetherread_theme') || 'light';
    setTheme(savedTheme);
    
    if (savedTheme === 'auto') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      // Successful login, redirect to homepage
      router.push('/');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'An error occurred during login.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'var(--bg)',
        transition: 'background-color 0.3s ease',
        padding: '1.5rem'
      }}
    >
      <div 
        className="card animate-pulse" 
        style={{ 
          maxWidth: '400px', 
          width: '100%', 
          padding: '2.5rem',
          boxShadow: 'var(--shadow)',
          animation: 'slideUp 0.3s ease-out',
          backdropFilter: 'blur(10px)'
        }}
      >
        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 900, background: 'linear-gradient(135deg, var(--accent), #f43f5e)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'inline-block', margin: '0 0 0.5rem 0' }}>
            ✦ AetherRead
          </h1>
          <p style={{ color: 'var(--meta-fg)', fontSize: '0.875rem' }}>
            Private Novel Proxy Reader. Please sign in to read.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div 
            style={{ 
              background: 'rgba(239, 68, 68, 0.1)', 
              color: '#ef4444', 
              padding: '0.75rem 1rem', 
              borderRadius: '8px', 
              fontSize: '0.875rem', 
              marginBottom: '1.5rem',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              textAlign: 'center',
              animation: 'slideUp 0.2s ease-out'
            }}
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="control-group">
            <label className="control-label" htmlFor="login-username" style={{ marginBottom: '0.375rem' }}>
              Username
            </label>
            <input
              id="login-username"
              type="text"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              disabled={loading}
            />
          </div>

          <div className="control-group">
            <label className="control-label" htmlFor="login-password" style={{ marginBottom: '0.375rem' }}>
              Password
            </label>
            <input
              id="login-password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
              disabled={loading}
            />
          </div>

          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ 
              padding: '0.75rem', 
              marginTop: '0.5rem',
              fontWeight: 600,
              letterSpacing: '0.025em' 
            }}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In →'}
          </button>
        </form>
      </div>
    </div>
  );
}
