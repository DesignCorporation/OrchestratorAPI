const ROLE_SCOPES: Record<string, string[]> = {
  OperatorAdmin: [
    'orchestrator.control.read',
    'orchestrator.control.write',
    'orchestrator.admin',
    'orchestrator.impersonate'
  ],
  Support: ['orchestrator.control.read', 'orchestrator.control.write'],
  ReadOnlyAuditor: ['orchestrator.control.read'],
  BreakGlassAdmin: [
    'orchestrator.control.read',
    'orchestrator.control.write',
    'orchestrator.admin',
    'orchestrator.impersonate'
  ]
};

export function getEffectiveScopes(role?: string, tokenScopes?: string[]): string[] {
  if (role && ROLE_SCOPES[role]) {
    return ROLE_SCOPES[role];
  }
  return tokenScopes || [];
}

export function hasScope(scopes: string[], scope: string): boolean {
  return scopes.includes(scope);
}
