import { HttpError } from "./errors";
import { AuthUser } from "../middleware/auth";

/** Résolution du dépôt effectif : un VENDEUR est confiné à son dépôt
 *  (SEC-11 : impossible d'opérer « au nom » d'un autre dépôt).
 *  Module partagé sans dépendance métier (évite les cycles entre services). */
export function resolveDepot(user: AuthUser, requested?: string): string {
  const depot =
    user.role === "VENDEUR" ? user.depotId : (requested ?? user.depotId);
  if (!depot)
    throw HttpError.badRequest(
      "DEPOT_REQUIRED",
      "Dépôt requis pour cette opération.",
    );
  if (user.role === "VENDEUR" && requested && requested !== user.depotId) {
    throw HttpError.forbidden(
      "Un vendeur ne peut opérer que sur son propre dépôt.",
      "DEPOT_FORBIDDEN",
    );
  }
  return depot;
}
