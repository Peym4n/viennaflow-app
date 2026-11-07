interface Position { x: number; y: number; }
interface Contact extends Position { id: number; }
interface Tap { point: Position; time: number; }

const TAP_WINDOW_MS = 300;
const TAP_DISTANCE_PX = 24;
const DRAG_THRESHOLD_PX = 8;
const PIXELS_PER_ZOOM = 150;
const SDK_TAP_RESET_MS = 500;

/** Recognition is independent of the DOM and Maps, including cancellation and direction reversal. */
export class TapDragRecognizer {
  private previousTap?: Tap;
  private touch?: { origin: Contact; time: number; second: boolean; moved: boolean; zooming: boolean };

  get claimed(): boolean { return this.touch?.second ?? false; }

  start(point: Contact, time: number): boolean {
    const second = !!this.previousTap && time >= this.previousTap.time && time - this.previousTap.time <= TAP_WINDOW_MS &&
      Math.hypot(point.x - this.previousTap.point.x, point.y - this.previousTap.point.y) <= TAP_DISTANCE_PX;
    this.previousTap = undefined;
    this.touch = { origin: point, time, second, moved: false, zooming: false };
    return second;
  }

  move(point: Contact): number | undefined {
    const touch = this.touch;
    if (!touch || touch.origin.id !== point.id) return undefined;
    const dx = point.x - touch.origin.x;
    const dy = point.y - touch.origin.y;
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) touch.moved = true;
    if (touch.second && Math.abs(dy) >= DRAG_THRESHOLD_PX && Math.abs(dy) >= Math.abs(dx)) touch.zooming = true;
    return touch.zooming ? dy / PIXELS_PER_ZOOM : undefined;
  }

  end(point: Contact, time: number): number | undefined {
    const touch = this.touch;
    if (!touch || touch.origin.id !== point.id) { this.cancel(); return undefined; }
    const delta = this.move(point);
    this.touch = undefined;
    if (touch.second) return touch.moved ? delta : 1;
    if (!touch.moved && time >= touch.time && time - touch.time <= TAP_WINDOW_MS) this.previousTap = { point, time };
    return undefined;
  }

  cancel(): void { this.previousTap = undefined; this.touch = undefined; }
}

/** Keep the second-tap location fixed in screen space while changing a flat map's scale. */
export function anchoredZoomCenter(center: Position, offset: Position, startZoom: number, zoom: number, heading = 0): Position {
  const angle = heading * Math.PI / 180;
  const rotated = { x: offset.x * Math.cos(angle) - offset.y * Math.sin(angle),
    y: offset.x * Math.sin(angle) + offset.y * Math.cos(angle) };
  const scale = 2 ** -startZoom - 2 ** -zoom;
  return { x: center.x + rotated.x * scale, y: center.y + rotated.y * scale };
}

interface Camera {
  zoom: number;
  center: Position;
  offset: Position;
  heading: number;
  projection: google.maps.Projection;
  minZoom: number;
  maxZoom: number;
  fractional: boolean;
}

/** Owns only double-tap touch sequences; the SDK retains ordinary pan, pinch and desktop input. */
export class TapDragZoom {
  private readonly recognizer = new TapDragRecognizer();
  private camera?: Camera;
  private requestedZoom?: number;
  private appliedZoom?: number;
  private frame?: number;
  private nativeDoubleTap?: { disabled: boolean };
  private restoreTimer?: ReturnType<typeof setTimeout>;
  private attached = false;
  private destroyed = false;

  constructor(private readonly container: HTMLElement, private readonly map: google.maps.Map) {}

  attach(): void {
    if (this.attached || this.destroyed) return;
    this.attached = true;
    // Maps consumes touch events. Capture the second contact before its default pan/double-tap handlers.
    this.container.addEventListener('touchstart', this.start, { capture: true, passive: false });
    this.container.addEventListener('touchmove', this.move, { capture: true, passive: false });
    this.container.addEventListener('touchend', this.end, { capture: true, passive: false });
    this.container.addEventListener('touchcancel', this.interrupt, true);
    this.container.addEventListener('pointerdown', this.otherPointer, true);
    window.addEventListener('blur', this.interrupt);
    document.addEventListener('visibilitychange', this.visibility);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.interrupt();
    this.container.removeEventListener('touchstart', this.start, true);
    this.container.removeEventListener('touchmove', this.move, true);
    this.container.removeEventListener('touchend', this.end, true);
    this.container.removeEventListener('touchcancel', this.interrupt, true);
    this.container.removeEventListener('pointerdown', this.otherPointer, true);
    window.removeEventListener('blur', this.interrupt);
    document.removeEventListener('visibilitychange', this.visibility);
  }

  private readonly start = (event: TouchEvent): void => {
    // On a second finger, pass the complete native contact list through to the SDK for pinch handling.
    if (event.touches.length !== 1 || this.isInteractive(event.target)) { this.interrupt(); return; }
    const point = this.contact(event.touches[0]);
    if (!this.recognizer.start(point, event.timeStamp)) return;
    this.camera = this.snapshot(point);
    if (!this.camera) { this.interrupt(); return; }
    this.guardNativeDoubleTap();
    this.consume(event);
  };

