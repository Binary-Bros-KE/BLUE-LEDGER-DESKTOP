import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Printer, X, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";
import { Button } from "@renderer/shared/components/Button";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";

// A real Worker instance (bundled by Vite via `?worker`, which defaults to an IIFE-format worker —
// deliberately not the `?url`+workerSrc string approach some pdfjs-dist guides show, since that makes
// pdfjs fetch an ES-module worker script itself, which is exactly the class of "loads fine over http
// but silently fails over a packaged app's file:// origin" bug this whole feature was rebuilt to get
// away from. Assigning `workerPort` instead of `workerSrc` skips pdfjs's own fetch entirely.
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;
const DEFAULT_SCALE = 0.9;
// How far past the actual visible scroll area a page still counts as "about to be seen" and gets
// rendered — big enough that scrolling never outruns rendering and shows a blank placeholder.
const LAZY_RENDER_MARGIN = "1000px 0px";

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** One page's own canvas + placeholder sizing. Placeholder size is fetched (cheap — pdf.js caches
 * pages) and applied immediately so the scroll container's total height is correct even before the
 * page has actually rendered — otherwise the page would pop in at a different scroll position than
 * where its placeholder sat, jumping the user's scroll offset around as pages load in.
 * `shouldRender` is only ever flipped true (never back to false) by the parent's lazy-render
 * IntersectionObserver — once a page has rendered it stays rendered, trading a little memory for
 * never having to re-render (and re-flash) a page the user scrolls back up to. */
