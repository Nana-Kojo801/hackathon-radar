import { fetchData, type Hackathon, type HackathonDetail } from "./api";
import { bannerOf } from "./format";

/**
 * Start loading a hackathon's page as soon as it's touched, before it slides in. Its details and
 * the shape of its banner then usually arrive during the slide; arriving after it, they changed
 * the page under you (content appearing, the banner resizing), which showed as a flicker.
 */

const details = new Map<string, { at: number; promise: Promise<HackathonDetail> }>();
const ratios = new Map<string, number>();
/** Reused for a few minutes: going back and opening it again is instant. */
const FRESH_MS = 5 * 60_000;

export function loadDetail(id: string): Promise<HackathonDetail> {
  const hit = details.get(id);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise;
  // Not tied to one page's signal: a prefetch is shared with the page that opens.
  const promise = fetchData<HackathonDetail>(`h/${id}.json`, `/hackathons/${id}`);
  promise.catch(() => details.delete(id));
  details.set(id, { at: Date.now(), promise });
  return promise;
}

/** The banner's width / height once it has been seen, so its header is the right height from the start. */
export function bannerRatio(url: string): number | undefined {
  return ratios.get(url);
}

export function rememberRatio(url: string, ratio: number): void {
  ratios.set(url, ratio);
}

export function prefetch(h: Hackathon): void {
  void loadDetail(h.id).catch(() => undefined);
  const banner = bannerOf(h);
  if (banner && !ratios.has(banner)) {
    const img = new Image();
    img.onload = () => img.naturalHeight && ratios.set(banner, img.naturalWidth / img.naturalHeight);
    img.src = banner;
  }
}

/** Props for a link to a hackathon: prefetch on press (and on hover with a mouse). */
export function prefetchOn(h: Hackathon) {
  return { onPointerDownCapture: () => prefetch(h), onMouseEnter: () => prefetch(h) };
}
