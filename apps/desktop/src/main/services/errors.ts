import type { ErrorCode } from "@automation-studio/shared-types";

/** Erro esperado, com mensagem segura para o usuário. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