function PdfPage({
  doc,
  pageNum,
  scale,
  shouldRender,
  registerWrapper
}: {
  doc: PDFDocumentProxy;
  pageNum: number;
  scale: number;
  shouldRender: boolean;
  registerWrapper: (pageNum: number, el: HTMLDivElement | null) => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);

  const setWrapperRef = useCallback((el: HTMLDivElement | null) => registerWrapper(pageNum, el), [pageNum, registerWrapper]);

  useEffect(() => {
    let cancelled = false;
    void doc.getPage(pageNum).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      setDims({ width: viewport.width, height: viewport.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNum, scale]);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    void (async () => {
      const page = await doc.getPage(pageNum);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      renderTaskRef.current?.cancel();
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const task = page.render({ canvas, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch (err) {
        // Expected whenever a newer render call cancels this one (zoom changed mid-render) — not a
        // real failure, so it must not surface as an error toast/state.
        if (err instanceof Error && err.name === "RenderingCancelledException") return;
        throw err;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageNum, scale, shouldRender]);

  return (
    <div
      ref={setWrapperRef}
      data-page-number={pageNum}
      className="mx-auto mb-4 bg-white shadow-soft last:mb-0"
      style={dims ? { width: dims.width, height: dims.height } : { width: "100%", maxWidth: 720, height: 480 }}
    >
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

/**
 * Renders whichever PDF main.tsx's `#/pdf-preview/<id>` hash points it at, entirely inside this app
 * (no Chromium native viewer — see openPdfPreviewWindow in printer-service.ts for why that path was
 * abandoned). Every page is stacked in one continuously-scrollable column — field feedback was that a
 * single-page-plus-Next-button viewer is exactly the kind of control real clients won't notice and
 * will just assume the document is missing pages, whereas scrolling is what everyone already expects
 * from a PDF viewer. Pages render lazily (only once they're about to scroll into view) so a document
 * with hundreds of pages (a full product export, say) doesn't pay to render everything up front —
 * only Prev/Next-jump and the page counter care about "which page is this" beyond that.
 */
export function PdfPreviewApp({ previewId }: { previewId: string }): React.JSX.Element {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("Preview");
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [renderablePages, setRenderablePages] = useState<Set<number>>(new Set());
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [busy, setBusy] = useState<"print" | "download" | null>(null);

  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.blueLedger.printer.getPdfPreviewData(previewId);
        if (cancelled) return;
        if (!result) {
          setError("This preview is no longer available. Close this window and reopen it.");
          setStatus("error");
          return;
        }
        setTitle(result.title);
        document.title = result.title;
        const bytes = base64ToUint8Array(result.data);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, "Failed to load preview"));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      docRef.current = null;
    };
  }, [previewId]);

  const registerWrapper = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    if (el) wrapperRefs.current.set(pageNum, el);
    else wrapperRefs.current.delete(pageNum);
  }, []);

  // Lazy-render trigger: a generous rootMargin means pages are rendered well before they're actually
  // scrolled to, so nothing pops in visibly. Deliberately separate from the scroll-position page
  // counter below — a big rootMargin here would make a distant page register as "fully visible" for
  // that purpose, which would make the counter wrong.
  useEffect(() => {
    if (status !== "ready" || !containerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const newlyVisible = entries.filter((entry) => entry.isIntersecting).map((entry) => Number((entry.target as HTMLElement).dataset.pageNumber));
        if (newlyVisible.length === 0) return;
        setRenderablePages((prev) => {
          const next = new Set(prev);
          for (const pageNum of newlyVisible) next.add(pageNum);
          return next;
        });
      },
      { root: containerRef.current, rootMargin: LAZY_RENDER_MARGIN }
    );
    for (const el of wrapperRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapperRefs is a ref, intentionally not a dep
  }, [status, pageCount]);

  // Page counter: whichever page's wrapper is closest to the top of the visible scroll area right
  // now — plain scroll-position math instead of a second IntersectionObserver, since that one would
  // need rootMargin "0px" (real visual overlap) while the lazy-render one above needs a big margin —
  // easier to keep these two genuinely different concerns as two different mechanisms than to
  // reconcile one observer serving both.
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;
      let closestPage = 1;
      let closestDistance = Infinity;
      for (const [pageNum, el] of wrapperRefs.current) {
        const distance = Math.abs(el.getBoundingClientRect().top - containerTop);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = pageNum;
        }
      }
      setCurrentPage(closestPage);
    });
  }, []);

  function scrollToPage(pageNum: number): void {
    wrapperRefs.current.get(pageNum)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Ctrl/Cmd+scroll-wheel zoom, matching every other PDF/browser viewer. React's onWheel is passive
  // by default (perf optimization for the common "just scroll" case) and a passive listener can't
  // call preventDefault — without a real listener here, holding Ctrl while scrolling would zoom the
  // WHOLE Electron window (Chromium's own page-zoom shortcut) instead of just the document.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function onWheel(event: WheelEvent): void {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setScale((prev) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor)));
    }
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  async function handlePrint(): Promise<void> {
    setBusy("print");
    try {
      const result = await window.blueLedger.printer.printPdfPreview(previewId);
      if (result.success) showSuccessToast(result.message);
      else showErrorToast(result.message);
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to print"));
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload(): Promise<void> {
    setBusy("download");
    try {
      const result = await window.blueLedger.printer.downloadPdfPreview(previewId);
      if (result.success) showSuccessToast(result.message);
      else if (result.message !== "Cancelled") showErrorToast(result.message);
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to download"));
    } finally {
      setBusy(null);
    }
  }

  function zoomIn(): void {
    setScale((prev) => Math.min(MAX_SCALE, prev * ZOOM_STEP));
  }
  function zoomOut(): void {
    setScale((prev) => Math.max(MIN_SCALE, prev / ZOOM_STEP));
  }

  if (status === "error") {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-app px-6 text-center">
        <p className="max-w-sm text-sm font-bold text-danger">{error}</p>
        <Button type="button" onClick={() => window.close()} className="h-9 text-xs">
          Close
        </Button>
      </div>
    );
  }

  const doc = docRef.current;

  return (
    <div className="flex h-screen w-full flex-col bg-soft">
      <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-line bg-white px-4 py-2.5">
        <p className="truncate text-sm font-extrabold text-ink">{title}</p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
            disabled={status !== "ready" || currentPage <= 1}
            className="h-8 w-8 border border-line bg-white p-0 text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="min-w-16 text-center text-xs font-bold text-muted">
            {status === "ready" ? `${currentPage} / ${pageCount}` : "—"}
          </span>
          <Button
            type="button"
            onClick={() => scrollToPage(Math.min(pageCount, currentPage + 1))}
            disabled={status !== "ready" || currentPage >= pageCount}
            className="h-8 w-8 border border-line bg-white p-0 text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>

          <div className="mx-1.5 h-5 w-px bg-line" />

          <Button
            type="button"
            onClick={zoomOut}
            disabled={status !== "ready"}
            className="h-8 w-8 border border-line bg-white p-0 text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ZoomOut className="size-4" aria-hidden="true" />
          </Button>
          <span className="min-w-12 text-center text-xs font-bold text-muted">{Math.round(scale * 100)}%</span>
          <Button
            type="button"
            onClick={zoomIn}
            disabled={status !== "ready"}
            className="h-8 w-8 border border-line bg-white p-0 text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ZoomIn className="size-4" aria-hidden="true" />
          </Button>

          <div className="mx-1.5 h-5 w-px bg-line" />

          <Button
            type="button"
            onClick={() => void handlePrint()}
            disabled={status !== "ready" || busy !== null}
            className="h-8 border border-line bg-white px-3 text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "print" ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            Print
          </Button>
          <Button
            type="button"
            onClick={() => void handleDownload()}
            disabled={status !== "ready" || busy !== null}
            className="h-8 border border-line bg-white px-3 text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "download" ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            Download
          </Button>
          <Button
            type="button"
            onClick={() => window.close()}
            className="h-8 w-8 bg-ink p-0 text-white shadow-none hover:bg-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-auto px-6 py-6">
        {status === "loading" || !doc ? (
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted" aria-hidden="true" />
          </div>
        ) : (
          Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNum) => (
            <PdfPage
              key={pageNum}
              doc={doc}
              pageNum={pageNum}
              scale={scale}
              shouldRender={renderablePages.has(pageNum)}
              registerWrapper={registerWrapper}
            />
          ))
        )}
      </div>
    </div>
  );
}
