import { jsPDF } from 'jspdf';
import bwipjs from 'bwip-js';
import { Product, ProductVariant } from '@/types';

/**
 * Service de génération d'étiquettes PDF pour StockMan
 */
export const labelService = {
  
  /**
   * Génère un code-barres en tant qu'image (Data URL)
   */
  async generateBarcode(text: string, type: string = 'code128'): Promise<string> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      try {
        bwipjs.toCanvas(canvas, {
          bcid: type,       // Barcode type
          text: text,       // Text to encode
          scale: 3,         // 3x scaling factor
          height: 10,       // Bar height, in millimeters
          includetext: true, // Show human-readable text
          textxalign: 'center',
        });
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    });
  },

  /**
   * Génère un PDF contenant une planche d'étiquettes pour un produit ou une variante
   */
  async generateProductLabels(
    product: Product, 
    variant?: ProductVariant, 
    tenantName: string = 'StockMan',
    quantity: number = 1
  ) {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const barcodeText = variant?.barcode || product.barcode || product.id;
    const priceText = `${(product.sellingPrice + (variant?.additionalPrice || 0)).toLocaleString()} FCFA`;
    const productName = variant ? `${product.name} (${variant.name})` : product.name;
    
    const barcodeDataUrl = await this.generateBarcode(barcodeText);

    // Configuration de la grille (Planche d'étiquettes standard A4 - 3x8)
    const labelWidth = 60;
    const labelHeight = 30;
    const marginX = 10;
    const marginY = 15;
    const gap = 5;

    let currentX = marginX;
    let currentY = marginY;

    for (let i = 0; i < quantity; i++) {
      // Dessiner le cadre de l'étiquette (optionnel, pour découpe)
      doc.setDrawColor(230, 230, 230);
      doc.rect(currentX, currentY, labelWidth, labelHeight);

      // Texte : Organisation
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(tenantName.toUpperCase(), currentX + 2, currentY + 5);

      // Texte : Nom Produit
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      const truncatedName = doc.truncateV6 ? productName : productName.substring(0, 25);
      doc.text(truncatedName, currentX + 2, currentY + 10);

      // Barcode
      doc.addImage(barcodeDataUrl, 'PNG', currentX + 5, currentY + 12, 50, 12);

      // Prix
      doc.setFontSize(10);
      doc.text(priceText, currentX + labelWidth - 2, currentY + 28, { align: 'right' });

      // Calculer la position suivante
      currentX += labelWidth + gap;
      if (currentX + labelWidth > 210) { // Nouvelle ligne
        currentX = marginX;
        currentY += labelHeight + gap;
      }

      if (currentY + labelHeight > 297) { // Nouvelle page
        doc.addPage();
        currentX = marginX;
        currentY = marginY;
      }
    }

    doc.save(`etiquettes-${product.name.replace(/\s+/g, '-')}.pdf`);
  }
};
