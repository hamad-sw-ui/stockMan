import { Router } from 'express';
import { getDashboardStats, getPredictiveReport, getSuperAdminStats } from '../controllers/reportController';
import { authMiddleware, authorize } from '../middleware/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/dashboard', getDashboardStats);
router.get('/predictive', getPredictiveReport);
router.get('/superadmin/stats', authorize('SUPER_ADMIN'), getSuperAdminStats);

export default router;
