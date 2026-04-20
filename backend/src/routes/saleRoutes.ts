import { Router } from 'express';
import { createSale, getSalesHistory } from '../controllers/saleController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.post('/', createSale);
router.get('/history', getSalesHistory);

export default router;
