import pool from '../config/db';

export class NotificationService {
  /**
   * Vérifie les stocks bas pour un tenant et notifie le propriétaire
   */
  static async checkLowStockAndNotify(tenantId: string) {
    try {
      // 1. Récupérer les produits en alerte
      const lowStockProducts = await pool.query(
        `SELECT name, quantity, min_stock_level 
         FROM products 
         WHERE tenant_id = $1 AND quantity <= min_stock_level`,
        [tenantId]
      );

      if (lowStockProducts.rows.length === 0) return;

      // 2. Récupérer les configs API du tenant
      const configRes = await pool.query(
        "SELECT key, value FROM configs WHERE tenant_id = $1",
        [tenantId]
      );
      const configs = configRes.rows.reduce((acc: any, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});

      // 3. Récupérer le contact du propriétaire
      const ownerRes = await pool.query(
        "SELECT email, name FROM users WHERE tenant_id = $1 AND role = 'ADMIN' LIMIT 1",
        [tenantId]
      );
      const owner = ownerRes.rows[0];

      if (!owner) return;

      const message = `⚠️ ALERTE STOCK BAS - STOCKMAN\n\nBonjour ${owner.name},\nLes produits suivants sont presque épuisés :\n` +
        lowStockProducts.rows.map(p => `- ${p.name}: ${p.quantity} restant (Seuil: ${p.min_stock_level})`).join('\n') +
        `\n\nConnectez-vous pour passer commande.`;

      // 4. Envoi Simulé (Logique à remplacer par l'API réelle)
      console.log(`[NOTIFICATION] Envoi à ${owner.email} (${tenantId}) :`);
      console.log(message);

      // Si WhatsApp configuré (Simulation)
      if (configs.whatsapp_api_token) {
        this.sendWhatsApp(configs.whatsapp_phone_number_id, 'PHONE_NUMBER_HERE', message);
      }

    } catch (error) {
      console.error('Erreur NotificationService:', error);
    }
  }

  static async sendWhatsApp(phoneId: string, to: string, message: string) {
    // Logique réelle Meta API ici
    console.log(`[WHATSAPP MOCK] Message envoyé au ${to} via ID ${phoneId}`);
  }

  static async sendSMS(to: string, message: string) {
    // Logique réelle Africa's Talking ici
    console.log(`[SMS MOCK] Message envoyé au ${to}`);
  }
}
