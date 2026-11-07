import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TapDragRecognizer, TapDragZoom } from './tap-drag-zoom';
import { installGoogleMaps } from '../../../../testing/google-maps';

const contact = (x = 100, y = 200, id = 1) => ({ x, y, id });

describe('double-tap drag recognition', () => {
  let recognizer: TapDragRecognizer;
  beforeEach(() => { recognizer = new TapDragRecognizer(); });
  function firstTap() { recognizer.start(contact(), 0); recognizer.end(contact(), 40); }

  it('requires a quick nearby second touch, then zooms down/in and up/out with reversible displacement', () => {
    firstTap();
    expect(recognizer.start(contact(100, 200, 2), 120)).toBe(true);
    expect(recognizer.move(contact(100, 205, 2))).toBeUndefined();
    expect(recognizer.move(contact(100, 350, 2))).toBe(1);
    expect(recognizer.move(contact(100, 50, 2))).toBe(-1);
    expect(recognizer.end(contact(100, 200, 2), 300)).toBe(0);
    expect(recognizer.claimed).toBe(false);
  });

  it('keeps ordinary dragging and long presses out of the double-tap path', () => {
    recognizer.start(contact(), 0);
    expect(recognizer.move(contact(100, 250))).toBeUndefined();
    recognizer.end(contact(100, 250), 100);
    expect(recognizer.start(contact(100, 250, 2), 150)).toBe(false);
    recognizer.cancel();
    recognizer.start(contact(), 0); recognizer.end(contact(), 400);
    expect(recognizer.start(contact(100, 200, 2), 450)).toBe(false);
  });

  it.each([{ x: 100, time: 341 }, { x: 125, time: 120 }])('rejects taps outside the timing/proximity bounds: %j', ({ x, time }) => {
    firstTap();
    expect(recognizer.start(contact(x, 200, 2), time)).toBe(false);
  });

  it('preserves plain double-tap zoom exactly once and avoids zooming for horizontal drags', () => {
    firstTap(); recognizer.start(contact(100, 200, 2), 120);
    expect(recognizer.end(contact(102, 202, 2), 150)).toBe(1);
    firstTap(); recognizer.start(contact(100, 200, 2), 120);
    expect(recognizer.end(contact(140, 200, 2), 150)).toBeUndefined();
  });

  it('resets on cancellation and rejects a mismatched ending contact', () => {
    firstTap(); recognizer.cancel();
    expect(recognizer.start(contact(100, 200, 2), 120)).toBe(false);
    expect(recognizer.end(contact(100, 200, 3), 150)).toBeUndefined();
    expect(recognizer.start(contact(100, 200, 4), 200)).toBe(false);
  });
});

