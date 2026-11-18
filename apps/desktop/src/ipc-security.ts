import {
  SystemGetInfoRequestSchema,
  SystemInfoSchema,
  type SystemInfo,
} from '@cash-sloth/contracts';

export interface SenderIdentity {
  webContentsId: number;
  frameProcessId: number;
  frameRoutingId: number;
  url: string;
}

/** Both the expected window and its current top-level frame must match. */
export function assertTrustedSender(
  actual: SenderIdentity | null,
  expected: SenderIdentity,
): void {
  if (
    actual === null ||
    actual.webContentsId !== expected.webContentsId ||
    actual.frameProcessId !== expected.frameProcessId ||
    actual.frameRoutingId !== expected.frameRoutingId ||
    actual.url !== expected.url
  ) {
    throw new Error('IPC sender is not authorized');
  }
}

export function handleSystemGetInfo(
  actual: SenderIdentity | null,
  expected: SenderIdentity,
  args: readonly unknown[],
  getInfo: () => SystemInfo,
): SystemInfo {
  return handleValidatedIpc(actual, expected, args, {
    request: SystemGetInfoRequestSchema,
    response: SystemInfoSchema,
  }, getInfo);
}

export interface RuntimeParser<T> {
  parse(value: unknown): T;
}

/** Every registered operation shares the same sender, envelope and runtime checks. */
export function handleValidatedIpc<TRequest, TResponse>(
  actual: SenderIdentity | null,
  expected: SenderIdentity,
  args: readonly unknown[],
  contract: { request: RuntimeParser<TRequest>; response: RuntimeParser<TResponse> },
  execute: (request: TRequest) => TResponse,
): TResponse {
  assertTrustedSender(actual, expected);
  if (args.length !== 1) throw new Error('IPC requires exactly one request envelope');
  let request: TRequest;
  try { request = contract.request.parse(args[0]); }
  catch { throw new Error('Invalid IPC request'); }
  const response = execute(request);
  try { return contract.response.parse(response); }
  catch { throw new Error('Invalid IPC response; reconcile any pending checkout before continuing'); }
}

/** Native file dialogs are asynchronous; authorize and validate before opening one. */
export async function handleValidatedAsyncIpc<TRequest, TResponse>(
  actual: SenderIdentity | null,
  expected: SenderIdentity,
  args: readonly unknown[],
  contract: { request: RuntimeParser<TRequest>; response: RuntimeParser<TResponse> },
  execute: (request: TRequest) => Promise<TResponse>,
): Promise<TResponse> {
  assertTrustedSender(actual, expected);
  if (args.length !== 1) throw new Error('IPC requires exactly one request envelope');
  let request: TRequest;
  try { request = contract.request.parse(args[0]); }
  catch { throw new Error('Invalid IPC request'); }
  const response = await execute(request);
  try { return contract.response.parse(response); }
  catch { throw new Error('Invalid file IPC response; inspect the operation result before retrying'); }
}
