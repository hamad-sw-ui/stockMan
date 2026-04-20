import { Router } from 'express';
import { adjustStock, getStockMovements } from '../controllers/stockController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Toutes les routes de stock nécessitent d'être authentifié
router.use(authMiddleware);

router.post('/adjust', adjustStock);
router.get('/movements', getStockMovements);

export default router;
