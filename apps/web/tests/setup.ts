import "@testing-library/jest-dom/vitest";

// jsdom n'implémente pas les médias : stubs silencieux pour les composants vidéo.
if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => undefined;
}
