'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Use CDN worker — simplest setup for Next.js
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  fileName?: string;
}

export default function PdfViewer({ url, fileName }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const [pageInputValue, setPageInputValue] = useState('1');

  /* Measure container for responsive fit */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
    setError(null);
  }, []);

  const onDocumentLoadError = useCallback(() => {
    setError('Failed to load PDF');
    setLoading(false);
  }, []);

  const goToFirst = () => { setPageNumber(1); setPageInputValue('1'); };
  const goToPrev = () => setPageNumber((p) => { const n = Math.max(1, p - 1); setPageInputValue(String(n)); return n; });
  const goToNext = () => setPageNumber((p) => { const n = Math.min(numPages, p + 1); setPageInputValue(String(n)); return n; });
  const goToLast = () => { setPageNumber(numPages); setPageInputValue(String(numPages)); };

  const commitPageInput = () => {
    const parsed = parseInt(pageInputValue, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= numPages) {
      setPageNumber(parsed);
      setPageInputValue(String(parsed));
    } else {
      setPageInputValue(String(pageNumber));
    }
  };

  const zoomIn = () => setScale((s) => Math.min(2.5, +(s + 0.25).toFixed(2)));
  const zoomOut = () => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)));
  const zoomFit = () => setScale(1.0);

  // Calculate page width to fit container
  const pageWidth = scale === 1.0 && containerWidth > 0 ? containerWidth - 32 : undefined;

  return (
    <div className="flex flex-col h-full -m-4 bg-[#f5f5f5]">
      {/* ── Navigation bar ─────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-[#e8e8e8] flex-shrink-0">
        {/* Left: file name */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          {fileName && (
            <span className="text-[12px] text-[#666] truncate">{fileName}</span>
          )}
        </div>

        {/* Center: page navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={goToFirst}
            disabled={pageNumber <= 1}
            className="w-[28px] h-[28px] rounded-md flex items-center justify-center text-[#666] hover:bg-[#f0f0f0] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="First page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 18l-6-6 6-6" />
              <path d="M6 6v12" />
            </svg>
          </button>

          <button
            onClick={goToPrev}
            disabled={pageNumber <= 1}
            className="w-[28px] h-[28px] rounded-md flex items-center justify-center text-[#666] hover:bg-[#f0f0f0] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Previous page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <div className="flex items-center gap-1 text-[12px] text-[#37352f] font-medium tabular-nums">
            <input
              type="text"
              inputMode="numeric"
              value={pageInputValue}
              onChange={(e) => setPageInputValue(e.target.value)}
              onBlur={commitPageInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { commitPageInput(); (e.target as HTMLInputElement).blur(); }
                if (e.key === 'Home') { e.preventDefault(); goToFirst(); }
                if (e.key === 'End') { e.preventDefault(); goToLast(); }
              }}
              className="w-[44px] h-[26px] text-center rounded border border-[#e0e0e0] bg-white text-[12px] font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff]"
            />
            <span className="text-[#999]">/ {numPages || '—'}</span>
          </div>

          <button
            onClick={goToNext}
            disabled={pageNumber >= numPages}
            className="w-[28px] h-[28px] rounded-md flex items-center justify-center text-[#666] hover:bg-[#f0f0f0] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Next page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          <button
            onClick={goToLast}
            disabled={pageNumber >= numPages}
            className="w-[28px] h-[28px] rounded-md flex items-center justify-center text-[#666] hover:bg-[#f0f0f0] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Last page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 18l6-6-6-6" />
              <path d="M18 6v12" />
            </svg>
          </button>
        </div>

        {/* Right: zoom controls */}
        <div className="flex items-center gap-1 flex-1 justify-end">
          <button
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="w-[28px] h-[28px] rounded-md flex items-center justify-center text-[#666] hover:bg-[#f0f0f0] disabled:opacity-30 transition-colors"
            title="Zoom out"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M5 12h14" />
            </svg>
          </button>

          <button
            onClick={zoomFit}
            className="px-1.5 h-[28px] rounded-md text-[11px] text-[#666] hover:bg-[#f0f0f0] transition-colors tabular-nums"
            title="Fit to width"
          >
            {scale === 1.0 ? 'Fit' : `${Math.round(scale * 100)}%`}
          </button>

          <button
            onClick={zoomIn}
            disabled={scale >= 2.5}
            className="w-[28px] h-[28px] rounded-md flex items-center justify-center text-[#666] hover:bg-[#f0f0f0] disabled:opacity-30 transition-colors"
            title="Zoom in"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── PDF content ────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex justify-center"
      >
        {error ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[13px] text-[#999]">{error}</p>
          </div>
        ) : (
          <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center justify-center h-full py-20">
                <div className="flex flex-col items-center gap-2">
                  <svg className="animate-spin w-5 h-5 text-[#999]" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <span className="text-[12px] text-[#999]">Loading PDF...</span>
                </div>
              </div>
            }
          >
            <div className="py-4 px-4">
              <Page
                pageNumber={pageNumber}
                width={scale !== 1.0 ? undefined : pageWidth}
                scale={scale !== 1.0 ? scale : undefined}
                className="shadow-lg rounded-sm"
                loading={
                  <div className="flex items-center justify-center py-20">
                    <svg className="animate-spin w-5 h-5 text-[#999]" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  </div>
                }
              />
            </div>
          </Document>
        )}

        {/* Loading overlay on initial load */}
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#f5f5f5]">
            <div className="flex flex-col items-center gap-2">
              <svg className="animate-spin w-5 h-5 text-[#999]" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span className="text-[12px] text-[#999]">Loading PDF...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
