import { Sequelize } from "sequelize";
import { randomUUID } from "crypto";
import User from "../../models/User";
import AppError from "../../errors/AppError";
import {
  createAccessToken,
  createRefreshToken
} from "../../helpers/CreateTokens";
import { SerializeUser } from "../../helpers/SerializeUser";
import Queue from "../../models/Queue";
import Company from "../../models/Company";
import Setting from "../../models/Setting";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import UpdateSettingService from "../SettingServices/UpdateSettingService";

interface SerializedUser {
  id: number;
  name: string;
  email: string;
  profile: string;
  queues: Queue[];
  companyId: number;
}

interface Request {
  email: string;
  password: string;
  language?: string;
}

interface Response {
  serializedUser: SerializedUser;
  token: string;
  refreshToken: string;
  // PALAZ patch (excepción octava, R-095) — identifica este login como un
  // "dispositivo" para el límite de sesiones simultáneas.
  sessionId: string;
}

const AuthUserService = async ({
  email,
  password,
  language
}: Request): Promise<Response> => {
  const user = await User.findOne({
    where: Sequelize.where(
      Sequelize.fn("LOWER", Sequelize.col("email")),
      email.toLowerCase()
    ),
    include: ["queues", { model: Company, include: [{ model: Setting }] }]
  });

  if (!user) {
    throw new AppError("ERR_INVALID_CREDENTIALS", 401);
  }

  if (!(await user.checkPassword(password))) {
    throw new AppError("ERR_INVALID_CREDENTIALS", 401);
  }

  if (user.super && language) {
    if (!(await GetCompanySetting(1, "defaultLanguage", null))) {
      UpdateSettingService({
        key: "defaultLanguage",
        value: language,
        companyId: 1
      });
    }
  }

  // PALAZ patch — multi-dispositivo (Principio I, excepción OCTAVA; R-095;
  // docs/propuesta-enmienda-constitucion-10.0.0.md).
  //
  // `sessionId` YA EXISTÍA en el payload de ambos tokens (CreateTokens.ts)
  // pero nadie lo rellenaba ni lo leía — igual que estaba `caption` antes
  // del patch 004. Al poblarlo, cada login queda identificado, y varias
  // pestañas del mismo navegador comparten token → comparten sessionId →
  // cuentan como UN dispositivo, no como varios (condición j.3).
  const sessionId = randomUUID();

  const token = createAccessToken(user, { sessionId });
  const refreshToken = createRefreshToken(user, { sessionId });

  const serializedUser = await SerializeUser(user);

  return {
    serializedUser,
    token,
    refreshToken,
    // PALAZ patch (excepción octava, R-095) — lo consume SessionController
    // para decidir a qué sesión cerrar si se supera el límite.
    sessionId
  };
};

export default AuthUserService;
