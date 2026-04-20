import { Router } from 'express';
import { getSuppliers, createSupplier } from '../controllers/supplierController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();
router.use(authMiddleware);

router.get('/', getSuppliers);
router.post('/', createSupplier);

export default router;
