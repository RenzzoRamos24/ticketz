import { cacheLayer } from "../libs/cache";
import { logger } from "../utils/logger";

type JwtConfig = {
  secret: string | null;
  expiresIn: string;
  refreshSecret: string | null;
  refreshExpiresIn: string;
};

const CACHE_KEY_JWT_SECRET = "TICKETZ_JWT_SECRET";
const CACHE_KEY_JWT_REFRESH_SECRET = "TICKETZ_JWT_REFRESH_SECRET";

function generateSecret(length: number): string {
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+";
  let secret = "";
  for (let i = 0; i < length; i += 1) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    secret += charset[randomIndex];
  }
  return secret;
}

async function generateSecretIfNotExists(cacheKey: string): Promise<string> {
  let secret = await cacheLayer.get(cacheKey);
  if (!secret) {
    secret = generateSecret(32);
    await cacheLayer.set(cacheKey, secret);
    logger.debug(`[auth.ts] Generated ${cacheKey}: ${secret}`);
  } else {
    logger.debug(`[auth.ts] Loaded ${cacheKey}: ${secret}`);
  }
  return secret;
}

// PALAZ patch — sesión con ventana deslizante (Principio I, excepción
// tercera; specs/000-despliegue-ticketz-vps/research.md R-069/R-070/R-071;
// docs/diseno-sesion-renovacion-automatica.md).
//
// `refreshExpiresIn` deja de ser un valor fijo desde la emisión (antes:
// "7d", el mismo jrt seguía siendo válido 7 días desde el login, sin
// importar cuánta actividad hubiera). CreateTokens.ts::createRefreshToken()
// usa este valor en CADA emisión — tanto en el login inicial
// (AuthUserService) como en cada refresco (RefreshTokenService) — así que
// bajar el valor a un número corto y fijo produce una ventana deslizante
// SOLA, sin lógica adicional: cada refresco reemite con vencimiento
// "ahora + N minutos", nunca heredado de la emisión original. Confirmado
// que no hace falta refresco proactivo para que esto funcione como
// "expira tras inactividad real": no existe ningún sondeo periódico por
// REST en el frontend (verificado, ver diseno-sesion-renovacion-automatica.md
// §2.1) — toda llamada REST, y por tanto todo refresco, es resultado de
// una acción real de la persona.
//
// Valor confirmado explícitamente por Renzo (2026-08-31, no elegido acá
// sin más — condición (c) de la excepción tercera): 30 minutos de
// inactividad. Configurable por si el valor necesita ajustarse sin
// recompilar; el default es el mismo valor ya confirmado, no un
// "razonable" inventado.
const DEFAULT_SESSION_INACTIVITY_TIMEOUT_MIN = 30;
const sessionInactivityTimeoutMin =
  Number(process.env.SESSION_INACTIVITY_TIMEOUT_MIN) ||
  DEFAULT_SESSION_INACTIVITY_TIMEOUT_MIN;

const jwtConfig: JwtConfig = {
  secret: null,
  // Token de acceso: sin cambios, 15 minutos (Renzo confirmó que no hace
  // falta acortarlo — la ventana de inactividad de 30 min ya lo cubre).
  expiresIn: "15m",
  refreshSecret: null,
  refreshExpiresIn: `${sessionInactivityTimeoutMin}m`
};

const secretPromise = generateSecretIfNotExists(CACHE_KEY_JWT_SECRET);
const refreshSecretPromise = generateSecretIfNotExists(
  CACHE_KEY_JWT_REFRESH_SECRET
);

Promise.all([secretPromise, refreshSecretPromise]).then(
  ([secret, refreshSecret]) => {
    jwtConfig.secret = secret;
    jwtConfig.refreshSecret = refreshSecret;
  }
);

export default jwtConfig;
