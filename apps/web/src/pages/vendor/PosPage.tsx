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
import { cartTotal, changeDue, makeLine, type CartLine } from "../../lib/cart";
import { formatDateTime, formatMoney, formatQty } from "../../lib/format";
import { ApiError, get, post } from "../../lib/http";
import { enqueueSale } from "../../lib/offline/outbox";
import { installAutoSync } from "../../lib/offline/sync";
import { usePosBootstrap, type BootstrapStatus } from "../../lib/pos";
import { useOnlineStatus } from "../../components/Shell";
import { useToast } from "../../store/toast";
import type { PaymentMethod, ReceiptData } from "../../lib/types";

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
  const [payOpen, setPayOpen] = useState(false);
  const [sold, setSold] = useState<SoldState | null>(null);
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
  const addToCart = (productId: string, variantId: string | null = null) => {
    if (!b) return;
    const p = b.products.find((x) => x.id === productId);
    if (!p) return;
    const v = variantId
      ? (p.variants.find((x) => x.id === variantId) ?? null)
      : null;
    const unit = p.unit_id ? (unitById.get(p.unit_id) ?? null) : null;
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
      unit: unit
        ? { id: unit.id, symbol: unit.symbol, baseValue: unit.base_value }
        : null,
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

  /** Ajout au panier par code-barres exact (produit ou variante) — chemin
   *  commun à la douchette USB, à la saisie Entrée et au scanner caméra. */
  const addByBarcode = (code: string): boolean => {
    if (!code || !b) return false;
    const byProduct = b.products.find((p) => p.barcode === code);
    if (byProduct) {
      pickProduct(byProduct.id);
      return true;
    }
    for (const p of b.products) {
      const v = p.variants.find((x) => x.barcode === code);
      if (v) {
        addToCart(p.id, v.id);
        return true;
      }
    }
    return false;
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
    }
  };

  // Résultat du scanner caméra : même comportement que la douchette.
  const onCameraDetect = (code: string) => {
    setScanOpen(false);
    if (!addByBarcode(code)) {
      show(`Aucun produit ne correspond au code « ${code} ».`, "error");
      return;
    }
    show("Produit ajouté au panier.", "success");
  };

  /* ------------------------------- Validation ------------------------------ */
  const finishSale = async (
    method: PaymentMethod,
    received: number | null,
    reference: string | null,
  ) => {
    if (!b || cart.length === 0) return;
    const clientSaleId = crypto.randomUUID();
    const payload = {
      depotId: b.depotId,
      items: cart.map((l) => ({
        productId: l.product.id,
        variantId: l.variant?.id ?? null,
        unitId: l.unit?.id ?? null,
        quantity: l.quantity,
        discountPct: l.discountPct ?? 0,
      })),
      paymentMethod: method,
      paymentReference: reference,
      clientSaleId,
      createdAt: new Date().toISOString(),
      amountReceived: received ?? undefined,
    };
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
      const res = await post<{ sale: { id: string; total_amount: number } }>(
        "/sales",
        payload,
      );
      setSold({
        saleId: res.sale.id,
        total: Number(res.sale.total_amount),
        received,
        method,
        reference,
        offline: false,
        lines: linesSnapshot,
        at,
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
      <aside className="pos-cart">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>🧾 Panier</h2>
          {cart.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setCart([])}>
              Vider
            </Button>
          ) : null}
        </div>

        {cart.length === 0 ? (
          <div className="empty" style={{ padding: "24px 8px" }}>
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
                    <div className="name">{l.product.name}</div>
                    {l.variant ? (
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {l.variant.name}
                      </div>
                    ) : null}
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {formatMoney(l.unitPrice)} /{" "}
                      {l.unit?.symbol ?? l.product.unitSymbol ?? "u"}
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      {(b?.units ?? []).length > 1 ? (
                        <select
                          className="select"
                          style={{
                            padding: "2px 6px",
                            fontSize: "0.8rem",
                            width: "auto",
                          }}
                          value={l.unit?.id ?? ""}
                          onChange={(e) => {
                            if (e.target.value) setUnit(l.key, e.target.value);
                          }}
                          aria-label="Unité de vente"
                        >
                          {(b?.units ?? []).map((u) => {
                            // Propose l'unité catalogue en tête, puis les dérivées de même famille (facteur multiple)
                            return (
                              <option key={u.id} value={u.id}>
                                {u.symbol}
                                {u.base_value !== 1 ? ` ×${u.base_value}` : ""}
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
                    <div className="amount">{formatMoney(l.lineTotal)}</div>
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
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-pay">
              <div className="row-between" style={{ marginBottom: 8 }}>
                <strong>Total</strong>
                <strong style={{ fontSize: "1.25rem" }}>
                  {formatMoney(total)}
                </strong>
              </div>
              <div className="pay-grid">
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

      {/* Encaissement */}
      {payOpen ? (
        <PaymentModal
          total={total}
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
  onClose,
  onConfirm,
}: {
  total: number;
  onClose: () => void;
  onConfirm: (
    method: PaymentMethod,
    received: number | null,
    reference: string | null,
  ) => Promise<void>;
}) {
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [received, setReceived] = useState<string>("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const receivedNum = received ? Number(received.replace(",", ".")) : null;
  const change = changeDue(total, receivedNum);
  const quick = [
    total,
    Math.ceil(total / 500) * 500,
    Math.ceil(total / 1000) * 1000,
    Math.ceil(total / 5000) * 5000,
  ];

  const confirm = async () => {
    if (method !== "CASH" && reference.trim().length < 3) {
      return;
    }
    setBusy(true);
    try {
      await onConfirm(
        method,
        method === "CASH" ? receivedNum : total,
        method === "CASH" ? null : reference.trim(),
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
          disabled={method !== "CASH" && reference.trim().length < 3}
        >
          ✅ Valider {formatMoney(total)}
        </Button>
      }
    >
      <div className="row-between" style={{ marginBottom: 12 }}>
        <span className="muted">À payer</span>
        <strong style={{ fontSize: "1.4rem" }}>{formatMoney(total)}</strong>
      </div>
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
