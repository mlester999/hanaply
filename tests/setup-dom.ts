import '@testing-library/jest-dom/vitest';

class ResizeObserverStub implements ResizeObserver {
  disconnect(): void {
    return;
  }
  observe(): void {
    return;
  }
  unobserve(): void {
    return;
  }
}

globalThis.ResizeObserver = ResizeObserverStub;

if (!globalThis.PointerEvent) {
  globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
}

Object.defineProperties(Element.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  releasePointerCapture: { configurable: true, value: () => undefined },
  scrollIntoView: { configurable: true, value: () => undefined },
  setPointerCapture: { configurable: true, value: () => undefined },
});
