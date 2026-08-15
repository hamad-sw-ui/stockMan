import "@testing-library/jest-dom/vitest";

// jsdom n'implémente pas les médias : stubs silencieux pour les composants vidéo.
if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => undefined;
}

// I1 — les tests historiques assertent le texte FRANÇAIS à l'identique :
// la langue source (fr) est donc imposée ici, une fois pour toutes les suites
// (les tests i18n basculent explicitement la langue et la restaurent).
import i18n from "../src/i18n";

void i18n.changeLanguage("fr");
