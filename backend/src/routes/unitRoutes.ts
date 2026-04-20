import { Router } from 'express';
import { getUnits, createUnit, deleteUnit } from '../controllers/unitController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();
router.use(authMiddleware);

router.get('/', getUnits);
router.post('/', createUnit);
router.delete('/:id', deleteUnit);

export default router;
