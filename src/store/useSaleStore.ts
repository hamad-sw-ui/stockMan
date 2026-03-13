import { create } from 'zustand';
import { SaleItem, PaymentMethod } from '@/types';

interface SaleState {
  cart: SaleItem[];
  paymentMethod: PaymentMethod;
  addToCart: (item: SaleItem) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  clearCart: () => void;
}

export const useSaleStore = create<SaleState>((set) => ({
  cart: [],
  paymentMethod: 'CASH',
  addToCart: (item) => set((state) => {
    const existingItem = state.cart.find((i) => i.productId === item.productId);
    if (existingItem) {
      return {
        cart: state.cart.map((i) =>
          i.productId === item.productId
            ? { ...i, quantity: i.quantity + item.quantity, totalPrice: (i.quantity + item.quantity) * i.unitPrice }
            : i
        ),
      };
    }
    return { cart: [...state.cart, item] };
  }),
  removeFromCart: (productId) => set((state) => ({
    cart: state.cart.filter((i) => i.productId !== productId),
  })),
  updateQuantity: (productId, quantity) => set((state) => ({
    cart: state.cart.map((i) =>
      i.productId === productId ? { ...i, quantity, totalPrice: quantity * i.unitPrice } : i
    ),
  })),
  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
  clearCart: () => set({ cart: [], paymentMethod: 'CASH' }),
}));
