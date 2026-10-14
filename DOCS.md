# AetherRead (proxy-site) - Documentation Overview

> **Current State**: Active, fully functional Next.js 16 web application with cloud sync (Neon PostgreSQL), offline on-device reading (IndexedDB), distraction-free web novel reader, custom text replacement engine, and TTS audio book capabilities.

---

## 1. Executive Summary

**AetherRead** is a web novel reader and proxy application designed to provide a clean, distraction-free reading experience. It bypasses aggressive advertisements, popups, and formatting clutter on popular web novel sites (such as `truyenfull.live`, `royalroad.com`, etc.), cleans article content via `@mozilla/readability`, and presents it with customizable reader preferences.

### Key Capabilities
- **Ad & Clutter Stripping**: Converts messy Web Novel HTML pages into readable, clean text formatted for modern screens.
- **Manga & Comic Support**: Full support for image-based manga/manhua/manhwa (such as TruyenQQ, NetTruyen). Features responsive vertical strip viewer with page numbers, prefetching, and an image proxy to seamlessly bypass CDN anti-hotlinking protections.
- **Dual-Storage Architecture**:
  - **Cloud Sync**: Web novel links and reading progress synced across devices using Neon Database (PostgreSQL Serverless).
  - **Offline / On-Device Reading**: `.txt` file uploads parsed into chapters and stored locally in browser IndexedDB without needing server storage.
- **Audio Book (Text-to-Speech)**: Integrated audio player with sentence-level TTS (Google TTS proxy) and system Web Speech API with Vietnamese neural voices (e.g., Microsoft HoaiMy). Includes long-press paragraph jump gestures.
- **Advanced Text Replacement Engine**: Scoped rule system (`global` > `book` > `chapter`) with regex, case sensitivity, and Vietnamese accent-insensitive matching (handles diacritic variations like "Tùy" vs "Tuỳ").
- **AI Translation Support**: Prepared data paths for AI-translated chapters served dynamically when available.

---

## 2. System Architecture

```mermaid
flowchart TD
    Client[Browser Frontend / Reader View] -->|Auth Middleware| Proxy[proxy.ts Middleware]
    Proxy --> Pages[Next.js App Router Pages]
    
    subgraph Storage Layer
        DB[(Neon PostgreSQL Serverless)]
        IDB[(Client IndexedDB - aetherread)]
    end

    subgraph API Layer
        AuthAPI[/api/auth/login]
        ReadAPI[/api/read]
        LibAPI[/api/library & /progress]
        RulesAPI[/api/rules]
        TtsAPI[/api/tts]
        UploadAPI[/api/upload]
    end

    Pages --> AuthAPI
    Pages --> ReadAPI
    Pages --> LibAPI
    Pages --> RulesAPI
    Pages --> TtsAPI
    Pages --> UploadAPI

    ReadAPI -->|Cache Hit / Scrape & Clean| DB
    ReadAPI -->|DOM Parsing| Readability[@mozilla/readability + linkedom]
    LibAPI --> DB
    RulesAPI --> DB
    UploadAPI --> DB
    
    Client <--->|Offline Storage| IDB
```

---

## 3. Core Features & Functional Overview

