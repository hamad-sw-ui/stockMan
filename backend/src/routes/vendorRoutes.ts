import { Router } from 'express';
import { getVendors, createVendor } from '../controllers/vendorController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();
router.use(authMiddleware);

router.get('/', getVendors);
router.post('/', createVendor);

export default router;
