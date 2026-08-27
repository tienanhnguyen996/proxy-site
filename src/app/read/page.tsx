'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getChapter, getBook, getLocalRulesForChapter, putBook, getAllLocalRules, putLocalRule, deleteLocalRule, type LocalBook, type LocalRule } from '@/lib/localdb';
import { applyTextRules } from '@/lib/replace-utils';

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
  hasTranslation?: boolean;
}

function getNovelBaseUrl(chapterUrl: string): string {
  // Handle local:// URLs for uploaded books
  if (chapterUrl.startsWith('local://')) {
    const match = chapterUrl.match(/^(local:\/\/[a-f0-9]+)/);
    return match ? match[1] : chapterUrl.split('/').slice(0, 2).join('/');
  }

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
  const [syncBanner, setSyncBanner] = useState<{ url: string; title: string } | null>(null);

  // Translation Source States (raw vs AI translated)
  const [mode, setMode] = useState<'raw' | 'translated'>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aetherread_mode') === 'translated' ? 'translated' : 'raw';
    }
    return 'raw';
  });
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [unavailableTranslations, setUnavailableTranslations] = useState<Record<string, boolean>>({});
  const fetchingTranslationsRef = useRef<Set<string>>(new Set());

  // Reader Preferences State
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aetherread_theme') || 'light';
    }
    return 'light';
  });
  const [fontSizePx, setFontSizePx] = useState(() => {
    if (typeof window !== 'undefined') {
      return parseInt(localStorage.getItem('aetherread_fontSizePx') || '20');
    }
    return 20;
  });
  const [lineHeight, setLineHeight] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aetherread_lineHeight') || 'relaxed';
    }
    return 'relaxed';
  });
  const [fontFamily, setFontFamily] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aetherread_fontFamily') || 'serif-lora';
    }
    return 'serif-lora';
  });
  const [readerWidth, setReaderWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aetherread_readerWidth') || 'normal';
    }
    return 'normal';
  });
  
  // UI State
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [rules, setRules] = useState<{ id: string; scope: string; scope_value: string | null; find_text: string; replace_with: string; is_regex: boolean; is_enabled: boolean; case_sensitive: boolean; ignore_accents: boolean; is_local?: boolean }[]>([]);
  const [ruleForm, setRuleForm] = useState({ scope: 'global', find_text: '', replace_with: '', is_regex: false, case_sensitive: false, ignore_accents: false });
  const [rulesLoading, setRulesLoading] = useState(false);
  const [loading, setLoading] = useState(() => !targetUrl);
  const [error, setError] = useState<string | null>(() => !targetUrl ? 'No URL provided to read.' : null);
  const [data, setData] = useState<ArticleData | null>(null);
  const [chapters, setChapters] = useState<{ title: string; url: string }[]>([]);
  const [scrollProgress, setScrollProgress] = useState(0);

  // Refs to track progress and prevent redundant saves
  const lastSavedUrlRef = useRef<string>('');
  const lastSavedProgressRef = useRef<number>(0);

  const handleChapterChange = (url: string) => {
    if (url) {
      if (isSaved && data) {
        saveProgress(scrollProgress);
      }
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

  // Initialize document theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('aetherread_theme') || 'light';
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
    if (!targetUrl) return;

    const fetchArticle = async () => {
      setLoading(true);
      setError(null);
      try {
        let result: ArticleData;

        if (targetUrl.startsWith('local://')) {
          // Local book: read directly from IndexedDB, no server round-trip
          const chapter = await getChapter(targetUrl);
          if (!chapter) {
            throw new Error('Chapter not found for this local book.');
          }
          const novelUrl = getNovelBaseUrl(targetUrl);
          const localRules = await getLocalRulesForChapter(novelUrl, targetUrl);
          const content = localRules.length > 0
            ? applyTextRules(chapter.content, localRules)
            : chapter.content;

          result = {
            title: chapter.title || 'Untitled',
            content,
            excerpt: '',
            siteName: 'Local Upload',
            nextUrl: chapter.next_url,
            prevUrl: chapter.prev_url,
            originalUrl: targetUrl,
            chapters: [],
          };

          // Populate chapter list from the book record so the dropdown works
          const book = await getBook(novelUrl);
          if (book && book.chapters_list) {
            try {
              const parsed = JSON.parse(book.chapters_list);
              if (parsed && parsed.length > 0) {
                setChapters(parsed);
              }
            } catch {}
          }
        } else {
          const response = await fetch(`/api/read?url=${encodeURIComponent(targetUrl)}`);
          const parsed = await response.json();

          if (!response.ok) {
            throw new Error(parsed.error || 'Failed to fetch the chapter.');
          }

          result = parsed;
          if (parsed.chapters && parsed.chapters.length > 0) {
            setChapters(parsed.chapters);
          }
        }

        setData(result);
        saveToHistory(targetUrl, result.title || 'Untitled Chapter', result.siteName || '');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred while loading content.';
        setError(errorMsg);
      } finally {
        setLoading(false);
        window.scrollTo(0, 0); // scroll to top on new chapter load
      }
    };

    fetchArticle();
  }, [targetUrl]);

  // Save initial progress (scroll = 0) when a new chapter is loaded
  useEffect(() => {
    if (!data || !isSaved) return;
    
    // Only save if we haven't saved this chapter yet
    if (lastSavedUrlRef.current !== data.originalUrl) {
      lastSavedUrlRef.current = data.originalUrl;
      lastSavedProgressRef.current = 0;
      saveProgress(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isSaved]);

  // Check library status and restore scroll position if match is found
  useEffect(() => {
    if (!data) return;
    const checkLibrary = async () => {
      try {
        const novelUrl = getNovelBaseUrl(data.originalUrl);

        if (novelUrl.startsWith('local://')) {
          // Local book: read/save progress in IndexedDB
          const book = await getBook(novelUrl);
          if (book) {
            setIsSaved(true);
            if (book.chapters_list) {
              try {
                const parsedList = JSON.parse(book.chapters_list);
                if (parsedList && parsedList.length > 0) {
                  setChapters(parsedList);
                }
              } catch {}
            }
            if (book.last_read_url) {
              lastSavedUrlRef.current = book.last_read_url;
              lastSavedProgressRef.current = book.scroll_position || 0;
            }
            if (book.last_read_url === data.originalUrl && book.scroll_position > 0) {
              setTimeout(() => {
                const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
                if (totalHeight > 0) {
                  window.scrollTo(0, (book.scroll_position / 100) * totalHeight);
                  lastSavedProgressRef.current = book.scroll_position;
                  lastSavedUrlRef.current = data.originalUrl;
                }
              }, 250);
            }
          } else {
            // Not in IndexedDB library but readable → treat as saved so Save button is consistent
            setIsSaved(true);
          }
          return;
        }

        const res = await fetch(`/api/library?novel_url=${encodeURIComponent(novelUrl)}&include_chapters=true`);
        if (res.ok) {
          const matched = await res.json();
          if (matched) {
            // Update refs first to prevent immediate saveProgress(0) overwrite
            if (matched.last_read_url) {
              lastSavedUrlRef.current = matched.last_read_url;
              lastSavedProgressRef.current = matched.scroll_position || 0;
            }

            setIsSaved(true);
            if (matched.chapters_list) {
              try {
                const parsedList = JSON.parse(matched.chapters_list);
                if (parsedList && parsedList.length > 0) {
                  setChapters(parsedList);
                }
              } catch (parseErr) {
                console.error('Failed to parse library chapters_list:', parseErr);
              }
            }
            
            // Restore scroll position only if it corresponds to current page
            if (matched.last_read_url === data.originalUrl && matched.scroll_position > 0) {
              setTimeout(() => {
                const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
                if (totalHeight > 0) {
                  window.scrollTo(0, (matched.scroll_position / 100) * totalHeight);
                  // Update refs to match restored position
                  lastSavedProgressRef.current = matched.scroll_position;
                  lastSavedUrlRef.current = data.originalUrl;
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

  // Listen to window focus/visibilitychange to check for remote progress updates
  useEffect(() => {
    if (!data || !isSaved || chapters.length === 0) return;

    let active = true;

    const checkRemoteProgress = async () => {
      if (data.originalUrl.startsWith('local://')) return;
      try {
        const novelUrl = getNovelBaseUrl(data.originalUrl);
        const res = await fetch(`/api/library?novel_url=${encodeURIComponent(novelUrl)}&include_chapters=true`);
        if (!res.ok || !active) return;
        
        const matched = await res.json();
        if (matched && matched.last_read_url) {
          const normalizedDbUrl = matched.last_read_url;
          const normalizedCurrentUrl = data.originalUrl;
          
          if (normalizedDbUrl !== normalizedCurrentUrl) {
            // Find indices in chapters to see if the DB has a newer chapter
            const dbIndex = chapters.findIndex((c) => c.url === normalizedDbUrl);
            const currentIndex = chapters.findIndex((c) => c.url === normalizedCurrentUrl);
            
            if (dbIndex !== -1 && currentIndex !== -1 && dbIndex > currentIndex) {
              setSyncBanner({
                url: matched.last_read_url,
                title: matched.last_read_title || 'Newer Chapter'
              });
            }
          }
        }
      } catch (err) {
        console.error('Failed to check remote progress:', err);
      }
    };

    const handleActivity = () => {
      if (document.visibilityState === 'visible') {
        checkRemoteProgress();
      }
    };

    window.addEventListener('focus', handleActivity);
    document.addEventListener('visibilitychange', handleActivity);

    // Initial check when isSaved/data/chapters changes
    checkRemoteProgress();

    return () => {
      active = false;
      window.removeEventListener('focus', handleActivity);
      document.removeEventListener('visibilitychange', handleActivity);
    };
  }, [data, isSaved, chapters]);

  // Lazy pre-fetch next 5 chapters in background to Neon DB
  useEffect(() => {
    if (!data || !chapters || chapters.length === 0) return;
    // Local books are stored fully on-device; no server pre-fetch needed
    if (data.originalUrl.startsWith('local://')) return;

    const currentIndex = chapters.findIndex(c => c.url === data.originalUrl);
    if (currentIndex === -1) return;

    const nextChapters = chapters.slice(currentIndex + 1, currentIndex + 6);

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
  }, [data, chapters]);

  async function saveProgress(scrollPos: number, url: string = data?.originalUrl || '', title: string = data?.title || '') {
    if (!data || !isSaved || !url) return;
    const novelUrl = getNovelBaseUrl(url);

    if (novelUrl.startsWith('local://')) {
      try {
        const book = await getBook(novelUrl);
        if (book) {
          await putBook({
            ...book,
            last_read_url: url,
            last_read_title: title,
            scroll_position: scrollPos,
            updated_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('Failed to save local progress:', err);
      }
      return;
    }

    try {
      await fetch('/api/library/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          novelUrl,
          lastReadUrl: url,
          lastReadTitle: title,
          scrollPosition: scrollPos
        })
      });
    } catch (err) {
      console.error('Failed to sync progress to database:', err);
    }
  }

  const handleSaveToLibrary = async () => {
    if (!data) return;

    // Local books are already saved by definition
    if (data.originalUrl.startsWith('local://')) {
      setIsSaved(true);
      return;
    }

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
          chapters_list: JSON.stringify(chapters || [])
        })
      });

      if (!res.ok) {
        throw new Error('Failed to save to library');
      }

      // Update refs to prevent duplicate save progress call
      lastSavedUrlRef.current = data.originalUrl;
      lastSavedProgressRef.current = 0;

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

  // Track scroll progress and update local state
  useEffect(() => {
    if (!data) return;

    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (totalHeight > 0) {
        const progress = (window.scrollY / totalHeight) * 100;
        setScrollProgress(progress);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [data]);

  // Periodically save progress to the DB (every 30 seconds of active reading/scrolling)
  useEffect(() => {
    if (!data || !isSaved) return;

    const interval = setInterval(() => {
      const diff = Math.abs(scrollProgress - lastSavedProgressRef.current);
      // Only sync if the scroll position changed by more than 1.5% or the URL changed
      if (diff > 1.5 || lastSavedUrlRef.current !== data.originalUrl) {
        lastSavedProgressRef.current = scrollProgress;
        lastSavedUrlRef.current = data.originalUrl;
        saveProgress(scrollProgress);
      }
    }, 30000); // Check and save every 30 seconds

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isSaved, scrollProgress]);

  function saveToHistory(url: string, title: string, siteName: string) {
    const historyJSON = localStorage.getItem('aetherread_history');
    let historyList: { url: string; title: string; siteName: string; timestamp: number }[] = [];
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
  }

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

  // Translation mode helpers
  const updateMode = (newMode: 'raw' | 'translated') => {
    setMode(newMode);
    localStorage.setItem('aetherread_mode', newMode);
  };

  // Replace Rules management
  const fetchRules = async () => {
    setRulesLoading(true);
    try {
      if (data && data.originalUrl.startsWith('local://')) {
        // Local book: rules stored in IndexedDB
        const localRules = await getAllLocalRules();
        setRules(localRules);
      } else {
        const res = await fetch('/api/rules');
        if (res.ok) {
          const dataJson = await res.json();
          setRules(dataJson);
        }
      }
    } catch (err) {
      console.error('Failed to fetch rules:', err);
    } finally {
      setRulesLoading(false);
    }
  };

  const addRule = async () => {
    if (!ruleForm.find_text || !ruleForm.replace_with) return;
    const scopeValue = ruleForm.scope === 'book'
      ? (data ? getNovelBaseUrl(data.originalUrl) : null)
      : ruleForm.scope === 'chapter'
        ? (data?.originalUrl || null)
        : null;

    try {
      if (data && data.originalUrl.startsWith('local://')) {
        const newRule: LocalRule = {
          id: Math.random().toString(36).slice(2),
          scope: ruleForm.scope as 'global' | 'book' | 'chapter',
          scope_value: scopeValue,
          find_text: ruleForm.find_text,
          replace_with: ruleForm.replace_with,
          is_regex: ruleForm.is_regex,
          is_enabled: true,
          case_sensitive: ruleForm.case_sensitive,
          ignore_accents: ruleForm.ignore_accents,
          sort_order: 0,
        };
        await putLocalRule(newRule);
        setRuleForm({ scope: 'global', find_text: '', replace_with: '', is_regex: false, case_sensitive: false, ignore_accents: false });
        await fetchRules();
      } else {
        const res = await fetch('/api/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...ruleForm, scope_value: scopeValue })
        });
        if (res.ok) {
          setRuleForm({ scope: 'global', find_text: '', replace_with: '', is_regex: false, case_sensitive: false, ignore_accents: false });
          await fetchRules();
        }
      }
      // Refresh content to apply new rule
      if (targetUrl) {
        router.push(`/read?url=${encodeURIComponent(targetUrl)}`);
      }
    } catch (err) {
      console.error('Failed to add rule:', err);
    }
  };

  const deleteRule = async (id: string) => {
    try {
      if (data && data.originalUrl.startsWith('local://')) {
        await deleteLocalRule(id);
        await fetchRules();
      } else {
        const res = await fetch(`/api/rules?id=${id}`, { method: 'DELETE' });
        if (res.ok) {
          await fetchRules();
        }
      }
      if (targetUrl) {
        router.push(`/read?url=${encodeURIComponent(targetUrl)}`);
      }
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const toggleRule = async (id: string, currentEnabled: boolean) => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    try {
      if (data && data.originalUrl.startsWith('local://')) {
        await putLocalRule({ ...(rule as LocalRule), is_enabled: !currentEnabled });
        await fetchRules();
      } else {
        const res = await fetch('/api/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...rule, is_enabled: !currentEnabled })
        });
        if (res.ok) {
          await fetchRules();
        }
      }
      if (targetUrl) {
        router.push(`/read?url=${encodeURIComponent(targetUrl)}`);
      }
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };

  // Lazily fetch AI translation for the current chapter when in translated mode
  useEffect(() => {
    if (!data || mode !== 'translated') return;
    const url = data.originalUrl;

    if (translations[url] || unavailableTranslations[url] || fetchingTranslationsRef.current.has(url)) return;

    fetchingTranslationsRef.current.add(url);
    fetch(`/api/read?url=${encodeURIComponent(url)}&mode=translated`)
      .then(async (res) => {
        if (!res.ok) {
          setUnavailableTranslations(prev => ({ ...prev, [url]: true }));
          return;
        }
        const result = await res.json();
        if (result.content) {
          setTranslations(prev => ({ ...prev, [url]: result.content }));
          setUnavailableTranslations(prev => {
            const next = { ...prev };
            delete next[url];
            return next;
          });
        } else {
          setUnavailableTranslations(prev => ({ ...prev, [url]: true }));
        }
      })
      .catch(() => setUnavailableTranslations(prev => ({ ...prev, [url]: true })))
      .finally(() => {
        fetchingTranslationsRef.current.delete(url);
      });
  }, [data, mode, translations, unavailableTranslations]);

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
            <button className="btn" onClick={() => router.push('/')}>← <span className="btn-text-hide-mobile">Back</span></button>
            <div className="logo">✦ Reading...</div>
            <div className="header-spacer"></div>
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
            <button className="btn" onClick={() => router.push('/')}>← <span className="btn-text-hide-mobile">Home</span></button>
            <div className="logo">✦ Error</div>
            <div className="header-spacer"></div>
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

  const translatedContent = mode === 'translated' ? translations[data.originalUrl] : undefined;
  const isShowingTranslation = !!translatedContent;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Scroll Progress Bar */}
      <div className="progress-bar-container">
        <div className="progress-bar" style={{ width: `${scrollProgress}%` }}></div>
      </div>

      {/* Header */}
      <header className="header">
        <div className="container header-inner">
          <button className="btn" onClick={() => router.push('/')}>← <span className="btn-text-hide-mobile">Home</span></button>
          {chapters && chapters.length > 0 ? (
            <select
              value={getCurrentChapterSelectValue()}
              onChange={(e) => handleChapterChange(e.target.value)}
              className="chapter-select"
            >
              {chapters.map((chap, idx) => (
                <option key={idx} value={chap.url}>
                  {chap.title}
                </option>
              ))}
            </select>
          ) : (
            <div className="logo site-title-header">
              {data.siteName}
            </div>
          )}
          <div className="header-actions">
            {!isSaved ? (
              <button className="btn btn-primary btn-save" onClick={handleSaveToLibrary} disabled={saving}>
                {saving ? 'Saving...' : <>❤ <span className="btn-text-hide-mobile">Save</span></>}
              </button>
            ) : (
              <button className="btn btn-saved" disabled>
                ✔ <span className="btn-text-hide-mobile">Saved</span>
              </button>
            )}
            <button className="btn btn-settings" onClick={() => setShowSettings(!showSettings)}>
              ⚙ <span className="btn-text-hide-mobile">Settings</span>
            </button>
          </div>
        </div>
      </header>

      {/* Sync Banner */}
      {syncBanner && (
        <div style={{
          position: 'sticky',
          top: '65px',
          zIndex: 90,
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          borderBottom: '1px solid var(--border)',
          padding: '0.75rem 1rem',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '1rem',
          fontSize: '0.9rem',
          fontWeight: 500,
          backdropFilter: 'blur(10px)',
        }}>
          <span>
            You were reading <strong>{syncBanner.title}</strong> on another device.
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
              className="btn btn-primary" 
              style={{ padding: '0.25rem 0.75rem', fontSize: '0.80rem' }}
              onClick={() => {
                const targetUrl = syncBanner.url;
                setSyncBanner(null);
                router.push(`/read?url=${encodeURIComponent(targetUrl)}`);
              }}
            >
              Sync Progress
            </button>
            <button 
              className="btn" 
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.80rem' }}
              onClick={() => setSyncBanner(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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

            {/* Translation Source */}
            <div className="control-group" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '12px' }}>
              <span className="control-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Translation</span>
                {data && mode === 'translated' && (
                  <span style={{ fontSize: '0.75rem', color: translations[data.originalUrl] ? 'var(--accent)' : 'var(--meta-fg)' }}>
                    {translations[data.originalUrl] ? '✨ Translated' : data.hasTranslation ? 'Loading…' : 'Raw fallback'}
                  </span>
                )}
              </span>
              <div className="control-buttons">
                <button
                  className={`control-btn ${mode === 'raw' ? 'active' : ''}`}
                  onClick={() => updateMode('raw')}
                >
                  Raw
                </button>
                <button
                  className={`control-btn ${mode === 'translated' ? 'active' : ''}`}
                  onClick={() => updateMode('translated')}
                >
                  ✨ AI Translated
                </button>
              </div>
            </div>

            {/* Replace Rules */}
            <div className="control-group" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '12px' }}>
              <button
                className="control-btn btn"
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onClick={() => {
                  setShowRules(!showRules);
                  if (!showRules) fetchRules();
                }}
              >
                <span>Replace Rules</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--meta-fg)' }}>
                  {showRules ? '▲' : '▼'}
                </span>
              </button>

              {showRules && (
                <div style={{ marginTop: '10px' }}>
                  {/* Add new rule form */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <select
                        value={ruleForm.scope}
                        onChange={(e) => setRuleForm({ ...ruleForm, scope: e.target.value })}
                        style={{
                          padding: '0.375rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border)',
                          background: 'var(--card-bg)',
                          color: 'var(--fg)',
                          fontSize: '0.75rem',
                          flex: '0 0 80px'
                        }}
                      >
                        <option value="global">Global</option>
                        <option value="book">Book</option>
                        <option value="chapter">Chapter</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Find"
                        value={ruleForm.find_text}
                        onChange={(e) => setRuleForm({ ...ruleForm, find_text: e.target.value })}
                        style={{
                          padding: '0.375rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border)',
                          background: 'var(--card-bg)',
                          color: 'var(--fg)',
                          fontSize: '0.75rem',
                          flex: 1
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <input
                        type="text"
                        placeholder="Replace with"
                        value={ruleForm.replace_with}
                        onChange={(e) => setRuleForm({ ...ruleForm, replace_with: e.target.value })}
                        style={{
                          padding: '0.375rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border)',
                          background: 'var(--card-bg)',
                          color: 'var(--fg)',
                          fontSize: '0.75rem',
                          flex: 1
                        }}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'var(--meta-fg)', whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={ruleForm.is_regex}
                          onChange={(e) => setRuleForm({ ...ruleForm, is_regex: e.target.checked })}
                        />
                        Regex
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'var(--meta-fg)', whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={ruleForm.case_sensitive}
                          onChange={(e) => setRuleForm({ ...ruleForm, case_sensitive: e.target.checked })}
                        />
                        Aa
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'var(--meta-fg)', whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={ruleForm.ignore_accents}
                          onChange={(e) => setRuleForm({ ...ruleForm, ignore_accents: e.target.checked })}
                        />
                        Accent
                      </label>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem' }}
                        onClick={addRule}
                        disabled={!ruleForm.find_text}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Rules list */}
                  {rulesLoading ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--meta-fg)', textAlign: 'center', padding: '8px' }}>Loading...</div>
                  ) : rules.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--meta-fg)', textAlign: 'center', padding: '8px' }}>No rules yet</div>
                  ) : (
                    <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {rules.map((rule) => (
                        <div
                          key={rule.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 6px',
                            borderRadius: '4px',
                            background: rule.is_enabled ? 'var(--accent-soft)' : 'var(--border)',
                            fontSize: '0.7rem',
                            opacity: rule.is_enabled ? 1 : 0.5
                          }}
                        >
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ color: 'var(--meta-fg)', marginRight: '4px' }}>[{rule.scope}{rule.case_sensitive ? '·Aa' : ''}{rule.ignore_accents ? '·~' : ''}]</span>
                            <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{rule.find_text}</span>
                            {' → '}
                            <span style={{ color: 'var(--accent)' }}>{rule.replace_with}</span>
                          </span>
                          <button
                            onClick={() => toggleRule(rule.id, rule.is_enabled)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', padding: '2px' }}
                            title={rule.is_enabled ? 'Disable' : 'Enable'}
                          >
                            {rule.is_enabled ? '👁' : '👁‍🗨'}
                          </button>
                          <button
                            onClick={() => deleteRule(rule.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', padding: '2px', color: '#ef4444' }}
                            title="Delete"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
            <div className="reader-meta">
              {data.siteName}{' '}
              {isShowingTranslation ? (
                <span style={{ marginLeft: '8px', padding: '2px 6px', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>✨ AI Translated</span>
              ) : mode === 'translated' ? (
                <span style={{ marginLeft: '8px', padding: '2px 6px', background: 'var(--border)', color: 'var(--meta-fg)', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>Raw · no translation yet</span>
              ) : null}
            </div>
            <h1 className="reader-title">{data.title}</h1>
            {!data.originalUrl.startsWith('local://') && (
              <a href={data.originalUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem', color: 'var(--meta-fg)' }}>
                🌐 View Original Website
              </a>
            )}
          </div>

          {/* Extracted story content */}
          <div 
            className={`reader-content ${fontFamily === 'sans' ? 'font-sans' : fontFamily === 'font-be-vietnam' ? 'font-be-vietnam' : fontFamily === 'font-literata' ? 'font-literata' : fontFamily === 'serif-lora' ? 'font-serif-lora' : ''}`}
            style={{ 
              fontSize: `${fontSizePx}px`, 
              lineHeight: lineHeights[lineHeight],
              fontFamily: fontFamily === 'original' && data.originalFont ? data.originalFont : undefined
            }}
            dangerouslySetInnerHTML={{ __html: translatedContent || data.content }}
          />

          {/* Bottom navigation */}
          <div className="chapter-nav" style={{ alignItems: 'center' }}>
            {data.prevUrl ? (
              <button 
                className="btn"
                onClick={() => handleChapterChange(data.prevUrl!)}
                style={{ minWidth: '90px' }}
              >
                ◀ Prev
              </button>
            ) : (
              <div style={{ flex: 1, minWidth: '90px' }}></div>
            )}
            
            {chapters && chapters.length > 0 ? (
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
                {chapters.map((chap, idx) => (
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
                onClick={() => handleChapterChange(data.nextUrl!)}
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
