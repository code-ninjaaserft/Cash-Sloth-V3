let demoSession: string | null = null;
export function configureOperationStorage(sessionId: string | null): void { demoSession = sessionId; }
// Demo pointers must never replace real payment recovery information.
export const operationStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
 getItem(key) { return demoSession ? window.sessionStorage.getItem(demoSession + ':' + key) : window.localStorage.getItem(key); },
 setItem(key, value) { if (demoSession) window.sessionStorage.setItem(demoSession + ':' + key, value); else window.localStorage.setItem(key, value); },
 removeItem(key) { if (demoSession) window.sessionStorage.removeItem(demoSession + ':' + key); else window.localStorage.removeItem(key); },
};
