/** Caisse (POS) — l'écran cœur de métier, mobile-first :
 *  - catalogue pré-chargé et disponible hors-ligne (IndexedDB) ;
 *  - recherche + douchette code-barres, favoris, catégories ;
 *  - panier multi-unités (pièce/carton → conversion auto) avec variantes et remises ;
 *  - paiements Espèces / MTN MoMo / Orange Money ;
 *  - mode hors-ligne complet : vente mise en file (clientSaleId) puis rejeu
 *    idempotent automatique (serveur = autorité finale pour prix et stock). */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
} from "../../components/ui";
import {
  CameraScanner,
  cameraScanSupported,
} from "../../components/CameraScanner";
import { CashSessionGate } from "../../components/CashSessionGate";
import {
  cartTotal,
  changeDue,
  lineKey,
  makeLine,
  type CartLine,
} from "../../lib/cart";
import { formatDateTime, formatMoney, formatQty } from "../../lib/format";
import { ApiError, get, post } from "../../lib/http";
import { enqueueSale } from "../../lib/offline/outbox";
import { installAutoSync } from "../../lib/offline/sync";
import { usePosBootstrap, type BootstrapStatus } from "../../lib/pos";
import { resolvePosScan } from "../../lib/posScan";
import { lookupBarcode } from "../../lib/scanLookup";
import { resolveWeighedScan } from "../../lib/weightedBarcode";
import { useOnlineStatus } from "../../components/Shell";
import { useToast } from "../../store/toast";
import type {
  PaymentMethod,
  PosCustomer,
  ReceiptData,
  SerialRow,
} from "../../lib/types";

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Quantités balance (kg) — précision au gramme. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/* ------------------------------ Types locaux ------------------------------- */
interface SoldState {
  saleId: string | null;
  total: number;
  received: number | null;
  method: PaymentMethod;
  reference: string | null;
  offline: boolean;
  lines: Array<{ label: string; qty: number; unit: string; total: number }>;
  at: string;
  customerName?: string | null;
  outstanding?: number;
}

const METHODS: Array<{ id: PaymentMethod; label: string; icon: string }> = [
  { id: "CASH", label: "Espèces", icon: "💵" },
  { id: "MTN_MOMO", label: "MTN MoMo", icon: "🟡" },
  { id: "ORANGE_MONEY", label: "Orange Money", icon: "🟠" },
];

