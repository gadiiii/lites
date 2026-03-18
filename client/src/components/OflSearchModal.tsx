/**
 * OflSearchModal.tsx
 *
 * Searches the Open Fixture Library via the server-side proxy at /api/ofl.
 * The proxy handles: live OFL API → disk cache → bundled starter set fallback,
 * so this works fully offline after the first online session.
 */

import React, { useState, useRef } from 'react';
import { T } from '../theme.js';
import type { Profile } from '../types.js';

interface Props {
  onImport: (profile: Omit<Profile, 'id'>) => void;
  onClose: () => void;
}

// Matches the shape returned by server /api/ofl/search
interface OflSearchResult {
  key: string;          // "manufacturer/fixture-name"
  name: string;
  manufacturer: string;
  channelCount: number;
}

// Matches the shape returned by server /api/ofl/fixture (already converted to Profile)
interface OflProfile {
  name: string;
  channelCount: number;
  params: Record<string, number>;
}

export default function OflSearchModal({ onImport, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OflSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setResults([]);

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch(
        `/api/ofl/search?q=${encodeURIComponent(query)}`,
        { signal: abortRef.current.signal }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as OflSearchResult[];
      setResults(data ?? []);
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setError('Search failed. The server may be unavailable.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (result: OflSearchResult) => {
    setImporting(result.key);
    setImportError((e) => ({ ...e, [result.key]: '' }));

    try {
      const res = await fetch(`/api/ofl/fixture?key=${encodeURIComponent(result.key)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fixture = await res.json() as OflProfile;

      const profile: Omit<Profile, 'id'> = {
        name: fixture.name,
        channelCount: fixture.channelCount,
        params: fixture.params,
      };

      onImport(profile);
      setImporting(null);
    } catch (e: unknown) {
      setImportError((err) => ({ ...err, [result.key]: (e as Error).message }));
      setImporting(null);
    }
  };

  const overlay: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const modal: React.CSSProperties = {
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: T.radius,
    width: 560,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
  };

  const inputStyle: React.CSSProperties = {
    background: T.surface2,
    border: `1px solid ${T.border2}`,
    borderRadius: T.radiusSm,
    color: T.text,
    fontFamily: T.font,
    fontSize: 13,
    padding: '8px 12px',
    flex: 1,
    outline: 'none',
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: T.text }}>Import from Open Fixture Library</div>
            <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>Search 7,000+ fixture profiles</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Search bar */}
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 8 }}>
          <input
            style={inputStyle}
            placeholder="Search fixtures (e.g. Chauvet, ADJ Par, Robe)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch(); }}
            autoFocus
          />
          <button
            onClick={() => void handleSearch()}
            disabled={loading}
            style={{
              background: T.accent,
              border: 'none',
              borderRadius: T.radiusSm,
              color: '#000',
              fontFamily: T.font,
              fontSize: 12,
              fontWeight: 600,
              padding: '0 16px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '…' : 'Search'}
          </button>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {error && (
            <div style={{ padding: '16px 20px', color: T.danger, fontSize: 12 }}>{error}</div>
          )}
          {!loading && !error && results.length === 0 && query && (
            <div style={{ padding: '24px 20px', color: T.dim, textAlign: 'center', fontSize: 12 }}>
              No results. Try a different search term.
            </div>
          )}
          {!loading && !error && results.length === 0 && !query && (
            <div style={{ padding: '24px 20px', color: T.dim, textAlign: 'center', fontSize: 12 }}>
              Type a fixture name or manufacturer and press Search.
            </div>
          )}
          {results.map((r) => (
            <div key={r.key} style={{
              padding: '10px 20px',
              borderBottom: `1px solid ${T.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
                  {r.manufacturer} {r.name}
                </div>
                <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginTop: 2 }}>
                  {r.channelCount}ch · {r.key}
                </div>
                {importError[r.key] && (
                  <div style={{ fontSize: 11, color: T.danger, marginTop: 2 }}>{importError[r.key]}</div>
                )}
              </div>
              <button
                onClick={() => void handleImport(r)}
                disabled={importing === r.key}
                style={{
                  background: importing === r.key ? T.surface2 : T.accent,
                  border: 'none',
                  borderRadius: T.radiusSm,
                  color: importing === r.key ? T.muted : '#000',
                  fontFamily: T.font,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '5px 14px',
                  cursor: importing === r.key ? 'not-allowed' : 'pointer',
                  flexShrink: 0,
                }}
              >
                {importing === r.key ? 'Importing…' : 'Import'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
