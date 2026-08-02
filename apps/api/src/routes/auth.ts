import { Router } from "express";
import { z } from "zod";
import { h } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { authenticate, AuthRequest } from "../middleware/auth";
import { loginLimiter, registerLimiter } from "../middleware/security";
import * as authService from "../services/authService";

const router = Router();

export const passwordSchema = z
  .string()
  .min(8, "Mot de passe : 8 caractères minimum")
  .regex(/[a-zA-Z]/, "Mot de passe : au moins une lettre")
  .regex(/[0-9]/, "Mot de passe : au moins un chiffre");

// Emails normalisés en minuscules (unicité globale insensible à la casse)
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Email invalide")
  .max(255);

const registerSchema = z.object({
  tenantName: z.string().trim().min(2).max(255),
  userName: z.string().trim().min(2).max(255),
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().trim().max(50).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Mot de passe requis"),
});

const pinSchema = z.object({
  email: emailSchema,
  pin: z.string().regex(/^\d{4,6}$/, "Le PIN comporte 4 à 6 chiffres"),
});

function setRefreshCookie(res: import("express").Response, token: string) {
  const { name, options } = authService.refreshCookieConfig;
  res.cookie(name, token, options);
}

function clearRefreshCookie(res: import("express").Response) {
  res.clearCookie(authService.refreshCookieConfig.name, { path: "/api/auth" });
}

router.post(
  "/register",
  registerLimiter,
  validateBody(registerSchema),
  h(async (req, res) => {
    const session = await authService.register(req.body);
    setRefreshCookie(res, session.refreshToken);
    res
      .status(201)
      .json({ accessToken: session.accessToken, user: session.user });
  }),
);

router.post(
  "/login",
  loginLimiter,
  validateBody(loginSchema),
  h(async (req, res) => {
    const session = await authService.login(req.body.email, req.body.password);
    setRefreshCookie(res, session.refreshToken);
    res.json({ accessToken: session.accessToken, user: session.user });
  }),
);

router.post(
  "/pin",
  loginLimiter,
  validateBody(pinSchema),
  h(async (req, res) => {
    const session = await authService.loginWithPin(
      req.body.email,
      req.body.pin,
    );
    setRefreshCookie(res, session.refreshToken);
    res.json({ accessToken: session.accessToken, user: session.user });
  }),
);

router.post(
  "/refresh",
  h(async (req, res) => {
    const session = await authService.refresh(
      req.cookies?.[authService.refreshCookieConfig.name],
    );
    setRefreshCookie(res, session.refreshToken);
    res.json({ accessToken: session.accessToken, user: session.user });
  }),
);

router.post(
  "/logout",
  h(async (req, res) => {
    await authService.logout(
      req.cookies?.[authService.refreshCookieConfig.name],
    );
    clearRefreshCookie(res);
    res.json({ message: "Déconnecté" });
  }),
);

router.post(
  "/forgot-password",
  loginLimiter,
  validateBody(z.object({ email: emailSchema })),
  h(async (req, res) => {
    const result = await authService.forgotPassword(req.body.email);
    res.json({
      message: "Si un compte existe, un lien de réinitialisation a été envoyé.",
      ...(result.devToken ? { devToken: result.devToken } : {}),
    });
  }),
);

router.post(
  "/reset-password",
  validateBody(
    z.object({ token: z.string().min(10), newPassword: passwordSchema }),
  ),
  h(async (req, res) => {
    await authService.resetPassword(req.body.token, req.body.newPassword);
    res.json({
      message: "Mot de passe réinitialisé. Vous pouvez vous connecter.",
    });
  }),
);

router.get(
  "/me",
  authenticate,
  h(async (req, res) => {
    res.json(await authService.me((req as AuthRequest).user.id));
  }),
);

router.post(
  "/change-password",
  authenticate,
  validateBody(
    z.object({
      currentPassword: z.string().min(1),
      newPassword: passwordSchema,
    }),
  ),
  h(async (req, res) => {
    const session = await authService.changePassword(
      (req as AuthRequest).user.id,
      req.body.currentPassword,
      req.body.newPassword,
    );
    setRefreshCookie(res, session.refreshToken);
    res.json({ accessToken: session.accessToken, user: session.user });
  }),
);

export default router;