### 3.1 Authentication & Route Protection
- **Session Token Security**: Uses HMAC SHA-256 signatures via Web Crypto API to sign session tokens (`username:expiresAt:signature`).
- **HttpOnly Cookie**: Token stored in `aetherread_session` cookie valid for 30 days.
- **Middleware Guard**: [`src/proxy.ts`](file:///c:/Users/tiena/proxy-site/src/proxy.ts) protects root `/`, `/read`, `/library`, and `/api/*` endpoints, redirecting unauthenticated users to `/login`.

### 3.2 Library Management & Reading Progress
- **Cloud Web Novels**: Adding a chapter URL scrapes novel metadata, extracts chapter lists (including AJAX options for sites like `truyenfull`), and indexes the novel in the library.
- **Progress Tracking**: Tracks current read chapter and scroll position percentage. Debounced auto-sync runs every 30 seconds during active scrolling.
- **Cache Pruning**: Chapters older than 7 days that have already been read are automatically deleted from the Neon DB cache to maintain lightweight storage.
- **Cross-Device Sync Banner**: Detects if a newer reading position exists on another device and offers a "Sync Progress" prompt.

### 3.3 Offline Local Book Uploads
- **Text File Uploads**: Users can upload `.txt` files up to 10MB directly in the Library interface.
- **Chapter Detection Engine**: Uses multi-pattern regular expressions ([`src/lib/chapters-client.ts`](file:///c:/Users/tiena/proxy-site/src/lib/chapters-client.ts)) matching Vietnamese (`Chương 1`, `Tập 1`, `1.`) and English (`Chapter 1`, `Ch. 1`) headers.
- **Batch Fallback**: If no chapter patterns are found, long text is automatically split into ~5000-character parts.
- **IndexedDB Storage**: Local books and chapters are saved to IndexedDB ([`src/lib/localdb.ts`](file:///c:/Users/tiena/proxy-site/src/lib/localdb.ts)) under `local-books` and `local-chapters`, bypassing server calls entirely.

### 3.4 Distraction-Free Reader Interface
- **Typography & Theme Controls**:
  - **Presets**: Standard, Book Warm, Compact, Focus.
  - **Themes**: Light, Dark, Sepia, Slate, and Auto (listens to system `prefers-color-scheme`).
  - **Fonts**: Lora, Literata, Be Vietnam, Inter, or original font scraped from source site.
  - **Adjustments**: Font size (14px–36px), Line Height (Tight, Medium, Wide), Reader Margin (Narrow, Mid, Wide).
- **Mode Switching**: Toggle between `Raw` scraped text and `✨ AI Translated` text when available.

### 3.5 Text-to-Speech (Audio Book)
- **Natural HD Voice**: Proxies Google TTS via [`/api/tts`](file:///c:/Users/tiena/proxy-site/src/app/api/tts/route.ts) with smart sentence splitting (under 180 chars) for smooth continuous playback.
- **System Web Speech API**: Falls back to native browser speech synthesis, automatically identifying Vietnamese voices such as Microsoft HoaiMy Neural.
- **Long-Press Paragraph Jump**: Pressing and holding on any paragraph for 400ms without dragging triggers audio playback directly from that paragraph.
- **Playback Controls**: Speed control (0.5x to 2.5x), paragraph skip/prev, play/pause, paragraph highlight styling (`tts-reading-active`), and auto-advancing to the next chapter.

### 3.6 Text Replacement Rules Engine
- **Scope Hierarchy**: Evaluated in order of `chapter` > `book` > `global`.
- **Match Options**:
  - `is_regex`: Regular expression matching.
  - `case_sensitive`: Case sensitivity setting.
  - `ignore_accents`: Vietnamese diacritic normalization (maps letter variants so rules apply regardless of accent placement, e.g., matching both "Tùy" and "Tuỳ").
- **Implementation**: Isomorphic implementation in [`src/lib/replace-utils.ts`](file:///c:/Users/tiena/proxy-site/src/lib/replace-utils.ts) used on both server and client.

---

## 4. Data Models & Schemas

### 4.1 Cloud Database (Neon PostgreSQL)

| Table | Description | Key Fields |
| :--- | :--- | :--- |
| `library` | Web novels saved by user | `id`, `novel_url` (PK), `title`, `author`, `cover_url`, `site_name`, `total_chapters`, `chapters_list` (JSON), `last_read_url`, `last_read_title`, `scroll_position`, `updated_at` |
| `chapters` | Cached scraped chapters | `id`, `novel_url`, `url` (PK), `title`, `content`, `next_url`, `prev_url`, `original_font`, `created_at` |
| `translations` | AI-translated chapter content | `id`, `novel_url`, `url` (PK), `title`, `content`, `created_at` |
| `replace_rules` | Search & replace text rules | `id` (PK), `scope`, `scope_value`, `find_text`, `replace_with`, `is_regex`, `is_enabled`, `case_sensitive`, `ignore_accents`, `sort_order`, `created_at` |

### 4.2 Client Database (IndexedDB: `aetherread`)

| Store Name | Key Path | Indexes | Object Structure |
| :--- | :--- | :--- | :--- |
| `local-books` | `novel_url` | - | `LocalBook` (`novel_url`, `title`, `site_name`, `total_chapters`, `chapters_list`, `last_read_url`, `scroll_position`, `updated_at`) |
| `local-chapters` | `url` | `novel_url` | `LocalChapter` (`url`, `novel_url`, `title`, `content`, `next_url`, `prev_url`) |
| `local-rules` | `id` | - | `LocalRule` (`id`, `scope`, `scope_value`, `find_text`, `replace_with`, `is_regex`, `is_enabled`, `case_sensitive`, `ignore_accents`, `sort_order`) |

---

## 5. API Reference

| Route | Method | Purpose |
| :--- | :--- | :--- |
| [`/api/auth/login`](file:///c:/Users/tiena/proxy-site/src/app/api/auth/login/route.ts) | `POST` | Authenticate user credentials and set HttpOnly session cookie |
| [`/api/library`](file:///c:/Users/tiena/proxy-site/src/app/api/library/route.ts) | `GET` | Retrieve library list or specific book details |
| [`/api/library`](file:///c:/Users/tiena/proxy-site/src/app/api/library/route.ts) | `POST` | Add new novel to library or update reading progress |
| [`/api/library`](file:///c:/Users/tiena/proxy-site/src/app/api/library/route.ts) | `DELETE` | Remove novel and delete cached chapters |
| [`/api/library/progress`](file:///c:/Users/tiena/proxy-site/src/app/api/library/progress/route.ts) | `POST` | Update scroll position and active chapter |
| [`/api/read`](file:///c:/Users/tiena/proxy-site/src/app/api/read/route.ts) | `GET` | Read chapter (serves DB cache or scrapes target URL, supports text novels and manga comics) |
| [`/api/proxy-image`](file:///c:/Users/tiena/proxy-site/src/app/api/proxy-image/route.ts) | `GET` | Proxy manga images with Referer header to bypass anti-hotlinking CDN restrictions |
| [`/api/rules`](file:///c:/Users/tiena/proxy-site/src/app/api/rules/route.ts) | `GET`, `POST`, `DELETE` | Manage cloud text replacement rules |
| [`/api/tts`](file:///c:/Users/tiena/proxy-site/src/app/api/tts/route.ts) | `GET` | Proxy audio MP3 stream from Google TTS |
| [`/api/upload`](file:///c:/Users/tiena/proxy-site/src/app/api/upload/route.ts) | `POST` | Server upload handler for `.txt` or `.gz` text files |

---

## 6. Directory & Codebase Map

```
proxy-site/
├── .env.local                    # Database & auth environment secrets
├── AGENTS.md / CLAUDE.md         # Next.js 16 breaking change rules
├── DOCS.md                       # Application documentation overview
├── package.json                  # Dependencies (Next.js 16.2.9, React 19, Neon, Linkedom, Readability)
├── scripts/
│   ├── chapter-tools.mjs         # CLI tool for pulling raw chapters & saving translations
│   ├── migrate-replace-rules.mjs # Migration script for replace rules schema
│   ├── migrate-rule-options.mjs  # Migration script for rule options
│   └── migrate-translations.mjs  # Migration script for translations table
└── src/
    ├── proxy.ts                  # Middleware for auth token verification & route protection
    ├── app/
    │   ├── layout.tsx            # Global HTML layout & CSS import
    │   ├── page.tsx              # Root route (redirects to /library)
    │   ├── globals.css           # Custom theme variables & reader CSS styles
    │   ├── library/
    │   │   └── page.tsx          # Library view (Cloud & Local novel cards, import & upload forms)
    │   ├── login/
    │   │   └── page.tsx          # Login form page
    │   ├── read/
    │   │   └── page.tsx          # Reader view (Floating settings, TTS audio controls, rules manager)
    │   └── api/
    │       ├── auth/login/route.ts
    │       ├── library/route.ts
    │       ├── library/progress/route.ts
    │       ├── proxy-image/route.ts
    │       ├── read/route.ts
    │       ├── rules/route.ts
    │       ├── tts/route.ts
    │       └── upload/route.ts
    └── lib/
        ├── auth.ts               # HMAC SHA-256 session token generation & verification
        ├── db.ts                 # Neon SQL database client & helper queries
        ├── localdb.ts            # IndexedDB wrapper for offline local books & rules
        ├── novel-utils.ts        # Novel URL normalization, base URL, and chapter navigation
        ├── replace-utils.ts      # Isomorphic text replacement & Vietnamese accent handling
        ├── chapters-client.ts    # Regex chapter boundary detection & batch splitter
        └── utils.ts              # URL normalization & MD5 hashing utilities
```

---

## 7. Tech Stack & Key Dependencies

- **Framework**: Next.js `16.2.9` (App Router)
- **UI Library**: React `19.2.4`
- **Database**:
  - Neon Serverless PostgreSQL (`@neondatabase/serverless` `^1.1.0`)
  - Browser IndexedDB (`IDBDatabase` API)
- **Scraping & Parsing**:
  - `@mozilla/readability` `^0.6.0` (Clean article extraction)
  - `linkedom` `^0.18.12` (Server-side DOM parsing)
- **Styling**: Pure CSS with CSS Custom Variables (`globals.css`) supporting dynamic themes (`light`, `dark`, `sepia`, `slate`).

---

## 8. Current Environment Setup

To run the application locally:

1. **Environment Variables** (`.env.local`):
   ```env
   DATABASE_URL=postgresql://user:pass@ep-xxx.singapore.aws.neon.tech/neondb?sslmode=require
   AUTH_SECRET=aetherread-secret-32-chars-long-key-string
   ```
2. **Commands**:
   ```bash
   npm run dev    # Start dev server on http://localhost:3000
   npm run build  # Production build
   npm run lint   # ESLint code check
   ```
