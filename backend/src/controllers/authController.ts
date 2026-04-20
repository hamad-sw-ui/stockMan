import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'fallback_refresh_secret';

const generateAccessToken = (user: any) => {
  return jwt.sign(
    { id: user.id, tenantId: user.tenant_id || user.tenantId, role: user.role },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
};

const generateRefreshToken = (user: any) => {
  return jwt.sign(
    { id: user.id, tenantId: user.tenant_id || user.tenantId, role: user.role },
    REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};

export const register = async (req: Request, res: Response) => {
  // ... (Code identique jusqu'à l'insertion)
  const { tenantName, userName, email, password } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Création du Tenant
    const tenantRes = await client.query(
      'INSERT INTO tenants (name) VALUES ($1) RETURNING id',
      [tenantName]
    );
    const tenantId = tenantRes.rows[0].id;

    // 2. Hachage du mot de passe
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Création de l'utilisateur Admin
    const userRes = await client.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role) 
       VALUES ($1, $2, $3, $4, 'ADMIN') RETURNING id, name, email, role`,
      [tenantId, userName, email, passwordHash]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Inscription réussie',
      user: userRes.rows[0],
      tenantId
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de l\'inscription' });
  } finally {
    client.release();
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT u.*, t.name as tenant_name 
       FROM users u 
       JOIN tenants t ON u.tenant_id = t.id 
       WHERE u.email = $1`,
      [email]
    );

    if (result.rows.length === 0) return res.status(401).json({ message: 'Identifiants invalides' });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ message: 'Identifiants invalides' });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Envoyer le Refresh Token dans un cookie sécurisé
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 jours
    });

    res.json({
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenant_id,
        depotId: user.depot_id
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la connexion' });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.status(401).json({ message: 'Non authentifié' });

  try {
    const decoded: any = jwt.verify(refreshToken, REFRESH_SECRET);
    const accessToken = generateAccessToken(decoded);
    res.json({ accessToken });
  } catch (err) {
    res.status(403).json({ message: 'Token invalide' });
  }
};

export const logout = async (req: Request, res: Response) => {
  res.clearCookie('refreshToken');
  res.json({ message: 'Déconnecté' });
};
