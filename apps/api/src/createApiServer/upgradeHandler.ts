import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import { checkBearerToken, isAllowedHostHeader, isAllowedOriginHeader, readHeaderValue } from "./security";

type TerminalRuntime = ReturnType<typeof import("../terminalRuntime").createTerminalRuntime>;

type CreateUpgradeHandlerOptions = {
  runtime: TerminalRuntime;
  allowRemoteAccess: boolean;
  bearerToken?: string;
};

export const createUpgradeHandler = ({
  runtime,
  allowRemoteAccess,
  bearerToken,
}: CreateUpgradeHandlerOptions) => {
  return (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const originHeader = readHeaderValue(request.headers.origin);
    const hostHeader = readHeaderValue(request.headers.host);
    if (!isAllowedHostHeader(hostHeader, allowRemoteAccess)) {
      socket.destroy();
      return;
    }

    if (!isAllowedOriginHeader(originHeader, allowRemoteAccess)) {
      socket.destroy();
      return;
    }

    if (allowRemoteAccess && bearerToken) {
      const authHeader = readHeaderValue(request.headers.authorization);
      if (!checkBearerToken(authHeader, bearerToken)) {
        socket.destroy();
        return;
      }
    }

    try {
      if (!runtime.handleUpgrade(request, socket, head)) {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  };
};