  private readonly move = (event: TouchEvent): void => {
    if (event.touches.length !== 1) { this.interrupt(); return; }
    const delta = this.recognizer.move(this.contact(event.touches[0]));
    if (!this.recognizer.claimed) return;
    this.consume(event);
    if (delta !== undefined && this.camera) this.queue(this.camera.zoom + delta);
  };

  private readonly end = (event: TouchEvent): void => {
    if (event.touches.length || !event.changedTouches.length) { this.interrupt(); return; }
    const claimed = this.recognizer.claimed;
    const delta = this.recognizer.end(this.contact(event.changedTouches[0]), event.timeStamp);
    if (!claimed) return;
    this.consume(event);
    if (delta !== undefined && this.camera) {
      this.queue(this.camera.zoom + delta);
      // Commit the final position even when the finger lifts before the queued frame runs.
      this.apply();
    }
    this.cancel();
    // Maps has seen the first tap. Its pending detector must not combine that tap with a quick third tap.
    this.restoreTimer = setTimeout(this.restoreNativeDoubleTap, SDK_TAP_RESET_MS);
  };

  private readonly visibility = (): void => { if (document.visibilityState !== 'visible') this.interrupt(); };

  private readonly otherPointer = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') this.interrupt();
  };

  private readonly interrupt = (): void => { this.cancel(); this.restoreNativeDoubleTap(); };

  private guardNativeDoubleTap(): void {
    if (this.restoreTimer !== undefined) clearTimeout(this.restoreTimer);
    this.restoreTimer = undefined;
    if (this.nativeDoubleTap) return;
    this.nativeDoubleTap = { disabled: this.map.get('disableDoubleClickZoom') === true };
    // Only double-click zoom is paused; pan and pinch stay enabled. Genuine mouse/pen input restores it immediately.
    this.map.setOptions({ disableDoubleClickZoom: true });
  }

  private readonly restoreNativeDoubleTap = (): void => {
    if (this.restoreTimer !== undefined) clearTimeout(this.restoreTimer);
    this.restoreTimer = undefined;
    if (!this.nativeDoubleTap) return;
    this.map.setOptions({ disableDoubleClickZoom: this.nativeDoubleTap.disabled });
    this.nativeDoubleTap = undefined;
  };

  private readonly cancel = (): void => {
    this.recognizer.cancel();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.camera = undefined;
    this.requestedZoom = undefined;
    this.appliedZoom = undefined;
  };

  private contact(touch: Touch): Contact { return { id: touch.identifier, x: touch.clientX, y: touch.clientY }; }

  private consume(event: TouchEvent): void {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }

  private isInteractive(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(
      '.station-overlay-host, app-station-card, button, a, input, textarea, select, [role="button"], [role="dialog"], [contenteditable="true"]',
    );
  }

  private snapshot(point: Position): Camera | undefined {
    const zoom = this.map.getZoom();
    const center = this.map.getCenter();
    const projection = this.map.getProjection();
    const bounds = this.container.getBoundingClientRect();
    const world = center && projection?.fromLatLngToPoint(center);
    if (zoom === undefined || !Number.isFinite(zoom) || !projection || !world || !bounds.width || !bounds.height) return undefined;
    const type = this.map.mapTypes.get(this.map.getMapTypeId() ?? 'roadmap') as google.maps.MapType | undefined;
    const min: unknown = this.map.get('minZoom');
    const max: unknown = this.map.get('maxZoom');
    return { zoom, center: { x: world.x, y: world.y },
      offset: { x: point.x - bounds.left - bounds.width / 2, y: point.y - bounds.top - bounds.height / 2 },
      heading: this.map.getHeading() ?? 0, projection,
      minZoom: typeof min === 'number' && Number.isFinite(min) ? min : type?.minZoom ?? 0,
      maxZoom: typeof max === 'number' && Number.isFinite(max) ? max : type?.maxZoom ?? 22,
      fractional: this.map.get('isFractionalZoomEnabled') !== false };
  }

  private queue(zoom: number): void {
    const camera = this.camera;
    if (!camera) return;
    const value = camera.fractional ? zoom : Math.round(zoom);
    this.requestedZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, value));
    if (this.frame === undefined) this.frame = requestAnimationFrame(() => this.apply());
  }

  private apply(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    const camera = this.camera;
    const zoom = this.requestedZoom;
    if (!camera || zoom === undefined || zoom === this.appliedZoom) return;
    const center = anchoredZoomCenter(camera.center, camera.offset, camera.zoom, zoom, camera.heading);
    const latLng = camera.projection.fromPointToLatLng(new google.maps.Point(center.x, center.y));
    if (!latLng) return;
    this.map.moveCamera({ center: latLng, zoom });
    this.appliedZoom = zoom;
  }
}
