import { Router } from 'express';
import { getAllTenants, toggleTenantStatus } from '../controllers/tenantController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();
router.use(authMiddleware);

router.get('/', getAllTenants);
router.patch('/:id/status', toggleTenantStatus);

export default router;
