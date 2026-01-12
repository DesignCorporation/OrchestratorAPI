import test from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveScopes, hasScope } from '../src/rbac';

test('Role mapping: ReadOnlyAuditor denies write/admin', () => {
  const scopes = getEffectiveScopes('ReadOnlyAuditor', ['orchestrator.control.write', 'orchestrator.admin']);
  assert.equal(hasScope(scopes, 'orchestrator.control.write'), false);
  assert.equal(hasScope(scopes, 'orchestrator.admin'), false);
  assert.equal(hasScope(scopes, 'orchestrator.control.read'), true);
});

test('Role mapping: Support allows control write but not admin', () => {
  const scopes = getEffectiveScopes('Support', ['orchestrator.admin']);
  assert.equal(hasScope(scopes, 'orchestrator.control.write'), true);
  assert.equal(hasScope(scopes, 'orchestrator.admin'), false);
});