/* ================================ COMPOSANT ================================ */
export default function PosPage() {
  const { show } = useToast();
  const online = useOnlineStatus();
  const [depotId, setDepotId] = useState<string | undefined>(undefined);
  const boot: BootstrapStatus = usePosBootstrap(depotId);
  const b = boot.data;

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [variantPick, setVariantPick] = useState<string | null>(null); // productId
  // Produit sérialisé (IMEI) en cours de capture des numéros — E8.
  const [serialPick, setSerialPick] = useState<{
    productId: string;
    variantId: string | null;
  } | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [sold, setSold] = useState<SoldState | null>(null);
  // R2 — panneau panier repliable ≤ 480 px (le bureau est inchangé :
  // la poignée `.pos-bar-toggle` n'y est jamais affichée).
  const [cartOpen, setCartOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const canCameraScan = useMemo(() => cameraScanSupported(), []);

  // Auto-sync du file d'attente au retour réseau
  useEffect(() => installAutoSync(), []);

  // Map produitId → stock disponible sur le dépôt (toutes variantes confondues pour l'affichage)
  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of b?.levels ?? []) {
      m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.quantity);
    }
    return m;
  }, [b]);

  const stockByVariant = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of b?.levels ?? []) {
      if (l.variant_id) m.set(l.variant_id, l.quantity);
    }
    return m;
  }, [b]);

  const unitById = useMemo(
    () => new Map((b?.units ?? []).map((u) => [u.id, u])),
    [b],
  );

  const filtered = useMemo(() => {
    const products = b?.products ?? [];
    const term = search.trim().toLowerCase();
    let list = products;
    if (category) list = list.filter((p) => p.category_name === category);
    if (term) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.barcode === term ||
          p.variants.some(
            (v) => v.barcode === term || v.name.toLowerCase().includes(term),
          ),
      );
    }
    return list.slice(0, 60);
  }, [b, search, category]);

  const favorites = useMemo(
    () =>
      (b?.products ?? [])
        .filter((p) => b?.favorites.includes(p.id))
        .slice(0, 12),
    [b],
  );

  const total = cartTotal(cart);

  /* ----------------------------- Actions panier ---------------------------- */
  const addToCart = (
    productId: string,
    variantId: string | null = null,
    // Unité imposée par un scan de conditionnement (C3) : « carton ×12 ».
    unitOverride: {
      id: string;
      symbol: string;
      baseValue: number;
    } | null = null,
  ) => {
    if (!b) return;
    const p = b.products.find((x) => x.id === productId);
    if (!p) return;
    const v = variantId
      ? (p.variants.find((x) => x.id === variantId) ?? null)
      : null;
    // Produit sérialisé (IMEI) : on ne peut pas l'ajouter « en vrac » —
    // chaque article vendu doit être identifié par son numéro de série.
    if (p.requires_serial) {
      setVariantPick(null);
      setSerialPick({ productId, variantId });
      return;
    }
    const knownUnit = p.unit_id ? (unitById.get(p.unit_id) ?? null) : null;
    const unit =
      unitOverride ??
      (knownUnit
        ? {
            id: knownUnit.id,
            symbol: knownUnit.symbol,
            baseValue: knownUnit.base_value,
          }
        : null);
    const line = makeLine({
      product: {
        id: p.id,
        name: p.name,
        sellingPrice: p.selling_price,
        unitBaseValue: p.unit_base_value ?? 1,
        unitId: p.unit_id,
        unitSymbol: p.unit_symbol,
        barcode: p.barcode,
      },
      variant: v
        ? {
            id: v.id,
            name: v.name,
            additionalPrice: v.additionalPrice,
            barcode: v.barcode,
          }
        : null,
      unit,
      quantity: 1,
    });
    setCart((prev) => {
      const existing = prev.find((l) => l.key === line.key);
      if (existing) {
        // Incrémente via makeLine pour recalculer les totaux
        return prev.map((l) =>
          l.key === line.key ? makeLine({ ...l, quantity: l.quantity + 1 }) : l,
        );
      }
      return [...prev, line];
    });
    setVariantPick(null);
  };

  /** Validation de la capture IMEI : (ré)écrit la ligne sérialisée du panier.
   *  Règles alignées API : unité de base uniquement, 1 numéro = 1 article. */
  const confirmSerials = (
    productId: string,
    variantId: string | null,
    serials: string[],
  ) => {
    if (!b) return;
    const p = b.products.find((x) => x.id === productId);
    if (!p) return;
    const v = variantId
      ? (p.variants.find((x) => x.id === variantId) ?? null)
      : null;
    if (serials.length === 0) {
      // Plus aucun numéro = retrait de la ligne.
      setCart((prev) =>
        prev.filter((l) => l.key !== lineKey(productId, variantId, null)),
      );
      setSerialPick(null);
      return;
    }
    const line = makeLine({
      product: {
        id: p.id,
        name: p.name,
        sellingPrice: p.selling_price,
        unitBaseValue: p.unit_base_value ?? 1,
        unitId: p.unit_id,
        unitSymbol: p.unit_symbol,
        barcode: p.barcode,
        requiresSerial: true,
      },
      variant: v
        ? {
            id: v.id,
            name: v.name,
            additionalPrice: v.additionalPrice,
            barcode: v.barcode,
          }
        : null,
      unit: null, // vente à l'unité de base (invariant serveur SERIAL_BASE_UNIT_ONLY)
      quantity: serials.length,
      serialNumbers: serials,
    });
    setCart((prev) => {
      const existing = prev.find((l) => l.key === line.key);
      if (existing) return prev.map((l) => (l.key === line.key ? line : l));
      return [...prev, line];
    });
    setSerialPick(null);
  };

  const pickProduct = (productId: string) => {
    const p = b?.products.find((x) => x.id === productId);
    if (!p) return;
    if (p.has_variants && p.variants.length > 0) setVariantPick(productId);
    else addToCart(productId);
  };

  const updateLine = (key: string, patchFn: (l: CartLine) => CartLine) =>
    setCart((prev) =>
      prev.map((l) => (l.key === key ? makeLine(patchFn(l)) : l)),
    );

  const setQty = (key: string, qty: number) =>
    updateLine(key, (l) => ({ ...l, quantity: Math.max(1, qty) }));

  const setUnit = (key: string, unitId: string) =>
    updateLine(key, (l) => {
      const u = unitById.get(unitId);
      return {
        ...l,
        unit: u
          ? { id: u.id, symbol: u.symbol, baseValue: u.base_value }
          : null,
      };
    });

  const setDiscount = (key: string, pct: number) =>
    updateLine(key, (l) => ({
      ...l,
      discountPct: Math.min(Math.max(pct, 0), 100),
    }));

  const removeLine = (key: string) =>
    setCart((prev) => prev.filter((l) => l.key !== key));

  /** Ajout au panier par code-barres (C3) — hors-ligne, priorité stricte :
   *  produit > variante > alias fournisseur/conditionnement (l'unité scannée
   *  suit son facteur, recalculé par le moteur cart.ts). Chemin commun à la
   *  douchette USB, à la saisie Entrée et au scanner caméra. */
  /** Article à pesée (C5) : étiquette de balance résolue → ligne à la
   *  quantité embarquée (WEIGHT) ou dérivée du prix (PRICE). */
  const addWeighed = (code: string): boolean => {
    if (!b) return false;
    const w = resolveWeighedScan(b.products, b.weightedMode ?? "OFF", code);
    if (!w) return false;
    const p = b.products.find((x) => x.id === w.productId);
    if (!p || p.requires_serial) return false;
    const catUnit = p.unit_id ? (unitById.get(p.unit_id) ?? null) : null;
    const line = makeLine({
      product: {
        id: p.id,
        name: p.name,
        sellingPrice: p.selling_price,
        unitBaseValue: p.unit_base_value ?? 1,
        unitId: p.unit_id,
        unitSymbol: p.unit_symbol,
        barcode: p.barcode,
      },
      variant: null,
      unit: catUnit
        ? {
            id: catUnit.id,
            symbol: catUnit.symbol,
            baseValue: catUnit.base_value,
          }
        : null,
      quantity: w.quantity,
    });
    setCart((prev) => {
      const existing = prev.find((l) => l.key === line.key);
      if (existing)
        // Deux pesées du même article : on CUMULE les quantités.
        return prev.map((l) =>
          l.key === line.key
            ? makeLine({ ...l, quantity: round3(l.quantity + w.quantity) })
            : l,
        );
      return [...prev, line];
    });
    show(
      `⚖️ ${p.name} — ${w.label}${w.embeddedPrice ? " embarqué" : ""} ajouté au panier.`,
      "success",
    );
    return true;
  };

  const addByBarcode = (code: string): boolean => {
    if (!code || !b) return false;
    const hit = resolvePosScan(b, code);
    // C5 — second essai : étiquette de balance à pesée (si le mode est actif).
    if (!hit) return addWeighed(code);
    if (hit.kind === "product") {
      pickProduct(hit.productId);
      return true;
    }
    if (hit.kind === "variant") {
      addToCart(hit.productId, hit.variantId);
      return true;
    }
    // Alias (code fournisseur ou conditionnement « carton »).
    const p = b.products.find((x) => x.id === hit.productId);
    if (!p) return false;
    // Produit sérialisé (IMEI) : vente à l'unité de base uniquement
    // (invariant serveur SERIAL_BASE_UNIT_ONLY) → pas d'unité imposée.
    let unitOverride: { id: string; symbol: string; baseValue: number } | null =
      null;
    if (hit.unitId && !p.requires_serial) {
      const known = unitById.get(hit.unitId);
      if (known)
        unitOverride = {
          id: known.id,
          symbol: known.symbol,
          baseValue: known.base_value,
        };
      else if (hit.unitBaseValue != null)
        unitOverride = {
          id: hit.unitId,
          symbol: hit.unitSymbol ?? "—",
          baseValue: hit.unitBaseValue,
        };
    }
    addToCart(hit.productId, hit.variantId, unitOverride);
    return true;
  };

  /** Repli connecté (C3) : code inconnu du bootstrap local (ex. alias au-delà
   *  des 5 000 chargés, catalogue tronqué) → résolveur serveur C1. Le ticket
   *  garde ses garanties hors-ligne : la validation de la vente reste gérée
   *  par la file idempotente. */
  const addByBarcodeOnline = async (code: string): Promise<boolean> => {
    if (!online || !b) return false;
    try {
      const r = await lookupBarcode(code);
      if (r.matched === "product") {
        pickProduct(r.productId);
        return true;
      }
      const p = b.products.find((x) => x.id === r.productId);
      if (!p) {
        show(
          "Produit résolu en ligne mais absent du catalogue local : synchronisez d'abord.",
          "error",
        );
        return true; // code « traité » : pas de double alerte
      }
      let unitOverride: {
        id: string;
        symbol: string;
        baseValue: number;
      } | null = null;
      if (r.matched === "alias" && r.unitId && !p.requires_serial) {
        const known = unitById.get(r.unitId);
        unitOverride = known
          ? { id: known.id, symbol: known.symbol, baseValue: known.base_value }
          : {
              id: r.unitId,
              symbol: r.unitSymbol ?? "—",
              baseValue: round2(r.unitFactor * (p.unit_base_value ?? 1)),
            };
      }
      addToCart(r.productId, r.variantId, unitOverride);
      return true;
    } catch {
      return false; // 404 BARCODE_UNKNOWN ou réseau coupé entre-temps
    }
  };

  // Recherche « douchette » : un code-barres exact valide ajoute directement au panier
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const term = search.trim();
    if (!term || !b) return;
    if (addByBarcode(term)) {
      setSearch("");
      return;
    }
    if (filtered.length === 1) {
      pickProduct(filtered[0]!.id);
      setSearch("");
      return;
    }
    // Inconnu localement : tente le résolveur serveur (C3) si connecté.
    void addByBarcodeOnline(term).then((ok) => {
      if (ok) setSearch("");
    });
  };

  // Résultat du scanner caméra : même comportement que la douchette.
  const onCameraDetect = (code: string) => {
    setScanOpen(false);
    if (addByBarcode(code)) {
      show("Produit ajouté au panier.", "success");
      return;
    }
    void addByBarcodeOnline(code).then((ok) => {
      if (ok) show("Produit ajouté au panier.", "success");
      else show(`Aucun produit ne correspond au code « ${code} ».`, "error");
    });
  };

  /* ------------------------------- Validation ------------------------------ */
  const finishSale = async (
    method: PaymentMethod,
    received: number | null,
    reference: string | null,
    customer?: PosCustomer | null,
    paidNow?: number | null,
    dueDate?: string | null,
  ) => {
    if (!b || cart.length === 0) return;
    const clientSaleId = crypto.randomUUID();
    // Crédit (E3) : montant payé maintenant < total ⇒ versement partiel tracé
    const paid = paidNow == null ? total : Math.min(paidNow, total);
    const credit = round2(total - paid);
    const payload: Record<string, unknown> = {
      depotId: b.depotId,
      items: cart.map((l) => ({
        productId: l.product.id,
        variantId: l.variant?.id ?? null,
        unitId: l.unit?.id ?? null,
        quantity: l.quantity,
        discountPct: l.discountPct ?? 0,
        // Produit sérialisé (E8) : IMEI vendus — figés sur la ligne serveur.
        serialNumbers: l.serialNumbers ?? undefined,
      })),
      paymentMethod: method,
      paymentReference: reference,
      clientSaleId,
      createdAt: new Date().toISOString(),
    };
    if (customer) payload.customerId = customer.id;
    if (credit > 0 && customer) {
      payload.payments = paid > 1e-9 ? [{ method, amount: paid }] : [];
      if (dueDate) payload.dueDate = dueDate;
    } else {
      payload.amountReceived = received ?? undefined;
    }
    const linesSnapshot = cart.map((l) => ({
      label: `${l.product.name}${l.variant ? ` · ${l.variant.name}` : ""}`,
      qty: l.quantity,
      unit: l.unit?.symbol ?? l.product.unitSymbol ?? "",
      total: l.lineTotal,
    }));
    const at = new Date().toISOString();

    const offlineFallback = async () => {
      await enqueueSale({
        clientSaleId,
        payload,
        label: `Ticket du ${new Date(at).toLocaleString("fr-FR")}`,
        total,
      });
      setSold({
        saleId: null,
        total,
        received,
        method,
        reference,
        offline: true,
        lines: linesSnapshot,
        at,
        customerName: customer?.name ?? null,
        outstanding: credit > 0 ? credit : 0,
      });
      setCart([]);
      setPayOpen(false);
      show(
        "Hors-ligne : vente enregistrée localement, synchronisation automatique au retour du réseau.",
        "info",
      );
    };

    if (!online) {
      await offlineFallback();
      return;
    }
    try {
      const res = await post<{
        sale: { id: string; total_amount: number; amount_paid: number };
      }>("/sales", payload);
      setSold({
        saleId: res.sale.id,
        total: Number(res.sale.total_amount),
        received,
        method,
        reference,
        offline: false,
        lines: linesSnapshot,
        at,
        customerName: customer?.name ?? null,
        outstanding: round2(
          Number(res.sale.total_amount) - Number(res.sale.amount_paid ?? 0),
        ),
      });
      setCart([]);
      setPayOpen(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        await offlineFallback();
      } else {
        show(e instanceof Error ? e.message : "Vente refusée", "error");
      }
    }
  };

  /* ================================== RENDU ================================= */
  if (boot.loading) {
    return (
      <div className="center" style={{ minHeight: "60vh" }}>
        <Spinner label="Chargement du catalogue de caisse…" />
      </div>
    );
  }
  if (boot.error === "network") {
    return (
      <div className="wrap">
        <div className="empty">
          <span className="emoji" aria-hidden>
            📡
          </span>
          <h3>Catalogue indisponible</h3>
          <p>
            Connectez-vous au réseau au moins une fois pour charger le catalogue
            de ce dépôt, puis la caisse fonctionnera hors-ligne.
          </p>
          <Button onClick={() => window.location.reload()}>Réessayer</Button>
        </div>
      </div>
    );
  }

  if (sold) {
    return (
      <SaleSuccess
        sold={sold}
        onNew={() => {
          setSold(null);
          setTimeout(() => searchRef.current?.focus(), 100);
        }}
      />
    );
  }

  return (
    <div className="pos-wrap">
      {/* Verrou « session obligatoire » (E6) : bloque la vente hors caisse */}
      <CashSessionGate />
      {/* ------------------------------ Catalogue ------------------------------ */}
      <section className="pos-catalog">
        <div className="pos-tools">
          <div className="input-icon" style={{ flex: 1, minWidth: 160 }}>
            <span>🔎</span>
            <input
              ref={searchRef}
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Rechercher ou scanner un code-barres…"
              autoFocus
              aria-label="Recherche produit ou scan code-barres"
            />
          </div>
          {canCameraScan ? (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setScanOpen(true)}
              aria-label="Scanner un code-barres avec la caméra"
              title="Scanner avec la caméra"
            >
              📷
            </button>
          ) : null}
          {boot.depots.length > 1 ? (
            <select
              className="select"
              style={{ width: "auto" }}
              value={boot.depotId ?? ""}
              onChange={(e) => setDepotId(e.target.value)}
              aria-label="Dépôt de vente"
            >
              {boot.depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          ) : (
            <Badge>
              {boot.depots.find((d) => d.id === boot.depotId)?.name ?? "Dépôt"}
            </Badge>
          )}
        </div>

        <div className="chips">
          <button
            className={`chip ${category === "" ? "active" : ""}`}
            onClick={() => setCategory("")}
          >
            Tout
          </button>
          {(b?.categories ?? []).map((c) => (
            <button
              key={c.id}
              className={`chip ${category === c.name ? "active" : ""}`}
              onClick={() => setCategory(c.name === category ? "" : c.name)}
            >
              {c.name}
            </button>
          ))}
        </div>

        {!search && !category && favorites.length > 0 ? (
          <>
            <h3
              className="muted"
              style={{
                margin: "10px 2px 6px",
                fontSize: "0.82rem",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              ⭐ Favoris
            </h3>
            <div className="pos-grid">
              {favorites.map((p) => (
                <ProductTile
                  key={`fav-${p.id}`}
                  productId={p.id}
                  name={p.name}
                  price={p.selling_price}
                  stock={stockByProduct.get(p.id) ?? 0}
                  onPick={pickProduct}
                />
              ))}
            </div>
          </>
        ) : null}

        <div className="pos-grid" style={{ marginTop: 10 }}>
          {filtered.map((p) => (
            <ProductTile
              key={p.id}
              productId={p.id}
              name={p.name}
              price={p.selling_price}
              stock={stockByProduct.get(p.id) ?? 0}
              onPick={pickProduct}
            />
          ))}
          {filtered.length === 0 ? (
            <p className="muted">
              Aucun produit ne correspond. Essayez un autre terme ou scannez le
              code-barres.
            </p>
          ) : null}
        </div>
        {boot.fromCache ? (
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: 8 }}>
            📴 Catalogue hors-ligne — les stocks affichés datent de la dernière
            synchronisation.
          </p>
        ) : null}
      </section>

      {/* ------------------------------- Panier -------------------------------- */}
      <aside className={`pos-cart pos-bar${cartOpen ? " open" : ""}`}>
        {/* Poignée mobile (≤ 480 px) — invisible au-delà, voir global.css R2. */}
        <button
          type="button"
          className="pos-bar-toggle"
          onClick={() => setCartOpen(!cartOpen)}
          aria-expanded={cartOpen}
        >
          <span aria-hidden>🧾</span> Panier
          <span className="pos-cart-count">
            {formatQty(cart.reduce((n, l) => n + l.quantity, 0))} article(s)
          </span>
          <span className="pos-bar-total money">{formatMoney(total)}</span>
          <span aria-hidden>{cartOpen ? "▾" : "▴"}</span>
        </button>
        <div className="pos-bar-body">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>🧾 Panier</h2>
            {cart.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setCart([])}>
                Vider
              </Button>
            ) : null}
          </div>

          {cart.length === 0 ? (
            <div className="empty empty-block" style={{ padding: "24px 8px" }}>
              <span className="emoji" aria-hidden>
                🛒
              </span>
              <h3>Panier vide</h3>
              <p>
                Touchez un produit ou scannez un code-barres pour commencer la
                vente.
              </p>
            </div>
          ) : (
            <>
              <div style={{ flex: 1, overflow: "auto" }}>
                {cart.map((l) => (
                  <div key={l.key} className="cart-line">
                    <div>
                      <div className="name product-name">{l.product.name}</div>
                      {l.variant ? (
                        <div className="muted" style={{ fontSize: "0.8rem" }}>
                          {l.variant.name}
                        </div>
                      ) : null}
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {formatMoney(l.unitPrice)} /{" "}
                        {l.unit?.symbol ?? l.product.unitSymbol ?? "u"}
                      </div>
                      {l.product.requiresSerial ? (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="info">🔢 Sérialisé</Badge>{" "}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSerialPick({
                                productId: l.product.id,
                                variantId: l.variant?.id ?? null,
                              })
                            }
                          >
                            Modifier les IMEI
                          </Button>
                          <div
                            className="muted"
                            style={{
                              fontSize: "0.72rem",
                              fontFamily: "monospace",
                              marginTop: 2,
                              wordBreak: "break-all",
                            }}
                          >
                            {(l.serialNumbers ?? []).join(" · ")}
                          </div>
                        </div>
                      ) : null}
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        {(b?.units ?? []).length > 1 &&
                        !l.product.requiresSerial ? (
                          <select
                            className="select"
                            style={{
                              padding: "2px 6px",
                              fontSize: "0.8rem",
                              width: "auto",
                            }}
                            value={l.unit?.id ?? ""}
                            onChange={(e) => {
                              if (e.target.value)
                                setUnit(l.key, e.target.value);
                            }}
                            aria-label="Unité de vente"
                          >
                            {(b?.units ?? []).map((u) => {
                              // Propose l'unité catalogue en tête, puis les dérivées de même famille (facteur multiple)
                              return (
                                <option key={u.id} value={u.id}>
                                  {u.symbol}
                                  {u.base_value !== 1
                                    ? ` ×${u.base_value}`
                                    : ""}
                                </option>
                              );
                            })}
                          </select>
                        ) : null}
                        <label
                          className="muted"
                          style={{
                            fontSize: "0.78rem",
                            display: "flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          Remise %
                          <input
                            style={{ width: 44 }}
                            inputMode="decimal"
                            value={l.discountPct ?? 0}
                            onChange={(e) =>
                              setDiscount(
                                l.key,
                                Number(e.target.value.replace(",", ".")) || 0,
                              )
                            }
                            aria-label="Remise en pourcentage"
                          />
                        </label>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 6,
                      }}
                    >
                      <div className="amount money">
                        {formatMoney(l.lineTotal)}
                      </div>
                      {l.product.requiresSerial ? (
                        <>
                          <div className="muted" style={{ fontSize: "0.8rem" }}>
                            {formatQty(l.quantity)} article(s)
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLine(l.key)}
                            aria-label="Retirer la ligne"
                          >
                            🗑️
                          </Button>
                        </>
                      ) : (
                        <div className="qty-stepper">
                          <button
                            onClick={() =>
                              l.quantity <= 1
                                ? removeLine(l.key)
                                : setQty(l.key, l.quantity - 1)
                            }
                            aria-label="Diminuer"
                          >
                            −
                          </button>
                          <span>{formatQty(l.quantity)}</span>
                          <button
                            onClick={() => setQty(l.key, l.quantity + 1)}
                            aria-label="Augmenter"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="cart-pay">
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <strong>Total</strong>
                  <strong className="money" style={{ fontSize: "1.25rem" }}>
                    {formatMoney(total)}
                  </strong>
                </div>
                <div className="pay-grid pos-bar-actions">
                  {METHODS.map((m) => (
                    <Button
                      key={m.id}
                      variant={m.id === "CASH" ? "primary" : "outline"}
                      size="lg"
                      onClick={() => setPayOpen(true)}
                    >
                      {m.icon} {m.label}
                    </Button>
                  ))}
                </div>
                {!online ? (
                  <p
                    className="muted"
                    style={{ fontSize: "0.8rem", marginTop: 6 }}
                  >
                    📴 Hors-ligne : la vente sera mise en file et synchronisée
                    automatiquement.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Choix de variante */}
      {variantPick ? (
        <VariantPicker
          productName={
            b?.products.find((p) => p.id === variantPick)?.name ?? ""
          }
          variants={
            b?.products.find((p) => p.id === variantPick)?.variants ?? []
          }
          stockByVariant={stockByVariant}
          onPick={(variantId) => addToCart(variantPick, variantId)}
          onClose={() => setVariantPick(null)}
        />
      ) : null}

      {/* Capture des numéros de série (IMEI) — produit sérialisé (E8) */}
      {serialPick
        ? (() => {
            const existing = cart.find(
              (l) =>
                l.key ===
                lineKey(serialPick.productId, serialPick.variantId, null),
            );
            return (
              <SerialPickerModal
                productName={
                  b?.products.find((p) => p.id === serialPick.productId)
                    ?.name ?? ""
                }
                variantName={
                  serialPick.variantId
                    ? (b?.products
                        .find((p) => p.id === serialPick.productId)
                        ?.variants.find((v) => v.id === serialPick.variantId)
                        ?.name ?? null)
                    : null
                }
                productId={serialPick.productId}
                depotId={b?.depotId ?? ""}
                online={online}
                initial={existing?.serialNumbers ?? []}
                onConfirm={(serials) =>
                  confirmSerials(
                    serialPick.productId,
                    serialPick.variantId,
                    serials,
                  )
                }
                onClose={() => setSerialPick(null)}
              />
            );
          })()
        : null}

      {/* Encaissement */}
      {payOpen ? (
        <PaymentModal
          total={total}
          customers={b?.customers ?? []}
          onClose={() => setPayOpen(false)}
          onConfirm={finishSale}
        />
      ) : null}

      {scanOpen ? (
        <Modal
          title="Scanner un code-barres"
          onClose={() => setScanOpen(false)}
        >
          <CameraScanner
            onDetect={onCameraDetect}
            onClose={() => setScanOpen(false)}
          />
        </Modal>
      ) : null}
    </div>
  );
}

/* ------------------------------ Tuile produit ------------------------------ */
function ProductTile({
  productId,
  name,
  price,
  stock,
  onPick,
}: {
  productId: string;
  name: string;
  price: number;
  stock: number;
  onPick: (id: string) => void;
}) {
  return (
    <button
      className="tile"
      onClick={() => onPick(productId)}
      disabled={stock <= 0}
      title={stock <= 0 ? "Rupture de stock" : name}
    >
      <span className="name">{name}</span>
      <span className="price">{formatMoney(price)}</span>
      <span
        className={`stock ${stock <= 0 ? "stock-out" : stock <= 5 ? "stock-low" : ""}`}
      >
        {stock <= 0 ? "Rupture" : `${formatQty(stock)} dispo.`}
      </span>
    </button>
  );
}

/* --------------------------- Sélecteur de variante -------------------------- */
function VariantPicker({
  productName,
  variants,
  stockByVariant,
  onPick,
  onClose,
}: {
  productName: string;
  variants: Array<{ id: string; name: string; additionalPrice: number }>;
  stockByVariant: Map<string, number>;
  onPick: (variantId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={`Variante — ${productName}`} onClose={onClose}>
      <div className="grid" style={{ gap: 8 }}>
        {variants.map((v) => {
          const stock = stockByVariant.get(v.id) ?? 0;
          return (
            <Button
              key={v.id}
              variant="outline"
              onClick={() => onPick(v.id)}
              disabled={stock <= 0}
            >
              {v.name}
              {v.additionalPrice
                ? ` (+${formatMoney(v.additionalPrice)})`
                : ""}{" "}
              <span className="muted">
                · {stock <= 0 ? "rupture" : `${formatQty(stock)} dispo.`}
              </span>
            </Button>
          );
        })}
      </div>
    </Modal>
  );
}

/* ------------------------------ Encaissement ------------------------------- */
function PaymentModal({
  total,
  customers,
  onClose,
  onConfirm,
}: {
  total: number;
  customers: PosCustomer[];
  onClose: () => void;
  onConfirm: (
    method: PaymentMethod,
    received: number | null,
    reference: string | null,
    customer?: PosCustomer | null,
    paidNow?: number | null,
    dueDate?: string | null,
  ) => Promise<void>;
}) {
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [received, setReceived] = useState<string>("");
  const [reference, setReference] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [paidStr, setPaidStr] = useState(""); // vide = total (comptant)
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const receivedNum = received ? Number(received.replace(",", ".")) : null;
  const change = changeDue(total, receivedNum);
  const paidNow =
    paidStr.trim() === "" ? null : Number(paidStr.replace(",", "."));
  const credit =
    paidNow != null && paidNow < total ? round2(total - paidNow) : 0;
  const customer = customers.find((c) => c.id === customerId) ?? null;
  const creditBlocked = credit > 1e-9 && !customer;
  const quick = [
    total,
    Math.ceil(total / 500) * 500,
    Math.ceil(total / 1000) * 1000,
    Math.ceil(total / 5000) * 5000,
  ];

  const confirm = async () => {
    if (method !== "CASH" && reference.trim().length < 3) return;
    if (creditBlocked) return;
    setBusy(true);
    try {
      await onConfirm(
        method,
        method === "CASH" ? receivedNum : total,
        method === "CASH" ? null : reference.trim(),
        customer,
        credit > 1e-9 && customer ? (paidNow ?? 0) : null,
        credit > 1e-9 && dueDate ? dueDate : null,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Encaisser"
      onClose={() => !busy && onClose()}
      footer={
        <Button
          size="lg"
          block
          loading={busy}
          onClick={confirm}
          disabled={
            (method !== "CASH" && reference.trim().length < 3) || creditBlocked
          }
        >
          ✅ Valider {formatMoney(total)}
        </Button>
      }
    >
      <div className="row-between" style={{ marginBottom: 12 }}>
        <span className="muted">À payer</span>
        <strong style={{ fontSize: "1.4rem" }}>{formatMoney(total)}</strong>
      </div>

      <Field
        label="Client (vente à crédit)"
        hint="Sélectionnez le client pour vendre à crédit ou partiellement payé. Créez la fiche depuis l’espace gérant s’il est absent."
      >
        <Select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          <option value="">— Comptant (sans client) —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.balance > 0 ? ` — solde ${formatMoney(c.balance)}` : ""}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Mode de paiement" required>
        <Select
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {METHODS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.icon} {m.label}
            </option>
          ))}
        </Select>
      </Field>

      {customer ? (
        <>
          <Field
            label="Montant payé maintenant"
            hint={`Vide = ${formatMoney(total)} (réglé en totalité). Saisissez une avance pour une vente partiellement payée, ou 0 pour une vente entièrement à crédit.`}
          >
            <Input
              inputMode="decimal"
              value={paidStr}
              onChange={(e) => setPaidStr(e.target.value)}
              placeholder={String(total)}
            />
          </Field>
          {credit > 1e-9 ? (
            <>
              <div className="pay-change" style={{ marginBottom: 10 }}>
                <span>Restera à payer</span>
                <strong>{formatMoney(credit)}</strong>
              </div>
              <Field label="Échéance (optionnel)">
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
            </>
          ) : null}
        </>
      ) : null}
      {creditBlocked ? (
        <p style={{ color: "var(--danger)", fontWeight: 600, marginTop: 8 }}>
          ⚠️ Un acompte inférieur au total exige de sélectionner un client
          (vente à crédit).
        </p>
      ) : null}

      {method === "CASH" ? (
        <>
          <Field label="Montant reçu">
            <Input
              inputMode="decimal"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              placeholder={String(total)}
              autoFocus
            />
          </Field>
          <div className="pay-quick">
            {[...new Set(quick)].map((amt) => (
              <button
                key={amt}
                className={receivedNum === amt ? "active" : ""}
                onClick={() => setReceived(String(amt))}
              >
                {formatMoney(amt)}
              </button>
            ))}
          </div>
          {receivedNum != null ? (
            <div className="pay-change">
              <span>Monnaie à rendre</span>
              <strong>{formatMoney(change)}</strong>
            </div>
          ) : null}
        </>
      ) : (
        <Field
          label={
            method === "MTN_MOMO"
              ? "Référence MTN MoMo (ID transaction)"
              : "Référence Orange Money"
          }
          required
          hint="Relevé dans le SMS de confirmation de l’opérateur."
        >
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Ex. MP240802.1234.A56789"
            autoFocus
          />
        </Field>
      )}
    </Modal>
  );
}

/* ------------------------------ Vente réussie ------------------------------ */
function SaleSuccess({ sold, onNew }: { sold: SoldState; onNew: () => void }) {
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const { show } = useToast();
  const change = changeDue(sold.total, sold.received);

  const loadReceipt = async (print = false) => {
    if (!sold.saleId) {
      show("Reçu disponible après synchronisation en ligne.", "info");
      return;
    }
    try {
      const r = await get<ReceiptData>(`/sales/${sold.saleId}/receipt`);
      setReceipt(r);
      if (print) setTimeout(() => window.print(), 150);
    } catch (e) {
      show(e instanceof Error ? e.message : "Reçu indisponible", "error");
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <div
        className="card card-pad center"
        style={{ flexDirection: "column", gap: 8 }}
      >
        <span style={{ fontSize: "3rem" }} aria-hidden>
          {sold.offline ? "📥" : "✅"}
        </span>
        <h1 style={{ margin: 0 }}>
          {sold.offline ? "Vente enregistrée (hors-ligne)" : "Vente validée"}
        </h1>
        <div className="kpi-value" style={{ color: "var(--primary)" }}>
          {formatMoney(sold.total)}
        </div>
        {sold.offline ? (
          <Badge tone="info">
            Mise en file — synchronisation automatique au retour du réseau
          </Badge>
        ) : (
          <Badge tone="ok">
            Stock déduit · {METHODS.find((m) => m.id === sold.method)?.label}
          </Badge>
        )}
        {sold.customerName ? (
          <p className="muted" style={{ margin: 0 }}>
            Client : <strong>{sold.customerName}</strong>
          </p>
        ) : null}
        {(sold.outstanding ?? 0) > 0 ? (
          <>
            <Badge tone="warn">Vente à crédit</Badge>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--warn)" }}>
              Reste à payer : {formatMoney(sold.outstanding ?? 0)}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
              Payé : {formatMoney(round2(sold.total - (sold.outstanding ?? 0)))}{" "}
              · l'encaissement du solde se fait depuis la fiche client.
            </p>
          </>
        ) : null}
        {sold.method === "CASH" && sold.received != null ? (
          <p className="muted" style={{ margin: 0 }}>
            Reçu {formatMoney(sold.received)} · monnaie{" "}
            <strong>{formatMoney(change)}</strong>
          </p>
        ) : null}
        {sold.reference ? (
          <p className="muted" style={{ margin: 0 }}>
            Référence : {sold.reference}
          </p>
        ) : null}
        <p className="muted" style={{ margin: 0 }}>
          {formatDateTime(sold.at)}
        </p>

        <div className="receipt-print" style={{ margin: "14px auto 0" }}>
          <div className="sep" />
          {sold.lines.map((l, i) => (
            <div key={i} className="line">
              <span>{l.label}</span>
              <span>
                {formatQty(l.qty)} {l.unit} · {formatMoney(l.total)}
              </span>
            </div>
          ))}
          <div className="tot">
            <div className="line">
              <span>TOTAL</span>
              <span>{formatMoney(sold.total)}</span>
            </div>
          </div>
        </div>

        <div
          className="no-print row"
          style={{ justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}
        >
          <Button size="lg" onClick={onNew}>
            🧾 Nouvelle vente
          </Button>
          {!sold.offline ? (
            <>
              <Button variant="outline" onClick={() => void loadReceipt(true)}>
                🖨️ Imprimer
              </Button>
              <Button variant="outline" onClick={() => void loadReceipt(false)}>
                👁️ Reçu
              </Button>
            </>
          ) : null}
        </div>

        {receipt ? (
          <div
            className="receipt-print no-print"
            style={{
              marginTop: 14,
              textAlign: "left",
              background: "var(--surface-2)",
              borderRadius: 10,
              padding: 12,
            }}
          >
            <pre
              style={{
                whiteSpace: "pre-wrap",
                margin: 0,
                fontFamily: "inherit",
                fontSize: "0.85rem",
              }}
            >
              {receipt.text}
            </pre>
            <div className="row" style={{ marginTop: 8 }}>
              <a
                className="btn btn-outline btn-sm"
                href={`https://wa.me/?text=${encodeURIComponent(receipt.text)}`}
                target="_blank"
                rel="noreferrer"
              >
                💬 Partager par WhatsApp
              </a>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReceipt(null)}
              >
                Fermer
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ======================== CAPTURE IMEI (PRODUIT SÉRIALISÉ) ================= */
/** Modale de saisie des numéros de série vendus : chaque article d'un produit
 *  sérialisé (téléphone, électronique…) est identifié par SON numéro (garantie,
 *  vol, SAV). En ligne, les numéros disponibles du dépôt sont proposés (puis
 *  vérifiés serveur à l'encaissement — l'API reste l'autorité). */
function SerialPickerModal({
  productName,
  variantName,
  productId,
  depotId,
  online,
  initial,
  onConfirm,
  onClose,
}: {
  productName: string;
  variantName: string | null;
  productId: string;
  depotId: string;
  online: boolean;
  initial: string[];
  onConfirm: (serials: string[]) => void;
  onClose: () => void;
}) {
  const { show } = useToast();
  const [selected, setSelected] = useState<string[]>(initial);
  const [entry, setEntry] = useState("");
  const [available, setAvailable] = useState<SerialRow[] | null>(null);
  const entryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    entryRef.current?.focus();
    if (!online || !depotId) return;
    get<{ rows: SerialRow[] }>(
      `/serials/product/${productId}?depotId=${depotId}`,
    )
      .then((r) => setAvailable(r.rows))
      .catch(() => setAvailable([]));
  }, [online, depotId, productId]);

  const addSerial = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    if (selected.some((x) => x.toLowerCase() === s.toLowerCase())) {
      show(`Le numéro « ${s} » est déjà dans la liste.`, "error");
      return;
    }
    setSelected((prev) => [...prev, s]);
    setEntry("");
    entryRef.current?.focus();
  };

  const suggestions = (available ?? []).filter(
    (r) => !selected.some((s) => s.toLowerCase() === r.serial.toLowerCase()),
  );

  return (
    <Modal
      title={`🔢 Numéros de série — ${productName}${variantName ? ` · ${variantName}` : ""}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={() => onConfirm(selected)}
            disabled={selected.length === 0}
          >
            Valider ({selected.length} article
            {selected.length > 1 ? "s" : ""})
          </Button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Chaque article vendu doit être identifié par son IMEI / n° de série
        (garantie & SAV). Scannez ou saisissez un numéro puis Entrée.
      </p>
      <Field label="Ajouter un numéro (douchette ou saisie)">
        <input
          ref={entryRef}
          className="input"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addSerial(entry);
            }
          }}
          placeholder="Ex. : 3567…"
          autoFocus
        />
      </Field>
      {selected.length > 0 ? (
        <div style={{ margin: "10px 0" }}>
          <strong style={{ fontSize: "0.85rem" }}>
            Sélectionnés ({selected.length}) :
          </strong>
          <div
            className="row"
            style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}
          >
            {selected.map((s) => (
              <span
                key={s}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  border: "1px solid var(--line, #e2e8f0)",
                  borderRadius: 999,
                  padding: "2px 8px",
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                }}
              >
                {s}
                <button
                  type="button"
                  aria-label={`Retirer ${s}`}
                  onClick={() =>
                    setSelected((prev) => prev.filter((x) => x !== s))
                  }
                  style={{
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {online && available !== null ? (
        <div style={{ marginTop: 12 }}>
          <strong style={{ fontSize: "0.85rem" }}>
            Disponibles dans le dépôt ({suggestions.length}) :
          </strong>
          {suggestions.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              {available.length === 0
                ? "Aucun numéro enregistré en stock pour ce produit."
                : "Tous les numéros disponibles sont déjà sélectionnés."}
            </p>
          ) : (
            <div
              className="row"
              style={{
                flexWrap: "wrap",
                gap: 6,
                marginTop: 6,
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {suggestions.map((r) => (
                <Button
                  key={r.id}
                  variant="outline"
                  size="sm"
                  onClick={() => addSerial(r.serial)}
                >
                  <span style={{ fontFamily: "monospace" }}>{r.serial}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 12 }}>
          📴 Hors-ligne : saisissez les numéros à la main — ils seront vérifiés
          automatiquement lors de la synchronisation.
        </p>
      )}
    </Modal>
  );
}