describe('map-scoped touch integration', () => {
  let sdk: ReturnType<typeof installGoogleMaps>;
  let container: HTMLDivElement;
  let surface: HTMLDivElement;
  let map: ReturnType<typeof installGoogleMaps>['maps'][number];
  let handler: TapDragZoom;
  let frames: Map<number, FrameRequestCallback>;
  let frameId: number;

  beforeEach(() => {
    vi.useFakeTimers();
    sdk = installGoogleMaps();
    container = document.createElement('div'); surface = document.createElement('div');
    container.append(surface); document.body.append(container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800));
    const sdkMap = new google.maps.Map(container, { center: { lat: 120, lng: 100 }, zoom: 13, gestureHandling: 'greedy' });
    map = sdk.maps[0];
    frames = new Map(); frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    handler = new TapDragZoom(container, sdkMap);
    handler.attach();
  });
  afterEach(() => { handler.destroy(); container.remove(); sdk.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

  function send(type: string, points = [contact()], target: Element = surface, changed = points) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const touches = points.map(point => ({ identifier: point.id, clientX: point.x, clientY: point.y }));
    Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changed.map(point => ({ identifier: point.id, clientX: point.x, clientY: point.y })) } });
    target.dispatchEvent(event);
    return event;
  }
  function secondDown() {
    send('touchstart'); send('touchend', [], surface, [contact()]); send('touchstart', [contact(100, 200, 2)]);
  }
  function flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); }

  it.each([0, 90])('keeps the map center fixed for off-center zoom gestures at heading %s', heading => {
    map.setOptions({ heading });
    const center = map.getCenter();
    secondDown();
    for (const [y, zoom] of [[350, 14], [50, 12], [200, 13]]) {
      send('touchmove', [contact(100, y, 2)]); flush();
      expect(map.getZoom()).toBe(zoom);
      expect(map.getCenter().equals(center)).toBe(true);
      expect(map.moveCamera).toHaveBeenLastCalledWith({ center, zoom });
    }
    send('touchend', [], surface, [contact(100, 200, 2)]);
    expect(map.getCenter().equals(center)).toBe(true);
  });

  it('passes ordinary touch/pan events to Maps but owns the second tap and drag', () => {
    const mapsStart = vi.fn(); const mapsMove = vi.fn();
    surface.addEventListener('touchstart', mapsStart); surface.addEventListener('touchmove', mapsMove);
    expect(send('touchstart').defaultPrevented).toBe(false);
    send('touchmove', [contact(100, 250)]); send('touchend', [], surface, [contact(100, 250)]);
    expect(mapsMove).toHaveBeenCalledTimes(1);
    expect(map.moveCamera).not.toHaveBeenCalled();
    secondDown();
    expect(mapsStart).toHaveBeenCalledTimes(2);
    expect(send('touchmove', [contact(100, 350, 2)]).defaultPrevented).toBe(true);
    flush();
    expect(map.moveCamera).toHaveBeenCalledTimes(1);
    expect(map.getZoom()).toBe(14);
    expect(mapsMove).toHaveBeenCalledTimes(1);
    send('touchend', [], surface, [contact(100, 350, 2)]);
    expect(map.moveCamera).toHaveBeenCalledTimes(1);
  });

  it('activates only when attached and cannot install duplicate or destroyed listeners', () => {
    handler.destroy();
    handler = new TapDragZoom(container, map as unknown as google.maps.Map);
    secondDown(); send('touchmove', [contact(100, 350, 2)]);
    expect(frames.size).toBe(0);
    handler.attach(); handler.attach();
    secondDown(); send('touchmove', [contact(100, 350, 2)]); flush();
    expect(map.moveCamera).toHaveBeenCalledTimes(1);
    handler.destroy(); handler.attach();
    secondDown(); send('touchmove', [contact(100, 350, 2)]); flush();
    expect(map.moveCamera).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('coalesces moves, reverses direction, clamps bounds and cancels pending frames', () => {
    map.setOptions({ minZoom: 12, maxZoom: 14 });
    secondDown();
    send('touchmove', [contact(100, 350, 2)]); send('touchmove', [contact(100, 500, 2)]);
    expect(frames.size).toBe(1); flush();
    expect(map.getZoom()).toBe(14);
    send('touchmove', [contact(100, 600, 2)]); flush();
    expect(map.moveCamera).toHaveBeenCalledTimes(1);
    send('touchmove', [contact(100, -100, 2)]); flush();
    expect(map.getZoom()).toBe(12);
    send('touchmove', [contact(100, 250, 2)]);
    send('touchcancel', [], surface, [contact(100, 250, 2)]);
    expect(frames.size).toBe(0);
    expect(map.getZoom()).toBe(12);
  });

  it('passes the full multi-touch event to Maps and leaves the next plain pan unaffected', () => {
    const mapsStart = vi.fn(); surface.addEventListener('touchstart', mapsStart);
    secondDown(); send('touchmove', [contact(100, 250, 2)]);
    const event = send('touchstart', [contact(100, 250, 2), contact(200, 250, 3)]);
    expect(event.defaultPrevented).toBe(false);
    expect(mapsStart).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
    expect(send('touchmove', [contact(100, 260, 2), contact(210, 260, 3)]).defaultPrevented).toBe(false);
    send('touchend', [], surface, [contact(100, 260, 2), contact(210, 260, 3)]);
    expect(send('touchstart', [contact(100, 200, 4)]).defaultPrevented).toBe(false);
  });

  it.each(['button', 'input', 'a', 'app-station-card'])('ignores interactive %s targets', tag => {
    const target = document.createElement(tag); container.append(target);
    send('touchstart', [contact()], target); send('touchend', [], target, [contact()]);
    expect(send('touchstart', [contact(100, 200, 2)], target).defaultPrevented).toBe(false);
    send('touchmove', [contact(100, 350, 2)], target); flush();
    expect(map.moveCamera).not.toHaveBeenCalled();
  });

  it('commits a plain double tap once and does not intercept mouse/keyboard events', () => {
    const center = map.getCenter();
    secondDown(); send('touchend', [], surface, [contact(100, 200, 2)]);
    expect(map.getZoom()).toBe(14);
    expect(map.getCenter().equals(center)).toBe(true);
    expect(map.moveCamera).toHaveBeenCalledTimes(1);
    expect(surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))).toBe(true);
    expect(surface.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }))).toBe(true);
  });

  it('blocks the SDK detector across a quick third tap, then restores its original option', () => {
    secondDown(); send('touchend', [], surface, [contact(100, 200, 2)]);
    expect(map.options.disableDoubleClickZoom).toBe(true);
    send('touchstart', [contact(100, 200, 3)]); send('touchend', [], surface, [contact(100, 200, 3)]);
    expect(map.options.disableDoubleClickZoom).toBe(true);
    expect(map.moveCamera).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(map.options.disableDoubleClickZoom).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restores native double-click zoom before mouse/pen input and preserves an already disabled option', () => {
    secondDown(); send('touchend', [], surface, [contact(100, 200, 2)]);
    const mouse = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(mouse, 'pointerType', { value: 'mouse' });
    expect(surface.dispatchEvent(mouse)).toBe(true);
    expect(map.options.disableDoubleClickZoom).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    map.setOptions({ disableDoubleClickZoom: true });
    secondDown(); send('touchend', [], surface, [contact(100, 200, 2)]);
    handler.destroy();
    expect(map.options.disableDoubleClickZoom).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['blur', 'hidden', 'destroy'])('releases owned work on %s and leaves no effective listeners after teardown', reason => {
    secondDown(); send('touchmove', [contact(100, 350, 2)]);
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else if (reason === 'hidden') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    } else handler.destroy();
    expect(frames.size).toBe(0);
    handler.destroy(); handler.destroy();
    secondDown(); send('touchmove', [contact(100, 350, 2)]); flush();
    expect(map.moveCamera).not.toHaveBeenCalled();
  });
});
