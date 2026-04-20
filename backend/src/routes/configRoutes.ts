import express from 'express';
import { getConfigs, updateConfig } from '../controllers/configController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = express.Router();

router.get('/', authMiddleware, getConfigs);
router.put('/', authMiddleware, updateConfig);

export default router;
