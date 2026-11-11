// Stand-in for src/main/services/auth-service.ts: a signed-in employee that each test sets directly.
type TestSession = { employeeId: string | null; branchId: string | null; permissions: Record<string, string[]> };

let session: TestSession | null = null;

export function setTestSession(next: TestSession | null): void {
  session = next;
}

export function hasPermission(module: string, action: string): boolean {
  return session?.permissions[module]?.includes(action) ?? false;
}

export function requirePermission(module: string, action: string): void {
  if (!session) throw new Error("You must be signed in to do that");
  if (!hasPermission(module, action)) throw new Error(`Your role doesn't have permission to ${action} ${module}`);
}

export function requirePermissionAnyOf(checks: Array<[string, string]>): void {
  if (!session) throw new Error("You must be signed in to do that");
  if (!checks.some(([module, action]) => hasPermission(module, action))) throw new Error("Your role doesn't have permission");
}

export function getCurrentBranchScope(): string | null {
  return session?.branchId ?? null;
}

export function getCurrentEmployeeId(): string | null {
  return session?.employeeId ?? null;
}

export function getCurrentEmployeeName(): string | null {
  return session?.employeeId ? "Test Employee" : null;
}

export function requireSignedIn(): void {
  if (!session) throw new Error("You must be signed in to do that");
}

export function getSession(): { employee: { id: string; firstName: string; lastName: string }; branch: { id: string } | null } | null {
  if (!session) return null;
  return { employee: { id: session.employeeId ?? "", firstName: "Test", lastName: "Employee" }, branch: session.branchId ? { id: session.branchId } : null };
}

export function getCurrentIsSuperAdmin(): boolean {
  return false;
}

export function resolveReportLocationScope(explicitLocationId: string | null | undefined): string | null {
  return session?.branchId ?? explicitLocationId ?? null;
}
