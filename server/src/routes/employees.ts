import { Router } from 'express';
import { authMiddleware, authorize } from '../middleware/auth';
import {
    createEmployeeHandler,
    listEmployeesHandler,
    getEmployeeHandler,
    updateEmployeeHandler,
    deactivateEmployeeHandler,
} from '../controllers/employee.controller';

const router = Router();

// Enforce JWT and ADMIN role on every route in this file.
router.use(authMiddleware);
router.use(authorize(['ADMIN']));

router.get('/', listEmployeesHandler);
router.post('/', createEmployeeHandler);
router.get('/:id', getEmployeeHandler);
router.put('/:id', updateEmployeeHandler);
router.delete('/:id', deactivateEmployeeHandler);

export default router;
