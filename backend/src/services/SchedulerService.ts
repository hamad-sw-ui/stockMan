import cron from 'node-cron';
import pool from '../config/db';
import { NotificationService } from './NotificationService';

export class SchedulerService {
  static init() {
    console.log('🕒 Service de planification initialisé');

    // Tâche : Vérification des stocks bas (Toutes les heures à minute 0)
    cron.schedule('0 * * * *', async () => {
      console.log('Running task: Low stock check...');
      try {
        const tenants = await pool.query('SELECT id FROM tenants WHERE is_active = TRUE');
        
        for (const tenant of tenants.rows) {
          await NotificationService.checkLowStockAndNotify(tenant.id);
        }
      } catch (error) {
        console.error('Scheduler Error:', error);
      }
    });

    // Tâche : Rapport journalier aux propriétaires (Tous les jours à 20h00)
    cron.schedule('0 20 * * *', async () => {
      console.log('Running task: Daily Sales Report...');
      // À implémenter : Génération et envoi du rapport PDF par WhatsApp
    });
  }
}
